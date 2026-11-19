/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const offline = await import('../lib/rdvOfflinePayments.js')
const { createManualPayment } = await import('../lib/rdvManualPaymentsAdmin.js')
const { runDailySweep } = await import('../lib/rdvBalanceCronHandler.js')
const { getBookingBalances } = await import('../lib/rdvDayPayments.js')

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const H = 3_600_000
const BOOKING = '11111111-1111-4111-8111-111111111111'
const PRACT = '7dcf2820-edb2-412b-b418-2a67fbf824ea'
const USER = '22222222-2222-4222-8222-222222222222'
const OFFLINE_ID = '44444444-4444-4444-8444-444444444444'
const PROD = { VERCEL_ENV: 'production' }
const REQ = 'req-0123456789abcdef'

const thenable = (value) => { const promise = Promise.resolve(value); return { then: (resolve, reject) => promise.then(resolve, reject) } }

// Faux client Supabase : requêtes chaînées + RPC, chaque appel est journalisé.
function fakeSupabase({ tables = {}, rpc = {} } = {}) {
  const calls = []
  const from = (table) => {
    const state = { table, filters: [], op: 'select', values: null }
    const run = () => {
      calls.push({ type: 'from', ...state })
      const handler = tables[table]
      const result = typeof handler === 'function' ? handler(state) : handler
      if (result && typeof result === 'object' && 'error' in result && !Array.isArray(result)) return result
      return { data: result ?? null, error: null }
    }
    const builder = {
      select() { return builder },
      insert(values) { state.op = 'insert'; state.values = values; return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      eq(col, val) { state.filters.push(['eq', col, val]); return builder },
      in(col, val) { state.filters.push(['in', col, val]); return builder },
      is() { return builder }, gt() { return builder }, lte() { return builder }, order() { return builder }, limit() { return builder },
      maybeSingle() { const r = run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }) },
      single() { return builder.maybeSingle() },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
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
      return thenable(result ?? { data: null, error: null })
    },
  }
}

const rpcCall = (db, name) => db.calls.find(c => c.type === 'rpc' && c.name === name)

test('annonce : rien n’est comptabilisé, la base reçoit le propriétaire, le montant et une clé d’idempotence', async () => {
  const db = fakeSupabase({ rpc: { announce_rdv_offline_payment: { data: { ok: true, replayed: false, payment: { id: OFFLINE_ID, status: 'announced' } }, error: null } } })
  const result = await offline.announceOfflinePayment({ supabase: db, userId: USER, env: PROD, input: { booking_id: BOOKING, payment_method: 'transfer', amount_cents: 5000, note: ' Virement annoncé ', request_id: REQ } })
  assert.equal(result.status, 201)
  assert.deepEqual(rpcCall(db, 'announce_rdv_offline_payment').args, {
    p_actor: USER, p_booking_id: BOOKING, p_payment_method: 'transfer', p_amount_cents: 5000, p_note: 'Virement annoncé', p_request_id: REQ,
  })
  assert.ok(!db.calls.some(c => c.type === 'from' && c.table === 'rdv_financial_entries'), 'aucune écriture comptable directe')
})

test('confirmation : exige l’attestation de réception, une date valide et un montant entier', async () => {
  const db = fakeSupabase()
  const base = { booking_id: BOOKING, payment_method: 'transfer', amount_cents: 5000, received_on: '2026-11-08', request_id: REQ }
  const now = new Date('2026-11-08T15:00:00Z')
  assert.equal((await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, now, input: base })).body.error, 'receipt_confirmation_required')
  assert.equal((await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, now, input: { ...base, receipt_verified: true, amount_cents: 50.5 } })).body.error, 'invalid_amount')
  assert.equal((await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, now, input: { ...base, receipt_verified: true, payment_method: 'paypal' } })).body.error, 'invalid_payment_method')
  assert.equal((await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, now, input: { ...base, receipt_verified: true, received_on: 'hier' } })).body.error, 'invalid_received_on')
  assert.equal(db.calls.length, 0, 'aucun appel en base pour une demande invalide')
})

