/* global process */
import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { deleteBookingFromGoogleCalendar } from './googleCalendarEvents.js'
import { sendEmail } from './transactionalEmail.js'
import {
  balancePaymentUrl,
  buildRdvBalanceAutoCancellation,
  buildRdvBalancePaidConfirmation,
  buildRdvBalanceReminder,
} from './rdvBalanceEmail.js'
import {
  captureRdvBalancePayPalOrder,
  createRdvBalancePayPalOrder,
  rdvBalancePayPalConfig,
  runtimeRdvBalancePayPalConfig,
  verifyRdvBalancePayPalPayment,
} from './rdvBalancePayPal.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORDER_RE = /^[A-Za-z0-9_-]{5,80}$/

function publicError(res, code, status = 409) {
  return res.status(status).json({ error: code })
}

function hashToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function moneyState({ booking, paidCents }) {
  const priceCents = Number(booking.booked_price_cents || 0)
  const dueCents = Math.max(0, priceCents - Number(paidCents || 0))
  return { priceCents, paidCents: Number(paidCents || 0), dueCents }
}

async function paidCentsForBooking(supabase, bookingId) {
  const { data, error } = await supabase.rpc('rdv_booking_paid_cents', { p_booking_id: bookingId })
  if (error) throw new Error('balance_lookup_failed')
  return Number(data || 0)
}

async function loadBookingByBalanceToken(supabase, tokenHash) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_email, starts_at, ends_at, timezone, status, cancelled_at, cancel_reason, google_event_id, google_meet_link, booked_price_cents, reservation_payment_cents, booking_source, balance_payment_token_expires_at, balance_paid_at')
    .eq('balance_payment_token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error('balance_lookup_failed')
  if (!booking) return null

  const { data: service } = await supabase
    .from('booking_services')
    .select('id, title, modality, vat_rate_bps')
    .eq('id', booking.service_id)
    .maybeSingle()
  if (!service) throw new Error('service_not_found')

  const paidCents = await paidCentsForBooking(supabase, booking.id)
  return { booking, service, ...moneyState({ booking, paidCents }) }
}

async function handleStatus(req, res, supabase) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  const tokenHash = hashToken(req.body?.token)
  if (!tokenHash) return publicError(res, 'invalid_balance_token', 400)

  let context
  try {
    context = await loadBookingByBalanceToken(supabase, tokenHash)
  } catch (error) {
    return publicError(res, error.message || 'balance_lookup_failed', 500)
  }
  if (!context) return publicError(res, 'balance_token_not_found', 404)

  const { booking, service, priceCents, paidCents, dueCents } = context
  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  const common = {
    bookingId: booking.id,
    firstName: booking.customer_first_name,
    serviceTitle: service.title,
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
    priceCents,
    paidCents,
    balanceCents: dueCents,
    deadlineAt: deadlineAt.toISOString(),
  }

  if (dueCents <= 0 || booking.balance_paid_at) {
    return res.status(200).json({ status: 'PAID', ...common, balanceCents: 0 })
  }
  if (booking.status !== 'confirmed') {
    return res.status(200).json({ status: 'CANCELLED', ...common })
  }
  if (!Array.isArray(service.modality) || !service.modality.includes('video')) {
    return publicError(res, 'balance_video_only', 409)
  }
  if (Date.now() >= deadlineAt.getTime() || (booking.balance_payment_token_expires_at && Date.now() >= new Date(booking.balance_payment_token_expires_at).getTime())) {
    return res.status(200).json({ status: 'EXPIRED', ...common })
  }

  try {
    const config = await rdvBalancePayPalConfig()
    return res.status(200).json({ status: 'PAYABLE', ...common, clientId: config.clientId, env: config.env, currency: config.currency })
  } catch (error) {
    return publicError(res, error.message || 'paypal_not_configured', 503)
  }
}

