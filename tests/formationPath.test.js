/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
process.env.PAYPAL_CLIENT_ID = 'client'
process.env.PAYPAL_CLIENT_SECRET = 'secret'
delete process.env.VERCEL_ENV
delete process.env.RESEND_API_KEY

const { handleFormationPath, syncLiveSubscriptions, ownsCompleteFormation, settlePathAfterFullPurchase, publicOffer } = await import('../lib/formationPath.js')

const USER = '11111111-1111-4111-8111-111111111111'

// ── In-memory Supabase ──────────────────────────────────────────────────────
function makeDb(seed = {}) {
  const t = { mediumia_formation_payments: [], mediumia_formation_subscriptions: [], mediumia_formation_unlock_orders: [], mediumia_paypal_plans: [], ...seed }
  const entitlements = []
  const from = (name) => {
    const filters = []
    let patch = null
    let op = 'select'
    let payload = null
    const rows = () => (t[name] ||= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload]
        for (const row of list) {
          if (name === 'mediumia_formation_payments' && t[name].some((r) => r.paypal_ref === row.paypal_ref)) return { data: null, error: { code: '23505' } }
          if (name === 'mediumia_formation_subscriptions' && ['approval_pending', 'active'].includes(row.status) && t[name].some((r) => r.user_id === row.user_id && ['approval_pending', 'active'].includes(r.status))) return { data: null, error: { code: '23505' } }
          t[name].push({ created_at: new Date().toISOString(), ...row })
        }
        return { data: null, error: null }
      }
      if (op === 'upsert') {
        if (!t[name].some((r) => r.paypal_env === payload.paypal_env && r.code === payload.code)) t[name].push(payload)
        return { data: null, error: null }
      }
      const found = rows()
      if (op === 'update') found.forEach((r) => Object.assign(r, patch))
      return { data: found, error: null }
    }
    const api = {
      select() { return api }, order() { return api }, limit() { return api },
      eq(k, v) { filters.push((r) => r[k] === v); return api },
      in(k, v) { filters.push((r) => v.includes(r[k])); return api },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api },
      insert(p) { op = 'insert'; payload = p; return api },
      upsert(p) { op = 'upsert'; payload = p; return api },
      update(p) { op = 'update'; patch = p; return api },
      maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return api
  }
  return {
    t, entitlements, from,
    rpc: async (fn, args) => {
      if (fn === 'mediumia_set_path_entitlement') {
        const existing = entitlements.find((e) => e.user_id === args.p_user_id)
        if (existing) Object.assign(existing, { max_module: args.p_max_module, access_expires_at: args.p_expires_at })
        else entitlements.push({ user_id: args.p_user_id, max_module: args.p_max_module, access_expires_at: args.p_expires_at })
        return { data: { status: 'ok' }, error: null }
      }
      return { data: null, error: null }
    },
    auth: {
      getUser: async (jwt) => (jwt === 'student' ? { data: { user: { id: USER, email: 'claire@example.com' } }, error: null } : { data: null, error: { message: 'no' } }),
      admin: { getUserById: async () => ({ data: { user: { email: 'claire@example.com' } } }) },
    },
  }
}

