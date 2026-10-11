/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
delete process.env.RDV_BALANCE_ALERT_EMAIL
delete process.env.VERCEL_ENV

const { encrypt } = await import('../lib/googleOAuth.js')
const { needsPreCancelAlert, runDailySweep, runGoogleReconciliation, googlePhaseDeadline, CRON_GOOGLE_PHASE_BUDGET_MS, CRON_MAX_DURATION_S } = await import('../lib/rdvBalanceCronHandler.js')
const { sendOwnerBalanceAlert, ownerAlertRecipient } = await import('../lib/rdvBalanceOwnerAlerts.js')
const { restoreBalanceBooking, setBalanceDecision, rotateBalanceLink, resumeBalanceRestoration, abandonBalanceRestoration, retryGoogleResync, dismissGoogleResync, listBalanceWatch, googleSlotIsFree, GOOGLE_SLOT_MAX_PAGES } = await import('../lib/rdvBalanceReviewAdmin.js')
const { reconcilePendingRestorations, releaseStaleCancelClaims, RESUME_ALERT_ATTEMPTS } = await import('../lib/rdvBalanceRestoreResume.js')
const { reconcileGoogleResyncs, ALERT_GRACE_MS } = await import('../lib/rdvBalanceGoogleResync.js')
const { recreatedEventId } = await import('../lib/rdvBalanceGoogle.js')
const { buildRdvBalanceOwnerAlert, buildRdvBalanceRestored } = await import('../lib/rdvBalanceEmail.js')

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const H = 3_600_000
const PRACT = '7dcf2820-edb2-412b-b418-2a67fbf824ea'
const BOOKING = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const KEY = '33333333-3333-4333-8333-333333333333'

const thenable = (value) => { const promise = Promise.resolve(value); return { then: (resolve, reject) => promise.then(resolve, reject) } }

// Faux client Supabase : requêtes chaînées + RPC, chaque appel est journalisé.
function fakeSupabase({ tables = {}, rpc = {} } = {}) {
  const calls = []
  const from = (table) => {
    const state = { table, filters: [], op: 'select', values: null }
    const builder = {
      select() { return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      eq(col, val) { state.filters.push(['eq', col, val]); return builder },
      gt() { return builder }, lt() { return builder }, not() { return builder }, lte() { return builder }, is() { return builder }, in() { return builder }, limit() { return builder }, order() { return builder },
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
      // Comme supabase-js : un objet « thenable » SANS .catch() (régression #148).
      return thenable(result ?? { data: null, error: null })
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
// La table des restaurations et le verrou de reprise sont simulés avec état.
const REST = '44444444-4444-4444-8444-444444444444'
function restoreSupabase({ blocker = null, restore, compensate = { ok: true }, complete = { ok: true }, previous = null, resume } = {}) {
  const starts = new Date(Date.now() + 30 * H).toISOString()
  const ends = new Date(Date.now() + 31 * H).toISOString()
  const journal = { attempts: 0, failures: [], completed: null }
  const supabase = fakeSupabase({
    tables: {
      booking_practitioners: (state) => state.filters.some(f => f[1] === 'slug')
        ? [{ id: PRACT }] : [{ id: PRACT, buffer_before_min: 0, buffer_after_min: 15 }],
      bookings: [{ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', customer_first_name: 'Naim', customer_last_name: 'Test', customer_email: 'n@example.invalid', starts_at: starts, ends_at: ends, status: 'cancelled', google_event_id: 'evt-old', booked_price_cents: 7000 }],
      booking_services: [{ id: 'svc', title: 'Guidance visio', modality: ['video'] }],
      booking_calendar_connections: [{ access_token_enc: encrypt('tok'), refresh_token_enc: encrypt('ref'), token_expiry: new Date(Date.now() + 10 * H).toISOString(), google_calendar_id: 'cal@group' }],
      rdv_balance_restorations: (state) => {
        if (state.filters.some(f => f[1] === 'idempotency_key')) return previous ? [previous] : []
        return previous && previous.status === 'google_pending' ? [previous] : []
      },
    },
    rpc: {
      rdv_balance_restore_blocker: { data: blocker, error: null },
      restore_rdv_balance_cancelled_booking: { data: restore ?? { ok: true, replay: false, restoration_id: REST, due_cents: 5000, paid_cents: 2000 }, error: null },
      claim_rdv_balance_restore_resume: () => {
        if (resume) return { data: resume, error: null }
        journal.attempts += 1
        return { data: { ok: true, restoration_id: REST, booking_id: BOOKING, attempts: journal.attempts, due_cents: 5000 }, error: null }
      },
      record_rdv_balance_restore_failure: (args) => { journal.failures.push(args.p_error); return { data: true, error: null } },
      compensate_rdv_balance_restore: { data: compensate, error: null },
      complete_rdv_balance_restore: (args) => { journal.completed = args; return { data: complete, error: null } },
      record_rdv_balance_restore_email: { data: true, error: null },
      rdv_booking_paid_cents: { data: 2000, error: null },
      rotate_rdv_balance_restore_token: { data: { ok: true, due_cents: 5000, late_until: new Date(Date.now() + 29 * H).toISOString() }, error: null },
    },
  })
  supabase.journal = journal
  return supabase
}
const enabled = { RDV_BALANCE_RESTORE_ENABLED: 'true' }
const restoreInput = { practitioner_id: PRACT, booking_id: BOOKING, idempotency_key: KEY, hours_before: 1, confirm_no_external_payment: true }

// Faux Google Agenda avec état : événements par identifiant, pages de
// résultats, et pannes injectées sur les écritures (dans l'ordre) :
//   { status } → réponse d'erreur ; 'timeout' → rien appliqué, délai dépassé ;
//   'lost' → modification APPLIQUÉE puis réponse perdue.
function fakeGoogle({ events = { 'evt-old': 'cancelled' }, pages = null, faults = [] } = {}) {
  const store = new Map(Object.entries(events))
  const calls = []
  const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const parsed = new URL(url)
    calls.push({ method, url, pageToken: parsed.searchParams.get('pageToken') })
    if (method === 'GET') {
      if (pages) {
        const index = Number(parsed.searchParams.get('pageToken')) || 0
        const page = pages[Math.min(index, pages.length - 1)]
        return { ok: true, status: 200, json: async () => page }
      }
      return { ok: true, status: 200, json: async () => ({ items: [...store].map(([id, status]) => ({ id, status })) }) }
    }
    const fault = faults.shift()
    if (fault === 'timeout') throw abort()
    if (fault && typeof fault === 'object') return { ok: false, status: fault.status, json: async () => ({}) }
    const apply = () => {
      if (method === 'DELETE') {
        const id = decodeURIComponent(parsed.pathname.split('/').pop())
        if (!store.has(id) || store.get(id) === 'cancelled') return { ok: false, status: 410, json: async () => ({}) }
        store.set(id, 'cancelled')
        return { ok: true, status: 204, json: async () => ({}) }
      }
      if (method === 'PATCH') {
        const id = decodeURIComponent(parsed.pathname.split('/').pop())
        if (!store.has(id)) return { ok: false, status: 404, json: async () => ({}) }
        store.set(id, 'confirmed')
        return { ok: true, status: 200, json: async () => ({ id }) }
      }
      const body = JSON.parse(opts.body)
      if (store.has(body.id)) return { ok: false, status: 409, json: async () => ({}) }
      store.set(body.id, 'confirmed')
      return { ok: true, status: 200, json: async () => ({ id: body.id }) }
    }
    const response = apply()
    if (fault === 'lost') throw abort()
    return response
  }
  return { fetchImpl, store, calls, writes: () => calls.filter(c => c.method !== 'GET') }
}

test('restauration : désactivée par défaut, confirmations et contrôles exigés avant toute écriture', async () => {
  const supabase = restoreSupabase()
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: {} })).body.error, 'restore_disabled')
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: { ...restoreInput, confirm_no_external_payment: false }, env: enabled })).body.error, 'external_payment_confirmation_required')
  assert.equal((await restoreBalanceBooking({ supabase, userId: USER, input: { ...restoreInput, hours_before: 0 }, env: enabled })).body.error, 'invalid_late_window')
  const blocked = restoreSupabase({ blocker: 'slot_booked' })
  assert.equal((await restoreBalanceBooking({ supabase: blocked, userId: USER, input: restoreInput, env: enabled, fetchImpl: fakeGoogle().fetchImpl })).body.error, 'slot_booked')
  assert.ok(!blocked.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'))
})

