import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  REFUND_RETRY_AFTER_MS,
  allowedActions,
  analyzeOrderForRefund,
  listDepositSettlements,
  refundBookingDeposit,
  retainBookingDeposit,
  transferBookingDeposit,
} from '../lib/rdvDepositSettlements.js'
import { rdvRefundCustomId, refundRdvDepositCapture, runtimeRdvRefundPayPalConfig } from '../lib/rdvDepositPayPal.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Aucun appel réseau réel : PayPal et Supabase sont simulés dans tout ce fichier.
const PRACT = 'aaaaaaaa-0000-4000-8000-000000000001'
const BOOKING = '11111111-0000-4000-8000-000000000001'
const TARGET = '11111111-0000-4000-8000-000000000002'
const USER = 'cccccccc-0000-4000-8000-000000000001'
const KEY = 'dddddddd-0000-4000-8000-000000000001'
const REFUND_ID = 'eeeeeeee-0000-4000-8000-000000000001'
const SANDBOX = { env: 'sandbox', base: 'https://api-m.sandbox.paypal.com' }
const NOW = Date.parse('2026-10-01T10:00:00Z')

function refundRow(over = {}) {
  return {
    id: REFUND_ID,
    payment_id: 'pay-1',
    paypal_env: 'sandbox',
    paypal_capture_id: 'CAPTURE1',
    paypal_order_id: 'ORDER1',
    paypal_request_id: `rdv-refund-${REFUND_ID}`,
    amount_cents: 2000,
    status: 'pending',
    attempt_count: 0,
    requested_at: new Date(NOW).toISOString(),
    last_attempt_at: null,
    paypal_refund_id: null,
    ...over,
  }
}

function order({ captureStatus = 'COMPLETED', refunds = [] } = {}) {
  return {
    id: 'ORDER1',
    purchase_units: [{ payments: { captures: [{ id: 'CAPTURE1', status: captureStatus, amount: { currency_code: 'EUR', value: '20.00' } }], refunds } }],
  }
}

function fakeDb({ owner = true, admin = true, begin, onRecord = () => ({ ok: true }), rpcs = {}, tables = {} } = {}) {
  const calls = { rpc: [], recorded: [] }
  const db = {
    calls,
    from(table) {
      const filters = {}
      const q = {
        select() { return q },
        eq(k, v) { filters[k] = v; return q },
        in(k, v) { filters[`in:${k}`] = v; return q },
        gt() { return q },
        order() { return q },
        limit() { return q },
        single() { return Promise.resolve(resolve()) },
        maybeSingle() { return Promise.resolve(resolve()) },
        then(ok, ko) { return Promise.resolve(resolve()).then(ok, ko) },
      }
      function resolve() {
        if (table === 'booking_practitioners') {
          if ('in:slug' in filters) return { data: admin ? [{ id: PRACT }] : [], error: null }
          return { data: owner ? { id: PRACT } : null }
        }
        if (table === 'rdv_paypal_payments' && tables.rdv_paypal_payments_list && !('id' in filters)) return tables.rdv_paypal_payments_list
        if (table === 'rdv_paypal_payments') return { data: { amount_cents: 2000 } }
        if (table === 'rdv_payment_refunds') return { data: tables.rdv_payment_refunds || [{ id: REFUND_ID, paypal_refund_id: null }] }
        return tables[table] || { data: [] }
      }
      return q
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (name === 'begin_rdv_payment_refund') return { data: begin(args) }
      if (name === 'mark_rdv_payment_refund_attempt') return { data: { ok: true, attempt_count: 1 } }
      if (name === 'record_rdv_payment_refund_result') {
        calls.recorded.push(args)
        return { data: { ok: true, status: args.p_outcome, ...onRecord(args) } }
      }
      if (rpcs[name]) return { data: rpcs[name](args) }
      return { data: null, error: { message: 'unexpected rpc' } }
    },
  }
  return db
}

