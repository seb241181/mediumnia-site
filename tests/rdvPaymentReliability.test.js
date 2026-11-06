/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  captureRdvDepositPayPalOrder,
  classifyRdvCaptureFailure,
  diagnoseRdvDepositPayPalReadOrder,
  rdvDepositCaptureRequestId,
} from '../lib/rdvDepositPayPal.js'
import { handlePayPalLiveReadDiagnostic, handleRdvDepositApi, reconcileStaleRdvCaptures, slotUnavailable, supersedeOwnPendingHolds } from '../lib/rdvDepositApiHandler.js'
import { buildCheckoutEvent, clientKind } from '../lib/rdvCheckoutEvents.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ORDER = 'ORDER-TEST-1234'
const realFetch = globalThis.fetch

// ── Faux PayPal ─────────────────────────────────────────────────────────────
function fakePayPal({ capture, order }) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {} })
    if (u.endsWith('/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
    if (u.endsWith('/capture')) {
      if (capture === 'network') throw new Error('network')
      return { ok: capture.status < 300, status: capture.status, json: async () => capture.body }
    }
    if (u.includes('/v2/checkout/orders/')) {
      if (order === 'network') throw new Error('network')
      return { ok: order.status < 300, status: order.status, json: async () => order.body }
    }
    throw new Error(`unexpected ${u}`)
  }
  return calls
}
const completedOrder = (amount = '20.00') => ({
  id: ORDER,
  status: 'COMPLETED',
  purchase_units: [{ reference_id: 'MEDIUMIA_RDV_ARRHES_SANDBOX', custom_id: 'MEDIUMIA:RDV-ARRHES:hold-1', payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: amount }, create_time: '2026-11-06T10:00:00Z' }] } }],
})
const declined = (issue) => ({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue }] } })

test.beforeEach(() => {
  delete process.env.VERCEL_ENV
  process.env.PAYPAL_CLIENT_ID = 'client'
  process.env.PAYPAL_CLIENT_SECRET = 'secret'
})
test.after(() => { globalThis.fetch = realFetch })

// ── Classement des issues de capture ────────────────────────────────────────
test('classement : seul un refus PayPal confirmé par la commande est « certain »', () => {
  const approved = { status: 'APPROVED', purchase_units: [{}] }
  const restart = classifyRdvCaptureFailure({ captureStatus: 422, captureData: declined('INSTRUMENT_DECLINED').body, orderStatus: 'APPROVED', orderData: approved })
  assert.deepEqual([restart.code, restart.outcome, restart.restartable], ['paypal_instrument_declined', 'definite', true])
  const refused = classifyRdvCaptureFailure({ captureStatus: 422, captureData: declined('TRANSACTION_REFUSED').body, orderStatus: 'APPROVED', orderData: approved })
  assert.deepEqual([refused.code, refused.outcome, refused.restartable], ['paypal_transaction_refused', 'definite', false])
  assert.equal(classifyRdvCaptureFailure({ captureStatus: 422, orderStatus: 'VOIDED', orderData: { status: 'VOIDED', purchase_units: [{}] } }).code, 'paypal_order_voided')
  // Pas de réponse, erreur serveur PayPal ou commande illisible : jamais « certain ».
  for (const input of [{ captureStatus: null, orderStatus: 'APPROVED' }, { captureStatus: 500, orderStatus: 'APPROVED' }, { captureStatus: 422, orderStatus: null },
    { captureStatus: 409, captureData: { name: 'PREVIOUS_REQUEST_IN_PROGRESS' }, orderStatus: 'APPROVED', orderData: approved },
    { captureStatus: 422, captureData: declined('INSTRUMENT_DECLINED').body, orderStatus: 'APPROVED', orderData: { ...approved, purchase_units: [{ payments: { captures: [{ id: 'capture-in-flight' }] } }] } },
    { captureStatus: 422, captureData: { name: 'UNPROCESSABLE_ENTITY' }, orderStatus: 'APPROVED', orderData: approved },
    { captureStatus: 422, captureData: declined('INSTRUMENT_DECLINED').body, orderStatus: 'APPROVED', orderData: { status: 'APPROVED' } }]) {
    const error = classifyRdvCaptureFailure(input)
    assert.deepEqual([error.code, error.outcome], ['paypal_capture_uncertain', 'uncertain'], JSON.stringify(input))
  }
})

test('clé d’idempotence : inchangée au 1er essai, nouvelle après un refus', () => {
  assert.equal(rdvDepositCaptureRequestId(ORDER, 1), `rdv-deposit-capture-${ORDER}`)
  assert.equal(rdvDepositCaptureRequestId(ORDER), `rdv-deposit-capture-${ORDER}`)
  assert.equal(rdvDepositCaptureRequestId(ORDER, 2), `rdv-deposit-capture-${ORDER}-2`)
})

