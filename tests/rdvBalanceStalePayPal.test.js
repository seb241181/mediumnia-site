/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyRdvBalanceOrder, createRdvBalancePayPalOrder, captureRdvBalancePayPalOrder, inspectRdvBalancePayPalOrder, rdvBalanceCreateRequestId, rdvBalanceCustomId } from '../lib/rdvBalancePayPal.js'
import { balancePaymentForbidsCancel, prepareBalanceOrder, reportUncertainBalancePayments, settleBalanceOrder, NOT_FOUND_MIN_AGE_MS, ORDER_REUSE_MAX_MS } from '../lib/rdvBalanceSettlement.js'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const PAYMENT = '22222222-2222-4222-8222-222222222222'
const CFG = { env: 'sandbox', base: 'https://api-m.sandbox.paypal.com', referenceId: 'MEDIUMIA_RDV_SOLDE_SANDBOX' }
const NOW = Date.now()
const ago = ms => new Date(NOW - ms).toISOString()
const H = 3_600_000
const page = readFileSync('public/rdv-solde.html', 'utf8')

// Faux PayPal : états réels d'une commande, un seul encaissement possible.
function fakePayPal() {
  const orders = new Map()
  const byRequest = new Map()
  const state = { orders, captures: 0, created: 0, down: false, refuse: null, captureMode: 'COMPLETED' }
  const add = (id, over = {}) => {
    orders.set(id, {
      id, status: 'PAYER_ACTION_REQUIRED', create_time: ago(0), update_time: ago(0),
      purchase_units: [{ reference_id: CFG.referenceId, custom_id: rdvBalanceCustomId(BOOKING), amount: { currency_code: 'EUR', value: '50.00' } }],
      ...over,
    })
    return orders.get(id)
  }
  const paid = (order, status = 'COMPLETED', value = order.purchase_units[0].amount.value) => {
    order.status = 'COMPLETED'
    order.purchase_units[0].payments = { captures: [{ id: `CAP-${order.id}`, status, amount: { currency_code: 'EUR', value }, create_time: ago(0) }] }
  }
  const api = {
    async inspect(id) {
      if (state.down) throw new Error('paypal_order_status_unavailable')
      const order = orders.get(id)
      if (!order) return { cfg: CFG, status: 'NOT_FOUND', data: null }
      return { cfg: CFG, status: order.status, data: structuredClone(order), approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }
    },
    async create(input) {
      if (state.down) throw new Error('paypal_create_order_failed')
      const key = rdvBalanceCreateRequestId(input)
      if (!byRequest.has(key)) {
        state.created += 1
        const id = `NEW-ORDER-${state.created}`
        add(id).purchase_units[0].amount.value = (input.amountCents / 100).toFixed(2)
        byRequest.set(key, id)
      }
      const id = byRequest.get(key)
      return { cfg: CFG, orderId: id, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }
    },
    async capture(id) {
      const order = orders.get(id)
      if (state.refuse) return { refusal: state.refuse, issue: 'X' }
      if (state.captureMode === 'timeout_paid') { paid(order); state.captures += 1; state.down = true; return { refusal: null, issue: null } }
      if (state.captureMode === 'timeout_unpaid') return { refusal: null, issue: null }
      if (order.status === 'APPROVED') { state.captures += 1; paid(order, state.captureMode) }
      return { refusal: null, issue: null }
    },
  }
  return { state, api, add, paid }
}