test('restauration : créneau occupé dans Google → refus sans écriture', async () => {
  const supabase = restoreSupabase()
  const google = fakeGoogle({ events: { 'evt-old': 'cancelled', other: 'confirmed' } })
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.body.error, 'google_slot_busy')
  assert.ok(!supabase.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'))
})

test('Google paginé : un rendez-vous en page 2 est vu, la restauration est refusée', async () => {
  const supabase = restoreSupabase()
  const google = fakeGoogle({ pages: [
    { items: [{ id: 'evt-old', status: 'cancelled' }, { id: 'free', status: 'confirmed', transparency: 'transparent' }], nextPageToken: '1' },
    { items: [{ id: 'manual', status: 'confirmed' }] },
  ] })
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.body.error, 'google_slot_busy')
  assert.deepEqual(google.calls.map(c => c.pageToken), [null, '1'])
  assert.match(google.calls[0].url, /fields=nextPageToken%2Citems/)
  assert.ok(!supabase.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'))
})

test('Google paginé : toutes les pages libres → libre ; liste sans fin → refus « tronquée »', async () => {
  const booking = { practitioner_id: PRACT, starts_at: new Date(Date.now() + 30 * H).toISOString(), ends_at: new Date(Date.now() + 31 * H).toISOString(), google_event_id: 'evt-old' }
  const supabase = restoreSupabase()
  const two = fakeGoogle({ pages: [{ items: [], nextPageToken: '1' }, { items: [{ id: 'evt-old', status: 'cancelled' }] }] })
  assert.deepEqual(await googleSlotIsFree({ supabase, booking, fetchImpl: two.fetchImpl }), { ok: true, pages: 2 })
  const endless = fakeGoogle({ pages: [{ items: [], nextPageToken: 'again' }] })
  assert.deepEqual(await googleSlotIsFree({ supabase, booking, fetchImpl: endless.fetchImpl }), { ok: false, error: 'google_calendar_truncated' })
  assert.equal(endless.calls.length, GOOGLE_SLOT_MAX_PAGES)
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) })
  assert.deepEqual(await googleSlotIsFree({ supabase, booking, fetchImpl: down }), { ok: false, error: 'google_calendar_unavailable' })
  const broken = async () => { throw new Error('reset') }
  assert.deepEqual(await googleSlotIsFree({ supabase, booking, fetchImpl: broken }), { ok: false, error: 'google_calendar_unavailable' })
})

test('restauration : succès → événement Google réactivé, lien du solde exact, aucun e-mail sans demande', async () => {
  const supabase = restoreSupabase()
  const google = fakeGoogle()
  let mails = 0
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl, send: async () => { mails++; return { status: 'sent' } } })
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
  assert.equal(supabase.journal.attempts, 1, 'essai Google sous verrou de reprise')
  assert.ok(supabase.journal.completed)
  assert.equal(google.store.get('evt-old'), 'confirmed')
})

