/* global process */
import { createHmac } from 'node:crypto'
import { decrypt, encrypt, parisUTCOffsetMs, refreshGoogleToken } from './googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { syncBookingToGoogleCalendar } from './googleCalendarEvents.js'
import { createCancellationToken, bookingCancellationUrl } from './bookingCancellation.js'
import { buildRdvDepositConfirmation } from './rdvDepositConfirmationEmail.js'
import { sendEmail } from './transactionalEmail.js'
import {
  captureRdvDepositPayPalOrder,
  createRdvDepositPayPalOrder,
  getRdvDepositPayPalOrder,
  isPayableDepositService,
  rdvDepositPayPalConfig,
  runtimeRdvDepositPayPalConfig,
  verifyRdvDepositPayPalPayment,
} from './rdvDepositPayPal.js'
import { isVideoOnly, visioLabel } from './visioChannel.js'
import { attachOfferToHold, markOfferUsed, offerBlocksCapture, offerErrorFromClaim, validateOfferSlot } from './rdvSlotOffers.js'
import { recordCheckoutEvent, CLIENT_EVENT_CODES } from './rdvCheckoutEvents.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORDER_RE = /^[A-Za-z0-9_-]{5,80}$/
// v2: consent wording rewritten in plain language (same legal meaning).
const TERMS_VERSION = 'rdv-arrhes-2026-09-24-v2'
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
      p_endpoint: 'rdv_deposit_create',
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

export async function validateServerAvailability({ supabase, practitioner, service, date, time }) {
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
    .select('paypal_order_id, client_checkout_id, hold:rdv_booking_holds(status, expires_at, reservation_payment_cents, service_price_cents, currency, converted_booking_id)')
    .eq('client_checkout_id', checkoutId)
    .maybeSingle()
  if (error) throw new Error('payment_lookup_failed')
  return data || null
}

async function loadPayment(supabase, holdId) {
  const { data, error } = await supabase
    .from('rdv_paypal_payments')
    .select('id, paypal_order_id, paypal_capture_id, paypal_env, amount_cents, currency, status, client_checkout_id, captured_at, hold:rdv_booking_holds(id, status, expires_at, reservation_payment_cents, service_price_cents, currency, converted_booking_id)')
    .eq('hold_id', holdId)
    .single()
  if (error || !data?.hold) throw new Error('payment_lookup_failed')
  return data
}