// Fausse base : mêmes gardes que claim / release / finalize / attach en SQL.
function fakeDb(over = {}) {
  const row = {
    id: PAYMENT, booking_id: BOOKING, client_checkout_id: 'x', paypal_order_id: 'OLD-ORDER', paypal_capture_id: null, paypal_env: 'sandbox',
    amount_cents: 5000, currency: 'EUR', status: 'order_pending', capture_claimed_at: null, last_error_code: null, updated_at: ago(0), ...over,
  }
  const db = { row, events: [], entries: [], expired: false, failFinalize: false, failEvents: false, onUpdate: null }
  const rpc = {
    claim_rdv_balance_capture({ p_paypal_order_id: id }) {
      if (row.paypal_order_id !== id) return { ok: false, error: 'balance_payment_not_found' }
      if (row.status === 'captured') return { ok: true, already_captured: true, booking_id: BOOKING, amount_cents: row.amount_cents }
      if (db.expired) return { ok: false, error: 'balance_payment_expired' }
      if (row.status === 'capture_in_progress' && Date.now() - new Date(row.capture_claimed_at) < 10 * 60_000) return { ok: false, error: 'balance_capture_in_progress' }
      Object.assign(row, { status: 'capture_in_progress', capture_claimed_at: new Date().toISOString(), last_error_code: null })
      return { ok: true, booking_id: BOOKING, amount_cents: row.amount_cents, currency: 'EUR' }
    },
    release_rdv_balance_capture({ p_paypal_order_id: id, p_error_code: code }) {
      if (row.paypal_order_id === id && row.status === 'capture_in_progress') Object.assign(row, { status: 'order_pending', capture_claimed_at: null, last_error_code: code })
      return null
    },
    finalize_rdv_balance_capture(p) {
      if (db.failFinalize) return { ok: false, error: 'balance_payment_intent_mismatch' }
      if (row.status === 'captured') return { ok: true, already_captured: true }
      if (row.status !== 'capture_in_progress' || row.amount_cents !== p.p_amount_cents) return { ok: false, error: 'balance_payment_intent_mismatch' }
      if (!db.entries.some(entry => entry.ref === p.p_paypal_capture_id)) db.entries.push({ ref: p.p_paypal_capture_id, cents: p.p_amount_cents })
      Object.assign(row, { status: 'captured', paypal_capture_id: p.p_paypal_capture_id, capture_claimed_at: null })
      return { ok: true, already_captured: false }
    },
    attach_rdv_balance_paypal_order({ p_paypal_order_id: id }) {
      if (row.paypal_order_id) return { ok: true, paypal_order_id: row.paypal_order_id, reused: true }
      if (db.expired) return { ok: false, error: 'balance_payment_expired' }
      row.paypal_order_id = id
      return { ok: true, paypal_order_id: id, reused: false }
    },
  }
  db.client = {
    rpc: async (name, args) => ({ data: rpc[name](args), error: null }),
    from(table) {
      const query = { filters: [], patch: null }
      const result = () => {
        if (table === 'rdv_balance_review_events') return { data: null, error: db.failEvents ? { message: 'x' } : null }
        if (table === 'bookings') return { data: { id: BOOKING, service_id: 's', starts_at: ago(-30 * H) }, error: null }
        if (table === 'booking_services') return { data: { title: 'Guidance' }, error: null }
        if (query.patch && db.onUpdate) { const hook = db.onUpdate; db.onUpdate = null; hook() }
        const match = query.filters.every(([col, val]) => (row[col] ?? null) === val)
        if (!match) return { data: null, error: null }
        if (query.patch) Object.assign(row, query.patch)
        return { data: structuredClone(row), error: null }
      }
      const builder = {
        select: () => builder, in: () => builder, not: () => builder, lt: () => builder, gt: () => builder, order: () => builder,
        limit: async () => ({ data: [structuredClone(row)], error: null }),
        insert: async value => { if (!db.failEvents) db.events.push(value); return result() },
        update: patch => { query.patch = patch; return builder },
        eq: (col, val) => { query.filters.push([col, val]); return builder },
        is: (col, val) => { query.filters.push([col, val]); return builder },
        maybeSingle: async () => result(),
      }
      return builder
    },
  }
  return db
}

function setup(rowOver, orderOver) {
  const pp = fakePayPal()
  if (orderOver !== null) pp.add('OLD-ORDER', orderOver)
  const db = fakeDb(rowOver)
  const alerts = []
  const emails = []
  const common = { paypal: pp.api, sendAlert: async input => { alerts.push(input.reason); return { status: 'sent' } }, onPaid: async (id, cents) => { emails.push(cents); return 'sent' } }
  return {
    pp, db, alerts, emails,
    prepare: (expectedCents = 5000) => prepareBalanceOrder(db.client, structuredClone(db.row), { expectedCents, serviceTitle: 'Guidance', ...common }),
    settle: id => settleBalanceOrder(db.client, id, common),
    report: () => reportUncertainBalancePayments(db.client, common),
    forbids: () => balancePaymentForbidsCancel(db.client, BOOKING, common),
  }
}

