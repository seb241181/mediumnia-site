/* global process */
import { createHmac } from 'node:crypto'
import { decrypt, encrypt, parisUTCOffsetMs, refreshGoogleToken } from './googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import {
  createRdvDepositPayPalOrder,
  isPayableDepositService,
  runtimeRdvDepositPayPalConfig,
} from './rdvDepositPayPal.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TERMS_VERSION = 'rdv-arrhes-2026-09-16-v1'

function publicError(res, code, status = 409) {
  return res.status(status).json({ error: code })
}

function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const midnight = new Date(`${dateStr}T00:00:00Z`).getTime() + offsetMs
  return new Date(midnight + hours * 3_600_000 + minutes * 60_000)
}

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  return xff ? xff.split(',')[0].trim().toLowerCase() : null
}

async function checkRateLimit(req, res, supabase) {
  const secret = String(process.env.RDV_RATE_LIMIT_SECRET || '').trim()
  const clientIp = extractClientIp(req)
  if (!/^[0-9a-fA-F]{64}$/.test(secret) || !clientIp) {
    publicError(res, 'rdv_payment_unavailable', 503)
    return true
  }
  const ipHash = createHmac('sha256', secret).update(clientIp).digest('hex')
  try {
    const { data, error } = await supabase.rpc('consume_api_rate_limit', {
      p_ip_hash: ipHash,
      p_endpoint: 'rdv_full_payment_create',
      p_hourly_limit: 10,
      p_daily_limit: 30,
    })
    if (error) throw error
    if (!data?.allowed) {
      publicError(res, 'rate_limit_exceeded', 429)
      return true
    }
  } catch {
    publicError(res, 'rdv_payment_unavailable', 503)
    return true
  }
  return false
}

async function validateServerAvailability({ supabase, practitioner, service, date, time }) {
  if (!practitioner.is_active || !practitioner.booking_enabled) throw new Error('booking_unavailable')
  const offsetMs = parisUTCOffsetMs(date)
  const startsAt = parisTimeToUTC(date, time, offsetMs)
  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000)

  if (startsAt.getTime() < Date.now() + (practitioner.min_advance_hours ?? 0) * 3_600_000) throw new Error('slot_too_soon')
  if (practitioner.booking_horizon_days) {
    const latest = new Date()
    latest.setDate(latest.getDate() + practitioner.booking_horizon_days)
    if (startsAt > latest) throw new Error('slot_outside_horizon')
  }

  const { data: exception } = await supabase
    .from('booking_exceptions')
    .select('exception_type, slots')
    .eq('practitioner_id', practitioner.id)
    .eq('exception_date', date)
    .maybeSingle()
  if (exception?.exception_type === 'closed') throw new Error('slot_closed')

  let rules = exception?.exception_type === 'modified' && exception.slots?.length ? exception.slots : null
  if (!rules) {
    const jsDay = new Date(`${date}T12:00:00Z`).getDay()
    const dbDay = (jsDay + 6) % 7
    const { data, error } = await supabase
      .from('booking_availability_rules')
      .select('start_time, end_time')
      .eq('practitioner_id', practitioner.id)
      .eq('day_of_week', dbDay)
      .order('start_time')
    if (error || !data?.length) throw new Error('slot_outside_rules')
    rules = data
  }

  const fitsRule = rules.some(rule => {
    const start = parisTimeToUTC(date, rule.start_time, offsetMs)
    const end = parisTimeToUTC(date, rule.end_time, offsetMs)
    return startsAt >= start && endsAt <= end
  })
  if (!fitsRule) throw new Error('slot_outside_rules')

  const { data: connection } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()
  if (!connection?.google_calendar_id || connection.google_calendar_id === 'primary') throw new Error('google_calendar_unavailable')

  let accessToken
  try {
    if (Date.now() > new Date(connection.token_expiry).getTime() - 60_000) {
      const refreshed = await refreshGoogleToken(connection.refresh_token_enc)
      accessToken = refreshed.access_token
      await supabase.from('booking_calendar_connections').update({
        access_token_enc: encrypt(accessToken),
        token_expiry: refreshed.expires_at,
        updated_at: new Date().toISOString(),
      }).eq('practitioner_id', practitioner.id)
    } else {
      accessToken = decrypt(connection.access_token_enc)
    }
  } catch {
    throw new Error('google_calendar_unavailable')
  }

  const beforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
  const afterMs = (practitioner.buffer_after_min ?? 0) * 60_000
  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date(startsAt.getTime() - beforeMs).toISOString(),
        timeMax: new Date(endsAt.getTime() + afterMs).toISOString(),
        timeZone: practitioner.timezone || 'Europe/Paris',
        items: [{ id: connection.google_calendar_id }],
      }),
    })
    if (!response.ok) throw new Error('freebusy_failed')
    const body = await response.json()
    if ((body.calendars?.[connection.google_calendar_id]?.busy || []).length > 0) throw new Error('slot_unavailable')
  } catch (error) {
    if (error?.message === 'slot_unavailable') throw error
    throw new Error('google_calendar_unavailable')
  }

  return { startsAt, endsAt }
}

