/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Découverte live déjà payée → Formation complète à 568 € au lieu de 597 €.
// Montants réels en centimes : 2900 (Découverte), 56800 (complet déduit), 59700 (public).

process.env.PAYPAL_CLIENT_ID = 'client'
process.env.PAYPAL_CLIENT_SECRET = 'secret'
process.env.RESEND_API_KEY = 'test-key'
process.env.RESEND_FROM_EMAIL = 'MediumIA <contact@mediumia.fr>'

const { handlePayPalCheckout, __paypalFormationTest } = await import('../lib/paypalSandbox.js')

const CLAIRE = '11111111-1111-4111-8111-111111111111'
const PAUL = '22222222-2222-4222-8222-222222222222'
const ACCOUNTS = { [CLAIRE]: 'claire@example.com', [PAUL]: 'paul@example.com' }
const TOKENS = { 'jwt-claire': CLAIRE, 'jwt-paul': PAUL }

function live() {
  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_ENV = 'live'
  process.env.PAYPAL_FORMATION_ENABLED = 'true'
}
function preview() {
  process.env.VERCEL_ENV = 'preview'
  delete process.env.PAYPAL_ENV
}

// ── In-memory Supabase (only what the checkout uses) ────────────────────────
function makeDb({ discoveries = [], pathPayments = [] } = {}) {
  let n = 0
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const t = {
    mediumia_paypal_purchases: discoveries.map((d) => ({
      id: id(), product_code: 'discovery', paypal_env: 'live', status: 'provisioned', amount_cents: 2900,
      upgrade_credit_cents: 2900, upgrade_credit_redeemed_at: null, upgrade_credit_redeemed_purchase_id: null,
      provisioned_at: '2026-09-20T10:00:00Z', ...d,
    })),
    mediumia_paypal_order_intents: [],
    mediumia_formation_payments: pathPayments,
    mediumia_students: Object.keys(ACCOUNTS).map((u) => ({ user_id: u, license_number: `LIC-${u.slice(0, 4)}`, display_name: null })),
  }
  const grants = []
  const from = (name) => {
    const filters = []
    let op = 'select'
    let payload = null
    const rows = () => (t[name] ||= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (op === 'insert') {
        const row = { id: id(), ...payload }
        if (name === 'mediumia_paypal_purchases' && t[name].some((r) => r.paypal_order_id === row.paypal_order_id)) return { data: null, error: { code: '23505' } }
        t[name].push(row)
        return { data: null, error: null }
      }
      const found = rows()
      if (op === 'update') {
        for (const r of found) {
          const next = { ...r, ...payload }
          // Unique index: one claim per Découverte; one Découverte per full purchase.
          if (name === 'mediumia_paypal_order_intents' && next.upgrade_credit_claimed_at && t[name].some((o) => o !== r && o.upgrade_credit_claimed_at && o.upgrade_credit_purchase_id === next.upgrade_credit_purchase_id)) return { data: null, error: { code: '23505' } }
          if (name === 'mediumia_paypal_purchases' && next.upgrade_credit_redeemed_purchase_id && t[name].some((o) => o !== r && o.upgrade_credit_redeemed_purchase_id === next.upgrade_credit_redeemed_purchase_id)) return { data: null, error: { code: '23505' } }
          Object.assign(r, payload)
        }
      }
      return { data: found, error: null }
    }
    const api = {
      select() { return api },
      eq(k, v) { filters.push((r) => r[k] === v); return api },
      in(k, v) { filters.push((r) => v.includes(r[k])); return api },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api },
      insert(p) { op = 'insert'; payload = p; return api },
      update(p) { op = 'update'; payload = p; return api },
      single() { const r = run(); return Promise.resolve({ data: r.data?.[0] || null, error: r.data?.[0] ? null : { message: 'none' } }) },
      maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return api
  }
  return {
    t, grants, from,
    rpc: async (fn, args) => {
      if (fn === 'mediumia_find_user_id_by_email') return { data: Object.keys(ACCOUNTS).find((u) => ACCOUNTS[u] === args.p_email) || null, error: null }
      if (fn === 'mediumia_grant_purchase_atomic') {
        const already = grants.find((g) => g.origin === args.p_origin_ref)
        if (already) return { data: { status: 'already_granted', entitlement_id: already.id, access_expires_at: '2027-09-25T00:00:00Z' }, error: null }
        grants.push({ id: id(), user: args.p_user_id, origin: args.p_origin_ref })
        return { data: { status: 'granted', entitlement_id: grants.at(-1).id, access_expires_at: '2027-09-25T00:00:00Z' }, error: null }
      }
      return { data: null, error: null }
    },
    auth: {
      getUser: async (jwt) => (TOKENS[jwt] ? { data: { user: { id: TOKENS[jwt], email: ACCOUNTS[TOKENS[jwt]] } }, error: null } : { data: null, error: { message: 'invalid' } }),
      admin: {
        getUserById: async (u) => ({ data: { user: ACCOUNTS[u] ? { id: u, email: ACCOUNTS[u] } : null }, error: null }),
        createUser: async () => ({ data: null, error: { message: 'exists' } }),
      },
    },
  }
}