test('confirmation : transmise telle quelle à la fonction atomique, erreurs traduites', async () => {
  const db = fakeSupabase({ rpc: { confirm_rdv_offline_payment: { data: { ok: false, error: 'amount_exceeds_due', due_cents: 5000 }, error: null } } })
  const input = { booking_id: BOOKING, offline_payment_id: OFFLINE_ID, payment_method: 'transfer', amount_cents: 6000, received_on: '2026-11-07', reference: 'VIR 123', receipt_verified: true, request_id: REQ }
  const result = await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, input })
  assert.equal(result.status, 409)
  assert.deepEqual(result.body, { error: 'amount_exceeds_due', due_cents: 5000 })
  const args = rpcCall(db, 'confirm_rdv_offline_payment').args
  assert.equal(args.p_received_on, '2026-11-07')
  assert.equal(args.p_offline_payment_id, OFFLINE_ID)
  assert.equal(args.p_reference, 'VIR 123')
})

test('base sans migration : « mise à jour en attente », jamais d’erreur opaque', async () => {
  const db = fakeSupabase({ rpc: { confirm_rdv_offline_payment: { data: null, error: { code: 'PGRST202' } } } })
  const result = await offline.confirmOfflinePayment({ supabase: db, userId: USER, env: PROD, input: { booking_id: BOOKING, payment_method: 'cash', amount_cents: 5000, received_on: '2026-11-07', receipt_verified: true, request_id: REQ } })
  assert.deepEqual(result, { status: 503, body: { error: 'migration_pending' } })
})