function fakePayPal({ refund = () => ({ outcome: 'completed', paypalRefundId: 'REFUND1', paypalStatus: 'COMPLETED', sent: true }), orders = [order()], cfg = SANDBOX, getRefund } = {}) {
  const calls = { refund: [], getOrder: 0, getRefund: 0 }
  let i = 0
  return {
    calls,
    config: () => cfg,
    async refund(args) { calls.refund.push(args); return refund(args) },
    async getOrder() {
      calls.getOrder += 1
      const o = orders[Math.min(i++, orders.length - 1)]
      if (o instanceof Error) throw o
      return o
    },
    async getRefund(args) { calls.getRefund += 1; return getRefund(args) },
  }
}

const newRefund = (over) => () => ({ ok: true, replay: false, refund: refundRow(over) })
const input = (over = {}) => ({ op: 'refund', practitioner_id: PRACT, booking_id: BOOKING, idempotency_key: KEY, ...over })
const run = (db, paypal, over = {}, now = NOW) => refundBookingDeposit({ supabase: db, userId: USER, input: input(over), paypal, now: () => now })

test('full refund: server-side amount and stored capture, ledger written only on PayPal confirmation', async () => {
  const db = fakeDb({ begin: newRefund() })
  const paypal = fakePayPal()
  // Le navigateur ne peut imposer ni la capture, ni l'environnement, ni l'id PayPal.
  const res = await run(db, paypal, { paypal_capture_id: 'PIRATE', paypal_env: 'live', capture_id: 'X' })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'completed')
  const begin = db.calls.rpc.find((c) => c.name === 'begin_rdv_payment_refund').args
  assert.equal(begin.p_paypal_env, 'sandbox') // vient du déploiement, pas du client
  assert.equal(begin.p_amount_cents, null) // montant déterminé par la base
  assert.equal(paypal.calls.refund.length, 1)
  assert.deepEqual(paypal.calls.refund[0], { cfg: SANDBOX, captureId: 'CAPTURE1', amountCents: 2000, requestId: `rdv-refund-${REFUND_ID}`, refundId: REFUND_ID })
  assert.equal(paypal.calls.getOrder, 1) // vérification de la transaction avant envoi
  assert.equal(db.calls.recorded.length, 1)
  assert.equal(db.calls.recorded[0].p_outcome, 'completed')
  assert.equal(db.calls.recorded[0].p_paypal_refund_id, 'REFUND1')
  // Ordre : réservation → marque de tentative → appel PayPal → résultat.
  assert.deepEqual(db.calls.rpc.map((c) => c.name), ['begin_rdv_payment_refund', 'mark_rdv_payment_refund_attempt', 'record_rdv_payment_refund_result'])
})

test('double click: the second request sees the reserved refund and never calls PayPal', async () => {
  for (const begin of [
    () => ({ ok: true, replay: true, refund: refundRow({ status: 'pending' }) }), // même clé
    () => ({ ok: false, error: 'refund_in_progress', refund: refundRow({ status: 'pending' }) }), // autre clé, 0,5 s après
  ]) {
    const db = fakeDb({ begin })
    const paypal = fakePayPal()
    const res = await run(db, paypal)
    assert.equal(res.status, 202)
    assert.equal(res.body.status, 'check_later')
    assert.equal(paypal.calls.refund.length, 0)
    assert.equal(paypal.calls.getOrder, 0)
  }
})

test('replay after completion returns the stored result without any PayPal call', async () => {
  const db = fakeDb({ begin: () => ({ ok: true, replay: true, refund: refundRow({ status: 'completed', paypal_refund_id: 'REFUND1' }) }) })
  const paypal = fakePayPal()
  const res = await run(db, paypal)
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.refund.length + paypal.calls.getOrder, 0)
  assert.equal(db.calls.recorded.length, 0)
})