test('restauration : refus net de Google (403) → compensation (retour à l’état annulé), aucun lien rendu', async () => {
  const supabase = restoreSupabase()
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: fakeGoogle({ faults: [{ status: 403 }] }).fetchImpl })
  assert.equal(result.status, 502)
  assert.equal(result.body.error, 'google_restore_failed')
  assert.equal(result.body.compensated, true)
  assert.equal(result.body.payment_url, undefined)
  assert.ok(!supabase.journal.completed)
})

test('interruption : Google 5xx ou délai dépassé → en attente (202), jamais compensé, réservation gardée', async () => {
  for (const fault of [{ status: 503 }, 'timeout']) {
    const supabase = restoreSupabase()
    const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: fakeGoogle({ faults: [fault] }).fetchImpl })
    assert.equal(result.status, 202)
    assert.equal(result.body.pending, true)
    assert.equal(result.body.restoration_id, REST)
    assert.equal(result.body.payment_url, undefined)
    assert.ok(!supabase.calls.some(c => c.name === 'compensate_rdv_balance_restore'), 'Google a pu appliquer : pas de retour en arrière')
    assert.ok(!supabase.journal.completed)
    assert.equal(supabase.journal.failures.length, 1)
  }
})

test('reprise : succès Google dont la réponse est perdue → aucun doublon à la reprise', async () => {
  // L'ancien événement n'existe plus : recréation à identifiant fixe, appliquée
  // par Google mais réponse perdue (coupure).
  const google = fakeGoogle({ events: {}, faults: [null, 'lost'] })
  const supabase = restoreSupabase()
  const first = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(first.status, 202)
  const fixedId = recreatedEventId(BOOKING, REST)
  assert.match(fixedId, /^[0-9a-v]+$/)
  assert.equal(google.store.size, 1, 'Google a bien créé l’événement')

  // Reprise par le bouton « Reprendre » : 404 sur l'ancien, 409 sur l'identifiant
  // fixe, réactivation du même événement → toujours un seul événement.
  const pending = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' } })
  const resumed = await resumeBalanceRestoration({ supabase: pending, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.completed, true)
  assert.match(resumed.body.payment_url, /\/rdv\/solde#token=/)
  assert.equal(google.store.size, 1, 'aucun doublon')
  assert.deepEqual([...google.store.keys()], [fixedId])
  assert.equal(pending.journal.completed.p_google_event_id, fixedId)
  assert.equal(pending.journal.completed.p_google_status, 'created')
  assert.ok(pending.calls.some(c => c.name === 'rotate_rdv_balance_restore_token'), 'nouveau lien : le premier n’a jamais été montré')
})

test('rejeu de la même demande : restauration en attente → reprise ; terminée → nouveau lien sans écriture Google', async () => {
  const google = fakeGoogle()
  const pending = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' } })
  const replayed = await restoreBalanceBooking({ supabase: pending, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(replayed.status, 200)
  assert.equal(replayed.body.replay, true)
  assert.ok(!pending.calls.some(c => c.name === 'restore_rdv_balance_cancelled_booking'), 'pas de seconde restauration')
  assert.ok(!pending.calls.some(c => c.name === 'rdv_balance_restore_blocker'))
  assert.equal(google.writes().length, 1)

  const google2 = fakeGoogle()
  const done = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'completed' }, resume: { ok: false, error: 'restoration_not_pending', status: 'completed' } })
  const again = await restoreBalanceBooking({ supabase: done, userId: USER, input: restoreInput, env: enabled, fetchImpl: google2.fetchImpl })
  assert.equal(again.status, 200)
  assert.equal(again.body.replay, true)
  assert.match(again.body.payment_url, /\/rdv\/solde#token=/)
  assert.equal(google2.writes().length, 0)

  const other = restoreSupabase({ previous: { id: REST, booking_id: '55555555-5555-4555-8555-555555555555', status: 'completed' } })
  assert.equal((await restoreBalanceBooking({ supabase: other, userId: USER, input: restoreInput, env: enabled, fetchImpl: google2.fetchImpl })).body.error, 'idempotency_key_reused')
})

test('concurrence : reprise déjà en cours ailleurs → 202 sans appel Google ; rien à reprendre → 409', async () => {
  const google = fakeGoogle()
  const busy = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' }, resume: { ok: false, error: 'resume_in_progress' } })
  const result = await resumeBalanceRestoration({ supabase: busy, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.status, 202)
  assert.equal(google.calls.length, 0)
  const none = restoreSupabase()
  assert.equal((await resumeBalanceRestoration({ supabase: none, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled })).body.error, 'restoration_not_pending')
})

test('cron : libère les annulations abandonnées, reprend les restaurations, alerte le propriétaire si besoin', async () => {
  const ROWS = [
    { id: 'r-ok', attempts: 0 }, { id: 'r-refused', attempts: 0 }, { id: 'r-retry', attempts: RESUME_ALERT_ATTEMPTS - 1 }, { id: 'r-first', attempts: 0 },
  ]
  const faults = { 'r-ok': [], 'r-refused': [{ status: 403 }], 'r-retry': [{ status: 503 }], 'r-first': ['timeout'] }
  const base = restoreSupabase()
  let current
  const supabase = {
    ...base,
    from: (table) => table === 'rdv_balance_restorations'
      ? fakeSupabase({ tables: { rdv_balance_restorations: ROWS.map(r => ({ id: r.id, booking_id: BOOKING })) } }).from(table)
      : base.from(table),
    rpc: (name, args) => {
      if (name === 'release_stale_rdv_balance_cancel_claims') return thenable({ data: 2, error: null })
      if (name === 'claim_rdv_balance_restore_resume') {
        current = ROWS.find(r => r.id === args.p_restoration_id)
        return thenable({ data: { ok: true, restoration_id: current.id, booking_id: BOOKING, attempts: current.attempts + 1, due_cents: 5000 }, error: null })
      }
      return base.rpc(name, args)
    },
  }
  const google = fakeGoogle()
  const fetchImpl = (url, opts) => {
    if (opts?.method && faults[current.id].length) {
      const fault = faults[current.id].shift()
      if (fault === 'timeout') return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return Promise.resolve({ ok: false, status: fault.status, json: async () => ({}) })
    }
    return google.fetchImpl(url, opts)
  }
  const alerts = []
  const summary = await reconcilePendingRestorations({ supabase, fetchImpl, limit: 10, sendAlert: async (args) => { alerts.push([args.kind, args.reason]); return { status: 'sent' } } })
  assert.equal(await releaseStaleCancelClaims({ supabase }), 2)
  assert.equal(summary.examined, 4)
  assert.deepEqual(summary.outcomes, { completed: 1, compensated: 1, pending: 2 })
  assert.deepEqual(alerts, [['restore', 'restore_compensated'], ['restore', 'restore_google_retrying']])
})

// ── Seconde revue PR #148 ───────────────────────────────────────────────────

// Calendrier connecté au premier accès (contrôle du créneau), puis déconnecté.
function disconnectAfter(supabase, okCalls) {
  let calls = 0
  const from = supabase.from
  supabase.from = (table) => {
    if (table !== 'booking_calendar_connections') return from(table)
    calls += 1
    return calls <= okCalls ? from(table) : fakeSupabase({ tables: { booking_calendar_connections: [] } }).from(table)
  }
  return supabase
}

test('A — connexion Google perdue entre le contrôle et l’écriture : en attente, jamais « synchronisé », jamais compensé', async () => {
  const supabase = disconnectAfter(restoreSupabase(), 1)
  const google = fakeGoogle()
  const result = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.status, 202)
  assert.equal(result.body.reason, 'google_disconnected')
  assert.equal(result.body.payment_url, undefined)
  assert.ok(!supabase.journal.completed, 'jamais marqué comme rétabli sans événement Google')
  assert.ok(!supabase.calls.some(c => c.name === 'compensate_rdv_balance_restore'))
  assert.deepEqual(supabase.journal.failures, ['google_disconnected'])
  assert.equal(google.writes().length, 0)
})

test('A — reprise au cron avec Google déconnecté : rien n’est écrit, alerte « reconnecter »', async () => {
  const supabase = disconnectAfter(restoreSupabase(), 0)
  supabase.from = ((from) => (table) => table === 'rdv_balance_restorations'
    ? fakeSupabase({ tables: { rdv_balance_restorations: [{ id: REST, booking_id: BOOKING }] } }).from(table)
    : from(table))(supabase.from)
  const google = fakeGoogle()
  const alerts = []
  const summary = await reconcilePendingRestorations({ supabase, fetchImpl: google.fetchImpl, sendAlert: async (args) => { alerts.push(args.reason); return { status: 'sent' } } })
  assert.deepEqual(summary.outcomes, { pending: 1 })
  assert.deepEqual(alerts, ['restore_google_disconnected'])
  assert.ok(!supabase.journal.completed)
  assert.equal(google.calls.length, 0)
})

test('D — reprise différée : nouveau rendez-vous manuel sur le créneau → examen manuel, aucune écriture Google', async () => {
  const google = fakeGoogle({ events: { 'evt-old': 'cancelled', 'manuel-1': 'confirmed' } })
  const pending = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' } })
  const result = await resumeBalanceRestoration({ supabase: pending, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'restore_google_conflict')
  assert.equal(google.writes().length, 0, 'aucune réactivation sur un créneau occupé')
  assert.deepEqual(pending.journal.failures, ['google_slot_conflict'])
  assert.ok(!pending.calls.some(c => c.name === 'compensate_rdv_balance_restore'), 'pas de retour silencieux')

  // Cron : même conflit → alerte « conflit ».
  const cron = restoreSupabase()
  cron.from = ((from) => (table) => table === 'rdv_balance_restorations'
    ? fakeSupabase({ tables: { rdv_balance_restorations: [{ id: REST, booking_id: BOOKING }] } }).from(table)
    : from(table))(cron.from)
  const alerts = []
  const summary = await reconcilePendingRestorations({ supabase: cron, fetchImpl: fakeGoogle({ events: { 'manuel-1': 'confirmed' } }).fetchImpl, sendAlert: async (args) => { alerts.push(args.reason); return { status: 'sent' } } })
  assert.deepEqual(summary.outcomes, { conflict: 1 })
  assert.deepEqual(alerts, ['restore_conflict'])
})

test('D — les événements de la réservation elle-même ne sont jamais un conflit', async () => {
  const fixed = recreatedEventId(BOOKING, REST)
  const google = fakeGoogle({ events: { [fixed]: 'confirmed' } })
  const pending = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' } })
  const result = await resumeBalanceRestoration({ supabase: pending, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: enabled, fetchImpl: google.fetchImpl })
  assert.equal(result.status, 200)
  assert.equal(google.store.size, 1)
})

test('Abandonner : retour à l’état annulé ; refusé si un paiement a commencé', async () => {
  const ok = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' } })
  const done = await abandonBalanceRestoration({ supabase: ok, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING } })
  assert.equal(done.status, 200)
  assert.equal(ok.calls.find(c => c.name === 'compensate_rdv_balance_restore').args.p_reason, 'owner_abandoned')
  const paid = restoreSupabase({ previous: { id: REST, booking_id: BOOKING, status: 'google_pending' }, compensate: { ok: false, error: 'payment_started_manual_review' } })
  assert.equal((await abandonBalanceRestoration({ supabase: paid, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING } })).body.error, 'restore_manual_review')
})

// Passage du cron sur une visio due, avec Google simulé (fetch global).
function cancelSupabase({ finalize, resyncClaim = { ok: true, booking_id: BOOKING, google_event_id: 'evt1' }, startsInHours = 30, review = null, error = null }) {
  const starts = new Date(Date.now() + startsInHours * H).toISOString()
  const startsAt = starts
  const ends = new Date(Date.now() + (startsInHours + 1) * H).toISOString()
  const journal = { released: 0, resynced: null, resyncFailures: [], manualReview: [], claims: [] }
  const supabase = fakeSupabase({
    tables: {
      bookings: [{ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', customer_first_name: 'Sylvie', customer_last_name: 'Test', customer_email: 's@example.invalid', starts_at: starts, ends_at: ends, status: 'confirmed', booking_source: 'mediumia', booked_price_cents: 7000, reservation_payment_cents: 2000, balance_reminder_sent_at: new Date().toISOString(), google_event_id: 'evt1', balance_google_resync_review_at: review, balance_google_resync_error: error }],
      booking_services: [{ id: 'svc', title: 'Guidance visio', modality: ['video'] }],
      booking_practitioners: [{ id: PRACT, buffer_before_min: 0, buffer_after_min: 0 }],
      rdv_financial_entries: [{ booking_id: BOOKING, direction: 'income', gross_cents: 2000 }],
      booking_calendar_connections: [{ access_token_enc: encrypt('tok'), refresh_token_enc: encrypt('ref'), token_expiry: new Date(Date.now() + 10 * H).toISOString(), google_calendar_id: 'cal@group' }],
    },
    rpc: {
      claim_rdv_balance_auto_cancel: { data: { ok: true, booking_id: BOOKING }, error: null },
      finalize_rdv_balance_auto_cancel: { data: finalize, error: null },
      release_rdv_balance_auto_cancel: () => { journal.released += 1; return { data: null, error: null } },
      claim_rdv_balance_google_resync: (args) => { journal.claims.push(args); return { data: resyncClaim, error: null } },
      complete_rdv_balance_google_resync: (args) => { journal.resynced = args; return { data: { ok: true }, error: null } },
      record_rdv_balance_google_resync_failure: (args) => { journal.resyncFailures.push(args.p_error); return { data: true, error: null } },
      flag_rdv_balance_google_resync_review: (args) => { journal.manualReview.push(args.p_error); return { data: true, error: null } },
      reopen_rdv_balance_google_resync: (args) => { journal.reopened = args; return { data: new Date(startsAt).getTime() <= Date.now() ? { ok: false, error: 'appointment_started' } : { ok: true }, error: null } },
      dismiss_rdv_balance_google_resync: (args) => { journal.dismissed = args; return { data: { ok: true }, error: null } },
      rdv_booking_paid_cents: { data: 2000, error: null },
    },
  })
  supabase.journal = journal
  return supabase
}

async function withGlobalFetch(fetchImpl, run) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try { return await run() } finally { globalThis.fetch = original }
}

const collectAlerts = (list) => async (args) => { list.push([args.kind, args.reason]); return { status: 'sent' } }

test('B — coupure juste après la suppression Google : créneau revérifié puis événement remis, l’annulation retentée plus tard', async () => {
  // DELETE appliqué par Google mais réponse perdue.
  const google = fakeGoogle({ events: { evt1: 'confirmed' }, faults: ['lost'] })
  const supabase = cancelSupabase({ finalize: { ok: true } })
  const result = await withGlobalFetch(google.fetchImpl, () => runDailySweep(supabase, new Date(), { sendAlert: async () => ({ status: 'sent' }) }))
  const item = result.results[0]
  assert.equal(item.action, 'cancel_google_retry')
  assert.equal(item.google, 'resynced')
  assert.equal(supabase.journal.released, 1, 'verrou libéré (plus de TypeError .catch)')
  assert.equal(google.store.get('evt1'), 'confirmed', 'événement remis')
  assert.deepEqual(google.calls.map(c => c.method), ['DELETE', 'GET', 'PATCH'], 'contrôle du créneau AVANT toute remise')
  assert.ok(!supabase.calls.some(c => c.name === 'finalize_rdv_balance_auto_cancel'))
})

test('P0 — remise : un rendez-vous manuel a pris le créneau → aucune écriture, repère gardé, examen manuel, alerte', async () => {
  // Événement de la réservation supprimé (annulation interrompue), un rendez-vous manuel occupe le créneau.
  const google = fakeGoogle({ events: { evt1: 'cancelled', 'manuel-1': 'confirmed' } })
  const supabase = cancelSupabase({ finalize: null })
  const alerts = []
  const summary = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(summary.outcomes, { conflict: 1 })
  assert.equal(google.writes().length, 0, 'aucune écriture Google')
  assert.equal(google.store.get('manuel-1'), 'confirmed', 'rendez-vous manuel intact')
  assert.equal(google.store.get('evt1'), 'cancelled', 'pas de chevauchement créé')
  assert.deepEqual(supabase.journal.manualReview, ['google_slot_conflict'], 'examen manuel')
  assert.equal(supabase.journal.resynced, null, 'repère conservé')
  assert.deepEqual(alerts, [['google_conflict', 'google_resync_conflict']])
})

test('P0 — remise après coupure réseau : contrôle du créneau impossible → rien d’écrit ; le lendemain, conflit détecté ou remise propre', async () => {
  // Jour 1 : DELETE appliqué puis coupure ; la remise immédiate ne peut pas lire Google.
  let networkDown = false
  const google = fakeGoogle({ events: { evt1: 'confirmed' }, faults: ['lost'] })
  const flaky = async (url, opts = {}) => {
    if (networkDown) throw new TypeError('fetch failed')
    const res = google.fetchImpl(url, opts)
    if ((opts.method || 'GET') === 'DELETE') networkDown = true
    return res
  }
  const day1 = cancelSupabase({ finalize: { ok: true } })
  const result = await withGlobalFetch(flaky, () => runDailySweep(day1, new Date(), { sendAlert: async () => ({ status: 'sent' }) }))
  assert.equal(result.results[0].google, 'failed')
  assert.deepEqual(day1.journal.resyncFailures, ['google_unavailable'])
  assert.equal(day1.journal.manualReview.length, 0)
  assert.equal(google.store.get('evt1'), 'cancelled')
  assert.equal(google.writes().length, 1, 'seul le DELETE initial a été envoyé')

  // Jour 2, cas a : un rendez-vous manuel a pris le créneau → conflit, aucune écriture.
  google.store.set('manuel-1', 'confirmed')
  const day2 = cancelSupabase({ finalize: null })
  const alerts = []
  const conflict = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase: day2, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(conflict.outcomes, { conflict: 1 })
  assert.equal(google.writes().length, 1)
  assert.deepEqual(alerts, [['google_conflict', 'google_resync_conflict']])

  // Jour 2, cas b : créneau libre → événement remis, un seul.
  google.store.delete('manuel-1')
  const day2b = cancelSupabase({ finalize: null })
  const ok = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase: day2b, sendAlert: async () => ({ status: 'sent' }) }))
  assert.deepEqual(ok.outcomes, { resynced: 1 })
  assert.equal(google.store.get('evt1'), 'confirmed')
  assert.equal(google.store.size, 1)
})