// ── Fake PayPal ─────────────────────────────────────────────────────────────
function makePayPal() {
  // Découverte captures known to PayPal (Sandbox: 1,00 € de test).
  const state = { subs: {}, orders: {}, calls: [], nextSub: 1, nextOrder: 1, nextTx: 1, captures: { 'CAP-DISC': { id: 'CAP-DISC', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'EUR' } } }, capturesDown: false }
  const json = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  state.charge = (subId, cents, status = 'COMPLETED') => {
    const sub = state.subs[subId]
    sub.transactions.push({ id: `TX${state.nextTx++}`, status, time: new Date(Date.now() + state.nextTx * 1000).toISOString(), amount_with_breakdown: { gross_amount: { value: (cents / 100).toFixed(2), currency_code: 'EUR' }, net_amount: { value: (cents / 100).toFixed(2), currency_code: 'EUR' } } })
  }
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const body = init.body && String(init.body).startsWith('{') ? JSON.parse(init.body) : null
    state.calls.push([init.method || 'GET', u.pathname, body])
    if (u.pathname === '/v1/oauth2/token') return json({ access_token: 'tok' })
    if (u.pathname.startsWith('/v2/payments/captures/')) {
      if (state.capturesDown) return json({}, 500)
      const c = state.captures[decodeURIComponent(u.pathname.split('/').pop())]
      return c ? json(c) : json({ name: 'RESOURCE_NOT_FOUND' }, 404)
    }
    if (u.pathname === '/v1/catalogs/products') return json({ id: 'PROD-1' }, 201)
    if (u.pathname === '/v1/billing/plans') return json({ id: 'P-PLAN1' }, 201)
    if (u.pathname === '/v1/billing/subscriptions' && init.method === 'POST') {
      const id = `I-SUB${String(state.nextSub++).padStart(6, '0')}`
      state.subs[id] = { id, status: 'APPROVAL_PENDING', custom_id: body.custom_id, plan: body.plan, transactions: [] }
      return json({ id, status: 'APPROVAL_PENDING' }, 201)
    }
    let m = u.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/(transactions|cancel))?$/)
    if (m) {
      const sub = state.subs[m[1]]
      if (!sub) return json({}, 404)
      if (m[3] === 'cancel') { sub.status = 'CANCELLED'; return json({}, 204) }
      if (m[3] === 'transactions') return json({ transactions: sub.transactions })
      return json({ id: sub.id, status: sub.status, custom_id: sub.custom_id })
    }
    if (u.pathname === '/v2/checkout/orders' && init.method === 'POST') {
      const id = `ORD${state.nextOrder++}`
      state.orders[id] = { id, amount: body.purchase_units[0].amount.value, status: 'APPROVED' }
      return json({ id, status: 'CREATED' }, 201)
    }
    m = u.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/)
    if (m) {
      const order = state.orders[m[1]]
      if (m[2]) order.status = 'COMPLETED'
      return json({ id: order.id, status: order.status, purchase_units: [{ payments: { captures: order.status === 'COMPLETED' ? [{ id: `CAP-${order.id}`, status: 'COMPLETED', amount: { value: order.amount, currency_code: 'EUR' }, create_time: new Date().toISOString() }] : [] } }] })
    }
    return json({ error: 'unexpected' }, 500)
  }
  return { state, fetchImpl }
}

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this }, setHeader() {} }
}