test('première ouverture : une commande, deux clics simultanés donnent la même', async () => {
  const t = setup({ paypal_order_id: null }, null)
  const [a, b] = await Promise.all([t.prepare(), t.prepare()])
  assert.equal(a.id, 'NEW-ORDER-1')
  assert.equal(b.id, 'NEW-ORDER-1')
  assert.equal(t.pp.state.created, 1)
  assert.equal(t.db.row.paypal_order_id, 'NEW-ORDER-1')
})

test('commande récente non validée (CREATED ou PAYER_ACTION_REQUIRED) : réutilisée', async () => {
  for (const status of ['CREATED', 'PAYER_ACTION_REQUIRED']) {
    const t = setup({}, { status })
    const result = await t.prepare()
    assert.equal(result.id, 'OLD-ORDER')
    assert.equal(t.pp.state.created, 0)
  }
})

test('commande ancienne non validée : remplacée, tracée, l’ancienne n’est plus jamais encaissable', async () => {
  const t = setup({ updated_at: ago(48 * H) }, { create_time: ago(ORDER_REUSE_MAX_MS + 1000) })
  const result = await t.prepare()
  assert.equal(result.id, 'NEW-ORDER-1')
  assert.equal(t.db.row.paypal_order_id, 'NEW-ORDER-1')
  assert.deepEqual([t.db.events[0].event, t.db.events[0].detail.old_order_id], ['paypal_order_replaced', 'OLD-ORDER'])
  // Le client valide quand même l'ancienne fenêtre PayPal : rien n'est encaissé.
  t.pp.state.orders.get('OLD-ORDER').status = 'APPROVED'
  const late = await t.settle('OLD-ORDER')
  assert.equal(late.error, 'balance_payment_not_found')
  assert.equal(t.pp.state.captures, 0)
  // Et la nouvelle se règle une seule fois.
  t.pp.state.orders.get('NEW-ORDER-1').status = 'APPROVED'
  assert.equal((await t.settle('NEW-ORDER-1')).status, 'COMPLETED')
  assert.equal(t.pp.state.captures, 1)
})

test('commande expirée (introuvable chez PayPal) : remplacée si jamais encaissée et assez ancienne', async () => {
  const t = setup({ updated_at: ago(NOT_FOUND_MIN_AGE_MS + 1000) }, null)
  assert.equal((await t.prepare()).id, 'NEW-ORDER-1')
})

test('introuvable mais récente, ou après une tentative d’encaissement : bloqué et vérification demandée', async () => {
  for (const row of [
    { updated_at: ago(60_000) },
    { updated_at: ago(48 * H), last_error_code: 'paypal_capture_failed' },
    { updated_at: ago(48 * H), status: 'capture_in_progress', capture_claimed_at: ago(48 * H) },
  ]) {
    const t = setup(row, null)
    const result = await t.prepare()
    assert.equal(result.error, 'balance_payment_review_required')
    assert.equal(t.pp.state.created, 0)
    assert.deepEqual(t.alerts, ['payment_uncertain'])
  }
})

test('deux clics simultanés sur une commande périmée : même remplacement pour les deux', async () => {
  const t = setup({ updated_at: ago(48 * H) }, { create_time: ago(48 * H) })
  const [a, b] = await Promise.all([t.prepare(), t.prepare()])
  assert.ok(a.ok && b.ok)
  assert.equal(a.id, b.id)
  assert.equal(t.pp.state.created, 1)
})

test('encaissement revendiqué pendant le remplacement : l’échange est refusé', async () => {
  const t = setup({ updated_at: ago(48 * H) }, { create_time: ago(48 * H) })
  t.db.onUpdate = () => Object.assign(t.db.row, { status: 'capture_in_progress', capture_claimed_at: new Date().toISOString() })
  const result = await t.prepare()
  assert.equal(result.error, 'balance_payment_retry_required')
  assert.equal(t.db.row.paypal_order_id, 'OLD-ORDER')
})