async function handleCreate(req, res, supabase) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  const tokenHash = hashToken(req.body?.token)
  const checkoutId = req.body?.client_checkout_id
  if (!tokenHash || !UUID_RE.test(checkoutId || '')) return publicError(res, 'invalid_balance_payment_request', 400)

  let cfg
  try {
    cfg = runtimeRdvBalancePayPalConfig()
  } catch (error) {
    return publicError(res, error.message || 'paypal_not_configured', 503)
  }

  const { data: intent, error: intentError } = await supabase.rpc('create_or_get_rdv_balance_payment', {
    p_token_hash: tokenHash,
    p_client_checkout_id: checkoutId,
    p_paypal_env: cfg.env,
  })
  if (intentError) return publicError(res, 'balance_payment_unavailable', 500)
  if (!intent?.ok) return publicError(res, intent?.error || 'balance_payment_unavailable', 409)
  if (intent.already_paid) return res.status(200).json({ status: 'PAID', bookingId: intent.booking_id, balanceCents: 0 })
  if (intent.paypal_order_id) {
    return res.status(200).json({
      id: intent.paypal_order_id,
      bookingId: intent.booking_id,
      amountCents: Number(intent.amount_cents),
      currency: intent.currency,
      reused: true,
    })
  }

  let order
  try {
    order = await createRdvBalancePayPalOrder({
      bookingId: intent.booking_id,
      amountCents: Number(intent.amount_cents),
      currency: intent.currency,
      serviceTitle: intent.service_title,
    })
  } catch (error) {
    return publicError(res, error.message || 'paypal_create_order_failed', 502)
  }

  const { data: stored, error: storeError } = await supabase
    .from('rdv_balance_payments')
    .update({ paypal_order_id: order.orderId, updated_at: new Date().toISOString(), last_error_code: null })
    .eq('id', intent.payment_id)
    .is('paypal_order_id', null)
    .select('paypal_order_id')
    .maybeSingle()

  if (storeError) return publicError(res, 'balance_payment_unavailable', 500)
  if (!stored?.paypal_order_id) {
    const { data: existing } = await supabase
      .from('rdv_balance_payments')
      .select('paypal_order_id')
      .eq('id', intent.payment_id)
      .single()
    if (!existing?.paypal_order_id) return publicError(res, 'balance_payment_unavailable', 500)
    return res.status(200).json({ id: existing.paypal_order_id, bookingId: intent.booking_id, amountCents: Number(intent.amount_cents), currency: intent.currency, reused: true })
  }

  return res.status(200).json({ id: stored.paypal_order_id, bookingId: intent.booking_id, amountCents: Number(intent.amount_cents), currency: intent.currency, reused: false })
}

async function sendBalancePaidEmail(supabase, bookingId, paidCents) {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, service_id, customer_first_name, customer_email, starts_at, timezone, google_meet_link')
    .eq('id', bookingId)
    .single()
  if (!booking) return 'booking_not_found'
  const { data: service } = await supabase.from('booking_services').select('title').eq('id', booking.service_id).single()
  if (!service) return 'service_not_found'
  const message = buildRdvBalancePaidConfirmation({
    firstName: booking.customer_first_name,
    serviceTitle: service.title,
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
    paidCents,
    meetLink: booking.google_meet_link || null,
  })
  const sent = await sendEmail({
    to: booking.customer_email,
    ...message,
    idempotencyKey: `rdv-balance-paid/${booking.id}`,
  })
  return sent.status
}

async function handleCapture(req, res, supabase) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  const orderId = String(req.body?.orderId || '').trim()
  if (!ORDER_RE.test(orderId)) return publicError(res, 'invalid_paypal_order', 400)

  const { data: claim, error: claimError } = await supabase.rpc('claim_rdv_balance_capture', { p_paypal_order_id: orderId })
  if (claimError) return publicError(res, 'balance_capture_failed', 500)
  if (!claim?.ok) return publicError(res, claim?.error || 'balance_capture_failed', 409)
  if (claim.already_captured) {
    return res.status(200).json({ status: 'COMPLETED', bookingId: claim.booking_id, amountCents: Number(claim.amount_cents), balanceCents: 0, alreadyCaptured: true })
  }

  try {
    const captured = await captureRdvBalancePayPalOrder(orderId)
    const verified = verifyRdvBalancePayPalPayment({
      cfg: captured.cfg,
      data: captured.data,
      bookingId: claim.booking_id,
      amountCents: Number(claim.amount_cents),
      currency: claim.currency,
    })

    const { data: finalized, error: finalError } = await supabase.rpc('finalize_rdv_balance_capture', {
      p_paypal_order_id: verified.orderId,
      p_paypal_capture_id: verified.captureId,
      p_captured_at: verified.capturedAt,
      p_paypal_env: captured.cfg.env,
      p_amount_cents: Number(claim.amount_cents),
      p_currency: claim.currency,
    })
    if (finalError || !finalized?.ok) throw new Error(finalized?.error || 'balance_finalize_failed')

    const emailStatus = await sendBalancePaidEmail(supabase, claim.booking_id, Number(claim.amount_cents))
    return res.status(200).json({
      status: 'COMPLETED',
      bookingId: claim.booking_id,
      amountCents: Number(claim.amount_cents),
      balanceCents: 0,
      emailStatus,
      alreadyCaptured: !!finalized.already_captured,
    })
  } catch (error) {
    await supabase.rpc('release_rdv_balance_capture', {
      p_paypal_order_id: orderId,
      p_error_code: error.message || 'balance_capture_failed',
    }).catch(() => {})
    return publicError(res, error.message || 'balance_capture_failed', 502)
  }
}

