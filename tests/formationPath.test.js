import test from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
process.env.PAYPAL_CLIENT_ID = 'client'
process.env.PAYPAL_CLIENT_SECRET = 'secret'
delete process.env.VERCEL_ENV
delete process.env.RESEND_API_KEY

const { handleFormationPath, syncLiveSubscriptions, ownsCompleteFormation } = await import('../lib/formationPath.js')

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
  const state = { subs: {}, orders: {}, calls: [], nextSub: 1, nextOrder: 1, nextTx: 1 }
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

function setup({ monthlyPaid = 0 } = {}) {
  const payments = [{ user_id: USER, paypal_env: 'sandbox', kind: 'discovery', amount_cents: 100, value_cents: 2900, paypal_ref: 'CAP-DISC', paid_at: '2026-09-01T10:00:00Z' }]
  for (let i = 0; i < monthlyPaid; i += 1) payments.push({ user_id: USER, paypal_env: 'sandbox', kind: 'monthly', amount_cents: 3400, value_cents: 3400, paypal_ref: `OLD${i}`, paid_at: `2026-${10 + i}-01T10:00:00Z` })
  const db = makeDb({ mediumia_formation_payments: payments })
  const pp = makePayPal()
  globalThis.fetch = pp.fetchImpl
  return { db, pp }
}

const webhook = (db, subId, type = 'PAYMENT.SALE.COMPLETED') => call(db, 'webhook', { event_type: type, resource: type.startsWith('BILLING') ? { id: subId } : { billing_agreement_id: subId } }, { auth: 'none' })
const paidTotal = (db) => db.t.mediumia_formation_payments.reduce((n, p) => n + (p.kind === 'refund' ? -p.value_cents : p.value_cents), 0)

test('successful first instalment opens modules 2-3; the schedule is 10 × 34 € then 28 €', async () => {
  const { db, pp } = setup()
  const status = await call(db, 'status')
  assert.deepEqual([status.statusCode, status.body.maxModule, status.body.remainingCents, status.body.schedule.regularCount, status.body.schedule.finalCents], [200, 1, 36800, 10, 2800])
  const sub = await call(db, 'subscribe', { consent: true })
  assert.equal(sub.statusCode, 201)
  const created = pp.state.subs[sub.body.id]
  assert.equal(created.custom_id, USER)
  assert.deepEqual(created.plan.billing_cycles.map((c) => [c.sequence, c.total_cycles, c.pricing_scheme.fixed_price.value]), [[1, 10, '34.00'], [2, 1, '28.00']])
  created.status = 'ACTIVE'
  pp.state.charge(sub.body.id, 3400)
  const act = await call(db, 'activate', { subscriptionId: sub.body.id })
  assert.deepEqual([act.statusCode, act.body.maxModule, act.body.paidCents], [200, 3, 6300])
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
  pp.state.charge(sub.body.id, 3400)
  await webhook(db, sub.body.id)
  await webhook(db, sub.body.id)
  assert.equal(db.t.mediumia_formation_payments.filter((p) => p.kind === 'monthly').length, 1)
  assert.equal(paidTotal(db), 6300)
})

test('a declined payment opens nothing, and a suspended subscription can be replaced', async () => {
  const { db, pp } = setup()
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'SUSPENDED'
  pp.state.charge(sub.body.id, 3400, 'DECLINED')
  await webhook(db, sub.body.id, 'BILLING.SUBSCRIPTION.SUSPENDED')
  assert.equal(db.t.mediumia_formation_subscriptions[0].status, 'suspended')
  assert.equal(paidTotal(db), 2900)
  assert.equal(db.entitlements.length, 0)
  const again = await call(db, 'subscribe', { consent: true })
  assert.equal(again.statusCode, 201)
  assert.equal(pp.state.subs[sub.body.id].status, 'CANCELLED', 'the suspended one is closed at PayPal first')
})

test('stopping cancels at PayPal; resuming after 2 instalments schedules 8 × 34 € then 28 €', async () => {
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
  assert.deepEqual([cycles[0].total_cycles, cycles[1].pricing_scheme.fixed_price.value], [8, '28.00'])
})

test('"unlock everything" with a running subscription: the subscription stops first, exactly the rest is charged', async () => {
  const { db, pp } = setup({ monthlyPaid: 2 })
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  const order = await call(db, 'unlock-create', { consent: true })
  assert.deepEqual([order.statusCode, order.body.amountCents], [201, 30000])
  const done = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.deepEqual([done.statusCode, done.body.maxModule, done.body.paidCents, done.body.complete], [200, 25, 39700, true])
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
  pp.state.charge(sub.body.id, 3400) // collected just before the student approves
  const r = await call(db, 'unlock-capture', { orderId: order.body.id })
  assert.deepEqual([r.statusCode, r.body.error, r.body.remainingCents], [409, 'amount_changed', 26600])
  assert.equal(pp.state.calls.some(([, path]) => path.endsWith('/capture')), false, 'never captured')
  assert.equal(paidTotal(db), 13100)
})