test('P0 — incident en examen manuel : plus aucun appel Google automatique, alerte assurée ; le propriétaire peut revérifier ou classer', async () => {
  const google = fakeGoogle({ events: { evt1: 'cancelled', 'manuel-1': 'confirmed' } })
  const supabase = cancelSupabase({ finalize: null, review: new Date().toISOString(), error: 'google_slot_conflict' })
  const alerts = []
  const summary = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(summary.outcomes, { manual_review: 1 })
  assert.equal(google.calls.length, 0)
  assert.deepEqual(alerts, [['google_conflict', 'google_resync_conflict']])
  assert.ok(!supabase.calls.some(c => c.name === 'claim_rdv_balance_google_resync'))

  // « Revérifier et remettre » : toujours avec contrôle ; encore occupé → refus, rien d'écrit.
  const retried = await retryGoogleResync({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, fetchImpl: google.fetchImpl })
  assert.equal(retried.status, 409)
  assert.equal(retried.body.error, 'google_slot_busy')
  assert.equal(supabase.journal.reopened.p_actor, USER, 'réouverture journalisée avec l’auteur')
  assert.equal(google.writes().length, 0)
  // Créneau libéré par le propriétaire → remise.
  google.store.delete('manuel-1')
  const done = await retryGoogleResync({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, fetchImpl: google.fetchImpl })
  assert.equal(done.status, 200)
  assert.equal(google.store.get('evt1'), 'confirmed')
  // « Marquer comme traité » : journalisé avec l'auteur.
  const dismissed = await dismissGoogleResync({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, note: 'vu avec la cliente' } })
  assert.equal(dismissed.status, 200)
  assert.equal(supabase.journal.dismissed.p_actor, USER)
})