test('sans journal de remplacement, ou si PayPal ne crée pas : l’ancienne commande reste en place', async () => {
  const noLog = setup({ updated_at: ago(48 * H) }, { create_time: ago(48 * H) })
  noLog.db.failEvents = true
  assert.equal((await noLog.prepare()).ok, false)
  assert.equal(noLog.db.row.paypal_order_id, 'OLD-ORDER')
  const noOrder = setup({ updated_at: ago(48 * H) }, { create_time: ago(48 * H) })
  noOrder.pp.api.create = async () => { throw new Error('paypal_create_order_failed') }
  assert.equal((await noOrder.prepare()).error, 'paypal_create_order_failed')
  assert.equal(noOrder.db.row.paypal_order_id, 'OLD-ORDER')
})

test('commande APPROVED (client parti avant le retour) : confirmée, jamais remplacée, un seul encaissement', async () => {
  const t = setup({ updated_at: ago(48 * H) }, { status: 'APPROVED', create_time: ago(48 * H) })
  const result = await t.prepare()
  assert.deepEqual([result.id, result.approved], ['OLD-ORDER', true])
  assert.equal(t.pp.state.created, 0)
  assert.equal((await t.settle('OLD-ORDER')).status, 'COMPLETED')
  assert.equal(t.pp.state.captures, 1)
})

test('commande COMPLETED jamais enregistrée : enregistrée une fois, aucun nouveau prélèvement', async () => {
  const t = setup({ updated_at: ago(48 * H) })
  t.pp.paid(t.pp.state.orders.get('OLD-ORDER'))
  const result = await t.prepare()
  assert.equal(result.paid, true)
  assert.equal(t.pp.state.created + t.pp.state.captures, 0)
  assert.deepEqual(t.db.entries, [{ ref: 'CAP-OLD-ORDER', cents: 5000 }])
  assert.deepEqual(t.emails, [5000])
})

test('paiement réussi, puis actualisation de la page de retour : une écriture, un e-mail', async () => {
  const t = setup({}, { status: 'APPROVED' })
  assert.equal((await t.settle('OLD-ORDER')).status, 'COMPLETED')
  assert.equal((await t.settle('OLD-ORDER')).alreadyCaptured, true)
  assert.deepEqual([t.pp.state.captures, t.db.entries.length, t.emails.length], [1, 1, 1])
})

test('e-mail de confirmation en panne : le règlement reste enregistré', async () => {
  const t = setup({}, { status: 'APPROVED' })
  const result = await settleBalanceOrder(t.db.client, 'OLD-ORDER', { paypal: t.pp.api, onPaid: async () => { throw new Error('resend') } })
  assert.equal(result.status, 'COMPLETED')
  assert.equal(t.db.row.status, 'captured')
})

test('retour sans validation : rien n’est encaissé, reprise immédiate possible', async () => {
  const t = setup()
  assert.equal((await t.settle('OLD-ORDER')).error, 'paypal_order_not_approved')
  assert.equal(t.db.row.status, 'order_pending')
  assert.equal((await t.prepare()).id, 'OLD-ORDER')
  assert.equal(t.pp.state.captures, 0)
})

test('moyen de paiement refusé : rien d’encaissé, une nouvelle commande est proposée', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.pp.state.refuse = 'paypal_payment_declined'
  assert.equal((await t.settle('OLD-ORDER')).error, 'paypal_payment_declined')
  assert.equal((await t.prepare()).id, 'NEW-ORDER-1')
  assert.equal(t.pp.state.captures, 0)
})

