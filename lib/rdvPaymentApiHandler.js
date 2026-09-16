/* global process */
import { createHmac } from 'node:crypto'
import { decrypt, encrypt, parisUTCOffsetMs, refreshGoogleToken } from './googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { syncBookingToGoogleCalendar } from './googleCalendarEvents.js'
import { createCancellationToken, bookingCancellationUrl } from './bookingCancellation.js'
import { buildRdvPaymentConfirmation } from './rdvPaymentConfirmationEmail.js'
import { sendEmail } from './transactionalEmail.js'
import {
  captureRdvPayPalOrder,
  createRdvPayPalOrder,
  isPayableRdvService,
  rdvPaymentPayPalConfig,
  runtimeRdvPaymentPayPalConfig,
  verifyRdvPayPalPayment,
} from './rdvPaymentPayPal.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORDER_RE = /^[A-Za-z0-9_-]{5,80}$/
const TERMS_VERSION = 'rdv-payment-2026-09-16-v2'
const HOURLY_LIMIT = 10
const DAILY_LIMIT = 30

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
  if (!xff) return null
  return xff.split(',')[0].trim().toLowerCase()
}

async function checkRateLimit(req, res, supabase) {
  const secret = String(process.env.RDV_RATE_LIMIT_SECRET || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    publicError(res, 'rdv_payment_unavailable', 503)
    return true
  }
  const clientIp = extractClientIp(req)
  if (!clientIp) {
    publicError(res, 'rdv_payment_unavailable', 503)
    return true
  }
  const ipHash = createHmac('sha256', secret).update(clientIp).digest('hex')
  try {
    const { data, error } = await supabase.rpc('consume_api_rate_limit', {
      p_ip_hash: ipHash,
      p_endpoint: 'rdv_payment_create',
      p_hourly_limit: HOURLY_LIMIT,
      p_daily_limit: DAILY_LIMIT,
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

async function loadPaymentByCheckoutId(supabase, checkoutId) {
  const { data, error } = await supabase
    .from('rdv_paypal_payments')
    .select('paypal_order_id, client_checkout_id, amount_cents, payment_option, hold:rdv_booking_holds(status, expires_at, reservation_payment_cents, service_price_cents, currency, converted_booking_id)')
    .eq('client_checkout_id', checkoutId)
    .maybeSingle()
  if (error) throw new Error('payment_lookup_failed')
  return data || null
}

async function loadPayment(supabase, holdId) {
  const { data, error } = await supabase
    .from('rdv_paypal_payments')
    .select('id, paypal_order_id, paypal_capture_id, paypal_env, amount_cents, currency, status, client_checkout_id, captured_at, payment_option, hold:rdv_booking_holds(id, status, expires_at, reservation_payment_cents, service_price_cents, currency, converted_booking_id)')
    .eq('hold_id', holdId)
    .single()
  if (error || !data?.hold) throw new Error('payment_lookup_failed')
  return data
}

async function finalizeBooking(supabase, orderId, bookingId) {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, starts_at, ends_at, timezone, google_event_id, google_meet_link, booked_price_cents, reservation_payment_cents')
    .eq('id', bookingId)
    .single()
  if (bookingError || !booking) return { googleSync: 'pending', emailStatus: 'pending', meetLink: null }

  const [{ data: service }, { data: practitioner }, { data: payment }] = await Promise.all([
    supabase.from('booking_services').select('title, duration_min, modality').eq('id', booking.service_id).single(),
    supabase.from('booking_practitioners').select('name, timezone').eq('id', booking.practitioner_id).single(),
    supabase.from('rdv_paypal_payments').select('id, confirmation_sent_at, payment_option').eq('paypal_order_id', orderId).single(),
  ])
  if (!service || !payment) return { googleSync: 'pending', emailStatus: 'pending', meetLink: booking.google_meet_link || null }

  const paidCents = Number(booking.reservation_payment_cents || 0)
  const servicePriceCents = Number(booking.booked_price_cents || 0)
  const balanceCents = Math.max(0, servicePriceCents - paidCents)
  const paidInFull = payment.payment_option === 'full' || balanceCents === 0

  let googleSync = { status: 'pending', google_meet_link: booking.google_meet_link || null }
  try {
    googleSync = await syncBookingToGoogleCalendar({
      supabase,
      practitionerId: booking.practitioner_id,
      bookingId: booking.id,
      currentGoogleEventId: booking.google_event_id,
      createConference: Array.isArray(service.modality) && service.modality.includes('video'),
      event: {
        title: `${service.title} — ${booking.customer_first_name} ${booking.customer_last_name}`,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        timezone: practitioner?.timezone || booking.timezone || 'Europe/Paris',
        description: [
          'MediumIA Rendez-vous', '',
          `Client : ${booking.customer_first_name} ${booking.customer_last_name}`,
          `Email : ${booking.customer_email}`,
          `Téléphone : ${booking.customer_phone || 'Non renseigné'}`,
          `${paidInFull ? 'Paiement intégral' : 'Arrhes réglées'} : ${(paidCents / 100).toFixed(2)} EUR`,
          `Solde restant : ${(balanceCents / 100).toFixed(2)} EUR`,
          `Identifiant MediumIA : ${booking.id}`,
        ].join('\n'),
      },
    })
  } catch { /* paiement + réservation restent valides même si Google échoue */ }

  const googleStatus = googleSync.status || 'failed'
  await supabase.from('rdv_paypal_payments').update({
    google_sync_status: googleStatus,
    google_sync_error: googleStatus === 'failed' ? (googleSync.reason || 'google_sync_failed') : null,
    finalized_at: new Date().toISOString(),
  }).eq('id', payment.id)

  let emailStatus = payment.confirmation_sent_at ? 'already_sent' : 'pending'
  if (!payment.confirmation_sent_at) {
    const cancellation = createCancellationToken()
    const { error: tokenError } = await supabase.from('bookings').update({
      cancellation_token_hash: cancellation.tokenHash,
      cancellation_token_created_at: new Date().toISOString(),
    }).eq('id', booking.id)

    if (!tokenError) {
      const message = buildRdvPaymentConfirmation({
        firstName: booking.customer_first_name,
        serviceTitle: service.title,
        startsAt: booking.starts_at,
        timezone: practitioner?.timezone || booking.timezone || 'Europe/Paris',
        servicePriceCents,
        paidCents,
        paymentOption: payment.payment_option,
        meetLink: googleSync.google_meet_link || booking.google_meet_link || null,
        cancelUrl: bookingCancellationUrl(cancellation.token),
      })
      const sent = await sendEmail({
        to: booking.customer_email,
        ...message,
        idempotencyKey: `rdv-payment-confirmation/${booking.id}`,
      })
      emailStatus = sent.status
      if (sent.status === 'sent') {
        await supabase.from('rdv_paypal_payments')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', payment.id)
          .is('confirmation_sent_at', null)
      }
    }
  }

  return {
    googleSync: googleStatus,
    emailStatus,
    meetLink: googleSync.google_meet_link || booking.google_meet_link || null,
    amountCents: paidCents,
    servicePriceCents,
    balanceCents,
    paymentOption: paidInFull ? 'full' : 'deposit',
  }
}

async function handleCreate(req, res, supabase) {
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
    payment_option = 'deposit',
  } = req.body || {}

  if (!practitioner_slug || !service_slug || !DATE_RE.test(date || '') || !TIME_RE.test(time || '')) return publicError(res, 'invalid_booking_request', 400)
  if (!UUID_RE.test(client_checkout_id || '')) return publicError(res, 'invalid_payment_request', 400)
  if (!customer?.firstName?.trim() || !customer?.lastName?.trim() || !EMAIL_RE.test(customer?.email?.trim() || '')) return publicError(res, 'invalid_customer', 400)
  if (!['deposit', 'full'].includes(payment_option)) return publicError(res, 'invalid_payment_option', 400)
  if (payment_option === 'full' && selected_modality !== 'video') return publicError(res, 'full_payment_video_only', 400)
  if (terms_accepted !== true) return publicError(res, 'terms_required', 400)
  if (early_performance_requested !== true) return publicError(res, 'early_performance_consent_required', 400)

  try {
    const existing = await loadPaymentByCheckoutId(supabase, client_checkout_id)
    if (existing?.hold) {
      if (existing.payment_option !== payment_option) return publicError(res, 'payment_option_mismatch', 409)
      if (existing.hold.status === 'converted') return res.status(200).json({ status: 'converted', bookingId: existing.hold.converted_booking_id })
      if (existing.paypal_order_id && ['payment_pending', 'payment_capturing'].includes(existing.hold.status)) {
        return res.status(200).json({
          id: existing.paypal_order_id,
          checkoutId: existing.client_checkout_id,
          expiresAt: existing.hold.expires_at,
          amount: (existing.amount_cents / 100).toFixed(2),
          servicePrice: (existing.hold.service_price_cents / 100).toFixed(2),
          balance: (Math.max(0, existing.hold.service_price_cents - existing.amount_cents) / 100).toFixed(2),
          currency: existing.hold.currency,
          paymentOption: existing.payment_option,
          reused: true,
        })
      }
    }
  } catch (error) {
    return publicError(res, error.message || 'payment_lookup_failed', 500)
  }

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
  if (!isPayableRdvService(service, selected_modality)) return publicError(res, 'service_not_payable_online', 409)
  if (payment_option === 'full' && !service.modality.includes('video')) return publicError(res, 'full_payment_video_only', 409)

  let slot
  try {
    slot = await validateServerAvailability({ supabase, practitioner, service, date, time })
  } catch (error) {
    return publicError(res, error.message || 'slot_unavailable', error.message === 'google_calendar_unavailable' ? 503 : 409)
  }

  const cfg = runtimeRdvPaymentPayPalConfig()
  const { data: holdResult, error: holdError } = await supabase.rpc('create_rdv_payment_hold', {
    p_practitioner_id: practitioner.id,
    p_service_id: service.id,
    p_starts_at: slot.startsAt.toISOString(),
    p_ends_at: slot.endsAt.toISOString(),
    p_selected_modality: selected_modality,
    p_customer_first_name: customer.firstName.trim(),
    p_customer_last_name: customer.lastName.trim(),
    p_customer_email: customer.email.trim().toLowerCase(),
    p_customer_phone: customer.phone?.trim() || null,
    p_customer_message: customer.message?.trim() || null,
    p_client_checkout_id: client_checkout_id,
    p_paypal_env: cfg.env,
    p_terms_version: TERMS_VERSION,
    p_early_performance_requested: true,
    p_payment_option: payment_option,
  })
  if (holdError || !holdResult?.ok) return publicError(res, holdResult?.error || 'hold_creation_failed', 409)
  if (holdResult.status === 'converted') return res.status(200).json({ status: 'converted', bookingId: holdResult.booking_id || null })
  if (holdResult.status !== 'payment_pending' && holdResult.status !== 'payment_capturing') return publicError(res, 'hold_not_available', 409)

  let payment
  try {
    payment = await loadPayment(supabase, holdResult.hold_id)
    if (!payment.paypal_order_id) {
      const created = await createRdvPayPalOrder({
        holdId: holdResult.hold_id,
        amountCents: holdResult.amount_cents,
        currency: holdResult.currency,
        serviceTitle: service.title,
        paymentOption: holdResult.payment_option || payment_option,
      })
      const { error: updateError } = await supabase
        .from('rdv_paypal_payments')
        .update({ paypal_order_id: created.orderId })
        .eq('id', payment.id)
        .is('paypal_order_id', null)
      if (updateError) throw new Error('payment_order_store_failed')
      payment = await loadPayment(supabase, holdResult.hold_id)
    }
  } catch (error) {
    return publicError(res, error.message || 'paypal_create_order_failed', 502)
  }

  return res.status(201).json({
    id: payment.paypal_order_id,
    checkoutId: payment.client_checkout_id,
    expiresAt: holdResult.expires_at,
    amount: (payment.amount_cents / 100).toFixed(2),
    servicePrice: (holdResult.service_price_cents / 100).toFixed(2),
    balance: (Math.max(0, holdResult.service_price_cents - payment.amount_cents) / 100).toFixed(2),
    currency: holdResult.currency,
    paymentOption: payment.payment_option,
    reused: Boolean(holdResult.existing),
  })
}

async function handleCapture(req, res, supabase) {
  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
  if (!ORDER_RE.test(orderId)) return publicError(res, 'invalid_order_id', 400)

  const { data: claim, error: claimError } = await supabase.rpc('claim_rdv_deposit_capture', { p_paypal_order_id: orderId })
  if (claimError || !claim?.ok) return publicError(res, claim?.error || 'capture_claim_failed', 409)
  if (claim.converted) {
    const finalization = await finalizeBooking(supabase, orderId, claim.booking_id)
    return res.status(200).json({ status: 'COMPLETED', bookingId: claim.booking_id, alreadyConverted: true, ...finalization })
  }
  if (claim.captured) return res.status(202).json({ status: 'CAPTURED_PENDING_RECONCILIATION' })
  if (claim.capturing) return res.status(202).json({ status: 'CAPTURE_IN_PROGRESS' })

  const { data: payment, error: lookupError } = await supabase
    .from('rdv_paypal_payments')
    .select('paypal_env, amount_cents, currency, payment_option, hold:rdv_booking_holds(id)')
    .eq('paypal_order_id', orderId)
    .single()
  if (lookupError || !payment?.hold) return publicError(res, 'payment_lookup_failed', 500)

  try {
    const completed = await captureRdvPayPalOrder(orderId)
    if (payment.paypal_env !== completed.cfg.env) throw new Error('paypal_environment_mismatch')
    const verified = verifyRdvPayPalPayment({
      cfg: completed.cfg,
      data: completed.data,
      holdId: payment.hold.id,
      amountCents: payment.amount_cents,
      currency: payment.currency,
    })

    const { data: converted, error: convertError } = await supabase.rpc('convert_rdv_deposit_hold', {
      p_paypal_order_id: verified.orderId,
      p_paypal_capture_id: verified.captureId,
      p_captured_at: verified.capturedAt,
      p_paypal_env: completed.cfg.env,
      p_amount_cents: payment.amount_cents,
      p_currency: payment.currency,
    })
    if (convertError || !converted?.ok) throw new Error(converted?.error || 'booking_conversion_failed')

    const finalization = await finalizeBooking(supabase, orderId, converted.booking_id)
    return res.status(200).json({
      status: 'COMPLETED',
      bookingId: converted.booking_id,
      alreadyConverted: Boolean(converted.converted),
      ...finalization,
    })
  } catch (error) {
    return publicError(res, error.message || 'paypal_capture_failed', 502)
  }
}

async function handleStatus(req, res, supabase) {
  const checkoutId = String(req.query?.checkout_id || req.body?.checkout_id || '')
  if (!UUID_RE.test(checkoutId)) return publicError(res, 'invalid_checkout_id', 400)
  const { data, error } = await supabase
    .from('rdv_paypal_payments')
    .select('paypal_order_id, status, amount_cents, payment_option, hold:rdv_booking_holds(status, expires_at, converted_booking_id, service_price_cents, reservation_payment_cents)')
    .eq('client_checkout_id', checkoutId)
    .maybeSingle()
  if (error || !data?.hold) return publicError(res, 'payment_not_found', 404)
  return res.status(200).json({
    orderId: data.paypal_order_id,
    paymentStatus: data.status,
    holdStatus: data.hold.status,
    expiresAt: data.hold.expires_at,
    bookingId: data.hold.converted_booking_id,
    amountCents: data.amount_cents,
    servicePriceCents: data.hold.service_price_cents,
    balanceCents: Math.max(0, data.hold.service_price_cents - data.amount_cents),
    paymentOption: data.payment_option,
  })
}

export async function handleRdvPaymentApi(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    runtimeRdvPaymentPayPalConfig()
  } catch (error) {
    const hidden = ['rdv_payment_paypal_disabled', 'rdv_payment_paypal_live_not_configured'].includes(error.message)
    return publicError(res, hidden ? 'not_found' : 'paypal_unavailable', hidden ? 404 : 503)
  }

  if (!isSupabaseConfigured()) return publicError(res, 'supabase_not_configured', 503)

  if (action === 'config') {
    if (req.method !== 'GET') return publicError(res, 'method_not_allowed', 405)
    try {
      return res.status(200).json({ ...(await rdvPaymentPayPalConfig()), termsVersion: TERMS_VERSION, fullPaymentVideoEnabled: true })
    } catch (error) {
      return publicError(res, error.message || 'paypal_unavailable', 503)
    }
  }

  const supabase = getSupabaseAdmin()
  if (action === 'create') {
    if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
    return await handleCreate(req, res, supabase)
  }
  if (action === 'capture') {
    if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
    return await handleCapture(req, res, supabase)
  }
  if (action === 'status') {
    if (!['GET', 'POST'].includes(req.method)) return publicError(res, 'method_not_allowed', 405)
    return await handleStatus(req, res, supabase)
  }
  return publicError(res, 'invalid_rdv_payment_action', 400)
}