test('never a cent above 397 €: the final step ends everything, no further charge is possible', async () => {
  const { db, pp } = setup({ monthlyPaid: 9 })
  const sub = await call(db, 'subscribe', { consent: true })
  const cycles = pp.state.subs[sub.body.id].plan.billing_cycles
  assert.deepEqual([cycles[0].total_cycles, cycles[1].pricing_scheme.fixed_price.value], [1, '28.00'])
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  pp.state.charge(sub.body.id, 3400)
  pp.state.charge(sub.body.id, 2800)
  await webhook(db, sub.body.id)
  assert.equal(paidTotal(db), 39700)
  assert.equal(db.entitlements[0].max_module, 25)
  assert.equal(pp.state.subs[sub.body.id].status, 'CANCELLED', 'the safety net stops the subscription at the cap')
  assert.equal((await call(db, 'subscribe', { consent: true })).body.error, 'already_complete')
  assert.equal((await call(db, 'unlock-create', { consent: true })).body.error, 'already_complete')
})

test('an over-cap charge is flagged and the subscription stopped', async () => {
  const { db, pp } = setup({ monthlyPaid: 10 })
  // Legacy state: someone at 369 € with a subscription still billing 34 €.
  db.t.mediumia_formation_subscriptions.push({ paypal_subscription_id: 'I-SUB999999', user_id: USER, paypal_env: 'sandbox', status: 'active', created_at: '2026-09-01T00:00:00Z' })
  pp.state.subs['I-SUB999999'] = { id: 'I-SUB999999', status: 'ACTIVE', custom_id: USER, transactions: [] }
  pp.state.charge('I-SUB999999', 3400)
  const r = await webhook(db, 'I-SUB999999')
  assert.equal(r.statusCode, 200)
  assert.equal(pp.state.subs['I-SUB999999'].status, 'CANCELLED')
})

test('the morning sync catches payments whose notification was missed', async () => {
  const { db, pp } = setup()
  const sub = await call(db, 'subscribe', { consent: true })
  pp.state.subs[sub.body.id].status = 'ACTIVE'
  pp.state.charge(sub.body.id, 3400)
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
  assert.equal(ownsCompleteFormation([r({ type: 'legacy_code', origin_ref: 'hmac', access_started_at: '2026-08-30T00:00:00Z', access_expires_at: '2027-08-30T00:00:00Z' })]), true)
  assert.equal(ownsCompleteFormation([r({ origin_ref: 'legacy-paypal:9AB12345CD', access_level: 'full', access_started_at: '2026-09-02T10:00:00Z', access_expires_at: '2027-08-14T10:00:00Z' })]), true, 'historical 597 € purchase')
  for (const temp of [r({ origin_ref: 'paypal:sandbox:8XK123' }), r({ origin_ref: 'conference-pass:sandbox:5TP9' }),
    r({ origin_ref: 'legacy-paypal:9AB12345CD', access_level: 'full', access_started_at: '2026-10-01T00:00:00Z' }),
    r({ origin_ref: 'legacy-paypal:9AB12345CD', access_level: 'full', access_started_at: '2026-09-02T10:00:00Z', status: 'expired' }),
    r({ origin_ref: 'v2:ab12' }), r({ type: 'admin', origin_ref: 'manual:gift' }), r({ origin_ref: 'promo:x' }), r({ origin_ref: 'paypal:live:discovery:X', max_module: 1 }), r({ type: 'legacy_code', origin_ref: 'hmac', access_expires_at: '2026-10-10T00:00:00Z' }), r({ origin_ref: 'paypal:live:8XK123', status: 'revoked' })]) {
    assert.equal(ownsCompleteFormation([temp]), false, temp.origin_ref)
  }
})

test('former Discoveries stay as sold (30 days); only a Discovery bought once the parcours is open gets its module 1 for good', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/paypalSandbox.js', import.meta.url), 'utf8')
  assert.match(src, /if \(cfg\.product === 'discovery' && pathEnv\(\)\) \{\s*await supabase\.rpc\('mediumia_set_path_entitlement'/)
  const migration = readFileSync(new URL('../supabase/migrations/20260925120000_formation_parcours_mensuel.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(migration, /update public\.mediumia_entitlements[^;]*discovery[^;]*where[^;]*paypal:/i, 'no update of existing Discovery rows')
  assert.match(migration, /case when p_max_module = 1 then 'discovery' else 'full' end/)
})