// ── Fake PayPal + Resend ─────────────────────────────────────────────────────
function makePayPal({ captures = {}, payer = 'claire@example.com', down = false } = {}) {
  const s = { orders: {}, captures, calls: [], emails: [], next: 1 }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const body = init.body && String(init.body).startsWith('{') ? JSON.parse(init.body) : null
    s.calls.push([init.method || 'GET', u.pathname])
    if (u.hostname === 'api.resend.com') { s.emails.push(body.to); return json({ id: 'email' }) }
    if (u.pathname === '/v1/oauth2/token') return json({ access_token: 'tok' })
    const sub = u.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/(cancel|transactions))?$/)
    if (sub) {
      s.subscriptions ||= {}
      if (sub[3] === 'cancel') { s.subscriptions[sub[1]] = 'CANCELLED'; return new Response(null, { status: 204 }) }
      if (sub[3] === 'transactions') return json({ transactions: [] })
      return json({ id: sub[1], status: s.subscriptions[sub[1]] || 'ACTIVE', custom_id: CLAIRE })
    }
    if (u.pathname.startsWith('/v2/payments/captures/')) {
      if (down) return json({}, 500)
      const c = s.captures[decodeURIComponent(u.pathname.split('/').pop())]
      return c ? json(c) : json({ name: 'RESOURCE_NOT_FOUND' }, 404)
    }
    if (u.pathname === '/v2/checkout/orders' && init.method === 'POST') {
      const oid = `ORDER${s.next++}`
      s.orders[oid] = { id: oid, status: 'APPROVED', purchase_units: [{ ...body.purchase_units[0] }], payer: { email_address: payer, name: { given_name: 'Claire', surname: 'M' } } }
      return json({ id: oid }, 201)
    }
    const m = u.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/)
    if (m) {
      const o = s.orders[m[1]]
      if (!o) return json({}, 404)
      if (m[2]) {
        if (s.failCapture) return json({ name: 'INSTRUMENT_DECLINED' }, 422)
        o.status = 'COMPLETED'
        o.purchase_units[0].payments = { captures: [{ id: `CAP-${m[1]}`, status: 'COMPLETED', amount: o.purchase_units[0].amount, create_time: '2026-09-25T12:00:00Z' }] }
      }
      return json(o)
    }
    return json({}, 404)
  }
  return s
}

async function call(action, { method = 'POST', body = {}, headers = {}, query = {} } = {}) {
  const req = { method, body, headers, query: { product: 'full', ...query } }
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, setHeader() {} }
  await handlePayPalCheckout(req, res, action)
  return res
}
const consent = { termsAccepted: true, immediateAccessAccepted: true, product: 'full' }
const as = (jwt) => ({ authorization: `Bearer ${jwt}` })
const paidDiscovery = (captureId) => ({ [captureId]: { id: captureId, status: 'COMPLETED', amount: { currency_code: 'EUR', value: '29.00' } } })