test('ambiguous network timeout: unknown, no blind retry, reconciliation before anything else', async () => {
  // 1) L'appel PayPal expire : état « unknown », aucun second envoi.
  let db = fakeDb({ begin: newRefund() })
  let paypal = fakePayPal({ refund: () => ({ outcome: 'unknown', errorCode: 'paypal_network_error', sent: true }) })
  let res = await run(db, paypal)
  assert.equal(res.status, 202)
  assert.equal(res.body.status, 'unknown')
  assert.equal(paypal.calls.refund.length, 1)
  assert.equal(db.calls.recorded[0].p_outcome, 'unknown')

  const ambiguous = refundRow({ status: 'unknown', attempt_count: 1, last_attempt_at: new Date(NOW).toISOString() })
  // 2) Nouveau clic moins de 2 minutes après : on attend, rien n'est envoyé.
  db = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: ambiguous }) })
  paypal = fakePayPal()
  res = await run(db, paypal, {}, NOW + 60_000)
  assert.equal(res.body.status, 'check_later')
  assert.equal(paypal.calls.refund.length + paypal.calls.getOrder, 0)

  // 3) Plus tard, PayPal montre que le remboursement a bien eu lieu : on l'enregistre, sans renvoyer.
  db = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: ambiguous }) })
  paypal = fakePayPal({ orders: [order({ captureStatus: 'REFUNDED', refunds: [{ id: 'REFUND9', status: 'COMPLETED', custom_id: rdvRefundCustomId(REFUND_ID), amount: { currency_code: 'EUR', value: '20.00' } }] })] })
  res = await run(db, paypal, {}, NOW + REFUND_RETRY_AFTER_MS + 1)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.refund.length, 0)
  assert.equal(db.calls.recorded[0].p_paypal_refund_id, 'REFUND9')
  assert.equal(db.calls.recorded[0].p_adopted_external, false)

  // 4) PayPal ne montre rien : reprise avec la MÊME clé PayPal-Request-Id.
  db = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: ambiguous }) })
  paypal = fakePayPal()
  res = await run(db, paypal, {}, NOW + REFUND_RETRY_AFTER_MS + 1)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.refund.length, 1)
  assert.equal(paypal.calls.refund[0].requestId, ambiguous.paypal_request_id)

  // 5) Lecture PayPal impossible après un envoi ambigu : on ne tente rien.
  db = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: ambiguous }) })
  paypal = fakePayPal({ orders: [new Error('paypal_lookup_failed')] })
  res = await run(db, paypal, {}, NOW + REFUND_RETRY_AFTER_MS + 1)
  assert.equal(res.body.status, 'check_later')
  assert.equal(paypal.calls.refund.length, 0)
  assert.equal(db.calls.recorded.length, 0)
})

test('PayPal says already refunded: an existing PayPal refund is adopted, never doubled', async () => {
  // a) Vu avant l'envoi (remboursement fait directement dans PayPal).
  const external = { id: 'EXT1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '20.00' } }
  let db = fakeDb({ begin: newRefund() })
  let paypal = fakePayPal({ orders: [order({ captureStatus: 'REFUNDED', refunds: [external] })] })
  let res = await run(db, paypal)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.refund.length, 0)
  assert.equal(db.calls.recorded[0].p_paypal_refund_id, 'EXT1')
  assert.equal(db.calls.recorded[0].p_adopted_external, true)

  // b) PayPal répond 422 CAPTURE_FULLY_REFUNDED à l'envoi : relecture puis adoption.
  db = fakeDb({ begin: newRefund() })
  paypal = fakePayPal({ refund: () => ({ outcome: 'already_refunded', errorCode: 'CAPTURE_FULLY_REFUNDED', sent: true }), orders: [order(), order({ captureStatus: 'REFUNDED', refunds: [external] })] })
  res = await run(db, paypal)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.refund.length, 1)
  assert.equal(db.calls.recorded.at(-1).p_paypal_refund_id, 'EXT1')

  // c) Montants incohérents : aucune adoption, vérification manuelle, rien de remboursé.
  db = fakeDb({ begin: newRefund() })
  paypal = fakePayPal({ orders: [order({ captureStatus: 'PARTIALLY_REFUNDED', refunds: [{ ...external, amount: { currency_code: 'EUR', value: '5.00' } }] })] })
  res = await run(db, paypal)
  assert.equal(res.body.status, 'failed')
  assert.equal(res.body.error, 'paypal_external_refund_mismatch')
  assert.equal(paypal.calls.refund.length, 0)
})

