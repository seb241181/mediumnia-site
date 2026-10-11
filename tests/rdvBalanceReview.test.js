/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
delete process.env.RDV_BALANCE_ALERT_EMAIL
delete process.env.VERCEL_ENV

const { encrypt } = await import('../lib/googleOAuth.js')
const { needsPreCancelAlert, runDailySweep } = await import('../lib/rdvBalanceCronHandler.js')
const { sendOwnerBalanceAlert, ownerAlertRecipient } = await import('../lib/rdvBalanceOwnerAlerts.js')
const { restoreBalanceBooking, setBalanceDecision, rotateBalanceLink } = await import('../lib/rdvBalanceReviewAdmin.js')
const { buildRdvBalanceOwnerAlert, buildRdvBalanceRestored } = await import('../lib/rdvBalanceEmail.js')

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const H = 3_600_000
const PRACT = '7dcf2820-edb2-412b-b418-2a67fbf824ea'
const BOOKING = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const KEY = '33333333-3333-4333-8333-333333333333'

// Faux client Supabase : requêtes chaînées + RPC, chaque appel est journalisé.
function fakeSupabase({ tables = {}, rpc = {} } = {}) {
  const calls = []
  const from = (table) => {
    const state = { table, filters: [], op: 'select', values: null }
    const builder = {
      select() { return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      eq(col, val) { state.filters.push(['eq', col, val]); return builder },
      gt() { return builder }, lte() { return builder }, is() { return builder }, in() { return builder }, limit() { return builder },
      maybeSingle() { return Promise.resolve(run(true)) },
      single() { return Promise.resolve(run(true)) },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    const run = (single) => {
      calls.push({ type: 'from', ...state })
      const handler = tables[table]
      const data = typeof handler === 'function' ? handler(state) : handler
      return { data: single && Array.isArray(data) ? (data[0] ?? null) : (data ?? null), error: null }
    }
    return builder
  }
  return {
    calls,
    from,
    rpc(name, args) {
      calls.push({ type: 'rpc', name, args })
      const handler = rpc[name]
      const result = typeof handler === 'function' ? handler(args) : handler
      return Promise.resolve(result ?? { data: null, error: null })
    },
  }
}

const sweepItem = (hoursAhead, extra = {}) => ({
  booking: { id: BOOKING, starts_at: new Date(Date.now() + hoursAhead * H).toISOString(), ...extra },
  service: { title: 'Guidance visio' }, dueCents: 5000, paidCents: 2000,
})

test('alerte « annulation prévue » : au passage précédant H-48, jamais si Maintenu ou lien tardif actif', () => {
  const now = new Date()
  assert.equal(needsPreCancelAlert(sweepItem(60), now), true)
  assert.equal(needsPreCancelAlert(sweepItem(30), now), true)
  assert.equal(needsPreCancelAlert(sweepItem(80), now), false)
  assert.equal(needsPreCancelAlert(sweepItem(30, { balance_owner_decision: 'hold' }), now), false)
  assert.equal(needsPreCancelAlert(sweepItem(30, { balance_late_payment_until: new Date(Date.now() + 2 * H).toISOString() }), now), false)
})

function sweepSupabase({ hoursAhead, claim }) {
  const starts = new Date(Date.now() + hoursAhead * H).toISOString()
  return fakeSupabase({
    tables: {
      bookings: [{ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', customer_first_name: 'Sylvie', customer_last_name: 'Test', customer_email: 's@example.invalid', starts_at: starts, ends_at: starts, status: 'confirmed', booking_source: 'mediumia', booked_price_cents: 7000, reservation_payment_cents: 2000, balance_reminder_sent_at: new Date().toISOString(), google_event_id: 'evt1' }],
      booking_services: [{ id: 'svc', title: 'Guidance visio', modality: ['video'] }],
      rdv_financial_entries: [{ booking_id: BOOKING, direction: 'income', gross_cents: 2000 }],
    },
    rpc: { claim_rdv_balance_auto_cancel: { data: claim, error: null } },
  })
}

test('cron : annulation refusée par la base → aucune suppression Google, alerte propriétaire demandée', async () => {
  const supabase = sweepSupabase({ hoursAhead: 30, claim: { ok: false, error: 'cancel_blocked', reason: 'owner_not_alerted' } })
  const alerts = []
  const result = await runDailySweep(supabase, new Date(), { sendAlert: async (args) => { alerts.push(args.kind); return { status: 'sent' } } })
  assert.deepEqual(alerts, ['pre_cancel'])
  assert.deepEqual(result.ownerAlerts, { sent: 1 })
  const blocked = result.results.find(r => r.action === 'cancel_blocked')
  assert.equal(blocked.reason, 'owner_not_alerted')
  assert.ok(!supabase.calls.some(c => c.type === 'rpc' && c.name === 'finalize_rdv_balance_auto_cancel'))
})

test('cron : paiement incertain → bloqué et alerte de revue (sans adresse configurée : rien n’est envoyé)', async () => {
  const supabase = sweepSupabase({ hoursAhead: 30, claim: { ok: false, error: 'cancel_blocked', reason: 'payment_uncertain' } })
  const result = await runDailySweep(supabase, new Date(), { sendAlert: async () => ({ status: 'sent' }) })
  const blocked = result.results.find(r => r.action === 'cancel_blocked')
  assert.equal(blocked.reason, 'payment_uncertain')
  assert.equal(blocked.alert, 'not_configured')
})

test('alerte propriétaire : jamais sans adresse, jamais deux fois, jamais renvoyée si l’envoi est incertain', async () => {
  const item = sweepItem(30, { customer_first_name: 'Sylvie', customer_last_name: 'Test' })
  assert.equal((await sendOwnerBalanceAlert({ supabase: fakeSupabase(), item, kind: 'pre_cancel', reason: 'pre_cancel', env: {} })).status, 'not_configured')
  const env = { RDV_BALANCE_ALERT_EMAIL: 'seb@example.invalid' }
  assert.equal(ownerAlertRecipient(env), 'seb@example.invalid')

  const already = fakeSupabase({ rpc: { claim_rdv_balance_owner_alert: { data: false, error: null } } })
  let sends = 0
  assert.equal((await sendOwnerBalanceAlert({ supabase: already, item, kind: 'pre_cancel', reason: 'pre_cancel', env, send: async () => { sends++; return { status: 'sent' } } })).status, 'already_handled')
  assert.equal(sends, 0)

  const uncertain = fakeSupabase({ rpc: { claim_rdv_balance_owner_alert: { data: true, error: null } } })
  assert.equal((await sendOwnerBalanceAlert({ supabase: uncertain, item, kind: 'pre_cancel', reason: 'pre_cancel', env, send: async () => ({ status: 'error', uncertain: true }) })).status, 'uncertain')
  assert.ok(!uncertain.calls.some(c => c.name === 'finalize_rdv_balance_owner_alert'))

  const ok = fakeSupabase({ rpc: { claim_rdv_balance_owner_alert: { data: true, error: null }, finalize_rdv_balance_owner_alert: { data: true, error: null } } })
  let sentArgs
  assert.equal((await sendOwnerBalanceAlert({ supabase: ok, item, kind: 'pre_cancel', reason: 'pre_cancel', env, send: async (args) => { sentArgs = args; return { status: 'sent', id: 'em_1' } } })).status, 'sent')
  assert.equal(sentArgs.idempotencyKey, `rdv-balance-owner-alert/${BOOKING}/pre_cancel`)
  assert.equal(sentArgs.to, 'seb@example.invalid')
  assert.equal(ok.calls.find(c => c.name === 'finalize_rdv_balance_owner_alert').args.p_status, 'sent')
})

// Contexte complet pour la restauration (propriétaire admin, créneau, Google).
function restoreSupabase({ blocker = null, restore, compensate = { ok: true }, complete = { ok: true } } = {}) {
  const starts = new Date(Date.now() + 30 * H).toISOString()
  const ends = new Date(Date.now() + 31 * H).toISOString()
  return fakeSupabase({
    tables: {
      booking_practitioners: (state) => state.filters.some(f => f[1] === 'slug')
        ? [{ id: PRACT }] : [{ id: PRACT, buffer_before_min: 0, buffer_after_min: 15 }],
      bookings: [{ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', customer_first_name: 'Naim', customer_last_name: 'Test', customer_email: 'n@example.invalid', starts_at: starts, ends_at: ends, status: 'cancelled', google_event_id: 'evt-old', booked_price_cents: 7000 }],
      booking_services: [{ id: 'svc', title: 'Guidance visio', modality: ['video'] }],
      booking_calendar_connections: [{ access_token_enc: encrypt('tok'), refresh_token_enc: encrypt('ref'), token_expiry: new Date(Date.now() + 10 * H).toISOString(), google_calendar_id: 'cal@group' }],
    },
    rpc: {
      rdv_balance_restore_blocker: { data: blocker, error: null },
      restore_rdv_balance_cancelled_booking: { data: restore ?? { ok: true, replay: false, restoration_id: 'rest-1', due_cents: 5000, paid_cents: 2000 }, error: null },
      compensate_rdv_balance_restore: { data: compensate, error: null },
      complete_rdv_balance_restore: { data: complete, error: null },
      record_rdv_balance_restore_email: { data: true, error: null },
    },
  })
}
const enabled = { RDV_BALANCE_RESTORE_ENABLED: 'true' }
const restoreInput = { practitioner_id: PRACT, booking_id: BOOKING, idempotency_key: KEY, hours_before: 1, confirm_no_external_payment: true }
const googleFetch = ({ busy = false, patchStatus = 200 } = {}) => async (url, opts = {}) => {
  if (!opts.method || opts.method === 'GET') return { ok: true, json: async () => ({ items: busy ? [{ id: 'other', status: 'confirmed' }] : [{ id: 'evt-old', status: 'cancelled' }] }) }
  if (opts.method === 'PATCH') return { ok: patchStatus === 200, status: patchStatus, json: async () => ({}) }
  return { ok: true, json: async () => ({ id: 'evt-new' }) }
}

test('restauration : désactivée par défaut, confirmations et contrôles exigés avant toute écriture', async () => {
  const supabase = restoreSupabase()
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: {} })).body.error, 'restore_disabled')
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: { ...restoreInput, confirm_no_external_payment: false }, env: enabled })).body.error, 'external_payment_confirmation_required')
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: { ...restoreInput, hours_before: 0 }, env: enabled })).body.error, 'invalid_late_window')
  const blocked = restoreSupabase({ blocker: 'slot_booked' })
  assert.equal((await restoreBalanceBooking({ supabase: blocked, userId: USER, input: restoreInput, env: enabled, fetchImpl: googleFetch() })).body.error, 'slot_booked')
  assert.ok(!blocked.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'))
})