test('Preview : aucune écriture hors base TEST', async () => {
  const db = fakeSupabase()
  const preview = { VERCEL_ENV: 'preview', SUPABASE_URL: 'https://uotkpygeqqnekpolezts.supabase.co' }
  for (const fn of [offline.announceOfflinePayment, offline.confirmOfflinePayment, offline.withdrawOfflinePayment]) {
    const result = await fn({ supabase: db, userId: USER, env: preview, input: {} })
    assert.equal(result.body.error, 'preview_manual_write_disabled')
  }
  assert.equal(offline.offlineWriteAllowed({ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co' }), true)
})

test('états affichés : soldé, virement annoncé, paiement à vérifier, solde à régler', () => {
  const s = offline.paymentState
  assert.equal(s({ remainingCents: 0, totalCents: 7000, status: 'confirmed' }), 'settled')
  assert.equal(s({ remainingCents: 5000, totalCents: 7000, status: 'confirmed', announced: { id: 'x' } }), 'announced')
  assert.equal(s({ remainingCents: 5000, totalCents: 7000, status: 'confirmed', announced: { id: 'x' }, balanceStatus: 'capture_in_progress' }), 'to_verify')
  assert.equal(s({ remainingCents: 5000, totalCents: 7000, status: 'confirmed', balanceStatus: 'order_pending' }), 'due', 'une commande PayPal ouverte reste « solde à régler »')
  assert.equal(s({ remainingCents: 0, totalCents: 7000, status: 'confirmed', balanceStatus: 'order_pending' }), 'settled', 'order_pending n’annule jamais un règlement confirmé')
  assert.equal(s({ remainingCents: 0, totalCents: 7000, status: 'cancelled' }), null)
})

test('date d’encaissement : heure de Paris, jamais dans le futur', () => {
  const now = new Date('2026-11-08T22:30:00Z') // 23 h 30 à Paris
  assert.equal(offline.receivedOnFrom('2026-11-08T22:30:00Z', now), '2026-11-08')
  assert.equal(offline.receivedOnFrom('2026-11-08T23:30:00Z', now), null)
  assert.equal(offline.receivedOnFrom('2026-11-05', now), '2026-11-05')
})

test('agenda : les soldes renvoient l’état et l’annonce ouverte', async () => {
  const db = fakeSupabase({
    tables: {
      booking_practitioners: [{ id: PRACT }],
      bookings: [{ id: BOOKING, service_id: 'svc', status: 'confirmed', booked_price_cents: 7000 }],
      rdv_financial_entries: [{ booking_id: BOOKING, payment_method: 'paypal', direction: 'income', gross_cents: 2000 }],
      booking_services: [{ id: 'svc', price_cents: 7000 }],
      rdv_offline_payments: [{ id: OFFLINE_ID, booking_id: BOOKING, payment_method: 'transfer', announced_amount_cents: 5000, created_at: '2026-11-08T10:00:00Z' }],
      rdv_balance_payments: [{ booking_id: BOOKING, status: 'order_pending' }],
    },
  })
  const result = await getBookingBalances({ supabase: db, userId: USER, practitionerId: PRACT, ids: BOOKING })
  const row = result.body.balances[BOOKING]
  assert.equal(row.remaining_cents, 5000)
  assert.equal(row.payment_state, 'announced')
  assert.deepEqual(row.announcement, { id: OFFLINE_ID, amount_cents: 5000, payment_method: 'transfer', created_at: '2026-11-08T10:00:00Z' })
})

test('agenda : base sans migration, l’ancien affichage reste disponible', async () => {
  const db = fakeSupabase({
    tables: {
      booking_practitioners: [{ id: PRACT }],
      bookings: [{ id: BOOKING, service_id: 'svc', status: 'confirmed', booked_price_cents: 7000 }],
      rdv_financial_entries: [{ booking_id: BOOKING, payment_method: 'paypal', direction: 'income', gross_cents: 7000 }],
      booking_services: [{ id: 'svc', price_cents: 7000 }],
      rdv_offline_payments: { data: null, error: { code: '42P01' } },
    },
  })
  const result = await getBookingBalances({ supabase: db, userId: USER, practitionerId: PRACT, ids: BOOKING })
  assert.equal(result.status, 200)
  assert.equal(result.body.balances[BOOKING].payment_state, 'settled')
})

test('caisse « Encaisser sur place » : passe par la même fonction atomique (verrou, historique, solde réglé)', async () => {
  const db = fakeSupabase({
    tables: { booking_practitioners: [{ id: PRACT }] },
    rpc: { confirm_rdv_offline_payment: { data: { ok: true, replayed: false, due_cents: 0, settled: true, payment: { financial_entry_id: 'entry-1' } }, error: null } },
  })
  const previous = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'production'
  try {
    const result = await createManualPayment({ supabase: db, userId: USER, body: {
      practitioner_id: PRACT, booking_id: BOOKING, payment_method: 'cash', gross_cents: 5000,
      occurred_at: new Date().toISOString(), client_request_id: 'manual-request-000001', note: 'Sur place',
    } })
    assert.equal(result.status, 201)
    assert.equal(result.body.settled, true)
    const args = rpcCall(db, 'confirm_rdv_offline_payment').args
    assert.equal(args.p_payment_method, 'cash')
    assert.equal(args.p_request_id, 'manual-request-000001')
    assert.ok(!db.calls.some(c => c.type === 'from' && c.table === 'rdv_financial_entries' && c.op === 'insert'), 'aucune insertion directe')

    const refused = fakeSupabase({
      tables: { booking_practitioners: [{ id: PRACT }] },
      rpc: { confirm_rdv_offline_payment: { data: { ok: false, error: 'amount_exceeds_due', due_cents: 3000 }, error: null } },
    })
    const over = await createManualPayment({ supabase: refused, userId: USER, body: {
      practitioner_id: PRACT, booking_id: BOOKING, payment_method: 'cash', gross_cents: 5000,
      occurred_at: new Date().toISOString(), client_request_id: 'manual-request-000002',
    } })
    assert.deepEqual(over, { status: 409, body: { error: 'montant_superieur_au_solde', remaining_cents: 3000 } })
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previous
  }
})

function sweepDb({ hoursAhead, announced, claim }) {
  const starts = new Date(Date.now() + hoursAhead * H).toISOString()
  return fakeSupabase({
    tables: {
      bookings: [{ id: BOOKING, practitioner_id: PRACT, service_id: 'svc', customer_first_name: 'Marie', customer_last_name: 'Test', customer_email: 'm@example.invalid', starts_at: starts, ends_at: starts, status: 'confirmed', booking_source: 'mediumia', booked_price_cents: 7000, reservation_payment_cents: 2000, balance_reminder_sent_at: null, google_event_id: 'evt1' }],
      booking_services: [{ id: 'svc', title: 'Guidance visio', modality: ['video'] }],
      rdv_financial_entries: [{ booking_id: BOOKING, direction: 'income', gross_cents: 2000 }],
      rdv_offline_payments: announced ? [{ id: OFFLINE_ID, booking_id: BOOKING, payment_method: 'transfer', announced_amount_cents: 5000 }] : [],
    },
    rpc: {
      claim_rdv_balance_reminder: { data: true, error: null },
      claim_rdv_balance_auto_cancel: { data: claim, error: null },
    },
  })
}

test('cron : virement annoncé → aucun rappel de paiement ni alerte de pré-annulation', async () => {
  const db = sweepDb({ hoursAhead: 60, announced: true })
  const alerts = []
  const result = await runDailySweep(db, new Date(), { sendAlert: async (args) => { alerts.push(args.kind); return { status: 'sent' } } })
  assert.deepEqual(alerts, [])
  assert.equal(result.results[0].action, 'offline_payment_announced')
  assert.ok(!rpcCall(db, 'claim_rdv_balance_reminder'), 'aucun lien de paiement créé ni envoyé')
})

test('cron : virement annoncé à l’échéance → annulation refusée par la base, revue signalée au propriétaire', async () => {
  const db = sweepDb({ hoursAhead: 10, announced: true, claim: { ok: false, error: 'cancel_blocked', reason: 'offline_payment_announced' } })
  const preCancel = []
  const result = await runDailySweep(db, new Date(), { sendAlert: async (args) => { preCancel.push(args.kind); return { status: 'sent' } } })
  assert.deepEqual(preCancel, [], 'pas d’alerte « annulation prévue »')
  const blocked = result.results[0]
  assert.equal(blocked.action, 'cancel_blocked')
  assert.equal(blocked.reason, 'offline_payment_announced')
  // Revue demandée au propriétaire (adresse non configurée dans les tests : rien n’est envoyé).
  assert.equal(blocked.alert, 'not_configured')
  assert.ok(!rpcCall(db, 'finalize_rdv_balance_auto_cancel'))
})

test('cron : sans annonce, le rappel de solde part comme avant', async () => {
  const db = sweepDb({ hoursAhead: 60, announced: false })
  await runDailySweep(db, new Date(), { sendAlert: async () => ({ status: 'sent' }) })
  assert.ok(rpcCall(db, 'claim_rdv_balance_reminder'), 'le rappel est tenté')
})

test('migration : additive, gardes posées, droits réservés au serveur, retour arrière fidèle', () => {
  const sql = read('supabase/migrations/20261108120000_rdv_offline_payments.sql')
  const rollback = read('supabase/runbooks/20261108-rdv-offline-payments/retour-arriere.sql')
  assert.equal((sql.match(/'offline_payment_announced'/g) || []).length, 3, 'lien PayPal, capture, annulation')
  assert.match(sql, /WHERE status = 'announced'/)
  assert.match(sql, /paypal_capture_in_progress/)
  assert.match(sql, /'offline:' \|\| p_request_id/)
  const newFunctions = sql.slice(0, sql.indexOf('-- ── 5.'))
  assert.doesNotMatch(newFunctions, /UPDATE public\.rdv_balance_payments|UPDATE public\.rdv_paypal_payments/, 'aucune transaction PayPal modifiée')
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/)
  for (const fn of ['announce_rdv_offline_payment', 'confirm_rdv_offline_payment', 'withdraw_rdv_offline_payment']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
    assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}`))
  }
  assert.doesNotMatch(rollback, /offline_payment_announced/, 'le retour arrière rétablit les fonctions sans les gardes')
  assert.doesNotMatch(rollback, /DROP TABLE/, 'historique conservé')
})

test('page de solde : un règlement annoncé n’est pas payable une seconde fois en ligne', () => {
  const page = read('public/rdv-solde.html')
  const handler = read('lib/rdvBalanceApiHandler.js')
  assert.match(page, /id="offlineState"/)
  assert.match(page, /current\.status === 'OFFLINE_ANNOUNCED'/)
  assert.match(page, /offline_payment_announced:/)
  assert.match(handler, /status: 'OFFLINE_ANNOUNCED'/)
})

test('agenda propriétaire : quatre états lisibles et confirmation explicite', () => {
  const status = read('src/components/rdv/BookingPaymentStatus.jsx') + read('src/components/rdv/offlinePayments.js')
  const panel = read('src/components/rdv/OfflinePaymentPanel.jsx')
  for (const label of ['Solde à régler', 'Virement annoncé, en attente de vérification', 'Paiement reçu et confirmé', 'Paiement à vérifier']) {
    assert.ok(status.includes(label), label)
  }
  assert.match(panel, /receipt_verified: true/)
  assert.match(panel, /J’ai vérifié que ce montant est bien arrivé sur mon compte/)
  assert.match(panel, /useState\(newRequestId\)/, 'une clé par formulaire : un double clic est rejoué, pas doublé')
})