test('capture : carte refusée par PayPal = refus certain, clé de la tentative 2', async () => {
  const calls = fakePayPal({ capture: declined('INSTRUMENT_DECLINED'), order: { status: 200, body: { id: ORDER, status: 'APPROVED', purchase_units: [{}] } } })
  await assert.rejects(captureRdvDepositPayPalOrder(ORDER, { attempt: 2 }), (error) => error.code === 'paypal_instrument_declined' && error.outcome === 'definite' && error.restartable)
  const capture = calls.find((c) => c.url.endsWith('/capture'))
  assert.equal(capture.headers['PayPal-Request-Id'], `rdv-deposit-capture-${ORDER}-2`)
  // Version Production : aucune réponse simulée n'est jamais demandée à PayPal.
  assert.equal(capture.headers['PayPal-Mock-Response'], undefined)
})
test('capture : réponse perdue mais commande encaissée = succès, jamais un refus', async () => {
  fakePayPal({ capture: 'network', order: { status: 200, body: completedOrder() } })
  const result = await captureRdvDepositPayPalOrder(ORDER)
  assert.equal(result.data.status, 'COMPLETED')
  fakePayPal({ capture: declined('ORDER_ALREADY_CAPTURED'), order: { status: 200, body: completedOrder() } })
  assert.equal((await captureRdvDepositPayPalOrder(ORDER, { attempt: 2 })).data.status, 'COMPLETED')
})

test('capture : réponse perdue et commande illisible = incertain', async () => {
  fakePayPal({ capture: 'network', order: 'network' })
  await assert.rejects(captureRdvDepositPayPalOrder(ORDER), (error) => error.outcome === 'uncertain')
})

test('capture : 409 PayPal et relecture APPROVED restent incertains, même sans capture visible', async () => {
  const calls = fakePayPal({ capture: { status: 409, body: { name: 'PREVIOUS_REQUEST_IN_PROGRESS' } }, order: { status: 200, body: { id: ORDER, status: 'APPROVED', purchase_units: [{}] } } })
  await assert.rejects(captureRdvDepositPayPalOrder(ORDER), (error) => error.outcome === 'uncertain' && error.code === 'paypal_capture_uncertain')
  assert.equal(calls.filter((call) => call.url.endsWith('/capture')).length, 1, 'aucun second POST de capture')
})

test('capture Live : une demande de simulation est sans effet', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENABLED: 'true', PAYPAL_RDV_DEPOSIT_ENV: 'live' })
  const calls = fakePayPal({ capture: { status: 201, body: { ...completedOrder(), purchase_units: [] } }, order: { status: 200, body: completedOrder() } })
  await captureRdvDepositPayPalOrder(ORDER, { mock: 'CAPTURE_TIMEOUT' })
  const capture = calls.find((c) => c.url.endsWith('/capture'))
  assert.ok(capture, 'la vraie capture a lieu')
  assert.equal(capture.headers['PayPal-Mock-Response'], undefined)
  assert.ok(capture.url.startsWith('https://api-m.paypal.com/'))
})

// ── Diagnostic Live temporaire, OAuth + GET uniquement ────────────────────
test('diagnostic Live : OAuth refusé expose seulement HTTP + catégorie et ne peut pas atteindre un endpoint financier', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENABLED: 'true', PAYPAL_RDV_DEPOSIT_ENV: 'live' })
  const calls = []
  const result = await diagnoseRdvDepositPayPalReadOrder(ORDER, {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' })
      return { ok: false, status: 401, json: async () => ({ name: 'ignored' }) }
    },
  })
  assert.deepEqual(result, { stage: 'oauth', httpStatus: 401, category: 'oauth_credentials_rejected' })
  assert.deepEqual(calls.map((call) => call.method), ['POST'])
  assert.ok(calls[0].url.endsWith('/v1/oauth2/token'))
  assert.doesNotMatch(calls.map((call) => call.url).join('\n'), /capture|refund/i)
})

test('diagnostic Live : OAuth réussi puis GET refusé ne révèle pas la commande et ne peut ni capturer ni rembourser', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENABLED: 'true', PAYPAL_RDV_DEPOSIT_ENV: 'live' })
  const calls = []
  const result = await diagnoseRdvDepositPayPalReadOrder(ORDER, {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' })
      if (String(url).endsWith('/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'token-never-returned' }) }
      return { ok: false, status: 404, json: async () => ({ name: 'ignored' }) }
    },
  })
  assert.deepEqual(result, { stage: 'order', httpStatus: 404, category: 'order_not_found' })
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET'])
  assert.ok(calls[1].url.includes('/v2/checkout/orders/'))
  assert.doesNotMatch(calls.map((call) => call.url).join('\n'), /capture|refund/i)
  assert.doesNotMatch(JSON.stringify(result), /token|ORDER-TEST/)
})