test('restauration : créneau occupé dans Google → refus sans écriture', async () => {
  const supabase = restoreSupabase()
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: googleFetch({ busy: true }) })
  assert.equal(result.body.error, 'google_slot_busy')
  assert.ok(!supabase.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'))
})

test('restauration : succès → événement Google réactivé, lien du solde exact, aucun e-mail sans demande', async () => {
  const supabase = restoreSupabase()
  let mails = 0
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: googleFetch(), send: async () => { mails++; return { status: 'sent' } } })
  assert.equal(result.status, 200)
  assert.equal(result.body.due_cents, 5000)
  assert.equal(result.body.google_status, 'restored')
  assert.equal(result.body.email_status, 'not_requested')
  assert.equal(mails, 0)
  assert.match(result.body.payment_url, /\/rdv\/solde#token=/)
  const call = supabase.calls.find(c => c.name === 'restore_rdv_balance_cancelled_booking').args
  assert.equal(call.p_paypal_env, 'sandbox')
  assert.equal(call.p_idempotency_key, KEY)
  assert.match(call.p_token_hash, /^[0-9a-f]{64}$/)
  assert.ok(!result.body.payment_url.includes(call.p_token_hash), 'le lien porte le jeton, la base n’en garde que l’empreinte')
  assert.ok(supabase.calls.some(c => c.name === 'complete_rdv_balance_restore'))
})