test('coupure pendant l’encaissement : ligne protégée, aucune nouvelle commande, puis rattrapage sans double', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.pp.state.captureMode = 'timeout_paid'
  assert.equal((await t.settle('OLD-ORDER')).error, 'paypal_capture_uncertain')
  assert.equal(t.db.row.status, 'capture_in_progress')
  assert.deepEqual(t.alerts, ['payment_uncertain'])
  assert.equal((await t.prepare()).error, 'paypal_order_status_unavailable')
  t.pp.state.down = false
  assert.equal((await t.settle('OLD-ORDER')).status, 'COMPLETED')
  assert.deepEqual([t.pp.state.captures, t.pp.state.created, t.db.entries.length], [1, 0, 1])
})

test('encaissement sans réponse et non constaté : pas de nouvelle commande pendant le délai de protection', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.pp.state.captureMode = 'timeout_unpaid'
  assert.equal((await t.settle('OLD-ORDER')).error, 'paypal_capture_uncertain')
  assert.equal((await t.prepare()).error, 'balance_capture_in_progress')
  assert.equal(t.pp.state.created, 0)
})

test('encaissement en attente ou remboursé chez PayPal : bloqué et signalé', async () => {
  for (const [status, code] of [['PENDING', 'paypal_capture_pending'], ['REFUNDED', 'balance_payment_review_required'], ['PARTIALLY_REFUNDED', 'balance_payment_review_required']]) {
    const t = setup()
    t.pp.paid(t.pp.state.orders.get('OLD-ORDER'), status)
    assert.equal((await t.prepare()).error, code)
    assert.deepEqual([t.pp.state.created, t.alerts.length], [0, 1])
  }
})

test('payé avant l’échéance mais enregistré après : constaté et enregistré, jamais « expiré »', async () => {
  const t = setup()
  t.pp.paid(t.pp.state.orders.get('OLD-ORDER'))
  t.db.expired = true
  assert.equal((await t.settle('OLD-ORDER')).status, 'COMPLETED')
  assert.equal(t.db.entries.length, 1)
})

test('échéance dépassée et simple validation : aucun encaissement', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.db.expired = true
  assert.equal((await t.settle('OLD-ORDER')).error, 'balance_payment_expired')
  assert.equal(t.pp.state.captures, 0)
})

test('solde modifié depuis la préparation : commande au montant exact, sinon vérification', async () => {
  const t = setup()
  const result = await t.prepare(3000)
  assert.deepEqual([result.id, result.amountCents, t.db.row.amount_cents], ['NEW-ORDER-1', 3000, 3000])
  assert.equal(t.pp.state.orders.get('NEW-ORDER-1').purchase_units[0].amount.value, '30.00')
  for (const prepareOrder of [order => { order.status = 'APPROVED' }, (order, pp) => pp.paid(order)]) {
    const blocked = setup()
    prepareOrder(blocked.pp.state.orders.get('OLD-ORDER'), blocked.pp)
    assert.equal((await blocked.prepare(3000)).error, 'balance_payment_review_required')
    assert.equal(blocked.pp.state.created, 0)
  }
})

test('commande d’un autre montant ou d’un autre rendez-vous : jamais encaissée', async () => {
  const amount = setup({}, { status: 'APPROVED' })
  amount.pp.state.orders.get('OLD-ORDER').purchase_units[0].amount.value = '70.00'
  assert.equal((await amount.settle('OLD-ORDER')).error, 'paypal_order_amount_changed')
  const other = setup({}, { status: 'APPROVED' })
  other.pp.state.orders.get('OLD-ORDER').purchase_units[0].custom_id = 'MEDIUMIA:RDV-SOLDE:autre'
  assert.equal((await other.settle('OLD-ORDER')).error, 'balance_payment_review_required')
  assert.equal(amount.pp.state.captures + other.pp.state.captures, 0)
})

test('encaissé mais refusé par la base : ligne protégée et propriétaire alerté', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.db.failFinalize = true
  assert.equal((await t.settle('OLD-ORDER')).error, 'balance_payment_review_required')
  assert.equal(t.db.row.status, 'capture_in_progress')
  assert.equal(t.alerts.length, 1)
  t.db.failFinalize = false
  assert.equal((await t.settle('OLD-ORDER')).status, 'COMPLETED')
  assert.equal(t.pp.state.captures, 1)
})