test('failed refund: definite PayPal refusal is recorded as failed, nothing counted', async () => {
  const db = fakeDb({ begin: newRefund() })
  const paypal = fakePayPal({ refund: () => ({ outcome: 'failed', errorCode: 'TRANSACTION_REFUSED', sent: true }) })
  const res = await run(db, paypal)
  assert.equal(res.status, 502)
  assert.equal(res.body.error, 'TRANSACTION_REFUSED')
  assert.equal(db.calls.recorded[0].p_outcome, 'failed')
  // Vérification impossible avant envoi : échec certain (rien n'est parti).
  const db2 = fakeDb({ begin: newRefund() })
  const paypal2 = fakePayPal({ orders: [new Error('down')] })
  const res2 = await run(db2, paypal2)
  assert.equal(res2.body.error, 'paypal_lookup_failed')
  assert.equal(paypal2.calls.refund.length, 0)
  assert.equal(db2.calls.recorded[0].p_outcome, 'failed')
})

test('PayPal PENDING refund is followed up by its id', async () => {
  const db = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: refundRow({ status: 'pending', paypal_refund_id: 'REFUND7', attempt_count: 1 }) }) })
  const paypal = fakePayPal({ getRefund: () => ({ id: 'REFUND7', status: 'COMPLETED' }) })
  const res = await run(db, paypal)
  assert.equal(res.body.status, 'completed')
  assert.equal(paypal.calls.getRefund, 1)
  assert.equal(paypal.calls.refund.length, 0)
})

test('business refusals pass through: no deposit, already transferred, already refunded, not cancelled', async () => {
  for (const error of ['no_paypal_deposit', 'settlement_not_open', 'already_refunded', 'booking_not_cancelled', 'paypal_environment_mismatch']) {
    const db = fakeDb({ begin: () => ({ ok: false, error }) })
    const paypal = fakePayPal()
    const res = await run(db, paypal)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, error)
    assert.equal(paypal.calls.refund.length + paypal.calls.getOrder, 0)
  }
})

test('partial refund amount is validated and passed to the database, never trusted blindly', async () => {
  const db = fakeDb({ begin: newRefund({ amount_cents: 500 }) })
  await run(db, fakePayPal(), { amount_cents: 500 })
  assert.equal(db.calls.rpc[0].args.p_amount_cents, 500)
  for (const bad of [0, -5, 12.5, 'abc']) {
    const res = await run(fakeDb({ begin: newRefund() }), fakePayPal(), { amount_cents: bad })
    assert.equal(res.status, 400)
  }
})

test('admin rights: practitioner owner AND platform admin required', async () => {
  for (const opts of [{ owner: false }, { admin: false }]) {
    const db = fakeDb({ ...opts, begin: newRefund() })
    const paypal = fakePayPal()
    const res = await run(db, paypal)
    assert.equal(res.status, 403)
    assert.equal(db.calls.rpc.length, 0)
    assert.equal((await transferBookingDeposit({ supabase: db, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, target_booking_id: TARGET, idempotency_key: KEY } })).status, 403)
    assert.equal((await retainBookingDeposit({ supabase: db, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING } })).status, 403)
  }
})

test('transfer to another booking: atomic RPC with idempotency key; refused cases pass through', async () => {
  let args
  const db = fakeDb({ rpcs: { transfer_rdv_deposit: (a) => { args = a; return { ok: true, transfer_id: 't1', remaining_due_cents: 2000 } } } })
  const res = await transferBookingDeposit({ supabase: db, userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, target_booking_id: TARGET, idempotency_key: KEY, amount_cents: 99999 } })
  assert.equal(res.status, 200)
  assert.equal(res.body.remaining_due_cents, 2000)
  assert.deepEqual(args, { p_booking_id: BOOKING, p_target_booking_id: TARGET, p_practitioner_id: PRACT, p_idempotency_key: KEY, p_actor: USER })
  for (const error of ['already_refunded', 'already_transferred', 'target_other_customer', 'transfer_exceeds_due', 'target_balance_payment_in_progress']) {
    const r = await transferBookingDeposit({ supabase: fakeDb({ rpcs: { transfer_rdv_deposit: () => ({ ok: false, error }) } }), userId: USER, input: { practitioner_id: PRACT, booking_id: BOOKING, target_booking_id: TARGET, idempotency_key: KEY } })
    assert.equal(r.status, 409)
    assert.equal(r.body.error, error)
  }
})