test('restauration : échec Google → compensation (retour à l’état annulé), aucun lien rendu', async () => {
  const supabase = restoreSupabase()
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: googleFetch({ patchStatus: 500 }) })
  assert.equal(result.status, 502)
  assert.equal(result.body.error, 'google_restore_failed')
  assert.equal(result.body.compensated, true)
  assert.equal(result.body.payment_url, undefined)
  assert.ok(!supabase.calls.some(c => c.name === 'complete_rdv_balance_restore'))
})

test('restauration : rejeu de la même demande → aucun nouveau lien ni écriture Google', async () => {
  const supabase = restoreSupabase({ restore: { ok: true, replay: true, status: 'completed' } })
  let googleCalls = 0
  const fetchImpl = async (url, opts) => { if (opts?.method) googleCalls++; return googleFetch()(url, opts) }
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl })
  assert.equal(result.body.replay, true)
  assert.equal(result.body.payment_url, undefined)
  assert.equal(googleCalls, 0)
})

test('accès : un compte qui n’est pas propriétaire ET administrateur est refusé', async () => {
  const supabase = fakeSupabase({ tables: { booking_practitioners: [] } })
  assert.equal((await setBalanceDecision({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, decision: 'hold' } })).status, 403)
  assert.equal((await rotateBalanceLink({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled })).status, 403)
})