test('PayPal injoignable : aucune commande créée, aucun encaissement', async () => {
  const t = setup({}, { status: 'APPROVED' })
  t.pp.state.down = true
  assert.equal((await t.prepare()).error, 'paypal_order_status_unavailable')
  assert.equal((await t.settle('OLD-ORDER')).error, 'paypal_order_status_unavailable')
  assert.equal(t.pp.state.created + t.pp.state.captures, 0)
})

test('annulation approuvée : interdite si payé, incertain ou illisible ; permise si rien n’est engagé', async () => {
  const paid = setup()
  paid.pp.paid(paid.pp.state.orders.get('OLD-ORDER'))
  assert.ok(await paid.forbids())
  const down = setup()
  down.pp.state.down = true
  assert.ok(await down.forbids())
  assert.ok(await setup({ status: 'capture_in_progress' }).forbids())
  assert.equal(await setup().forbids(), null)
  const cron = readFileSync('lib/rdvBalanceCronHandler.js', 'utf8')
  assert.ok(cron.indexOf('balancePaymentForbidsCancel(supabase') < cron.indexOf("rpc('claim_rdv_balance_auto_cancel'"))
})

test('contrôle quotidien : lecture seule, alerte pour un paiement engagé, silence sinon', async () => {
  const engaged = setup({}, { status: 'APPROVED' })
  assert.deepEqual(await engaged.report(), [{ state: 'approved', alert: 'sent' }])
  assert.equal(engaged.pp.state.captures + engaged.pp.state.created, 0)
  assert.equal(engaged.db.row.status, 'order_pending')
  assert.deepEqual(await setup().report(), [{ state: 'payable', alert: null }])
})

test('clé de création propre au montant et à la commande remplacée, dans la limite PayPal', () => {
  const base = { paymentId: PAYMENT, amountCents: 5000 }
  const keys = [base, { ...base, amountCents: 3000 }, { ...base, replacesOrderId: 'A'.repeat(20) }].map(rdvBalanceCreateRequestId)
  assert.equal(new Set(keys).size, 3)
  assert.ok(keys.every(key => key.length <= 108))
  assert.equal(rdvBalanceCreateRequestId(base), keys[0])
})

test('classement prudent : tout état inconnu est incertain', () => {
  const order = (status, unit = {}) => ({ cfg: CFG, status, data: { purchase_units: [{ reference_id: CFG.referenceId, custom_id: rdvBalanceCustomId(BOOKING), amount: { currency_code: 'EUR', value: '50.00' }, ...unit }] } })
  const classify = value => classifyRdvBalanceOrder(value, { bookingId: BOOKING, amountCents: 5000, currency: 'EUR' })
  assert.equal(classify(order('CREATED')), 'payable')
  assert.equal(classify(order('APPROVED')), 'approved')
  assert.equal(classify(order('VOIDED')), 'gone')
  assert.equal(classify(order('NOUVEL_ETAT')), 'uncertain')
  assert.equal(classify(order('COMPLETED')), 'uncertain')
  assert.equal(classify(order('CREATED', { reference_id: 'autre' })), 'uncertain')
  assert.equal(classify(order('CREATED', { amount: { currency_code: 'USD', value: '50.00' } })), 'wrong_amount')
  assert.equal(classify(order('APPROVED', { payments: { authorizations: [{ status: 'CREATED' }] } })), 'uncertain')
})

async function withFetch(handler, run) {
  const oldFetch = globalThis.fetch
  const keys = ['VERCEL_ENV', 'VERCEL_URL', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  Object.assign(process.env, { VERCEL_ENV: 'preview', VERCEL_URL: 'apercu.vercel.app', PAYPAL_CLIENT_ID: 'test-id', PAYPAL_CLIENT_SECRET: 'test-secret' })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', headers: options.headers, body: options.body, signal: options.signal })
    if (String(url).endsWith('/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'fake' }) }
    return handler(String(url), options)
  }
  try { return await run(requests) } finally {
    globalThis.fetch = oldFetch
    for (const key of keys) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key] }
  }
}

