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
const { restoreBalanceBooking, setBalanceDecision, rotateBalanceLink, resumeBalanceRestoration, googleSlotIsFree, GOOGLE_SLOT_MAX_PAGES } = await import('../lib/rdvBalanceReviewAdmin.js')
const { reconcilePendingRestorations, RESUME_ALERT_ATTEMPTS } = await import('../lib/rdvBalanceRestoreResume.js')
const { recreatedEventId } = await import('../lib/rdvBalanceGoogle.js')
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
      gt() { return builder }, lt() { return builder }, lte() { return builder }, is() { return builder }, in() { return builder }, limit() { return builder }, order() { return builder },
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
      if (name === 'release_stale_rdv_balance_cancel_claims') return Promise.resolve({ data: 2, error: null })
      if (name === 'claim_rdv_balance_restore_resume') {
        current = ROWS.find(r => r.id === args.p_restoration_id)
        return Promise.resolve({ data: { ok: true, restoration_id: current.id, booking_id: BOOKING, attempts: current.attempts + 1, due_cents: 5000 }, error: null })
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
  const summary = await reconcilePendingRestorations({ supabase, fetchImpl, sendAlert: async (args) => { alerts.push([args.kind, args.reason]); return { status: 'sent' } } })
  assert.equal(summary.released_cancel_claims, 2)
  assert.equal(summary.examined, 4)
  assert.deepEqual(summary.outcomes, { completed: 1, compensated: 1, pending: 2 })
  assert.deepEqual(alerts, [['restore', 'restore_compensated'], ['restore', 'restore_google_retrying']])
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
  assert.match(sql, /CHECK \(kind IN \('pre_cancel', 'review', 'restore'\)\)/)
  const handler = read('lib/rdvBalanceApiHandler.js')
  assert.match(handler, /rpc\('attach_rdv_balance_paypal_order'/)
  assert.doesNotMatch(handler, /\.update\(\{ paypal_order_id: order\.orderId/, 'plus de rattachement direct hors verrou')
  assert.match(read('lib/rdvBalanceCronHandler.js'), /reconcilePendingRestorations\(\{ supabase \}\)/)
})

test('branchements : action admin, panneau dans la comptabilité, colonnes lues par le cron', () => {
  assert.match(read('api/rdv-admin.js'), /case 'balance-watch': \{/)
  assert.match(read('api/rdv-admin.js'), /input\.op === 'resume'\) result = await resumeBalanceRestoration/)
  assert.match(read('src/components/rdv/AccountingSection.jsx'), /<RdvBalanceWatch practitionerId=\{practitionerId\} session=\{session\} \/>/)
  assert.match(read('lib/rdvBalanceCronHandler.js'), /balance_owner_decision, balance_late_payment_until'\)/)
})