// ── Gestionnaire de capture ─────────────────────────────────────────────────
function fakeDb({ claim = { ok: true, hold_id: 'hold-1' }, convert = { ok: true, booking_id: 'booking-1' }, payment } = {}) {
  const rpc = []
  const events = []
  const db = {
    // Comme supabase-js : un « thenable » sans .catch() (un .catch direct plantait en TEST).
    rpc: (name, args) => {
      rpc.push({ name, args })
      const value = name === 'claim_rdv_deposit_capture' ? { data: claim, error: null }
        : name === 'next_rdv_capture_attempt' ? { data: 2, error: null }
          : name === 'release_rdv_deposit_capture' ? { data: { ok: true }, error: null }
            : name === 'convert_rdv_deposit_hold' ? { data: convert, error: null }
              : name === 'supersede_rdv_own_pending_holds' ? { data: 1, error: null }
                : { data: null, error: null }
      return { then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }
    },
    from(table) {
      const q = {
        select: () => q, eq: () => q, is: () => q, in: () => q, gt: () => q, lt: () => q, limit: () => q,
        insert: async (row) => { if (table === 'rdv_checkout_events') events.push(row); return { error: null } },
        single: async () => (table === 'rdv_paypal_payments'
          ? { data: payment || { paypal_env: 'sandbox', amount_cents: 2000, currency: 'EUR', client_checkout_id: 'abcdef12-1111-4111-8111-111111111111', hold: { id: 'hold-1', practitioner_id: 'pract-1', starts_at: '2026-12-01T14:00:00Z' } }, error: null }
          : { data: null, error: { code: 'x' } }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve) => resolve({ data: table === 'rdv_booking_holds' ? db.holds || [] : [], error: null }),
      }
      return q
    },
  }
  return { db, rpc, events }
}
function response() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}

test('diagnostic temporaire : lookup serveur borné, réponse assainie, aucune mutation Supabase', async () => {
  const calls = []
  const db = {
    rpc: () => { throw new Error('rpc interdit') },
    from(table) {
      assert.equal(table, 'rdv_paypal_payments')
      const q = {
        select: (columns) => { calls.push(['select', columns]); return q },
        eq: (column, value) => { calls.push(['eq', column, value]); return q },
        like: (column, value) => { calls.push(['like', column, value]); return q },
        limit: async (count) => { calls.push(['limit', count]); return { data: [{ paypal_order_id: ORDER, paypal_env: 'live' }], error: null } },
        update: () => { throw new Error('update interdit') },
        insert: () => { throw new Error('insert interdit') },
        delete: () => { throw new Error('delete interdit') },
      }
      return q
    },
  }
  const res = response()
  await handlePayPalLiveReadDiagnostic({}, res, db, { diagnose: async () => ({ stage: 'order', httpStatus: 404, category: 'order_not_found', leaked: ORDER }) })
  assert.deepEqual(res.body, { stage: 'order', httpStatus: 404, category: 'order_not_found' })
  assert.deepEqual(calls, [['select', 'paypal_order_id, paypal_env'], ['eq', 'paypal_env', 'live'], ['like', 'paypal_order_id', '%7357'], ['limit', 2]])
  assert.doesNotMatch(JSON.stringify(res.body), /ORDER-TEST/)
})

test('diagnostic temporaire : inaccessible sans authentification serveur avant toute lecture', async () => {
  Object.assign(process.env, {
    VERCEL_ENV: 'production', PAYPAL_RDV_DEPOSIT_ENABLED: 'true', PAYPAL_RDV_DEPOSIT_ENV: 'live',
    SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', CRON_SECRET: 'server-only-test-secret',
  })
  const res = response()
  await handleRdvDepositApi({ method: 'POST', body: {}, headers: {}, query: {} }, res, 'diagnostic')
  assert.deepEqual([res.statusCode, res.body], [401, { error: 'unauthorized' }])
})

async function capture(db, body = { orderId: ORDER }) {
  const res = response()
  const { handleCaptureForTest } = await import('../lib/rdvDepositApiHandler.js')
  await handleCaptureForTest({ method: 'POST', body, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, query: {} }, res, db)
  return res
}

test('gestionnaire : carte refusée → créneau rendu au client, relance PayPal proposée, journal sans donnée personnelle', async () => {
  fakePayPal({ capture: declined('INSTRUMENT_DECLINED'), order: { status: 200, body: { id: ORDER, status: 'APPROVED', purchase_units: [{}] } } })
  const { db, rpc, events } = fakeDb()
  const res = await capture(db)
  assert.deepEqual([res.statusCode, res.body], [402, { error: 'paypal_instrument_declined', restartable: true }])
  assert.deepEqual(rpc.find((c) => c.name === 'release_rdv_deposit_capture').args, { p_paypal_order_id: ORDER, p_next: 'payment_pending', p_error_code: 'paypal_instrument_declined' })
  assert.equal(rpc.some((c) => c.name === 'convert_rdv_deposit_hold'), false)
  assert.deepEqual(events.map((e) => [e.action, e.error_code, e.client_kind, e.checkout_ref]), [['capture', 'paypal_instrument_declined', 'mobile', 'abcdef12']])
  assert.doesNotMatch(JSON.stringify(events), /ORDER-TEST|@|hold-1/)
})