test('sandbox vs live: deployment decides, production needs an explicit switch', () => {
  assert.equal(runtimeRdvRefundPayPalConfig({ VERCEL_ENV: 'preview' }).base, 'https://api-m.sandbox.paypal.com')
  assert.equal(runtimeRdvRefundPayPalConfig({}).env, 'sandbox')
  // Même avec un « live » demandé ailleurs, une Preview reste en sandbox.
  assert.equal(runtimeRdvRefundPayPalConfig({ VERCEL_ENV: 'preview', PAYPAL_RDV_DEPOSIT_ENV: 'live', PAYPAL_RDV_REFUNDS_ENABLED: 'true' }).env, 'sandbox')
  assert.throws(() => runtimeRdvRefundPayPalConfig({ VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENV: 'live' }), /rdv_refunds_disabled/)
  assert.throws(() => runtimeRdvRefundPayPalConfig({ VERCEL_ENV: 'production', PAYPAL_RDV_REFUNDS_ENABLED: 'true' }), /live_not_configured/)
  const live = runtimeRdvRefundPayPalConfig({ VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENV: 'live', PAYPAL_RDV_REFUNDS_ENABLED: 'true' })
  assert.equal(live.env, 'live')
  assert.equal(live.base, 'https://api-m.paypal.com')
})

test('sandbox can never touch live (and vice versa): environment mismatch stops before PayPal', async () => {
  // Paiement live vu depuis la Preview : la base refuse (p_paypal_env = sandbox).
  const db = fakeDb({ begin: (a) => (a.p_paypal_env === 'sandbox' ? { ok: false, error: 'paypal_environment_mismatch' } : newRefund()()) })
  const paypal = fakePayPal()
  const res = await run(db, paypal)
  assert.equal(res.body.error, 'paypal_environment_mismatch')
  assert.equal(paypal.calls.refund.length + paypal.calls.getOrder, 0)
  // Double sécurité côté serveur si une ligne d'un autre environnement remontait.
  const db2 = fakeDb({ begin: () => ({ ok: false, error: 'refund_in_progress', refund: refundRow({ paypal_env: 'live' }) }) })
  const paypal2 = fakePayPal()
  const res2 = await run(db2, paypal2, {}, NOW + REFUND_RETRY_AFTER_MS + 1)
  assert.equal(res2.body.error, 'paypal_environment_mismatch')
  assert.equal(paypal2.calls.refund.length + paypal2.calls.getOrder, 0)
  // Production sans interrupteur : 503, rien n'est réservé.
  const db3 = fakeDb({ begin: newRefund() })
  const res3 = await refundBookingDeposit({ supabase: db3, userId: USER, input: input(), env: { VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENV: 'live' } })
  assert.equal(res3.status, 503)
  assert.equal(res3.body.error, 'refunds_disabled')
  assert.equal(db3.calls.rpc.length, 0)
})