test('P1 — rendez-vous déjà commencé avant la remise : aucune modification Google, incident conservé, alerte URGENTE', async () => {
  const google = fakeGoogle({ events: { evt1: 'cancelled' } })
  const supabase = cancelSupabase({ finalize: null, startsInHours: -1, resyncClaim: { ok: false, error: 'appointment_started', first: true } })
  const alerts = []
  const summary = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(summary.outcomes, { overdue: 1 })
  assert.equal(google.calls.length, 0, 'aucun appel Google sur un créneau passé')
  assert.equal(supabase.journal.resynced, null, 'repère jamais effacé silencieusement')
  assert.deepEqual(alerts, [['google_overdue', 'google_resync_started']])
  const mail = buildRdvBalanceOwnerAlert({ customerName: 'Sylvie T.', serviceTitle: 'Guidance', startsAt: new Date().toISOString(), dueCents: 5000, deadlineAt: new Date().toISOString(), reminderSentAt: null, reason: 'google_resync_started' })
  assert.match(mail.subject, /^URGENT — /)
  // Le bouton « Revérifier » refuse aussi sur un créneau passé (contrôle en base).
  const retried = await retryGoogleResync({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, fetchImpl: google.fetchImpl })
  assert.equal(retried.body.error, 'appointment_started')
  assert.ok(!supabase.journal.claims.length || supabase.journal.claims.length === 1, 'aucune remise lancée par le bouton')
  assert.equal(google.calls.length, 0)
})