async function finalizeBooking(supabase, orderId, bookingId) {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, starts_at, ends_at, timezone, google_event_id, booked_price_cents, reservation_payment_cents')
    .eq('id', bookingId)
    .single()
  if (bookingError || !booking) return { googleSync: 'pending', emailStatus: 'pending' }
  // Un créneau proposé par lien personnel est désormais pris : le lien ne sert plus.
  await markOfferUsed(supabase, booking).catch(() => {})

  const [{ data: service }, { data: practitioner }, { data: payment }] = await Promise.all([
    supabase.from('booking_services').select('title, duration_min, modality').eq('id', booking.service_id).single(),
    supabase.from('booking_practitioners').select('name, timezone').eq('id', booking.practitioner_id).single(),
    supabase.from('rdv_paypal_payments').select('id, confirmation_sent_at, hold:rdv_booking_holds(selected_modality)').eq('paypal_order_id', orderId).single(),
  ])
  if (!service || !payment) return { googleSync: 'pending', emailStatus: 'pending' }

  // Visio = WhatsApp ou FaceTime, jamais Google Meet : canal à confirmer par Sébastien.
  const selectedModality = payment.hold?.selected_modality || null
  const isVideo = selectedModality ? selectedModality === 'video' : isVideoOnly(service.modality)
  const visio = isVideo ? visioLabel('a_preciser') : null

  let googleSync = { status: 'pending' }
  try {
    googleSync = await syncBookingToGoogleCalendar({
      supabase,
      practitionerId: booking.practitioner_id,
      bookingId: booking.id,
      currentGoogleEventId: booking.google_event_id,
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
          `Arrhes réglées : ${(booking.reservation_payment_cents / 100).toFixed(2)} EUR`,
          `Solde restant : ${((booking.booked_price_cents - booking.reservation_payment_cents) / 100).toFixed(2)} EUR`,
          ...(visio ? [visio] : []),
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
      const message = buildRdvDepositConfirmation({
        firstName: booking.customer_first_name,
        serviceTitle: service.title,
        startsAt: booking.starts_at,
        timezone: practitioner?.timezone || booking.timezone || 'Europe/Paris',
        servicePriceCents: booking.booked_price_cents,
        depositCents: booking.reservation_payment_cents,
        visio,
        cancelUrl: bookingCancellationUrl(cancellation.token),
        balanceReminderEnabled: Array.isArray(service.modality)
          && service.modality.includes('video')
          && booking.reservation_payment_cents < booking.booked_price_cents,
      })
      const sent = await sendEmail({
        to: booking.customer_email,
        ...message,
        idempotencyKey: `rdv-deposit-confirmation/${booking.id}`,
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
    visio,
    amountCents: booking.reservation_payment_cents,
    servicePriceCents: booking.booked_price_cents,
    balanceCents: booking.booked_price_cents - booking.reservation_payment_cents,
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
    offer_token,
  } = req.body || {}

  if (!practitioner_slug || !service_slug || !DATE_RE.test(date || '') || !TIME_RE.test(time || '')) return publicError(res, 'invalid_booking_request', 400)
  if (!UUID_RE.test(client_checkout_id || '')) return publicError(res, 'invalid_payment_request', 400)
  if (!customer?.firstName?.trim() || !customer?.lastName?.trim() || !EMAIL_RE.test(customer?.email?.trim() || '')) return publicError(res, 'invalid_customer', 400)
  if (terms_accepted !== true) return publicError(res, 'terms_required', 400)
  if (early_performance_requested !== true) return publicError(res, 'early_performance_consent_required', 400)

  try {
    const existing = await loadPaymentByCheckoutId(supabase, client_checkout_id)
    if (existing?.hold) {
      if (existing.hold.status === 'converted') return res.status(200).json({ status: 'converted', bookingId: existing.hold.converted_booking_id })
      // Tentative remplacée, expirée ou abandonnée : le navigateur repart d'un nouvel identifiant.
      if (['expired', 'failed'].includes(existing.hold.status)) return publicError(res, 'checkout_expired', 409)
      if (existing.paypal_order_id && ['payment_pending', 'payment_capturing'].includes(existing.hold.status)) {
        return res.status(200).json({
          id: existing.paypal_order_id,
          checkoutId: existing.client_checkout_id,
          expiresAt: existing.hold.expires_at,
          amount: (existing.hold.reservation_payment_cents / 100).toFixed(2),
          servicePrice: (existing.hold.service_price_cents / 100).toFixed(2),
          currency: existing.hold.currency,
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
  if (!isPayableDepositService(service, selected_modality)) return publicError(res, 'service_not_payable_online', 409)

  let slot
  try {
    // Lien personnel (créneau d'urgence) : créneau choisi par le praticien.
    slot = offer_token
      ? await validateOfferSlot({ supabase, practitioner, service, date, time, token: offer_token })
      : await validateServerAvailability({ supabase, practitioner, service, date, time })
  } catch (error) {
    return publicError(res, error.message || 'slot_unavailable', error.message === 'google_calendar_unavailable' ? 503 : 409)
  }

  const cfg = runtimeRdvDepositPayPalConfig()
  await supersedeOwnPendingHolds(supabase, { practitionerId: practitioner.id, slot, email: customer.email, checkoutId: client_checkout_id })
  const { data: holdResult, error: holdError } = await supabase.rpc('create_rdv_deposit_hold', {
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
  })
  if (holdError || !holdResult?.ok) {
    const code = holdResult?.error || 'hold_creation_failed'
    const context = { action: 'create', checkoutId: client_checkout_id, practitionerId: practitioner.id, startsAt: slot.startsAt, req }
    if (code === 'slot_unavailable') return slotUnavailable(res, supabase, { practitionerId: practitioner.id, slot, context })
    await recordCheckoutEvent(supabase, { ...context, code, status: 409 })
    return publicError(res, code, 409)
  }
  if (slot.offerId) {
    try {
      await attachOfferToHold(supabase, holdResult.hold_id, slot.offerId)
    } catch (error) {
      return publicError(res, error.message || 'offer_attach_failed', 500)
    }
  }
  if (holdResult.status === 'converted') return res.status(200).json({ status: 'converted', bookingId: holdResult.booking_id || null })
  if (holdResult.status !== 'payment_pending' && holdResult.status !== 'payment_capturing') return publicError(res, 'hold_not_available', 409)

  let payment
  try {
    payment = await loadPayment(supabase, holdResult.hold_id)
    if (!payment.paypal_order_id) {
      const created = await createRdvDepositPayPalOrder({
        holdId: holdResult.hold_id,
        amountCents: holdResult.amount_cents,
        currency: holdResult.currency,
        serviceTitle: service.title,
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
    const code = error.message || 'paypal_create_order_failed'
    await recordCheckoutEvent(supabase, { action: 'create', code, status: 502, checkoutId: client_checkout_id, practitionerId: practitioner.id, startsAt: slot.startsAt, req })
    return publicError(res, code, 502)
  }

  return res.status(201).json({
    id: payment.paypal_order_id,
    checkoutId: payment.client_checkout_id,
    expiresAt: holdResult.expires_at,
    amount: (holdResult.amount_cents / 100).toFixed(2),
    servicePrice: (holdResult.service_price_cents / 100).toFixed(2),
    currency: holdResult.currency,
    reused: Boolean(holdResult.existing),
  })
}

// Trace l'erreur sur le paiement. Un appel Supabase n'est pas une Promise : pas de
// .catch() direct (il plantait et empêchait la réponse au client).
async function notePaymentError(supabase, orderId, code) {
  try {
    const { error } = await supabase.rpc('note_rdv_payment_error', { p_paypal_order_id: orderId, p_error_code: code })
    if (error) console.error(`[rdv-deposit] erreur non tracée : ${error.code || 'unknown'}`)
  } catch {
    console.error('[rdv-deposit] erreur non tracée')
  }
}

async function handleCapture(req, res, supabase) {
  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
  if (!ORDER_RE.test(orderId)) return publicError(res, 'invalid_order_id', 400)

  // Lien personnel annulé pendant le paiement : on ne capture pas.
  const offerBlock = await offerBlocksCapture(supabase, orderId).catch(() => null)
  if (offerBlock) return publicError(res, offerBlock, 409)

  const { data: claim, error: claimError } = await supabase.rpc('claim_rdv_deposit_capture', { p_paypal_order_id: orderId })
  // Lien annulé ou expiré à l'instant même : la base a refusé la réclamation.
  const claimOfferError = offerErrorFromClaim(claimError)
  if (claimOfferError) {
    await offerBlocksCapture(supabase, orderId).catch(() => null)
    return publicError(res, claimOfferError, 409)
  }
  if (claimError || !claim?.ok) {
    const code = claim?.error || 'capture_claim_failed'
    await recordCheckoutEvent(supabase, { action: 'capture', code, status: 409, req })
    // Commande d'une tentative remplacée ou expirée : jamais capturée, rien n'est prélevé.
    if (code === 'hold_not_capturable') return publicError(res, 'checkout_expired', 409)
    return publicError(res, code, 409)
  }
  if (claim.converted) {
    const finalization = await finalizeBooking(supabase, orderId, claim.booking_id)
    return res.status(200).json({ status: 'COMPLETED', bookingId: claim.booking_id, alreadyConverted: true, ...finalization })
  }
  if (claim.captured) return res.status(202).json({ status: 'CAPTURED_PENDING_RECONCILIATION', error: 'payment_received_pending' })
  if (claim.capturing) return res.status(202).json({ status: 'CAPTURE_IN_PROGRESS' })

  const { data: payment, error: lookupError } = await supabase
    .from('rdv_paypal_payments')
    .select('paypal_env, amount_cents, currency, client_checkout_id, hold:rdv_booking_holds(id, practitioner_id, starts_at)')
    .eq('paypal_order_id', orderId)
    .single()
  if (lookupError || !payment?.hold) return publicError(res, 'payment_lookup_failed', 500)
  const context = { action: 'capture', checkoutId: payment.client_checkout_id, practitionerId: payment.hold.practitioner_id, startsAt: payment.hold.starts_at, req }

  // Numéro de tentative : la clé d'idempotence PayPal change après un refus.
  const { data: attempt } = await supabase.rpc('next_rdv_capture_attempt', { p_paypal_order_id: orderId })

  let completed
  try {
    completed = await captureRdvDepositPayPalOrder(orderId, { attempt: Number(attempt) || 1 })
  } catch (error) {
    const code = error?.code || 'paypal_capture_uncertain'
    if (error?.outcome === 'definite') {
      // PayPal a refusé et confirme que rien n'est encaissé : le client peut repayer.
      await supabase.rpc('release_rdv_deposit_capture', { p_paypal_order_id: orderId, p_next: 'payment_pending', p_error_code: code })
      await recordCheckoutEvent(supabase, { ...context, code, status: 402 })
      return res.status(402).json({ error: code, restartable: Boolean(error.restartable) })
    }
    // Issue inconnue : la capture reste bloquée pour le rapprochement, jamais relancée ici.
    await notePaymentError(supabase, orderId, code)
    await recordCheckoutEvent(supabase, { ...context, code, status: 202 })
    return res.status(202).json({ status: 'CAPTURE_UNCERTAIN', error: 'paypal_capture_uncertain' })
  }

  try {
    if (payment.paypal_env !== completed.cfg.env) throw new Error('paypal_environment_mismatch')
    const verified = verifyRdvDepositPayPalPayment({
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
    // L'argent est encaissé chez PayPal : on ne libère jamais ce créneau, on le signale.
    const code = `captured_${error.message || 'conversion_failed'}`.slice(0, 80)
    console.error(`[rdv-deposit] paiement encaissé sans confirmation : ${code}`)
    await notePaymentError(supabase, orderId, code)
    await recordCheckoutEvent(supabase, { ...context, code, status: 202 })
    return res.status(202).json({ status: 'CAPTURED_PENDING_RECONCILIATION', error: 'payment_received_pending' })
  }
}

// Nouvelle tentative du même client sur ce créneau : sa tentative précédente,
// encore en attente de paiement, est remplacée au lieu de lui bloquer le créneau.
export async function supersedeOwnPendingHolds(supabase, { practitionerId, slot, email, checkoutId }) {
  const { data, error } = await supabase.rpc('supersede_rdv_own_pending_holds', {
    p_practitioner_id: practitionerId,
    p_starts_at: slot.startsAt.toISOString(),
    p_ends_at: slot.endsAt.toISOString(),
    p_customer_email: String(email || '').trim().toLowerCase(),
    p_client_checkout_id: checkoutId,
  })
  if (error) console.error(`[rdv-deposit] remplacement de tentative impossible : ${error.code || 'unknown'}`)
  return Number(data) || 0
}

// Créneau refusé : réservé pour de bon, ou seulement tenu par un paiement en cours
// d'une autre personne (il peut alors se libérer).
export async function slotUnavailable(res, supabase, { practitionerId, slot, context }) {
  const { data: holds } = await supabase
    .from('rdv_booking_holds')
    .select('status, expires_at')
    .eq('practitioner_id', practitionerId)
    .eq('status', 'payment_pending')
    .gt('expires_at', new Date().toISOString())
    .lt('starts_at', slot.endsAt.toISOString())
    .gt('ends_at', slot.startsAt.toISOString())
  const retryAt = (holds || []).map((h) => h.expires_at).sort().at(-1) || null
  const code = retryAt ? 'slot_held' : 'slot_unavailable'
  await recordCheckoutEvent(supabase, { ...context, code, status: 409 })
  return res.status(409).json({ error: code, ...(retryAt ? { retryAt } : {}) })
}

// ── Rapprochement des captures restées sans réponse ─────────────────────────
// Lecture seule chez PayPal (jamais de capture) : la commande encaissée devient un
// rendez-vous (créneau futur) ou un cas à examiner (créneau passé) ; la commande non
// encaissée libère le créneau. Sans apply, rien n'est modifié (simple rapport).
export async function reconcileStaleRdvCaptures(supabase, { apply = false, now = new Date(), limit = 10, checkoutId = null, getOrder = getRdvDepositPayPalOrder, finalize = finalizeBooking } = {}) {
  const staleBefore = new Date(now.getTime() - 5 * 60_000).toISOString()
  let query = supabase
    .from('rdv_paypal_payments')
    .select('paypal_order_id, paypal_env, amount_cents, currency, client_checkout_id, capture_attempts, hold:rdv_booking_holds!inner(id, status, expires_at, starts_at)')
    .eq('status', 'capturing')
    .is('paypal_capture_id', null)
    .eq('hold.status', 'payment_capturing')
    .lt('hold.expires_at', staleBefore)
  if (checkoutId) query = query.eq('client_checkout_id', checkoutId)
  const { data: rows, error } = await query.limit(limit)
  if (error) throw new Error('reconcile_lookup_failed')

  const report = []
  for (const row of rows || []) {
    const entry = {
      checkoutRef: String(row.client_checkout_id || '').slice(0, 8),
      orderRef: `…${String(row.paypal_order_id).slice(-4)}`,
      slot: row.hold.starts_at,
      paypalStatus: null,
      action: 'none',
    }
    report.push(entry)
    let order
    try {
      order = await getOrder(row.paypal_order_id)
    } catch {
      entry.action = 'paypal_unreachable'
      continue
    }
    if (order.cfg.env !== row.paypal_env) { entry.action = 'environment_mismatch'; continue }
    entry.paypalStatus = order.data.status

    // Existing captures predate capture_attempts. They require a separate,
    // explicitly authorized reconciliation; even an apply request cannot alter them.
    if (apply && !Number(row.capture_attempts)) {
      entry.action = 'historical_report_only'
      continue
    }

    if (order.data.status !== 'COMPLETED') {
      // APPROVED / PAYER_ACTION_REQUIRED / a pending capture are not evidence
      // that no funds were taken. Never free a stale hold from a single GET.
      entry.action = 'manual_review:order_not_completed'
      continue
    }

    let verified
    try {
      verified = verifyRdvDepositPayPalPayment({ cfg: order.cfg, data: order.data, holdId: row.hold.id, amountCents: row.amount_cents, currency: row.currency })
    } catch (verifyError) {
      entry.action = `manual_review:${verifyError.message}`
      if (apply) await supabase.rpc('note_rdv_payment_error', { p_paypal_order_id: row.paypal_order_id, p_error_code: `captured_${verifyError.message}` })
      continue
    }
    // Créneau déjà passé : un humain décide (remboursement…), aucun e-mail automatique.
    if (new Date(row.hold.starts_at).getTime() <= now.getTime()) {
      entry.action = 'manual_review:captured_past_slot'
      if (apply) await supabase.rpc('note_rdv_payment_error', { p_paypal_order_id: row.paypal_order_id, p_error_code: 'captured_past_slot' })
      continue
    }
    entry.action = apply ? 'converted' : 'would_convert'
    if (!apply) continue
    const { data: converted, error: convertError } = await supabase.rpc('convert_rdv_deposit_hold', {
      p_paypal_order_id: verified.orderId,
      p_paypal_capture_id: verified.captureId,
      p_captured_at: verified.capturedAt,
      p_paypal_env: order.cfg.env,
      p_amount_cents: row.amount_cents,
      p_currency: row.currency,
    })
    if (!converted?.ok) {
      // Argent encaissé chez PayPal mais rendez-vous refusé : on le trace toujours (code
      // sur le paiement + journal), le créneau reste bloqué pour un examen humain.
      const reason = converted?.error || (convertError?.message ? String(convertError.message).replace(/[^a-z_]/gi, '').slice(0, 40) : '') || 'conversion_failed'
      entry.action = `manual_review:${reason}`
      console.error(`[rdv-reconcile] paiement encaissé, rendez-vous refusé : ${reason} (commande ${entry.orderRef})`)
      await notePaymentError(supabase, row.paypal_order_id, `captured_${reason}`)
      continue
    }
    await finalize(supabase, row.paypal_order_id, converted.booking_id).catch(() => null)
  }
  return report
}

async function handleStatus(req, res, supabase) {
  const checkoutId = String(req.query?.checkout_id || req.body?.checkout_id || '')
  if (!UUID_RE.test(checkoutId)) return publicError(res, 'invalid_checkout_id', 400)
  const { data, error } = await supabase
    .from('rdv_paypal_payments')
    .select('paypal_order_id, status, amount_cents, confirmation_sent_at, hold:rdv_booking_holds(status, expires_at, converted_booking_id, service_price_cents, reservation_payment_cents)')
    .eq('client_checkout_id', checkoutId)
    .maybeSingle()
  if (error || !data?.hold) return publicError(res, 'payment_not_found', 404)

  // A status request never converts a booking or releases a hold. An explicit
  // report request may read PayPal, but remains strictly read-only.
  const staleCapture = data.status === 'capturing' && data.hold.status === 'payment_capturing'
    && data.hold.expires_at && new Date(data.hold.expires_at).getTime() < Date.now() - 5 * 60_000
  if (staleCapture && req.query?.reconcile === 'report') {
    let reconciliation
    try {
      [reconciliation] = await reconcileStaleRdvCaptures(supabase, { apply: false, checkoutId, limit: 1 })
    } catch {
      reconciliation = { action: 'reconcile_failed' }
    }
    return res.status(200).json({ paymentStatus: data.status, holdStatus: data.hold.status, reconciliation: reconciliation || null })
  }

  return res.status(200).json({
    orderId: data.paypal_order_id,
    paymentStatus: data.status,
    holdStatus: data.hold.status,
    expiresAt: data.hold.expires_at,
    bookingId: data.hold.converted_booking_id,
    amountCents: data.amount_cents,
    servicePriceCents: data.hold.service_price_cents,
    balanceCents: data.hold.service_price_cents - data.hold.reservation_payment_cents,
    email_confirmation: data.confirmation_sent_at
      ? 'sent'
      : data.hold.converted_booking_id && (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
        ? 'not_configured'
        : data.hold.converted_booking_id ? 'unknown' : 'pending',
  })
}

// Erreurs vues par le navigateur (SDK PayPal, fenêtre fermée…) : code seulement.
async function handleClientEvent(req, res, supabase) {
  const checkoutId = String(req.body?.checkoutId || '')
  const code = String(req.body?.code || '')
  if (!UUID_RE.test(checkoutId) || !CLIENT_EVENT_CODES.has(code)) return publicError(res, 'invalid_client_event', 400)
  await recordCheckoutEvent(supabase, { source: 'client', action: 'paypal', code, checkoutId, req })
  return res.status(200).json({ ok: true })
}

export async function handleRdvDepositApi(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    runtimeRdvDepositPayPalConfig()
  } catch (error) {
    const hidden = ['rdv_deposit_paypal_disabled', 'rdv_deposit_paypal_live_not_configured'].includes(error.message)
    return publicError(res, hidden ? 'not_found' : 'paypal_unavailable', hidden ? 404 : 503)
  }

  if (!isSupabaseConfigured()) return publicError(res, 'supabase_not_configured', 503)

  if (action === 'config') {
    if (req.method !== 'GET') return publicError(res, 'method_not_allowed', 405)
    try {
      return res.status(200).json({ ...(await rdvDepositPayPalConfig()), termsVersion: TERMS_VERSION })
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
  if (action === 'clientEvent') {
    if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
    return await handleClientEvent(req, res, supabase)
  }
  if (action === 'reconcile') {
    if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
    const secret = String(process.env.CRON_SECRET || '').trim()
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return publicError(res, 'unauthorized', 401)
    try {
      const report = await reconcileStaleRdvCaptures(supabase, { apply: req.body?.apply === true })
      return res.status(200).json({ apply: req.body?.apply === true, report })
    } catch (error) {
      return publicError(res, error.message || 'reconcile_failed', 500)
    }
  }
  return publicError(res, 'invalid_rdv_deposit_action', 400)
}

// Point d'entrée des tests (sans passer par la configuration PayPal de l'environnement).
export { handleCapture as handleCaptureForTest, handleStatus as handleStatusForTest }