test('décision : valeurs acceptées uniquement « hold », « cancel » ou levée', async () => {
  const supabase = restoreSupabase()
  assert.equal((await setBalanceDecision({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, decision: 'delete' } })).body.error, 'invalid_decision')
})

test('e-mails : alerte interne sans données de paiement sensibles ; lien client = solde exact, arrhes déduites', () => {
  const alert = buildRdvBalanceOwnerAlert({ customerName: 'Sylvie B.', serviceTitle: 'Guidance', startsAt: '2026-10-19T07:30:00Z', dueCents: 5000, deadlineAt: '2026-10-17T07:30:00Z', reminderSentAt: null, reason: 'pre_cancel' })
  assert.match(alert.text, /Solde restant : 50,00 €/)
  assert.match(alert.text, /Aucune action n’a été faite auprès du client/)
  const restored = buildRdvBalanceRestored({ firstName: 'Naim', serviceTitle: 'Guidance', startsAt: '2026-10-12T11:30:00Z', balanceCents: 5000, paidCents: 2000, deadlineAt: '2026-10-12T10:30:00Z', paymentUrl: 'https://mediumia.fr/rdv/solde#token=x' })
  assert.match(restored.text, /20,00 € déjà versés sont bien pris en compte/)
  assert.match(restored.text, /il reste uniquement 50,00 €/)
  assert.doesNotMatch(restored.text, /70,00 €/)
})

test('migration : garde en base sur les deux chemins d’annulation et fenêtre tardive sur le paiement', () => {
  const sql = read('supabase/migrations/20261011160000_rdv_balance_owner_review_restore.sql')
  assert.match(sql, /v_blocker := public\.rdv_balance_cancel_blocker\(v_booking\.id, p_now\);/)
  assert.match(sql, /OR v_booking\.balance_owner_decision = 'hold'/)
  assert.equal((sql.match(/COALESCE\(v_booking\.balance_late_payment_until, v_booking\.starts_at - INTERVAL '48 hours'\)/g) || []).length, 2)
  assert.match(sql, /PERFORM pg_advisory_xact_lock\(hashtext\(p_practitioner_id::text\)\);/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS auto_cancel_mode TEXT NOT NULL DEFAULT 'auto'/)
  assert.doesNotMatch(sql, /UPDATE public\.bookings\s+SET status = 'confirmed'[\s\S]{0,40}WHERE id = '/, 'aucune réservation ciblée en dur')
  assert.doesNotMatch(sql, /Brulard|Audin/i)
})

test('branchements : action admin, panneau dans la comptabilité, colonnes lues par le cron', () => {
  assert.match(read('api/rdv-admin.js'), /case 'balance-watch': \{/)
  assert.match(read('src/components/rdv/AccountingSection.jsx'), /<RdvBalanceWatch practitionerId=\{practitionerId\} session=\{session\} \/>/)
  assert.match(read('lib/rdvBalanceCronHandler.js'), /balance_owner_decision, balance_late_payment_until'\)/)
})