test('P1 — rendez-vous imminent : échec de remise → alerte URGENTE', async () => {
  const google = fakeGoogle({ events: { evt1: 'cancelled' }, faults: [{ status: 503 }] })
  const supabase = cancelSupabase({ finalize: null, startsInHours: 5 })
  const alerts = []
  await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(alerts, [['google_sync', 'google_resync_failed_imminent']])
})

test('B — événement déjà supprimé par un passage interrompu (already_deleted) + finalisation refusée : remis sans doublon', async () => {
  const google = fakeGoogle({ events: { evt1: 'cancelled' } })
  const supabase = cancelSupabase({ finalize: { ok: false, error: 'booking_no_longer_due_for_balance_cancel', reason: 'owner_hold' } })
  const result = await withGlobalFetch(google.fetchImpl, () => runDailySweep(supabase, new Date(), { sendAlert: async () => ({ status: 'sent' }) }))
  const item = result.results[0]
  assert.equal(item.action, 'cancel_aborted')
  assert.equal(item.google, 'resynced')
  assert.equal(google.store.get('evt1'), 'confirmed')
  assert.equal(google.store.size, 1, 'aucun doublon')
  assert.equal(supabase.journal.resynced.p_google_status, 'restored')
  assert.equal(supabase.journal.released, 1)
})