test('gestionnaire : issue incertaine → rien n’est libéré ni relancé, le rapprochement tranchera', async () => {
  fakePayPal({ capture: 'network', order: 'network' })
  const { db, rpc } = fakeDb()
  const res = await capture(db)
  assert.deepEqual([res.statusCode, res.body.status], [202, 'CAPTURE_UNCERTAIN'])
  assert.equal(rpc.some((c) => c.name === 'release_rdv_deposit_capture'), false)
  assert.deepEqual(rpc.find((c) => c.name === 'note_rdv_payment_error').args, { p_paypal_order_id: ORDER, p_error_code: 'paypal_capture_uncertain' })
})

test('gestionnaire : 409 simultané ne libère pas le créneau et ne relance pas la capture', async () => {
  const calls = fakePayPal({ capture: { status: 409, body: { name: 'PREVIOUS_REQUEST_IN_PROGRESS' } }, order: { status: 200, body: { id: ORDER, status: 'APPROVED', purchase_units: [{}] } } })
  const { db, rpc } = fakeDb()
  const res = await capture(db)
  assert.equal(res.body.status, 'CAPTURE_UNCERTAIN')
  assert.equal(rpc.some((call) => call.name === 'release_rdv_deposit_capture'), false)
  assert.equal(calls.filter((call) => call.url.endsWith('/capture')).length, 1)
})

test('captures simultanées : la seconde voit la réclamation en cours et n’envoie aucun POST PayPal', async () => {
  const calls = fakePayPal({ capture: { status: 201, body: completedOrder() }, order: { status: 200, body: completedOrder() } })
  const { db, rpc } = fakeDb()
  const originalRpc = db.rpc
  let claims = 0
  db.rpc = (name, args) => {
    if (name === 'claim_rdv_deposit_capture' && ++claims === 2) {
      rpc.push({ name, args })
      return { then: (resolve) => resolve({ data: { ok: true, capturing: true }, error: null }) }
    }
    return originalRpc(name, args)
  }
  const responses = await Promise.all([capture(db), capture(db)])
  assert.deepEqual(responses.map((res) => res.body.status).sort(), ['CAPTURE_IN_PROGRESS', 'COMPLETED'])
  assert.equal(calls.filter((call) => call.url.endsWith('/capture')).length, 1)
  assert.equal(rpc.filter((call) => call.name === 'convert_rdv_deposit_hold').length, 1)
})

test('gestionnaire : encaissé mais confirmation impossible → jamais libéré, client rassuré', async () => {
  fakePayPal({ capture: { status: 201, body: completedOrder() }, order: { status: 200, body: completedOrder() } })
  const { db, rpc } = fakeDb({ convert: { ok: false, error: 'booking_conversion_failed' } })
  const res = await capture(db)
  assert.deepEqual([res.statusCode, res.body.error], [202, 'payment_received_pending'])
  assert.equal(rpc.some((c) => c.name === 'release_rdv_deposit_capture'), false)
  assert.equal(rpc.find((c) => c.name === 'note_rdv_payment_error').args.p_error_code, 'captured_booking_conversion_failed')
})

test('gestionnaire : double clic après confirmation → aucune seconde capture', async () => {
  const calls = fakePayPal({ capture: { status: 201, body: completedOrder() }, order: { status: 200, body: completedOrder() } })
  const { db, rpc } = fakeDb({ claim: { ok: true, capturing: true } })
  const res = await capture(db)
  assert.deepEqual([res.statusCode, res.body.status], [202, 'CAPTURE_IN_PROGRESS'])
  assert.equal(calls.length, 0)
  assert.equal(rpc.some((c) => c.name === 'next_rdv_capture_attempt'), false)
})

test('gestionnaire : commande d’une tentative remplacée → « tentative expirée », rien n’est capturé', async () => {
  const calls = fakePayPal({ capture: { status: 201, body: completedOrder() }, order: { status: 200, body: completedOrder() } })
  const { db } = fakeDb({ claim: { ok: false, error: 'hold_not_capturable' } })
  const res = await capture(db)
  assert.deepEqual([res.statusCode, res.body.error], [409, 'checkout_expired'])
  assert.equal(calls.length, 0)
})