export async function handleRdvFullPaymentCreate(req, res) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  if (!isSupabaseConfigured()) return publicError(res, 'supabase_not_configured', 503)

  let cfg
  try {
    cfg = runtimeRdvDepositPayPalConfig()
  } catch (error) {
    return publicError(res, error.message || 'paypal_unavailable', 503)
  }

  const {
    practitioner_slug,
    service_slug,
    date,
    time,
    selected_modality,
    customer,
    client_checkout_id,
    terms_accepted,
    early_performance_requested,
  } = req.body || {}

  if (!practitioner_slug || !service_slug || !DATE_RE.test(date || '') || !TIME_RE.test(time || '')) return publicError(res, 'invalid_booking_request', 400)
  if (selected_modality !== 'video') return publicError(res, 'full_payment_video_only', 409)
  if (!UUID_RE.test(client_checkout_id || '')) return publicError(res, 'invalid_payment_request', 400)
  if (!customer?.firstName?.trim() || !customer?.lastName?.trim() || !EMAIL_RE.test(customer?.email?.trim() || '')) return publicError(res, 'invalid_customer', 400)
  if (terms_accepted !== true) return publicError(res, 'terms_required', 400)
  if (early_performance_requested !== true) return publicError(res, 'early_performance_consent_required', 400)

  const supabase = getSupabaseAdmin()
  if (await checkRateLimit(req, res, supabase)) return

  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id, timezone, is_active, booking_enabled, booking_horizon_days, min_advance_hours, buffer_before_min, buffer_after_min')
    .eq('slug', practitioner_slug)
    .single()
  if (!practitioner) return publicError(res, 'practitioner_not_found', 404)

  const { data: service } = await supabase
    .from('booking_services')
    .select('id, title, duration_min, price_cents, currency, modality, booking_mode, is_active, reservation_payment_kind, reservation_payment_cents')
    .eq('slug', service_slug)
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()
  if (!service) return publicError(res, 'service_not_found', 404)
  if (!isPayableDepositService(service, 'video')) return publicError(res, 'service_not_payable_online', 409)

  let slot
  try {
    slot = await validateServerAvailability({ supabase, practitioner, service, date, time })
  } catch (error) {
    return publicError(res, error.message || 'slot_unavailable', error.message === 'google_calendar_unavailable' ? 503 : 409)
  }

  const { data: holdResult, error: holdError } = await supabase.rpc('create_rdv_full_payment_hold', {
    p_practitioner_id: practitioner.id,
    p_service_id: service.id,
    p_starts_at: slot.startsAt.toISOString(),
    p_ends_at: slot.endsAt.toISOString(),
    p_selected_modality: 'video',
    p_customer_first_name: customer.firstName.trim(),
    p_customer_last_name: customer.lastName.trim(),
    p_customer_email: customer.email.trim().toLowerCase(),
    p_customer_phone: customer.phone?.trim() || null,
    p_customer_message: customer.message?.trim() || null,
    p_client_checkout_id: client_checkout_id,
    p_paypal_env: cfg.env,
    p_terms_version: TERMS_VERSION,
    p_early_performance_requested: true,
  })
  if (holdError || !holdResult?.ok) return publicError(res, holdResult?.error || 'hold_creation_failed', 409)

  const { data: payment, error: paymentError } = await supabase
    .from('rdv_paypal_payments')
    .select('id, paypal_order_id, client_checkout_id, amount_cents, currency')
    .eq('hold_id', holdResult.hold_id)
    .single()
  if (paymentError || !payment) return publicError(res, 'payment_lookup_failed', 500)

  let orderId = payment.paypal_order_id
  if (!orderId) {
    try {
      const created = await createRdvDepositPayPalOrder({
        holdId: holdResult.hold_id,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        serviceTitle: service.title,
        paymentOption: 'full',
      })
      const { error: updateError } = await supabase
        .from('rdv_paypal_payments')
        .update({ paypal_order_id: created.orderId })
        .eq('id', payment.id)
        .is('paypal_order_id', null)
      if (updateError) throw new Error('payment_order_store_failed')
      orderId = created.orderId
    } catch (error) {
      return publicError(res, error.message || 'paypal_create_order_failed', 502)
    }
  }

  return res.status(201).json({
    id: orderId,
    checkoutId: payment.client_checkout_id,
    expiresAt: holdResult.expires_at,
    amount: (service.price_cents / 100).toFixed(2),
    servicePrice: (service.price_cents / 100).toFixed(2),
    currency: service.currency,
    paymentChoice: 'full_payment',
    reused: Boolean(holdResult.existing),
  })
}