test('B — rattrapage au cron suivant (décision « Maintenir » prise entre-temps) : remis, puis rien à refaire', async () => {
  // Événement complètement disparu : recréé une seule fois avec l'identifiant fixe de la réservation.
  const google = fakeGoogle({ events: {} })
  const supabase = cancelSupabase({ finalize: null })
  const fixed = recreatedEventId(BOOKING, BOOKING)
  const first = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: async () => ({ status: 'sent' }) }))
  assert.deepEqual(first.outcomes, { resynced: 1 })
  assert.equal(supabase.journal.resynced.p_google_event_id, fixed)
  // Réponse perdue puis nouveau passage : son propre événement n'est pas un conflit ; 409 → même événement.
  const again = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase, sendAlert: async () => ({ status: 'sent' }) }))
  assert.deepEqual(again.outcomes, { resynced: 1 })
  assert.deepEqual([...google.store.keys()], [fixed])

  // Google refuse : repère conservé, échec journalisé, alerte « google_sync ».
  const refused = fakeGoogle({ events: { evt1: 'cancelled' }, faults: [{ status: 403 }] })
  const failing = cancelSupabase({ finalize: null })
  const alerts = []
  const summary = await withGlobalFetch(refused.fetchImpl, () => reconcileGoogleResyncs({ supabase: failing, sendAlert: collectAlerts(alerts) }))
  assert.deepEqual(summary.outcomes, { failed: 1 })
  assert.deepEqual(failing.journal.resyncFailures, ['google_patch_403'])
  assert.deepEqual(alerts, [['google_sync', 'google_resync_failed']])
  assert.equal(failing.journal.resynced, null)
})

// Phase Google du cron sur 5 remises + 3 restaurations, Google simulé.
function budgetSupabase() {
  const supabase = restoreSupabase()
  supabase.from = ((from) => (table) => {
    if (table === 'rdv_balance_restorations') return fakeSupabase({ tables: { rdv_balance_restorations: [1, 2, 3].map(i => ({ id: `r-${i}`, booking_id: BOOKING })) } }).from(table)
    if (table === 'bookings') return fakeSupabase({ tables: { bookings: [1, 2, 3, 4, 5].map(() => ({ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', starts_at: new Date(Date.now() + 30 * H).toISOString(), ends_at: new Date(Date.now() + 31 * H).toISOString(), status: 'confirmed', google_event_id: 'evt-old', booked_price_cents: 7000 })) } }).from(table)
    return from(table)
  })(supabase.from)
  const rpc = supabase.rpc
  supabase.rpc = (name, args) => name === 'claim_rdv_balance_google_resync'
    ? thenable({ data: { ok: true, booking_id: BOOKING, google_event_id: 'evt-old' }, error: null })
    : rpc(name, args)
  return supabase
}

test('C — tâches précédentes lentes : échéance déjà atteinte → aucune requête Google, tout est reporté', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ items: [] }) } }
  const cronStartedAt = Date.now() - (CRON_GOOGLE_PHASE_BUDGET_MS + 5_000) // 65 s déjà écoulées
  const started = Date.now()
  const result = await withGlobalFetch(fetchImpl, () => runGoogleReconciliation({ supabase: budgetSupabase(), deadline: googlePhaseDeadline(cronStartedAt), fetchImpl, sendAlert: async () => ({ status: 'sent' }) }))
  assert.equal(calls, 0)
  assert.equal(result.googleResync.deferred, 5)
  assert.equal(result.restorations.deferred, 3)
  assert.ok(Date.now() - started < 200)
})

test('C — Google qui ne répond jamais (même pas à l’abandon) : la phase s’arrête net à l’échéance', async () => {
  const hang = () => new Promise(() => {}) // ignore délai et signal d'abandon
  const started = Date.now()
  const deadline = started + 300
  const result = await withGlobalFetch(hang, () => runGoogleReconciliation({ supabase: budgetSupabase(), deadline, fetchImpl: hang, sendAlert: async () => ({ status: 'sent' }) }))
  const elapsed = Date.now() - started
  assert.ok(elapsed < 450, `phase terminée en ${elapsed} ms pour une échéance de 300 ms`)
  assert.equal(result.googleResync.examined, 0)
  assert.equal(result.googleResync.deferred + result.restorations.deferred, 8)
})

test('C — Google lent qui respecte l’abandon : chaque appel est coupé à l’échéance globale', async () => {
  let calls = 0
  const slow = (url, opts = {}) => new Promise((resolve, reject) => {
    calls += 1
    const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ items: [] }) }), 5_000)
    opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  const started = Date.now()
  const result = await withGlobalFetch(slow, () => runGoogleReconciliation({ supabase: budgetSupabase(), deadline: started + 250, fetchImpl: slow, sendAlert: async () => ({ status: 'sent' }) }))
  const elapsed = Date.now() - started
  assert.ok(elapsed < 400, `phase terminée en ${elapsed} ms`)
  assert.ok(calls >= 1)
  assert.ok(result.googleResync.deferred + result.restorations.deferred >= 7)
})