// ── Nouvelle tentative et créneau tenu ──────────────────────────────────────
test('nouvelle tentative : la tentative précédente du même client est remplacée (e-mail normalisé)', async () => {
  const { db, rpc } = fakeDb()
  const slot = { startsAt: new Date('2026-12-01T14:00:00Z'), endsAt: new Date('2026-12-01T15:00:00Z') }
  assert.equal(await supersedeOwnPendingHolds(db, { practitionerId: 'pract-1', slot, email: ' Cliente@Example.org ', checkoutId: 'c-2' }), 1)
  assert.deepEqual(rpc[0].args, { p_practitioner_id: 'pract-1', p_starts_at: '2026-12-01T14:00:00.000Z', p_ends_at: '2026-12-01T15:00:00.000Z', p_customer_email: 'cliente@example.org', p_client_checkout_id: 'c-2' })
  const handler = read('lib/rdvDepositApiHandler.js')
  assert.ok(handler.indexOf('supersedeOwnPendingHolds(supabase') < handler.indexOf("rpc('create_rdv_deposit_hold'"), 'remplacement avant la création')
  const full = read('lib/rdvFullPaymentApiHandler.js')
  assert.ok(full.indexOf('supersedeOwnPendingHolds(supabase') < full.indexOf("rpc('create_rdv_full_payment_hold'"))
})

test('créneau tenu par une autre personne → « en cours de réservation » avec heure de libération', async () => {
  const { db, events } = fakeDb()
  db.holds = [{ status: 'payment_pending', expires_at: '2026-12-01T13:20:00Z' }, { status: 'payment_pending', expires_at: '2026-12-01T13:25:00Z' }]
  const slot = { startsAt: new Date('2026-12-01T14:00:00Z'), endsAt: new Date('2026-12-01T15:00:00Z') }
  const res = response()
  await slotUnavailable(res, db, { practitionerId: 'pract-1', slot, context: { action: 'create', checkoutId: 'abcdef12-0000-4000-8000-000000000000' } })
  assert.deepEqual([res.statusCode, res.body], [409, { error: 'slot_held', retryAt: '2026-12-01T13:25:00Z' }])
  assert.equal(events[0].error_code, 'slot_held')
  db.holds = []
  const booked = response()
  await slotUnavailable(booked, db, { practitionerId: 'pract-1', slot, context: { action: 'create' } })
  assert.deepEqual(booked.body, { error: 'slot_unavailable' })
})

// ── Rapprochement ───────────────────────────────────────────────────────────
function reconcileDb(rows) {
  const rpc = []
  return {
    rpc,
    db: {
      rpc: async (name, args) => { rpc.push({ name, args }); return { data: name === 'convert_rdv_deposit_hold' ? { ok: true, booking_id: 'b-1' } : { ok: true }, error: null } },
      from() {
        const q = { select: () => q, eq: () => q, is: () => q, lt: () => q, limit: async () => ({ data: rows, error: null }) }
        return q
      },
    },
  }
}
const staleRow = (startsAt, captureAttempts = 1) => ({ paypal_order_id: 'ORDER-STALE-9876', paypal_env: 'sandbox', amount_cents: 2000, currency: 'EUR', client_checkout_id: 'cfc3f81d-0000-4000-8000-000000000000', capture_attempts: captureAttempts, hold: { id: 'hold-1', status: 'payment_capturing', expires_at: '2026-11-03T09:40:19Z', starts_at: startsAt } })
const sandboxCfg = { env: 'sandbox', referenceId: 'MEDIUMIA_RDV_ARRHES_SANDBOX' }

test('rapprochement : par défaut un simple rapport, rien n’est modifié', async () => {
  const { db, rpc } = reconcileDb([staleRow('2026-11-16T10:00:00Z')])
  const report = await reconcileStaleRdvCaptures(db, { now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => ({ cfg: sandboxCfg, data: { status: 'APPROVED' } }) })
  assert.deepEqual(report, [{ checkoutRef: 'cfc3f81d', orderRef: '…9876', slot: '2026-11-16T10:00:00Z', paypalStatus: 'APPROVED', action: 'manual_review:order_not_completed' }])
  assert.equal(rpc.length, 0)
})

test('cron rendez-vous : rapport uniquement, aucun drapeau ne peut appliquer une réconciliation', () => {
  const cron = read('lib/rdvBalanceCronHandler.js')
  assert.match(cron, /reconcileStaleRdvCaptures\(supabase, \{ apply: false \}\)/)
  assert.doesNotMatch(cron, /RDV_PAYMENT_RECONCILE_APPLY/)
})

test('rapprochement appliqué : commande APPROVED ne prouve pas absence de capture, créneau conservé', async () => {
  const { db, rpc } = reconcileDb([staleRow('2026-11-16T10:00:00Z')])
  const calls = fakePayPal({ capture: { status: 201, body: completedOrder() }, order: { status: 200, body: completedOrder() } })
  const report = await reconcileStaleRdvCaptures(db, { apply: true, now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => ({ cfg: sandboxCfg, data: { status: 'APPROVED' } }) })
  assert.equal(report[0].action, 'manual_review:order_not_completed')
  assert.equal(rpc.length, 0)
  assert.equal(calls.length, 0)
})