async function buy(db, pp, headers) {
  const created = await call('create', { body: consent, headers })
  assert.equal(created.statusCode, 201, JSON.stringify(created.body))
  const captured = await call('capture', { body: { orderId: created.body.id, product: 'full' } })
  return { created, captured, order: pp.orders[created.body.id], intent: db.t.mediumia_paypal_order_intents.find((i) => i.paypal_order_id === created.body.id) }
}

// ── Tests ───────────────────────────────────────────────────────────────────
test('no Découverte: 597 € (59700), anonymous or logged in', async () => {
  live()
  for (const headers of [{}, as('jwt-paul')]) {
    const db = makeDb(); __paypalFormationTest.useSupabase(db)
    const pp = makePayPal({ payer: 'paul@example.com' })
    const { order, intent, captured } = await buy(db, pp, headers)
    assert.equal(order.purchase_units[0].amount.value, '597.00')
    assert.equal(order.purchase_units[0].reference_id, 'MEDIUMIA_FORMATION_597')
    assert.deepEqual([intent.amount_cents, intent.upgrade_credit_purchase_id ?? null], [59700, null])
    assert.equal(captured.statusCode, 200)
    assert.equal(db.t.mediumia_paypal_purchases.find((p) => p.product_code === 'full').amount_cents, 59700)
  }
})

test('a real live Découverte (29 €, provisioned, not refunded) → 568 € once, for the same account', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  // Claire pays with another PayPal address: the purchase still goes to her account.
  const pp = makePayPal({ captures: paidDiscovery('DISC1'), payer: 'autre-adresse@example.net' })
  const shown = await call('credit', { method: 'GET', headers: as('jwt-claire') })
  assert.deepEqual([shown.statusCode, shown.body.credited, shown.body.creditCents, shown.body.displayAmount], [200, true, 2900, '568.00'])

  const { order, intent, captured } = await buy(db, pp, { ...as('jwt-claire'), 'x-mediumia-expected-full-amount': '568.00' })
  assert.equal(order.purchase_units[0].amount.value, '568.00')
  assert.equal(order.purchase_units[0].reference_id, 'MEDIUMIA_FORMATION_568')
  const discovery = db.t.mediumia_paypal_purchases.find((p) => p.product_code === 'discovery')
  assert.deepEqual([intent.amount_cents, intent.user_id, intent.upgrade_credit_purchase_id], [56800, CLAIRE, discovery.id])
  assert.equal(captured.statusCode, 200, JSON.stringify(captured.body))
  const full = db.t.mediumia_paypal_purchases.find((p) => p.product_code === 'full')
  assert.deepEqual([full.amount_cents, full.status, full.user_id], [56800, 'provisioned', CLAIRE])
  assert.deepEqual([db.grants.length, db.grants[0].user], [1, CLAIRE])
  assert.equal(discovery.upgrade_credit_redeemed_purchase_id, full.id)
  assert.ok(discovery.upgrade_credit_redeemed_at)
  assert.deepEqual(pp.emails, ['claire@example.com', 'claire@example.com'], 'e-mails go to the account, not the PayPal address')
  // 29 + 568 = 597: the public price, never more.
  assert.equal(discovery.amount_cents + full.amount_cents, 59700)
})

test('replay / idempotence: capturing the same order again changes nothing', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  const pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const { created } = await buy(db, pp, as('jwt-claire'))
  const again = await call('capture', { body: { orderId: created.body.id, product: 'full' } })
  const third = await call('capture', { body: { orderId: created.body.id, product: 'full' } })
  assert.deepEqual([again.statusCode, again.body.access.alreadyProvisioned, third.statusCode], [200, true, 200])
  assert.equal(pp.calls.filter(([m, p]) => m === 'POST' && p.endsWith('/capture')).length, 1, 'PayPal captured once')
  assert.equal(db.t.mediumia_paypal_purchases.filter((p) => p.product_code === 'full').length, 1)
  assert.equal(db.grants.length, 1)
})