test('C — limite Vercel déclarée et budget : phase Google + alertes très en deçà de la durée maximale', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.equal(vercel.functions['api/rdv-config.js'].maxDuration, CRON_MAX_DURATION_S)
  assert.equal(vercel.rewrites.find(r => r.source === '/api/rdv-balance-cron').destination, '/api/rdv-config?rdvBalanceAction=cron')
  assert.ok(CRON_GOOGLE_PHASE_BUDGET_MS + ALERT_GRACE_MS <= (CRON_MAX_DURATION_S * 1000) / 4)
  const src = read('lib/rdvBalanceCronHandler.js')
  const sweep = src.indexOf('const result = await runDailySweep(supabase)')
  const formation = src.indexOf('formationPath = await syncLiveSubscriptions(supabase)')
  const google = src.indexOf('await runGoogleReconciliation({ supabase, deadline: googlePhaseDeadline(cronStartedAt) })')
  assert.ok(sweep > 0 && formation > sweep && google > formation, 'rappels et annulations d’abord, Google en dernier')
  assert.doesNotMatch(src, /\.rpc\([^)]*\)\.catch\(/)
  assert.doesNotMatch(read('lib/rdvBalanceApiHandler.js'), /\.rpc\([^)]*\)\.catch\(/)
})

test('Restauration OFF : aucune restauration ni nouveau lien possibles ; la remise Google (P0) reste active', async () => {
  const supabase = restoreSupabase()
  const off = {}
  const restored = await restoreBalanceBooking({ supabase, userId: USER, input: restoreInput, env: off, fetchImpl: fakeGoogle().fetchImpl })
  assert.equal(restored.status, 403)
  assert.equal(restored.body.error, 'restore_disabled')
  assert.equal((await rotateBalanceLink({ supabase, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING }, env: off })).body.error, 'restore_disabled')
  assert.equal(supabase.calls.filter(c => c.type === 'rpc').length, 0, 'aucune écriture en base')
  const watch = await listBalanceWatch({ supabase: restoreSupabase(), userId: USER, practitionerId: PRACT, env: off })
  assert.equal(watch.body.restore_enabled, false)
  // La remise d'un événement après une annulation interrompue ne dépend pas de l'interrupteur.
  const google = fakeGoogle({ events: { evt1: 'cancelled' } })
  const resync = cancelSupabase({ finalize: null })
  const summary = await withGlobalFetch(google.fetchImpl, () => reconcileGoogleResyncs({ supabase: resync, sendAlert: async () => ({ status: 'sent' }) }))
  assert.deepEqual(summary.outcomes, { resynced: 1 })
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
  // Revendication ET finalisation repassent par le même contrôle complet.
  assert.equal((sql.match(/v_blocker := public\.rdv_balance_cancel_blocker\(v_booking\.id, p_now\);/g) || []).length, 2)
  assert.match(sql, /IF v_booking\.balance_owner_decision = 'hold' THEN RETURN 'owner_hold'; END IF;/)
  assert.equal((sql.match(/COALESCE\(v_booking\.balance_late_payment_until, v_booking\.starts_at - INTERVAL '48 hours'\)/g) || []).length, 3)
  assert.match(sql, /PERFORM pg_advisory_xact_lock\(hashtext\(p_practitioner_id::text\)\);/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS auto_cancel_mode TEXT NOT NULL DEFAULT 'auto'/)
  assert.doesNotMatch(sql, /UPDATE public\.bookings\s+SET status = 'confirmed'[\s\S]{0,40}WHERE id = '/, 'aucune réservation ciblée en dur')
  assert.doesNotMatch(sql, /Brulard|Audin/i)
})

test('migration : paiement et annulation sérialisés, reprise des restaurations journalisée', () => {
  const sql = read('supabase/migrations/20261011160000_rdv_balance_owner_review_restore.sql')
  assert.match(sql, /RETURN 'payment_in_progress'/)
  assert.match(sql, /RETURN 'restore_pending'/)
  assert.match(sql, /'error', 'balance_cancel_in_progress'/)
  assert.match(sql, /FUNCTION public\.attach_rdv_balance_paypal_order/)
  assert.match(sql, /FUNCTION public\.claim_rdv_balance_restore_resume/)
  assert.match(sql, /FUNCTION public\.release_stale_rdv_balance_cancel_claims/)
  assert.match(sql, /CHECK \(kind IN \('pre_cancel', 'review', 'restore', 'google_sync', 'google_conflict', 'google_overdue'\)\)/)
  assert.match(sql, /IF v_booking\.starts_at <= p_now THEN\s+UPDATE public\.bookings\s+SET balance_google_resync_review_at = COALESCE/, 'rendez-vous commencé : repère conservé en incident')
  assert.match(sql, /FUNCTION public\.rdv_balance_google_incidents/)
  const handler = read('lib/rdvBalanceApiHandler.js')
  assert.match(handler, /rpc\('attach_rdv_balance_paypal_order'/)
  assert.doesNotMatch(handler, /\.update\(\{ paypal_order_id: order\.orderId/, 'plus de rattachement direct hors verrou')
  assert.match(read('lib/rdvBalanceCronHandler.js'), /reconcilePendingRestorations\(options\)/)
  assert.match(sql, /balance_google_resync_at = COALESCE\(balance_google_resync_at, p_now\)/)
  assert.match(sql, /FUNCTION public\.claim_rdv_balance_google_resync/)
})

test('branchements : action admin, panneau dans la comptabilité, colonnes lues par le cron', () => {
  assert.match(read('api/rdv-admin.js'), /case 'balance-watch': \{/)
  assert.match(read('api/rdv-admin.js'), /input\.op === 'resume'\) result = await resumeBalanceRestoration/)
  assert.match(read('api/rdv-admin.js'), /input\.op === 'abandon'\) result = await abandonBalanceRestoration/)
  assert.match(read('src/components/rdv/AccountingSection.jsx'), /<RdvBalanceWatch practitionerId=\{practitionerId\} session=\{session\} \/>/)
  assert.match(read('lib/rdvBalanceCronHandler.js'), /balance_owner_decision, balance_late_payment_until'\)/)
})
