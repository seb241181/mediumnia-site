/* global process */
import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { deleteBookingFromGoogleCalendar } from './googleCalendarEvents.js'
import { sendEmail } from './transactionalEmail.js'
import {
  balancePaymentUrl,
  buildRdvBalanceAutoCancellation,
  buildRdvBalanceReminder,
} from './rdvBalanceEmail.js'

function publicError(res, code, status) {
  return res.status(status).json({ error: code })
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function isCronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim()
  if (!secret) return { ok: false, configured: false }
  const authorization = String(req.headers?.authorization || '')
  return { ok: authorization === `Bearer ${secret}`, configured: true }
}

async function loadSweepCandidates(supabase, now) {
  const upper = new Date(now.getTime() + 72 * 3_600_000).toISOString()
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_email, starts_at, timezone, status, google_event_id, booked_price_cents, reservation_payment_cents, booking_source, balance_reminder_sent_at, balance_paid_at')
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .gt('starts_at', now.toISOString())
    .lte('starts_at', upper)

  if (error) throw new Error('balance_candidate_lookup_failed')
  if (!bookings?.length) return []

  const serviceIds = [...new Set(bookings.map(booking => booking.service_id))]
  const bookingIds = bookings.map(booking => booking.id)
  const [{ data: services, error: servicesError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from('booking_services').select('id, title, modality').in('id', serviceIds),
    supabase.from('rdv_financial_entries').select('booking_id, direction, gross_cents').eq('source', 'mediumia').in('booking_id', bookingIds),
  ])
  if (servicesError || entriesError) throw new Error('balance_candidate_lookup_failed')

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

async function processReminder(supabase, item, now) {
  const { booking, service, dueCents } = item
  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  if (booking.balance_reminder_sent_at || now >= deadlineAt) return { action: 'none' }

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const { data: claimed, error: claimError } = await supabase.rpc('claim_rdv_balance_reminder', {
    p_booking_id: booking.id,
    p_token_hash: tokenHash,
    p_token_expires_at: deadlineAt.toISOString(),
    p_now: now.toISOString(),
  })
  if (claimError || !claimed) return { action: 'none' }

  try {
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
  } catch (error) {
    await supabase.rpc('release_rdv_balance_reminder', { p_booking_id: booking.id, p_token_hash: tokenHash }).catch(() => {})
    return { action: 'reminder_failed', bookingId: booking.id, error: error?.message || 'unknown_error' }
  }
}

async function processAutoCancel(supabase, item, now) {
  const { booking, service, dueCents } = item
  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  if (now < deadlineAt) return { action: 'none' }

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

  try {
    const message = buildRdvBalanceAutoCancellation({
      firstName: booking.customer_first_name,
      serviceTitle: service.title,
      startsAt: booking.starts_at,
      timezone: booking.timezone || 'Europe/Paris',
    })
    const sent = await sendEmail({
      to: booking.customer_email,
      ...message,
      idempotencyKey: `rdv-balance-auto-cancel/${booking.id}`,
    })
    return {
      action: sent.status === 'sent' ? 'cancelled' : 'cancelled_email_failed',
      bookingId: booking.id,
      amountCents: dueCents,
    }
  } catch {
    return { action: 'cancelled_email_failed', bookingId: booking.id, amountCents: dueCents }
  }
}

async function runDailySweep(supabase, now = new Date()) {
  const candidates = await loadSweepCandidates(supabase, now)
  const results = []
  for (const item of candidates) {
    try {
      const startsMs = new Date(item.booking.starts_at).getTime()
      const deadlineMs = startsMs - 48 * 3_600_000
      if (now.getTime() >= deadlineMs) results.push(await processAutoCancel(supabase, item, now))
      else results.push(await processReminder(supabase, item, now))
    } catch (error) {
      results.push({ action: 'error', bookingId: item.booking.id, error: error?.message || 'unknown_error' })
    }
  }

  const counts = results.reduce((acc, result) => {
    acc[result.action] = (acc[result.action] || 0) + 1
    return acc
  }, {})
  return { candidates: candidates.length, counts, results }
}

export async function handleRdvBalanceDailyCron(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return publicError(res, 'method_not_allowed', 405)

  const auth = isCronAuthorized(req)
  if (!auth.configured) return publicError(res, 'cron_not_configured', 503)
  if (!auth.ok) return publicError(res, 'unauthorized', 401)
  if (!isSupabaseConfigured()) return publicError(res, 'supabase_not_configured', 503)

  try {
    const result = await runDailySweep(getSupabaseAdmin())
    console.info(`[rdv-balance-cron] candidates=${result.candidates} counts=${JSON.stringify(result.counts)}`)
    return res.status(200).json({ ok: true, candidates: result.candidates, counts: result.counts })
  } catch (error) {
    console.error(`[rdv-balance-cron] failed: ${error?.message || 'unknown_error'}`)
    return publicError(res, 'balance_cron_failed', 500)
  }
}