async function loadSweepCandidates(supabase, now, practitionerSlug = null) {
  let practitionerId = null
  if (practitionerSlug) {
    const { data: practitioner } = await supabase.from('booking_practitioners').select('id').eq('slug', practitionerSlug).maybeSingle()
    if (!practitioner) return []
    practitionerId = practitioner.id
  }

  const upper = new Date(now.getTime() + 72 * 3_600_000).toISOString()
  let query = supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_email, starts_at, timezone, status, google_event_id, booked_price_cents, reservation_payment_cents, booking_source, balance_reminder_sent_at, balance_paid_at')
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .gt('starts_at', now.toISOString())
    .lte('starts_at', upper)
  if (practitionerId) query = query.eq('practitioner_id', practitionerId)
  const { data: bookings, error } = await query
  if (error || !bookings?.length) return []

  const serviceIds = [...new Set(bookings.map(b => b.service_id))]
  const bookingIds = bookings.map(b => b.id)
  const [{ data: services }, { data: entries }] = await Promise.all([
    supabase.from('booking_services').select('id, title, modality').in('id', serviceIds),
    supabase.from('rdv_financial_entries').select('booking_id, direction, gross_cents').eq('source', 'mediumia').in('booking_id', bookingIds),
  ])
  const serviceMap = new Map((services || []).map(service => [service.id, service]))
  const paidMap = new Map()
  for (const entry of entries || []) {
    const delta = entry.direction === 'refund' ? -Number(entry.gross_cents || 0) : Number(entry.gross_cents || 0)
    paidMap.set(entry.booking_id, (paidMap.get(entry.booking_id) || 0) + delta)
  }

  return bookings.map(booking => {
    const service = serviceMap.get(booking.service_id)
    const paidCents = paidMap.get(booking.id) || 0
    const dueCents = Math.max(0, Number(booking.booked_price_cents || 0) - paidCents)
    return { booking, service, paidCents, dueCents }
  }).filter(item =>
    item.service?.modality?.includes('video')
    && Number(item.booking.reservation_payment_cents || 0) > 0
    && item.paidCents > 0
    && item.dueCents > 0
    && !item.booking.balance_paid_at
  )
}

async function processReminder(supabase, item, now, dryRun) {
  const { booking, service, dueCents } = item
  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  if (booking.balance_reminder_sent_at || now >= deadlineAt) return { action: 'none' }
  if (dryRun) return { action: 'reminder_due', bookingId: booking.id, amountCents: dueCents }

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const { data: claimed, error: claimError } = await supabase.rpc('claim_rdv_balance_reminder', {
    p_booking_id: booking.id,
    p_token_hash: tokenHash,
    p_token_expires_at: deadlineAt.toISOString(),
    p_now: now.toISOString(),
  })
  if (claimError || !claimed) return { action: 'none' }

  const message = buildRdvBalanceReminder({
    firstName: booking.customer_first_name,
    serviceTitle: service.title,
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
    balanceCents: dueCents,
    deadlineAt,
    paymentUrl: balancePaymentUrl(token),
  })
  const sent = await sendEmail({
    to: booking.customer_email,
    ...message,
    idempotencyKey: `rdv-balance-reminder/${booking.id}`,
  })
  if (sent.status !== 'sent') {
    await supabase.rpc('release_rdv_balance_reminder', { p_booking_id: booking.id, p_token_hash: tokenHash }).catch(() => {})
    return { action: 'reminder_failed', bookingId: booking.id }
  }

  await supabase.rpc('finalize_rdv_balance_reminder', {
    p_booking_id: booking.id,
    p_token_hash: tokenHash,
    p_email_id: sent.id || null,
    p_sent_at: new Date().toISOString(),
  })
  return { action: 'reminder_sent', bookingId: booking.id, amountCents: dueCents }
}