test('never two deductions: once used, the next order is 597 €; two open orders cannot both use it', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  const pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const first = await call('create', { body: consent, headers: as('jwt-claire') })
  const second = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.deepEqual([pp.orders[first.body.id].purchase_units[0].amount.value, pp.orders[second.body.id].purchase_units[0].amount.value], ['568.00', '568.00'])
  assert.equal((await call('capture', { body: { orderId: first.body.id, product: 'full' } })).statusCode, 200)
  const refused = await call('capture', { body: { orderId: second.body.id, product: 'full' } })
  assert.deepEqual([refused.statusCode, refused.body.error], [502, 'discovery_credit_unavailable'])
  assert.equal(pp.orders[second.body.id].status, 'APPROVED', 'the second order is never captured: no money taken')
  const after = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.equal(pp.orders[after.body.id].purchase_units[0].amount.value, '597.00')
})

test('refunded, sandbox, unprovisioned or someone else’s Découverte: 597 €', async () => {
  live()
  const cases = [
    { name: 'refunded', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D' }], captures: { D: { status: 'REFUNDED', amount: { currency_code: 'EUR', value: '29.00' } } } },
    { name: 'partially refunded', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D' }], captures: { D: { status: 'PARTIALLY_REFUNDED', amount: { currency_code: 'EUR', value: '29.00' } } } },
    { name: 'unknown at PayPal', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D' }], captures: {} },
    { name: 'sandbox Découverte', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D', paypal_env: 'sandbox', amount_cents: 100 }], captures: paidDiscovery('D') },
    { name: 'not provisioned', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D', status: 'provisioning_failed' }], captures: paidDiscovery('D') },
    { name: 'already used', discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'D', upgrade_credit_redeemed_at: '2026-09-21T00:00:00Z', upgrade_credit_redeemed_purchase_id: 'x' }], captures: paidDiscovery('D') },
    { name: 'another student', discoveries: [{ user_id: PAUL, paypal_capture_id: 'D' }], captures: paidDiscovery('D') },
  ]
  for (const c of cases) {
    const db = makeDb({ discoveries: c.discoveries }); __paypalFormationTest.useSupabase(db)
    const pp = makePayPal({ captures: c.captures })
    const shown = await call('credit', { method: 'GET', headers: as('jwt-claire') })
    assert.deepEqual([shown.body.credited, shown.body.displayAmount], [false, '597.00'], c.name)
    const created = await call('create', { body: consent, headers: as('jwt-claire') })
    assert.equal(pp.orders[created.body.id].purchase_units[0].amount.value, '597.00', c.name)
  }
})

test('sandbox checkout never applies a deduction, even for a live Découverte', async () => {
  preview()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  const pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const shown = await call('credit', { method: 'GET', headers: as('jwt-claire') })
  assert.deepEqual([shown.body.credited, shown.body.displayAmount, shown.body.amount], [false, '597.00', '1.00'])
  const created = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.equal(pp.orders[created.body.id].purchase_units[0].amount.value, '1.00')
  assert.equal(db.t.mediumia_paypal_order_intents[0].upgrade_credit_purchase_id ?? null, null)
  assert.throws(() => __paypalFormationTest.creditedConfig(__paypalFormationTest.runtimeConfig(null, 'full')), /purchase_product_mismatch/)
})

test('fail safe: expired session, unverifiable Découverte or changed price never create an order', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  let pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const expired = await call('create', { body: consent, headers: as('jwt-expired') })
  assert.deepEqual([expired.statusCode, expired.body.error], [401, 'session_expired'])
  const changed = await call('create', { body: consent, headers: { ...as('jwt-claire'), 'x-mediumia-expected-full-amount': '597.00' } })
  assert.deepEqual([changed.statusCode, changed.body.error, changed.body.displayAmount], [409, 'price_changed', '568.00'])
  const forged = await call('create', { body: { ...consent, amount: '1.00', creditCents: 59700 }, headers: { 'x-mediumia-expected-full-amount': '1.00' } })
  assert.deepEqual([forged.statusCode, forged.body.error], [409, 'price_changed'], 'the browser can only refuse, never set, a price')
  pp = makePayPal({ captures: paidDiscovery('DISC1'), down: true })
  const down = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.deepEqual([down.statusCode, down.body.error], [503, 'credit_check_unavailable'])
  assert.equal(Object.keys(pp.orders).length, 0)
  assert.equal(db.t.mediumia_paypal_order_intents.length, 0)
})

test('a parcours already under way is finished with « Tout débloquer », not with 568 €', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }], pathPayments: [{ user_id: CLAIRE, paypal_env: 'live', kind: 'monthly' }] }); __paypalFormationTest.useSupabase(db)
  makePayPal({ captures: paidDiscovery('DISC1') })
  const created = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.deepEqual([created.statusCode, created.body.error], [409, 'parcours_in_progress'])
})