test('PayPal refund call: one POST, fixed PayPal-Request-Id, server amount; ambiguous answers are « unknown »', async () => {
  const realFetch = globalThis.fetch
  const prev = { id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET }
  process.env.PAYPAL_CLIENT_ID = 'test-client'
  process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
  const sent = []
  const call = (answer) => {
    globalThis.fetch = async (url, opts = {}) => {
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      sent.push({ url, opts })
      return answer()
    }
    return refundRdvDepositCapture({ cfg: SANDBOX, captureId: 'CAPTURE1', amountCents: 2000, requestId: 'rdv-refund-x', refundId: 'x' })
  }
  try {
    let r = await call(() => new Response(JSON.stringify({ id: 'R1', status: 'COMPLETED' }), { status: 201 }))
    assert.deepEqual(r, { outcome: 'completed', paypalRefundId: 'R1', paypalStatus: 'COMPLETED', sent: true })
    assert.equal(sent[0].url, 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1/refund')
    assert.equal(sent[0].opts.headers['PayPal-Request-Id'], 'rdv-refund-x')
    assert.deepEqual(JSON.parse(sent[0].opts.body).amount, { currency_code: 'EUR', value: '20.00' })
    assert.equal(JSON.parse(sent[0].opts.body).custom_id, rdvRefundCustomId('x'))
    r = await call(() => { throw new TypeError('fetch failed') })
    assert.equal(r.outcome, 'unknown')
    r = await call(() => new Response('{}', { status: 503 }))
    assert.equal(r.outcome, 'unknown')
    r = await call(() => new Response(JSON.stringify({ name: 'PREVIOUS_REQUEST_IN_PROGRESS' }), { status: 409 }))
    assert.equal(r.outcome, 'unknown')
    r = await call(() => new Response('not json', { status: 201 }))
    assert.equal(r.outcome, 'unknown')
    r = await call(() => new Response(JSON.stringify({ id: 'R2', status: 'PENDING' }), { status: 201 }))
    assert.equal(r.outcome, 'pending')
    r = await call(() => new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CAPTURE_FULLY_REFUNDED' }] }), { status: 422 }))
    assert.equal(r.outcome, 'already_refunded')
    r = await call(() => new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_TIME_LIMIT_EXCEEDED' }] }), { status: 422 }))
    assert.deepEqual(r, { outcome: 'failed', errorCode: 'REFUND_TIME_LIMIT_EXCEEDED', sent: true })
    assert.equal(sent.length, 8) // un seul POST par appel, jamais de relance automatique
    globalThis.fetch = async () => new Response('{}', { status: 401 })
    r = await refundRdvDepositCapture({ cfg: SANDBOX, captureId: 'CAPTURE1', amountCents: 2000, requestId: 'rdv-refund-x', refundId: 'x' })
    assert.deepEqual(r, { outcome: 'failed', errorCode: 'paypal_auth_failed', sent: false })
  } finally {
    globalThis.fetch = realFetch
    process.env.PAYPAL_CLIENT_ID = prev.id
    process.env.PAYPAL_CLIENT_SECRET = prev.secret
    if (prev.id === undefined) delete process.env.PAYPAL_CLIENT_ID
    if (prev.secret === undefined) delete process.env.PAYPAL_CLIENT_SECRET
  }
})

test('order analysis: capture checked against the stored id and amount', () => {
  const r = refundRow()
  assert.equal(analyzeOrderForRefund({ order: order(), refund: r, paymentAmountCents: 2000 }).kind, 'clear')
  assert.equal(analyzeOrderForRefund({ order: order(), refund: { ...r, paypal_capture_id: 'OTHER' }, paymentAmountCents: 2000 }).errorCode, 'paypal_capture_not_found')
  assert.equal(analyzeOrderForRefund({ order: order(), refund: r, paymentAmountCents: 2500 }).errorCode, 'paypal_capture_amount_mismatch')
  assert.equal(analyzeOrderForRefund({ order: order({ captureStatus: 'REFUNDED' }), refund: r, paymentAmountCents: 2000 }).errorCode, 'paypal_capture_already_refunded')
  // Un remboursement déjà connu de MediumIA (partiel précédent) n'est pas adopté une 2e fois.
  const known = { id: 'R-OLD', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '20.00' } }
  assert.equal(analyzeOrderForRefund({ order: order({ captureStatus: 'PARTIALLY_REFUNDED', refunds: [known] }), refund: r, paymentAmountCents: 2000, knownRefundIds: ['R-OLD'] }).kind, 'clear')
})

test('allowed actions: final states block every incompatible action', () => {
  const base = { bookingStatus: 'cancelled', settlementStatus: 'open', refundedCents: 0, activeRefund: null, paypalEnv: 'live', runtimeEnv: 'live', refundsEnabled: true, hasTargets: true }
  assert.deepEqual(allowedActions(base), { refund: true, reconcile: false, transfer: true, retain: true })
  for (const settlementStatus of ['refunded', 'transferred', 'retained']) {
    assert.deepEqual(allowedActions({ ...base, settlementStatus }), { refund: false, reconcile: false, transfer: false, retain: false })
  }
  assert.deepEqual(allowedActions({ ...base, settlementStatus: 'refund_pending', activeRefund: { id: 1 } }), { refund: false, reconcile: true, transfer: false, retain: false })
  assert.deepEqual(allowedActions({ ...base, settlementStatus: 'partially_refunded', refundedCents: 500 }), { refund: true, reconcile: false, transfer: false, retain: false })
  assert.equal(allowedActions({ ...base, bookingStatus: 'confirmed' }).refund, false) // annuler ≠ rembourser
  assert.equal(allowedActions({ ...base, runtimeEnv: 'sandbox' }).refund, false) // paiement live vu depuis la Preview
  assert.equal(allowedActions({ ...base, refundsEnabled: false }).refund, false)
})

test('booking without deposit is not listed; cancelled paid booking is listed with its state', async () => {
  const db = fakeDb({
    tables: {
      rdv_paypal_payments_list: { data: [{ id: 'pay-1', paypal_capture_id: 'CAPTURE1', paypal_env: 'sandbox', amount_cents: 2000, captured_at: '2026-09-20T10:00:00Z', settlement_status: 'open', refunded_cents: 0, hold: { practitioner_id: PRACT, converted_booking_id: BOOKING } }] },
      bookings: { data: [{ id: BOOKING, service_id: 's1', status: 'cancelled', starts_at: '2027-01-15T10:00:00Z', customer_first_name: 'Cliente', customer_last_name: 'Test', customer_email: 'c@example.test' }] },
      rdv_payment_refunds: [],
      rdv_deposit_transfers: { data: [] },
      booking_services: { data: [{ id: 's1', title: 'Consultation' }] },
    },
  })
  const res = await listDepositSettlements({ supabase: db, userId: USER, practitionerId: PRACT, paypal: fakePayPal() })
  assert.equal(res.status, 200)
  assert.equal(res.body.items.length, 1)
  const [item] = res.body.items
  assert.equal(item.amount_cents, 2000)
  assert.equal(item.settlement_status, 'open')
  assert.equal(item.customer_name, 'Cliente Test')
  assert.equal(item.allowed.refund, true)
  assert.equal('customer_email' in item, false) // pas d'e-mail renvoyé à l'écran
})

test('migration: refund/transfer tables, idempotency constraints, service_role only, no capture rewritten', () => {
  const sql = read('supabase/migrations/20260930230000_rdv_deposit_settlements.sql')
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_rdv_payment_refunds_one_active[\s\S]*WHERE status IN \('pending', 'unknown'\)/)
  assert.match(sql, /paypal_request_id TEXT NOT NULL UNIQUE/)
  assert.match(sql, /idempotency_key UUID NOT NULL UNIQUE/)
  assert.match(sql, /payment_id UUID NOT NULL UNIQUE REFERENCES public\.rdv_paypal_payments/)
  for (const fn of ['begin_rdv_payment_refund', 'record_rdv_payment_refund_result', 'transfer_rdv_deposit', 'retain_rdv_deposit', 'mark_rdv_payment_refund_attempt']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
  }
  // Jamais de réécriture d'une capture : aucune mise à jour de status / paypal_capture_id / amount_cents.
  const paymentUpdates = sql.match(/UPDATE public\.rdv_paypal_payments[^;]*;/g) || []
  assert.ok(paymentUpdates.length >= 4)
  for (const stmt of paymentUpdates) assert.doesNotMatch(stmt, /(SET|,)\s*(paypal_capture_id|paypal_order_id|amount_cents|status|captured_at)\s*=/)
  assert.doesNotMatch(sql, /DELETE FROM public\.rdv_financial_entries/)
  // Le remboursement est une contre-passation, le transfert une paire sans recette.
  assert.match(sql, /'mediumia', 'refund', 'refund', 'paypal'/)
  assert.equal((sql.match(/'mediumia', 'deposit_transfer'/g) || []).length, 2)
  assert.match(sql, /IF v_payment\.paypal_env <> p_paypal_env THEN/)
})

test('accounting: transfers are neither income nor refund in the counters; labels exist', () => {
  const patch = read('scripts/apply-rdv-accounting-dashboard.mjs')
  assert.match(patch, /if \(entry\.entry_kind === 'deposit_transfer'\) return acc/)
  const ui = read('src/components/rdv/AccountingSection.jsx')
  assert.match(ui, /deposit_transfer: 'Transfert d’arrhes'/)
  assert.match(ui, /refund: 'Remboursement'/)
})

test('cancellation never triggers a refund', () => {
  const book = read('api/rdv-book.js')
  const cron = read('lib/rdvBalanceApiHandler.js')
  for (const src of [book, cron]) {
    assert.doesNotMatch(src, /begin_rdv_payment_refund|refundBookingDeposit|refundRdvDepositCapture/)
  }
})