async function call(db, action, body, { auth = 'student', method } = {}) {
  const r = res()
  await handleFormationPath({ method: method || (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${auth}` }, body: body || {} }, r, action, db)
  return r
}

// The Découverte purchase recorded by the checkout (same account, same environment, provisioned).
const discoveryPurchase = (over = {}) => ({ paypal_capture_id: 'CAP-DISC', user_id: USER, paypal_env: 'sandbox', status: 'provisioned', amount_cents: 100, product_code: 'discovery', ...over })

function setup({ monthlyPaid = 0, purchase = {} } = {}) {
  const payments = [{ user_id: USER, paypal_env: 'sandbox', kind: 'discovery', amount_cents: 100, value_cents: 2900, paypal_ref: 'CAP-DISC', paid_at: '2026-09-01T10:00:00Z' }]
  for (let i = 0; i < monthlyPaid; i += 1) payments.push({ user_id: USER, paypal_env: 'sandbox', kind: 'monthly', amount_cents: 4800, value_cents: 4800, paypal_ref: `OLD${i}`, paid_at: new Date(Date.UTC(2026, 9 + i, 1, 10)).toISOString() })
  const db = makeDb({ mediumia_formation_payments: payments, mediumia_paypal_purchases: purchase === null ? [] : [discoveryPurchase(purchase)] })
  const pp = makePayPal()
  globalThis.fetch = pp.fetchImpl
  return { db, pp }
}

const webhook = (db, subId, type = 'PAYMENT.SALE.COMPLETED') => call(db, 'webhook', { event_type: type, resource: type.startsWith('BILLING') ? { id: subId } : { billing_agreement_id: subId } }, { auth: 'none' })
const paidTotal = (db) => db.t.mediumia_formation_payments.reduce((n, p) => n + (p.kind === 'refund' ? -p.value_cents : p.value_cents), 0)

test('successful first instalment opens modules 2-3; the schedule is 11 × 48 € then 40 €', async () => {
  const { db, pp } = setup()
  const status = await call(db, 'status')
  assert.deepEqual([status.statusCode, status.body.maxModule, status.body.remainingCents, status.body.schedule.regularCount, status.body.schedule.finalCents], [200, 1, 56800, 11, 4000])
  const sub = await call(db, 'subscribe', { consent: true })
  assert.equal(sub.statusCode, 201)
  const created = pp.state.subs[sub.body.id]
  assert.equal(created.custom_id, USER)
  assert.deepEqual(created.plan.billing_cycles.map((c) => [c.sequence, c.total_cycles, c.pricing_scheme.fixed_price.value]), [[1, 11, '48.00'], [2, 1, '40.00']])
  created.status = 'ACTIVE'
  pp.state.charge(sub.body.id, 4800)
  const act = await call(db, 'activate', { subscriptionId: sub.body.id })
  assert.deepEqual([act.statusCode, act.body.maxModule, act.body.paidCents], [200, 3, 7700])
  assert.equal(db.entitlements[0].max_module, 3)
})

test('consent is required, and a Discovery is needed before continuing', async () => {
  const { db } = setup()
  assert.equal((await call(db, 'subscribe', {})).body.error, 'consent_required')
  db.t.mediumia_formation_payments.length = 0
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'discovery_required')
  assert.equal((await call(db, 'status', null, { auth: 'nobody' })).statusCode, 401)
})

test('a webhook received twice records the payment once', async () => {
  const { db, pp } = setup()
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  pp.state.charge(sub.body.id, 4800)
  await webhook(db, sub.body.id)
  await webhook(db, sub.body.id)
  assert.equal(db.t.mediumia_formation_payments.filter((p) => p.kind === 'monthly').length, 1)
  assert.equal(paidTotal(db), 7700)
})

test('a declined payment opens nothing, and a suspended subscription can be replaced', async () => {
  const { db, pp } = setup()
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'SUSPENDED'
  pp.state.charge(sub.body.id, 4800, 'DECLINED')
  await webhook(db, sub.body.id, 'BILLING.SUBSCRIPTION.SUSPENDED')
  assert.equal(db.t.mediumia_formation_subscriptions[0].status, 'suspended')
  assert.equal(paidTotal(db), 2900)
  assert.equal(db.entitlements.length, 0)
  const again = await call(db, 'subscribe', { consent: true })
  assert.equal(again.statusCode, 201)
  assert.equal(pp.state.subs[sub.body.id].status, 'CANCELLED', 'the suspended one is closed at PayPal first')
})

test('stopping cancels at PayPal; resuming after 2 instalments schedules 9 × 48 € then 40 €', async () => {
  const { db, pp } = setup({ monthlyPaid: 2 })
  const first = await call(db, 'subscribe', { consent: true })
  pp.state.subs[first.body.id].status = 'ACTIVE'
  await webhook(db, first.body.id, 'BILLING.SUBSCRIPTION.ACTIVATED')
  const stop = await call(db, 'cancel', {})
  assert.equal(stop.statusCode, 200)
  assert.equal(pp.state.subs[first.body.id].status, 'CANCELLED')
  assert.equal(db.t.mediumia_formation_subscriptions[0].status, 'cancelled')
  const again = await call(db, 'subscribe', { consent: true })
  const cycles = pp.state.subs[again.body.id].plan.billing_cycles
  assert.deepEqual([cycles[0].total_cycles, cycles[1].pricing_scheme.fixed_price.value], [9, '40.00'])
})

test('"unlock everything" with a running subscription: the subscription stops first, exactly the rest is charged', async () => {
  const { db, pp } = setup({ monthlyPaid: 2 })
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  const order = await call(db, 'unlock-create', { consent: true })
  assert.deepEqual([order.statusCode, order.body.amountCents], [201, 47200])
  const done = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.deepEqual([done.statusCode, done.body.maxModule, done.body.paidCents, done.body.complete], [200, 25, 59700, true])
  const cancelIdx = pp.state.calls.findIndex(([, path]) => path.endsWith(`${sub.body.id}/cancel`))
  const captureIdx = pp.state.calls.findIndex(([, path]) => path.endsWith('/capture'))
  assert.ok(cancelIdx > -1 && cancelIdx < captureIdx, 'cancelled before the capture')
  assert.equal(db.entitlements[0].max_module, 25)
})

test('if an instalment lands before the capture, nothing is charged and the new rest is shown', async () => {
  const { db, pp } = setup({ monthlyPaid: 2 })
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  const order = await call(db, 'unlock-create', { consent: true })
  pp.state.charge(sub.body.id, 4800) // collected just before the student approves
  const r = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.deepEqual([r.statusCode, r.body.error, r.body.remainingCents], [409, 'amount_changed', 42400])
  assert.equal(pp.state.calls.some(([, path]) => path.endsWith('/capture')), false, 'never captured')
  assert.equal(paidTotal(db), 17300)
})

test('never a cent above 597 €: the final step ends everything, no further charge is possible', async () => {
  const { db, pp } = setup({ monthlyPaid: 10 })
  const sub = await call(db, 'subscribe', { consent: true })
  const cycles = pp.state.subs[sub.body.id].plan.billing_cycles
  assert.deepEqual([cycles[0].total_cycles, cycles[1].pricing_scheme.fixed_price.value], [1, '40.00'])
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  pp.state.charge(sub.body.id, 4800)
  pp.state.charge(sub.body.id, 4000)
  await webhook(db, sub.body.id)
  assert.equal(paidTotal(db), 59700)
  assert.equal(db.entitlements[0].max_module, 25)
  assert.equal(pp.state.subs[sub.body.id].status, 'CANCELLED', 'the safety net stops the subscription at the cap')
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'already_complete')
  assert.equal((await call(db, 'unlock-create', { consent: true })).body.error, 'already_complete')
})

test('an over-cap charge is flagged and the subscription stopped', async () => {
  const { db, pp } = setup({ monthlyPaid: 11 })
  // Anomaly: someone at 557 € with a subscription still billing 48 € (the last step is 40 €).
  db.t.mediumia_formation_subscriptions.push({ paypal_subscription_id: 'I-SUB999999', user_id: USER, paypal_env: 'sandbox', status: 'active', created_at: '2026-09-01T00:00:00Z' })
  pp.state.subs['I-SUB999999'] = { id: 'I-SUB999999', status: 'ACTIVE', custom_id: USER, transactions: [] }
  pp.state.charge('I-SUB999999', 4800)
  const r = await webhook(db, 'I-SUB999999')
  assert.equal(r.statusCode, 200)
  assert.equal(pp.state.subs['I-SUB999999'].status, 'CANCELLED')
})

test('the morning sync catches payments whose notification was missed', async () => {
  const { db, pp } = setup()
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  pp.state.charge(sub.body.id, 4800)
  const out = await syncLiveSubscriptions(db)
  assert.equal(out.synced, 1)
  assert.equal(db.entitlements[0].max_module, 3)
})

test('webhooks never trust their content and ignore unknown subscriptions', async () => {
  const { db } = setup()
  const r = await webhook(db, 'I-UNKNOWN123')
  assert.equal(r.statusCode, 200)
  assert.equal(paidTotal(db), 2900)
})

test('the student space may read the status and stop the parcours, other sites may not', async () => {
  const { db } = setup()
  const allowed = res()
  await handleFormationPath({ method: 'OPTIONS', headers: { origin: 'https://espace.mediumia.fr' }, body: {} }, allowed, 'status', db)
  assert.equal(allowed.statusCode, 204)
  const denied = res()
  await handleFormationPath({ method: 'OPTIONS', headers: { origin: 'https://evil.example' }, body: {} }, denied, 'status', db)
  assert.equal(denied.statusCode, 403)
  const payment = res()
  await handleFormationPath({ method: 'OPTIONS', headers: { origin: 'https://espace.mediumia.fr' }, body: {} }, payment, 'unlock-create', db)
  assert.equal(payment.statusCode, 403, 'payments stay on mediumia.fr')
})

test('students who already hold the whole course (conference pass, former code, founder) are complete: nothing is offered', async () => {
  const { db } = setup()
  db.t.mediumia_entitlements = [{ user_id: USER, type: 'purchase', origin_ref: 'conference-pass:live:CAP1', status: 'active', max_module: 25 }]
  const status = await call(db, 'status')
  assert.deepEqual([status.body.complete, status.body.maxModule, status.body.remainingCents], [true, 25, 0])
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'already_complete')
  assert.equal((await call(db, 'unlock-create', { consent: true })).body.error, 'already_complete')
})

test('only permanent complete origins count as "already complete"; temporary or unknown ones never do', () => {
  const r = (over) => ({ type: 'purchase', status: 'active', max_module: 25, access_started_at: '2026-09-10T00:00:00Z', access_expires_at: '2027-09-10T00:00:00Z', ...over })
  assert.equal(ownsCompleteFormation([r({ origin_ref: 'paypal:live:8XK123' })]), true)
  assert.equal(ownsCompleteFormation([r({ origin_ref: 'conference-pass:live:5TP9' })]), true)
  assert.equal(ownsCompleteFormation([r({ type: 'admin', origin_ref: 'founder:0b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b' })]), true)
  const annualCode = r({ type: 'legacy_code', origin_ref: 'hmac', access_level: 'full', access_started_at: '2026-08-30T00:00:00Z', access_expires_at: '2027-08-30T00:00:00Z' })
  assert.equal(ownsCompleteFormation([annualCode]), true)
  // The historical 597 € purchase has no exception in the code: the founder status covers it.
  const historical = r({ origin_ref: 'legacy-paypal:9AB12345CD', access_level: 'full', access_started_at: '2026-09-02T10:00:00Z', access_expires_at: '2027-08-14T10:00:00Z' })
  assert.equal(ownsCompleteFormation([historical, r({ type: 'admin', origin_ref: 'founder:0b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b', access_level: 'full' })]), true, 'with the founder status')
  for (const temp of [r({ origin_ref: 'paypal:sandbox:8XK123' }), r({ origin_ref: 'conference-pass:sandbox:5TP9' }), historical,
    { ...annualCode, access_level: 'discovery' },
    r({ origin_ref: 'v2:ab12' }), r({ type: 'admin', origin_ref: 'manual:gift' }), r({ origin_ref: 'promo:x' }), r({ origin_ref: 'paypal:live:discovery:X', max_module: 1 }), r({ type: 'legacy_code', origin_ref: 'hmac', access_expires_at: '2026-10-10T00:00:00Z' }), r({ origin_ref: 'paypal:live:8XK123', status: 'revoked' })]) {
    assert.equal(ownsCompleteFormation([temp]), false, temp.origin_ref)
  }
})

test('former Discoveries stay as sold (30 days); only a Discovery bought once the parcours is open gets its module 1 for good', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/paypalSandbox.js', import.meta.url), 'utf8')
  assert.match(src, /if \(cfg\.product === 'discovery' && pathEnv\(\)\) \{\s*await supabase\.rpc\('mediumia_set_path_entitlement'/)
  for (const file of ['20260925120000_formation_parcours_mensuel.sql', '20260926100000_formation_parcours_597.sql']) {
    const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(migration, /update public\.mediumia_entitlements[^;]*discovery[^;]*where[^;]*paypal:/i, 'no update of existing Discovery rows')
    assert.match(migration, /case when p_max_module = 1 then 'discovery' else 'full' end/)
  }
})

// ── Modèle 597 € : 29 € + 11 × 48 € + 40 € ─────────────────────────────────

test('public offer: 29 € then 11 × 48 €, last 40 €, 597 € in all; closed (404) while the switch is off', async () => {
  assert.deepEqual(publicOffer(), { capCents: 59700, discoveryCents: 2900, stepCents: 4800, regularCount: 11, finalCents: 4000 })
  const { db } = setup()
  const open = await call(db, 'offer', null, { auth: 'nobody' })
  assert.deepEqual([open.statusCode, open.body], [200, { enabled: true, ...publicOffer() }], 'no account needed to read the offer')
  process.env.VERCEL_ENV = 'production'
  delete process.env.PAYPAL_FORMATION_PATH_ENABLED
  try {
    const closed = await call(db, 'offer', null, { auth: 'nobody' })
    assert.equal(closed.statusCode, 404, 'production without the switch: nothing shown')
  } finally {
    delete process.env.VERCEL_ENV
  }
})

test('the PayPal plan is the new 597 € plan (11 × 48 € then 40 €), never the former 34 € one', async () => {
  const { db, pp } = setup()
  db.t.mediumia_paypal_plans.push({ paypal_env: 'sandbox', code: 'parcours-34x-final', paypal_product_id: 'OLD', paypal_plan_id: 'P-OLD34' })
  const sub = await call(db, 'subscribe', { consent: true })
  const plan = pp.state.calls.find(([method, path]) => method === 'POST' && path === '/v1/billing/plans')[2]
  assert.match(plan.name, /597 € maximum/)
  assert.deepEqual(plan.billing_cycles.map((c) => [c.tenure_type, c.total_cycles, c.pricing_scheme.fixed_price.value]), [['TRIAL', 11, '48.00'], ['REGULAR', 1, '40.00']])
  assert.equal(db.t.mediumia_formation_subscriptions[0].paypal_plan_id, 'P-PLAN1', 'the former plan is not reused')
  assert.ok(db.t.mediumia_paypal_plans.some((p) => p.code === 'parcours-48x-final-597'))
  assert.equal(pp.state.subs[sub.body.id].plan.billing_cycles[0].pricing_scheme.fixed_price.value, '48.00')
})

test('the Découverte must meet the 568 € credit criteria: same account, same environment, provisioned, real amount', async () => {
  for (const [label, purchase] of [
    ['no purchase recorded by the server', null],
    ['another account', { user_id: '99999999-9999-4999-8999-999999999999' }],
    ['other PayPal environment (live row seen from Sandbox)', { paypal_env: 'live', amount_cents: 2900 }],
    ['not provisioned', { status: 'captured' }],
    ['wrong amount', { amount_cents: 2900 }],
    ['not a Découverte', { product_code: 'full' }],
  ]) {
    const { db, pp } = setup({ purchase })
    const status = await call(db, 'status')
    assert.deepEqual([status.body.hasDiscovery, status.body.maxModule, status.body.paidCents], [false, 0, 0], label)
    const r = await call(db, 'subscribe', { consent: true })
    assert.equal(r.body.error, 'discovery_required', label)
    assert.equal(Object.keys(pp.state.subs).length, 0, `${label}: nothing created at PayPal`)
  }
})

test('a Découverte refunded at PayPal no longer counts: recorded as refunded, nothing is charged', async () => {
  const { db, pp } = setup()
  pp.state.captures['CAP-DISC'].status = 'REFUNDED'
  const r = await call(db, 'subscribe', { consent: true })
  assert.equal(r.body.error, 'discovery_required')
  assert.equal(Object.keys(pp.state.subs).length, 0)
  const refund = db.t.mediumia_formation_payments.find((p) => p.kind === 'refund')
  assert.deepEqual([refund.refunded_kind, refund.paypal_ref, refund.value_cents], ['discovery', 'refund:CAP-DISC', 2900])
  const status = await call(db, 'status')
  assert.deepEqual([status.body.hasDiscovery, status.body.paidCents, status.body.remainingCents], [false, 0, 59700])
  await call(db, 'subscribe', { consent: true })
  assert.equal(db.t.mediumia_formation_payments.filter((p) => p.kind === 'refund').length, 1, 'recorded once')
})

test('PayPal cannot confirm the Découverte: no subscription and no order are created', async () => {
  const { db, pp } = setup()
  pp.state.capturesDown = true
  const sub = await call(db, 'subscribe', { consent: true })
  const unlock = await call(db, 'unlock-create', { consent: true })
  assert.deepEqual([sub.statusCode, sub.body.error, unlock.statusCode, unlock.body.error], [502, 'discovery_check_unavailable', 502, 'discovery_check_unavailable'])
  assert.equal(Object.keys(pp.state.subs).length + Object.keys(pp.state.orders).length, 0)
  const status = await call(db, 'status')
  assert.equal(status.statusCode, 200, 'the page still shows the parcours')
})

test('Découverte refunded between « Tout débloquer » and the payment: nothing is captured', async () => {
  const { db, pp } = setup({ monthlyPaid: 3 })
  const order = await call(db, 'unlock-create', { consent: true })
  assert.equal(order.body.amountCents, 59700 - 2900 - 3 * 4800)
  pp.state.captures['CAP-DISC'].status = 'REFUNDED'
  const r = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.deepEqual([r.statusCode, r.body.error], [409, 'amount_changed'])
  assert.equal(pp.state.calls.some(([, path]) => path.endsWith('/capture')), false)
  assert.equal(db.t.mediumia_formation_unlock_orders[0].status, 'refused')
})

test('replaying a captured « Tout débloquer » changes nothing', async () => {
  const { db, pp } = setup({ monthlyPaid: 1 })
  const order = await call(db, 'unlock-create', { consent: true })
  await call(db, 'unlock-capture', { orderId: order.body.id })
  const again = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.equal(again.statusCode, 200)
  assert.equal(pp.state.calls.filter(([, path]) => path.endsWith('/capture')).length, 1)
  assert.equal(paidTotal(db), 59700)
})

test('two subscribe requests at the same time: one subscription stored, never two that could bill', async () => {
  const { db } = setup()
  const [a, b] = await Promise.all([call(db, 'subscribe', { consent: true }), call(db, 'subscribe', { consent: true })])
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 502])
  assert.equal(db.t.mediumia_formation_subscriptions.filter((s) => ['approval_pending', 'active'].includes(s.status)).length, 1)
})

test('stop then resume at any point: the new schedule always ends exactly at 597 €', async () => {
  for (let k = 0; k <= 10; k += 1) {
    const { db, pp } = setup({ monthlyPaid: k })
    const sub = await call(db, 'subscribe', { consent: true })
    const cycles = pp.state.subs[sub.body.id].plan.billing_cycles
    const total = 2900 + k * 4800 + cycles[0].total_cycles * Math.round(Number(cycles[0].pricing_scheme.fixed_price.value) * 100) + Math.round(Number(cycles[1].pricing_scheme.fixed_price.value) * 100)
    assert.deepEqual([cycles[0].total_cycles, cycles[1].pricing_scheme.fixed_price.value, total], [11 - k, '40.00', 59700], `after ${k} instalments`)
  }
  const { db } = setup({ monthlyPaid: 11 })
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'use_final_payment', 'after 11 instalments: one single 40 € payment')
  assert.equal((await call(db, 'unlock-create', { consent: true })).body.amountCents, 4000)
})

test('a complete one-off purchase stops a running parcours at PayPal and closes it', async () => {
  const { db, pp } = setup({ monthlyPaid: 2 })
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  const out = await settlePathAfterFullPurchase(db, 'sandbox', USER)
  assert.equal(out.stopped, 1)
  assert.equal(pp.state.subs[sub.body.id].status, 'CANCELLED')
  assert.equal(db.t.mediumia_formation_subscriptions[0].status, 'completed')
  assert.deepEqual(await settlePathAfterFullPurchase(db, 'sandbox', USER), { stopped: 0, paidCents: 12500 }, 'nothing left to stop')
})

test('a complete purchase on top of parcours payments is detected as an overpayment', async () => {
  const { db } = setup({ monthlyPaid: 2 })
  db.t.mediumia_formation_payments.push({ user_id: USER, paypal_env: 'sandbox', kind: 'full', amount_cents: 100, value_cents: 59700, paypal_ref: 'CAP-FULL', paid_at: '2026-12-01T10:00:00Z' })
  const out = await settlePathAfterFullPurchase(db, 'sandbox', USER)
  assert.equal(out.paidCents, 2900 + 2 * 4800 + 59700, 'total above 597 € → the owner is warned to refund the excess')
  const status = await call(db, 'status')
  assert.deepEqual([status.body.complete, status.body.remainingCents], [true, 0])
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'already_complete')
})

test('complete students (597 € or 568 € after the Découverte) are never charged again', async () => {
  for (const value of [59700, 56800]) {
    const { db, pp } = setup()
    db.t.mediumia_formation_payments.push({ user_id: USER, paypal_env: 'sandbox', kind: 'full', amount_cents: 100, value_cents: value, paypal_ref: `CAP-F${value}`, paid_at: '2026-10-01T10:00:00Z' })
    const status = await call(db, 'status')
    assert.deepEqual([status.body.complete, status.body.maxModule, status.body.remainingCents], [true, 25, 0])
    assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'already_complete')
    assert.equal((await call(db, 'unlock-create', { consent: true })).body.error, 'already_complete')
    assert.equal(Object.keys(pp.state.subs).length + Object.keys(pp.state.orders).length, 0)
  }
})

test('the abandoned 397 / 368 / 34 € amounts appear nowhere in the parcours code, page or migration', async () => {
  const { readFileSync } = await import('node:fs')
  const code = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const f of ['lib/formationProgression.js', 'lib/formationPath.js', 'lib/discoveryEligibility.js', 'src/components/FormationParcoursPage.jsx', 'src/components/ParcoursOffer.jsx', 'src/lib/parcoursOffer.js']) {
    const src = code(f)
    assert.doesNotMatch(src, /\b(397|368|39700|36800|3400)\b|34 €|28\.00|34\.00/, f)
  }
  const migration = readFileSync(new URL('../supabase/migrations/20260926100000_formation_parcours_597.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '')
  assert.doesNotMatch(migration, /\b(397|368|39700|36800)\b/)
  assert.match(migration, /step_cents = 4800\s+and regular_count between 1 and 11\s+and final_cents between 1 and 4800\s+and regular_count \* step_cents \+ final_cents <= 56800/)
  assert.match(migration, /paypal_env = 'sandbox'\s+and step_cents = 3400/, 'the former 34 € rule survives only for Sandbox tests')
  assert.match(migration, /amount_cents between 1 and 56800/)
})

test('a Découverte refunded mid-parcours: the student keeps going, its 29 € join what is left, 597 € in all', async () => {
  const { db, pp } = setup({ monthlyPaid: 3 })
  pp.state.captures['CAP-DISC'].status = 'REFUNDED'
  const sub = await call(db, 'subscribe', { consent: true })
  assert.equal(sub.statusCode, 201)
  const cycles = pp.state.subs[sub.body.id].plan.billing_cycles
  const planned = cycles[0].total_cycles * 4800 + Math.round(Number(cycles[1].pricing_scheme.fixed_price.value) * 100)
  assert.equal(3 * 4800 + planned, 59700)
  const status = await call(db, 'status')
  assert.deepEqual([status.body.maxModule, status.body.remainingCents], [7, 59700 - 3 * 4800])
})

test('the 597 € migration is dated 26 September 2026, after the credit migration, and no version is used twice', async () => {
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()
  const versions = files.map((f) => f.slice(0, 14))
  assert.equal(new Set(versions).size, versions.length, 'unique versions')
  assert.ok(files.includes('20260926100000_formation_parcours_597.sql'))
  assert.ok(!files.some((f) => f.startsWith('20261001')), 'no migration dated in the future')
  assert.equal(versions.indexOf('20260926100000'), versions.indexOf('20260926090000') + 1, 'right after the 568 € credit migration')
  assert.equal(versions.at(-1), '20260926100000', 'the latest migration')
})

test('FAQ « payer en plusieurs fois » once the parcours is open: 29 €, 48 €/mois, 40 €, 597 € maximum, coach 12 months', async () => {
  const { parcoursFaqAnswer } = await import('../src/lib/parcoursOffer.js')
  const text = parcoursFaqAnswer(publicOffer()).replace(/\u00a0/g, ' ')
  for (const part of ['29 € pour commencer', '48 € par mois', 'dernière mensualité 40 €', '597 € TTC au total au maximum', 'le même prix que la Formation complète', 'arrêter à tout moment', 'ne payant que le reste', '12 mois après votre dernier paiement']) {
    assert.ok(text.includes(part), part)
  }
  const { readFileSync } = await import('node:fs')
  const page = readFileSync(new URL('../src/components/FormationPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /const items = offer \? FAQ\.map/, 'the new answer only replaces the current one when the offer is open')
  assert.match(page, /r: "Oui\. La Formation MediumIA est à 597 € TTC\. Paiement en plusieurs fois disponible avec PayPal selon éligibilité\." \}/, 'current answer kept while closed')
})

test('CGV « Parcours au mois »: draft only (not published), points to settle clearly marked', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const draft = readFileSync(new URL('../docs/legal/cgv-formation-parcours-au-mois.draft.html', import.meta.url), 'utf8')
  assert.ok(!existsSync(new URL('../public/cgv-formation-parcours-au-mois.draft.html', import.meta.url)))
  assert.match(draft, /noindex,nofollow/)
  assert.doesNotMatch(readFileSync(new URL('../public/cgv-formation.html', import.meta.url), 'utf8'), /Parcours au mois|4 bis/, 'published CGV unchanged until opening')
  assert.match(draft, /11 mensualités de 48 € TTC/)
  assert.match(draft, /dernière mensualité de 40 € TTC/)
  assert.match(draft, /597 € TTC au maximum/)
  assert.match(draft, /dans les meilleurs délais, et au plus tard sous 14 jours[^<]*<span class="a-valider">clause à valider juridiquement/)
  assert.match(draft, /prélevée au démarrage du parcours[^<]*<span class="a-valider">à confirmer en test PayPal Sandbox/)
  assert.match(draft, /12 mois à compter du dernier paiement encaissé/)
  assert.match(draft, /formation-parcours-597-2026-09-26/)
  assert.doesNotMatch(draft.replace(/<!--[\s\S]*?-->/g, ''), /\b(397|368)\b/)
})