test('an open parcours subscription (even before its first instalment) also blocks the 568 € credit', async () => {
  live()
  for (const status of ['approval_pending', 'active', 'suspended']) {
    const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
    db.t.mediumia_formation_subscriptions = [{ paypal_subscription_id: 'I-SUB1', user_id: CLAIRE, paypal_env: 'live', status }]
    const pp = makePayPal({ captures: paidDiscovery('DISC1') })
    const shown = await call('credit', { method: 'GET', headers: as('jwt-claire') })
    assert.equal(shown.body.error, 'parcours_in_progress', status)
    const created = await call('create', { body: consent, headers: as('jwt-claire') })
    assert.deepEqual([created.statusCode, created.body.error], [409, 'parcours_in_progress'], status)
    assert.equal(Object.keys(pp.orders).length, 0)
  }
  // A stopped parcours no longer blocks: the credit applies again (29 + 568 = 597).
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  db.t.mediumia_formation_subscriptions = [{ paypal_subscription_id: 'I-SUB1', user_id: CLAIRE, paypal_env: 'live', status: 'cancelled' }]
  makePayPal({ captures: paidDiscovery('DISC1') })
  assert.equal((await call('credit', { method: 'GET', headers: as('jwt-claire') })).body.displayAmount, '568.00')
})

test('a complete purchase made outside « Mon parcours » stops the subscription and reports any overpayment', async () => {
  live()
  process.env.PAYPAL_FORMATION_PATH_ENABLED = 'true'
  try {
    const db = makeDb({
      discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }],
      pathPayments: [
        { user_id: CLAIRE, paypal_env: 'live', kind: 'discovery', amount_cents: 2900, value_cents: 2900, paypal_ref: 'DISC1', paid_at: '2026-10-01T10:00:00Z' },
        { user_id: CLAIRE, paypal_env: 'live', kind: 'monthly', amount_cents: 4800, value_cents: 4800, paypal_ref: 'TX1', paid_at: '2026-11-01T10:00:00Z' },
      ],
    }); __paypalFormationTest.useSupabase(db)
    db.t.mediumia_formation_subscriptions = [{ paypal_subscription_id: 'I-SUB1', user_id: CLAIRE, paypal_env: 'live', status: 'active', created_at: '2026-10-01T10:00:00Z' }]
    // Anonymous checkout paid with Claire's address: 597 € (no deduction without login).
    const pp = makePayPal({ captures: paidDiscovery('DISC1'), payer: 'claire@example.com' })
    const { captured } = await buy(db, pp, {})
    assert.equal(captured.statusCode, 200, JSON.stringify(captured.body))
    assert.equal(pp.subscriptions['I-SUB1'], 'CANCELLED', 'no further instalment can be taken')
    assert.equal(db.t.mediumia_formation_subscriptions[0].status, 'completed')
    assert.ok(pp.emails.includes('contact@mediumia.fr'), 'the owner is warned: 29 + 48 + 597 > 597, refund the excess')
  } finally {
    delete process.env.PAYPAL_FORMATION_PATH_ENABLED
  }
})

test('Découverte refunded between the order and the payment: nothing is captured', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  const pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const created = await call('create', { body: consent, headers: as('jwt-claire') })
  pp.captures.DISC1.status = 'REFUNDED'
  const refused = await call('capture', { body: { orderId: created.body.id, product: 'full' } })
  assert.equal(refused.body.error, 'discovery_credit_unavailable')
  assert.equal(pp.orders[created.body.id].status, 'APPROVED')
})