async function processAutoCancel(supabase, item, now, dryRun) {
  const { booking, service, dueCents } = item
  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  if (now < deadlineAt) return { action: 'none' }
  if (dryRun) return { action: 'cancel_due', bookingId: booking.id, amountCents: dueCents }

  const { data: claimed, error: claimError } = await supabase.rpc('claim_rdv_balance_auto_cancel', {
    p_booking_id: booking.id,
    p_now: now.toISOString(),
  })
  if (claimError || !claimed?.ok) return { action: 'none' }

  const google = await deleteBookingFromGoogleCalendar({
    supabase,
    practitionerId: booking.practitioner_id,
    googleEventId: booking.google_event_id,
  })
  if (!['deleted', 'already_deleted', 'not_synced'].includes(google.status)) {
    await supabase.rpc('release_rdv_balance_auto_cancel', { p_booking_id: booking.id }).catch(() => {})
    return { action: 'cancel_google_retry', bookingId: booking.id }
  }

  const { data: finalized, error: finalError } = await supabase.rpc('finalize_rdv_balance_auto_cancel', {
    p_booking_id: booking.id,
    p_now: now.toISOString(),
  })
  if (finalError || !finalized?.ok) {
    await supabase.rpc('release_rdv_balance_auto_cancel', { p_booking_id: booking.id }).catch(() => {})
    return { action: 'cancel_finalize_retry', bookingId: booking.id }
  }

  const message = buildRdvBalanceAutoCancellation({
    firstName: booking.customer_first_name,
    serviceTitle: service.title,
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
  })
  await sendEmail({
    to: booking.customer_email,
    ...message,
    idempotencyKey: `rdv-balance-auto-cancel/${booking.id}`,
  })
  return { action: 'cancelled', bookingId: booking.id, amountCents: dueCents }
}

async function runSweep(supabase, { now = new Date(), practitionerSlug = null, dryRun = false } = {}) {
  const candidates = await loadSweepCandidates(supabase, now, practitionerSlug)
  const results = []
  for (const item of candidates) {
    const startsMs = new Date(item.booking.starts_at).getTime()
    const deadlineMs = startsMs - 48 * 3_600_000
    if (now.getTime() >= deadlineMs) results.push(await processAutoCancel(supabase, item, now, dryRun))
    else results.push(await processReminder(supabase, item, now, dryRun))
  }
  const counts = results.reduce((acc, result) => {
    acc[result.action] = (acc[result.action] || 0) + 1
    return acc
  }, {})
  return { candidates: candidates.length, counts, results }
}

async function handleSweep(req, res, supabase) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  const raw = String(req.body?.sweepToken || '')
  const tokenHash = hashToken(raw)
  if (!tokenHash) return publicError(res, 'unauthorized', 401)
  const { data: claimed, error } = await supabase.rpc('claim_rdv_balance_sweep_token', { p_token_hash: tokenHash })
  if (error || !claimed) return publicError(res, 'unauthorized', 401)
  const result = await runSweep(supabase)
  return res.status(200).json({ ok: true, candidates: result.candidates, counts: result.counts })
}

async function handleTestSweep(req, res, supabase) {
  if (req.method !== 'POST') return publicError(res, 'method_not_allowed', 405)
  if (process.env.VERCEL_ENV !== 'preview') return publicError(res, 'not_available', 404)
  if (req.body?.practitioner_slug !== 'test-seb-arrhes') return publicError(res, 'test_practitioner_required', 400)
  const parsedNow = req.body?.now ? new Date(req.body.now) : new Date()
  if (!Number.isFinite(parsedNow.getTime())) return publicError(res, 'invalid_test_time', 400)
  const result = await runSweep(supabase, {
    now: parsedNow,
    practitionerSlug: 'test-seb-arrhes',
    dryRun: req.body?.dry_run !== false,
  })
  return res.status(200).json({ ok: true, dryRun: req.body?.dry_run !== false, candidates: result.candidates, counts: result.counts, results: result.results })
}

export async function handleRdvBalanceApi(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isSupabaseConfigured()) return publicError(res, 'supabase_not_configured', 503)
  const supabase = getSupabaseAdmin()

  try {
    if (action === 'status') return await handleStatus(req, res, supabase)
    if (action === 'create') return await handleCreate(req, res, supabase)
    if (action === 'capture') return await handleCapture(req, res, supabase)
    if (action === 'sweep') return await handleSweep(req, res, supabase)
    if (action === 'testSweep') return await handleTestSweep(req, res, supabase)
    return publicError(res, 'unknown_balance_action', 404)
  } catch (error) {
    console.error(`[rdv-balance] ${action} failed: ${error?.message || 'unknown_error'}`)
    return publicError(res, 'balance_payment_unavailable', 500)
  }
}