test('rapprochement appliqué : les captures historiques restent intactes, même COMPLETED', async () => {
  for (const status of ['APPROVED', 'COMPLETED']) {
    const { db, rpc } = reconcileDb([staleRow('2026-11-16T10:00:00Z', 0)])
    const report = await reconcileStaleRdvCaptures(db, { apply: true, now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => ({ cfg: sandboxCfg, data: { ...completedOrder(), status } }) })
    assert.equal(report[0].action, 'historical_report_only')
    assert.equal(rpc.length, 0, 'aucune conversion, libération, ni journalisation de l’ancien paiement')
  }
})

test('rapprochement appliqué : encaissé → rendez-vous confirmé (créneau futur) ou examen manuel (créneau passé)', async () => {
  const paid = { cfg: sandboxCfg, data: { ...completedOrder(), purchase_units: [{ ...completedOrder().purchase_units[0], custom_id: 'MEDIUMIA:RDV-ARRHES:hold-1' }] } }
  const finalized = []
  const future = reconcileDb([staleRow('2026-11-16T10:00:00Z')])
  const report = await reconcileStaleRdvCaptures(future.db, { apply: true, now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => paid, finalize: async (_db, order, booking) => finalized.push([order, booking]) })
  assert.equal(report[0].action, 'converted')
  assert.equal(future.rpc[0].name, 'convert_rdv_deposit_hold')
  assert.deepEqual(finalized, [['ORDER-STALE-9876', 'b-1']])

  const past = reconcileDb([staleRow('2026-10-16T07:30:00Z')])
  const pastReport = await reconcileStaleRdvCaptures(past.db, { apply: true, now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => paid, finalize: async () => { throw new Error('jamais') } })
  assert.equal(pastReport[0].action, 'manual_review:captured_past_slot')
  assert.deepEqual(past.rpc.map((c) => c.name), ['note_rdv_payment_error'])
})

test('rapprochement : PayPal injoignable → rien n’est touché', async () => {
  const { db, rpc } = reconcileDb([staleRow('2026-11-16T10:00:00Z')])
  const report = await reconcileStaleRdvCaptures(db, { apply: true, getOrder: async () => { throw new Error('down') } })
  assert.equal(report[0].action, 'paypal_unreachable')
  assert.equal(rpc.length, 0)
})

test('rapprochement par appel direct : secret du cron obligatoire', async () => {
  process.env.CRON_SECRET = 'cron-test'
  const res = response()
  await handleRdvDepositApi({ method: 'POST', body: { apply: true }, headers: {}, query: {} }, res, 'reconcile').catch(() => null)
  assert.ok([401, 503].includes(res.statusCode))
})

// ── Journal ─────────────────────────────────────────────────────────────────
test('journal : code, étape, créneau et type d’appareil seulement', () => {
  const row = buildCheckoutEvent({ action: 'create', code: 'slot_held', status: 409, checkoutId: 'ABCDEF12-0000-4000-8000-000000000000', practitionerId: 'p', startsAt: '2026-12-01T14:00:00Z', req: { headers: { 'user-agent': 'Instagram 300.0 (iPhone)' } } })
  assert.deepEqual(Object.keys(row).sort(), ['action', 'checkout_ref', 'client_kind', 'error_code', 'http_status', 'practitioner_id', 'slot_starts_at', 'source'])
  assert.deepEqual([row.checkout_ref, row.client_kind], ['abcdef12', 'in_app'])
  assert.equal(clientKind('Mozilla/5.0 (Windows NT 10.0)'), 'desktop')
  assert.equal(clientKind('Mozilla/5.0 (Linux; Android 14; wv) Chrome'), 'in_app')
  assert.equal(clientKind(''), 'unknown')
})