test('a failed PayPal capture releases the Découverte for a new order', async () => {
  live()
  const db = makeDb({ discoveries: [{ user_id: CLAIRE, paypal_capture_id: 'DISC1' }] }); __paypalFormationTest.useSupabase(db)
  const pp = makePayPal({ captures: paidDiscovery('DISC1') })
  const created = await call('create', { body: consent, headers: as('jwt-claire') })
  pp.failCapture = true
  const failed = await call('capture', { body: { orderId: created.body.id, product: 'full' } })
  assert.equal(failed.body.error, 'paypal_capture_failed')
  assert.equal(db.t.mediumia_paypal_order_intents[0].upgrade_credit_claimed_at, null)
  pp.failCapture = false
  const retry = await call('create', { body: consent, headers: as('jwt-claire') })
  assert.equal(pp.orders[retry.body.id].purchase_units[0].amount.value, '568.00')
})

test('597 € is the public price and stays valid for existing orders; 568 € only exists with a Découverte', () => {
  live()
  const full = __paypalFormationTest.runtimeConfig(null, 'full')
  assert.deepEqual([full.amount, full.displayAmount, full.referenceId], ['597.00', '597.00', 'MEDIUMIA_FORMATION_597'])
  const credited = __paypalFormationTest.creditedConfig(full)
  assert.deepEqual([credited.amount, credited.referenceId, credited.creditCents], ['568.00', 'MEDIUMIA_FORMATION_568', 2900])
  // An order created before this change (597 €) still validates at capture.
  const intent = { paypal_order_id: 'OLD597', reference_id: 'MEDIUMIA_FORMATION_597', amount_cents: 59700, currency: 'EUR', product_code: 'full', paypal_env: 'live', terms_version: 'formation-2026-09-01-v1', terms_accepted_at: '2026-08-13T00:00:00Z', immediate_access_accepted_at: '2026-08-13T00:00:00Z' }
  const order = { id: 'OLD597', status: 'COMPLETED', purchase_units: [{ reference_id: 'MEDIUMIA_FORMATION_597', amount: { currency_code: 'EUR', value: '597.00' }, payments: { captures: [{ id: 'C', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '597.00' } }] } }] }
  assert.doesNotThrow(() => __paypalFormationTest.validateOrderAgainstIntent(full, order, intent, { requireCaptured: true }))
})

test('the migration stores the credit safely: 59700 without credit, 56800 only with a Découverte, one claim, one redemption', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260926090000_decouverte_credit_568.sql', import.meta.url), 'utf8')
  const executed = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.match(executed, /^begin;$/m)
  assert.match(executed, /^commit;$/m)
  assert.match(executed, /product_code = 'full' and amount_cents = 59700\)/)
  assert.match(executed, /product_code = 'full' and amount_cents = 56800\)/)
  assert.match(executed, /upgrade_credit_purchase_id is not null and user_id is not null\s+and paypal_env = 'live' and product_code = 'full' and amount_cents = 56800/)
  assert.match(executed, /create unique index if not exists ux_mediumia_order_intents_credit_claim[\s\S]*where upgrade_credit_claimed_at is not null/)
  assert.match(executed, /create unique index if not exists ux_mediumia_purchases_credit_redeemed_by/)
  assert.match(executed, /product_code = 'full' and amount_cents in \(59700, 56800\)/)
  assert.doesNotMatch(executed, /\bupdate\b|\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i)
})

test('the abandoned 397 / 368 / 297 amounts appear nowhere in the credit code', () => {
  for (const path of ['lib/paypalSandbox.js', 'src/lib/formationCredit.js', 'src/components/FormationCreditNotice.jsx', 'src/components/FormationPage.jsx', 'public/cgv-formation.html', 'supabase/migrations/20260926090000_decouverte_credit_568.sql']) {
    // Code comments aside (the monthly-plan comment inherited from main is not a price).
    const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split('\n').filter((line) => !/^\s*(\/\/|--)/.test(line)).join('\n')
    assert.doesNotMatch(source, /39700|36800|29700|397\.00|368\.00|297\.00|397 €|368 €|297 €/, path)
  }
})