test('appels PayPal : lecture sans capture, délai borné, destination limitée à PayPal', async () => {
  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ id: 'ORDER_12345678', status: 'CREATED', links: [{ rel: 'payer-action', href: 'https://pirate.example/checkoutnow' }] }) }), async requests => {
    const checked = await inspectRdvBalancePayPalOrder('ORDER_12345678')
    assert.equal(checked.status, 'CREATED')
    assert.equal(checked.approveUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER_12345678')
    assert.ok(requests.every(request => !request.url.includes('/capture') && request.signal))
    assert.ok(requests.every(request => request.url.startsWith('https://api-m.sandbox.paypal.com/')))
  })
  await withFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }), async () => {
    assert.equal((await inspectRdvBalancePayPalOrder('ORDER_12345678')).status, 'NOT_FOUND')
  })
  for (const status of [401, 403, 429, 500]) {
    await withFetch(async () => ({ ok: false, status, json: async () => ({}) }), async () => {
      await assert.rejects(inspectRdvBalancePayPalOrder('ORDER_12345678'), /paypal_order_status_unavailable/)
    })
  }
})

test('création : montant exact, retour et annulation sur la page du solde', async () => {
  await withFetch(async () => ({ ok: true, status: 201, json: async () => ({ id: 'ORDER_NEW12345', status: 'PAYER_ACTION_REQUIRED', links: [] }) }), async requests => {
    await createRdvBalancePayPalOrder({ bookingId: BOOKING, paymentId: PAYMENT, amountCents: 5000, currency: 'EUR', serviceTitle: 'Guidance', replacesOrderId: 'OLD-ORDER' })
    const sent = requests.at(-1)
    const body = JSON.parse(sent.body)
    assert.equal(sent.headers['PayPal-Request-Id'], `rdv-balance-create-${PAYMENT}-5000-OLD-ORDER`)
    assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'EUR', value: '50.00' })
    assert.equal(body.payment_source.paypal.experience_context.return_url, 'https://apercu.vercel.app/rdv/solde?balance_return=1')
    assert.equal(body.payment_source.paypal.experience_context.cancel_url, 'https://apercu.vercel.app/rdv/solde?balance_cancel=1')
  })
})

test('capture : seul un refus 422 motivé est certain', async () => {
  const run = (status, data) => withFetch(async () => ({ ok: status < 300, status, json: async () => data }), () => captureRdvBalancePayPalOrder('ORDER_12345678'))
  assert.equal((await run(422, { details: [{ issue: 'INSTRUMENT_DECLINED' }] })).refusal, 'paypal_payment_declined')
  assert.equal((await run(422, { details: [{ issue: 'ORDER_NOT_APPROVED' }] })).refusal, 'paypal_approval_expired')
  assert.equal((await run(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] })).refusal, null)
  assert.equal((await run(500, {})).refusal, null)
  const cut = await withFetch(async () => { throw new TypeError('fetch failed') }, () => captureRdvBalancePayPalOrder('ORDER_12345678'))
  assert.deepEqual(cut, { refusal: null, issue: null })
})

test('page : jeton gardé dans l’onglet seulement, reprise après PayPal, jamais d’invitation à repayer un paiement engagé', () => {
  assert.match(page, /history\.replaceState\(\{ \.\.\.\(history\.state \|\| \{\}\)/)
  assert.match(page, /sessionStorage\.setItem\(RESUME_KEY/)
  assert.doesNotMatch(page, /localStorage|document\.cookie/)
  assert.match(page, /sessionStorage\.removeItem\(RESUME_KEY\)/)
  assert.match(page, /window\.location\.assign\(checkoutUrl\)/)
  assert.doesNotMatch(page, /window\.open\(|window\.close\(/)
  assert.match(page, /addEventListener\('pageshow'/)
  assert.match(page, /Paiement en cours de vérification/)
  assert.match(page, /error instanceof TypeError \? 'paypal_capture_uncertain'/)
  assert.doesNotMatch(page, /l’échéance de 48 heures/)
  // Le script de la page est syntaxiquement valide.
  assert.doesNotThrow(() => new Function(page.slice(page.indexOf('<script>\n') + 9, page.lastIndexOf('</script>'))))
})