// ── Page et disponibilités ──────────────────────────────────────────────────
test('disponibilités publiques : les paiements en cours sont comptés, comme au paiement', () => {
  const api = read('api/rdv-availability.js')
  assert.equal((api.match(/await loadActiveHoldsBusy\(supabase/g) || []).length, 2, 'vue jour et vue calendrier')
  assert.match(api, /activeHolds\(data \|\| \[\], new Date\(\)\)/)
  assert.match(api, /held: true/)
})

test('page : identifiant partagé entre onglets, créneau tenu repris par son navigateur, relance PayPal', () => {
  const page = read('src/components/rdv/RdvPublic.jsx')
  const checkout = read('src/components/rdv/RdvDepositCheckout.jsx')
  const storage = read('src/components/rdv/rdvCheckoutStorage.js')
  assert.doesNotMatch(page, /sessionStorage\./)
  assert.match(storage, /localStorage/)
  assert.match(page, /slot\.available \|\| \(slot\.held && ownsCheckout\(slot\.time\)\)/)
  assert.match(checkout, /return actions\.restart\(\)/)
  assert.match(checkout, /result\.error === 'checkout_expired'/)
  assert.doesNotMatch(checkout, /Ne repayez pas : réessayez la confirmation/)
  // Version Production : aucune simulation PayPal dans la page.
  assert.doesNotMatch(checkout, /paypal_simulate|simulate/)
})

test('migration : réclamation durcie, nouvelles fonctions réservées au serveur, paiement encaissé jamais libéré', () => {
  const sql = read('supabase/migrations/20261106120000_rdv_payment_reliability.sql')
  assert.doesNotMatch(sql, /create or replace function public\.(create_rdv_deposit_hold|convert_rdv_deposit_hold)/i)
  assert.match(sql, /IF v_hold\.status = 'payment_capturing' THEN/)
  assert.doesNotMatch(sql, /IF v_hold\.status = 'payment_capturing' AND v_hold\.expires_at > now\(\) THEN/)
  assert.match(sql, /payment_already_captured/)
  for (const fn of ['next_rdv_capture_attempt', 'release_rdv_deposit_capture', 'note_rdv_payment_error', 'supersede_rdv_own_pending_holds']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`))
  }
})

test('runbook : transactions, préconditions internes et rollback bloqué par tout paiement intégral présentiel', () => {
  const deploy = read('supabase/runbooks/20261106-rdv-paypal-production/01-migration-atomique.sql')
  const rollback = read('supabase/runbooks/20261106-rdv-paypal-production/03-retour-arriere.sql')
  for (const sql of [deploy, rollback]) {
    assert.match(sql, /\bBEGIN;[\s\S]*\bCOMMIT;\s*$/i)
    assert.match(sql, /SET LOCAL lock_timeout/i)
  }
  assert.match(deploy, /rdv_preflight_signature_mismatch/)
  assert.match(deploy, /rdv_preflight_payment_permissions_mismatch/)
  assert.match(rollback, /LOCK TABLE public\.rdv_paypal_payments, public\.rdv_booking_holds, public\.bookings IN ACCESS EXCLUSIVE MODE/)
  assert.match(rollback, /rdv_rollback_full_in_person_payment_exists/)
  assert.doesNotMatch(rollback, /p\.status in \('order_pending', 'capturing'\)/i)
})

// ── Agenda fictif de TEST ───────────────────────────────────────────────────
// ── Limiteur anti-abus ──────────────────────────────────────────────────────
test('fonctions de paiement réservées au serveur : jamais exécutables avec la clé publique', () => {
  const sql = read('supabase/migrations/20261106130000_rdv_payment_functions_server_only.sql')
  for (const fn of ['create_rdv_deposit_hold', 'create_rdv_full_payment_hold', 'claim_rdv_deposit_capture', 'convert_rdv_deposit_hold']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), fn)
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), fn)
  }
  // Les pages n'appellent jamais ces fonctions : seul le serveur (clé service_role) le fait.
  const client = read('src/lib/supabase.js')
  assert.doesNotMatch(client, /create_rdv_|claim_rdv_|convert_rdv_/)
})

// ── Vérification d'un paiement resté « en capture » à la demande d'état ─────
function statusDb({ status = 'capturing', holdStatus = 'payment_capturing', expiresAt = '2020-01-01T00:00:00Z' } = {}) {
  const rpc = []
  let state = { status, holdStatus, converted: null }
  const row = () => ({ paypal_order_id: 'ORDER-STUCK-325B', status: state.status, amount_cents: 8000, confirmation_sent_at: null, paypal_env: 'sandbox', currency: 'EUR', client_checkout_id: 'a0b2ac90-0000-4000-8000-000000000000', hold: { id: 'hold-9', status: state.holdStatus, expires_at: expiresAt, starts_at: '2099-11-16T15:00:00Z', converted_booking_id: state.converted, service_price_cents: 8000, reservation_payment_cents: 8000 } })
  return {
    rpc,
    db: {
      rpc: (name, args) => {
        rpc.push({ name, args })
        if (name === 'convert_rdv_deposit_hold') state = { status: 'captured', holdStatus: 'converted', converted: 'booking-9' }
        return { then: (resolve) => resolve({ data: name === 'convert_rdv_deposit_hold' ? { ok: true, booking_id: 'booking-9' } : { ok: true }, error: null }) }
      },
      from() {
        const q = { select: () => q, eq: () => q, is: () => q, lt: () => q, limit: async () => ({ data: state.status === 'capturing' ? [row()] : [], error: null }), maybeSingle: async () => ({ data: row(), error: null }) }
        return q
      },
    },
  }
}

test('état d’un paiement bloqué : « report » lit PayPal sans rien modifier', async () => {
  const { handleStatusForTest } = await import('../lib/rdvDepositApiHandler.js')
  const { db, rpc } = statusDb()
  const calls = fakePayPal({ capture: { status: 201, body: {} }, order: { status: 200, body: { ...completedOrder('80.00'), purchase_units: [{ ...completedOrder('80.00').purchase_units[0], custom_id: 'MEDIUMIA:RDV-ARRHES:hold-9' }] } } })
  const res = response()
  await handleStatusForTest({ query: { checkout_id: 'a0b2ac90-0000-4000-8000-000000000000', reconcile: 'report' }, headers: {} }, res, db)
  assert.equal(res.body.reconciliation.paypalStatus, 'COMPLETED')
  assert.equal(res.body.reconciliation.action, 'would_convert')
  assert.equal(rpc.length, 0, 'aucune écriture')
  assert.equal(calls.some((c) => c.url.endsWith('/capture')), false, 'jamais de capture')
})

test('état d’un paiement bloqué : consultation ordinaire ne contacte pas PayPal et ne modifie rien', async () => {
  const { handleStatusForTest } = await import('../lib/rdvDepositApiHandler.js')
  const { db, rpc } = statusDb()
  const calls = fakePayPal({ capture: { status: 201, body: {} }, order: { status: 200, body: { ...completedOrder('80.00'), purchase_units: [{ ...completedOrder('80.00').purchase_units[0], custom_id: 'MEDIUMIA:RDV-ARRHES:hold-9' }] } } })
  const res = response()
  await handleStatusForTest({ query: { checkout_id: 'a0b2ac90-0000-4000-8000-000000000000' }, headers: {} }, res, db)
  assert.equal(res.body.bookingId, null)
  assert.equal(res.body.paymentStatus, 'capturing')
  assert.equal(rpc.length, 0)
  assert.equal(calls.length, 0)
  const again = response()
  await handleStatusForTest({ query: { checkout_id: 'a0b2ac90-0000-4000-8000-000000000000' }, headers: {} }, again, db)
  assert.equal(rpc.length, 0, 'aucune conversion apres deux lectures')
})

test('état d’un paiement encore dans le délai de sécurité : PayPal n’est pas interrogé', async () => {
  const { handleStatusForTest } = await import('../lib/rdvDepositApiHandler.js')
  const { db, rpc } = statusDb({ expiresAt: new Date(Date.now() + 60_000).toISOString() })
  const calls = fakePayPal({ capture: { status: 201, body: {} }, order: { status: 200, body: completedOrder() } })
  const res = response()
  await handleStatusForTest({ query: { checkout_id: 'a0b2ac90-0000-4000-8000-000000000000' }, headers: {} }, res, db)
  assert.equal(res.body.paymentStatus, 'capturing')
  assert.equal(calls.length + rpc.length, 0)
})

test('rapprochement : rendez-vous refusé après encaissement → code tracé et journalisé, créneau jamais libéré', async () => {
  const rpc = []
  const db = {
    rpc: (name, args) => {
      rpc.push({ name, args })
      const value = name === 'convert_rdv_deposit_hold' ? { data: null, error: { code: '23514', message: 'reservation_payment_required' } } : { data: null, error: null }
      return { then: (resolve) => resolve(value) }
    },
    from() {
      const q = { select: () => q, eq: () => q, is: () => q, lt: () => q, limit: async () => ({ data: [staleRow('2099-11-16T15:00:00Z')], error: null }) }
      return q
    },
  }
  const paid = { cfg: sandboxCfg, data: { ...completedOrder(), purchase_units: [{ ...completedOrder().purchase_units[0], custom_id: 'MEDIUMIA:RDV-ARRHES:hold-1' }] } }
  const errors = []
  const original = console.error
  console.error = (line) => errors.push(String(line))
  const report = await reconcileStaleRdvCaptures(db, { apply: true, now: new Date('2026-11-06T15:00:00Z'), getOrder: async () => paid, finalize: async () => { throw new Error('jamais') } })
  console.error = original
  assert.equal(report[0].action, 'manual_review:reservation_payment_required')
  assert.deepEqual(rpc.find((c) => c.name === 'note_rdv_payment_error').args, { p_paypal_order_id: 'ORDER-STALE-9876', p_error_code: 'captured_reservation_payment_required' })
  assert.equal(rpc.some((c) => c.name === 'release_rdv_deposit_capture'), false)
  assert.ok(errors.some((line) => line.includes('[rdv-reconcile]') && line.includes('…9876')))
})

test('migration de protection : paiement intégral toutes modalités, montants toujours contrôlés', () => {
  const sql = read('supabase/migrations/20261106140000_rdv_full_payment_booking_guard.sql')
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /'video'/)
  assert.match(sql, /NEW\.booked_price_cents IS NOT DISTINCT FROM v_service\.price_cents/)
  assert.match(sql, /NEW\.reservation_payment_cents IS NOT DISTINCT FROM v_service\.reservation_payment_cents\s+OR NEW\.reservation_payment_cents IS NOT DISTINCT FROM v_service\.price_cents/)
  assert.match(sql, /À déployer TOUJOURS avec 20260923200000/)
})
