import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setImmediate } from 'node:timers'
import {
  captureQuestionOrder,
  handleWebhook,
  sendPurchaseEmails,
  inspectLatestSandboxGuidance,
} from '../lib/emailQuestions.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const fixture = (name) => JSON.parse(read(`tests/fixtures/paypal/${name}`))
const webhookFixture = fixture('payment-capture-completed.sandbox.json')
const orderFixture = fixture('checkout-order-completed.sandbox.json')

const QUESTION_ID = '11111111-2222-4333-8444-555555555555'
const ORDER_ID = '9P99943869582473S'
const CAPTURE_ID = '3Y662965014333303'

function response() {
  return {
    code: null,
    body: null,
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this },
  }
}

function webhookRequest(body = webhookFixture, headers = {}) {
  return {
    method: 'POST',
    body: structuredClone(body),
    headers: {
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-TEST',
      'paypal-transmission-id': '69cd13f0-d67a-11f0-8a88-77339302725b',
      'paypal-transmission-sig': 'TEST_SIGNATURE_BASE64',
      'paypal-transmission-time': '2026-10-14T18:42:19Z',
      ...headers,
    },
  }
}

function guidanceRow(overrides = {}) {
  return {
    id: QUESTION_ID,
    paypal_env: 'sandbox',
    paypal_order_id: ORDER_ID,
    paypal_capture_id: null,
    capture_started_at: null,
    pack: 'q2',
    question_count: 2,
    amount_cents: 2990,
    currency: 'EUR',
    first_name: 'Camille',
    email: 'camille@example.invalid',
    questions: [
      { q: 'Est-ce le bon moment pour changer de voie professionnelle ?', context: '' },
      { q: 'Comment avancer sereinement dans cette période ?', context: '' },
    ],
    status: 'payment_pending',
    due_at: null,
    ...overrides,
  }
}

function createMemoryDb(initialRow = guidanceRow()) {
  const state = {
    row: structuredClone(initialRow),
    events: new Map(),
    updates: [],
  }

  function matches(filters) {
    return filters.every(([key, value]) => state.row?.[key] === value)
  }

  function query() {
    const filters = []
    let changes = null
    const q = {
      select() { return q },
      eq(key, value) { filters.push([key, value]); return q },
      is(key, value) { filters.push([key, value]); return q },
      update(value) { changes = value; return q },
      async maybeSingle() {
        if ((changes?.capture_started_at && state.failClaim) || (changes?.status === 'paid' && state.failPaid)
          || (!changes && state.failReads)) return { data: null, error: { message: 'database unavailable' } }
        if (!state.row || !matches(filters)) return { data: null, error: null }
        if (changes) {
          state.row = { ...state.row, ...changes }
          state.updates.push(structuredClone(changes))
        }
        return { data: structuredClone(state.row), error: null }
      },
      then(resolve, reject) {
        const run = async () => {
          if (state.row && matches(filters) && changes) {
            state.row = { ...state.row, ...changes }
            state.updates.push(structuredClone(changes))
          }
          return { data: state.row ? structuredClone(state.row) : null, error: null }
        }
        return run().then(resolve, reject)
      },
    }
    return q
  }

  return {
    state,
    from(table) {
      assert.equal(table, 'mediumia_email_questions')
      return query()
    },
    async rpc(name, params) {
      if (name === 'claim_email_question_paypal_event') {
        const byEvent = state.events.get(params.p_event_id)
        const byCapture = [...state.events.values()].find((item) => item.captureId === params.p_capture_id)
        const existing = byEvent || byCapture
        if (!existing) {
          state.events.set(params.p_event_id, {
            captureId: params.p_capture_id,
            orderId: params.p_paypal_order_id,
            questionId: params.p_question_id,
            status: 'processing',
            attempts: 1,
          })
          return { data: [{ claimed: true, event_status: 'processing' }], error: null }
        }
        if (existing.status === 'retryable') {
          existing.status = 'processing'
          existing.attempts += 1
          return { data: [{ claimed: true, event_status: 'processing' }], error: null }
        }
        return { data: [{ claimed: false, event_status: existing.status }], error: null }
      }
      if (name === 'finish_email_question_paypal_event') {
        const event = state.events.get(params.p_event_id)
        if (!event || event.status !== 'processing') return { data: false, error: null }
        event.status = params.p_status
        event.error = params.p_error
        return { data: true, error: null }
      }
      throw new Error(`unexpected_rpc:${name}`)
    },
  }
}

function installPayPalFetch({ verification = 'SUCCESS', orderResponses = [orderFixture], captureError = null, captureStatus = 201 } = {}) {
  const original = globalThis.fetch
  const calls = []
  let orderIndex = 0
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url)
    calls.push({ href, method: options.method, headers: options.headers, body: options.body, signal: options.signal })
    if (href.endsWith('/v1/oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'SANDBOX_ACCESS_TOKEN' }) }
    }
    if (href.endsWith('/v1/notifications/verify-webhook-signature')) {
      return { ok: true, status: 200, json: async () => ({ verification_status: verification }) }
    }
    if (href.endsWith(`/v2/payments/captures/${CAPTURE_ID}`)) {
      return {
        ok: true, status: 200,
        json: async () => structuredClone(orderFixture.purchase_units[0].payments.captures[0]),
      }
    }
    if (href.endsWith(`/v2/checkout/orders/${ORDER_ID}/capture`)) {
      if (captureError) throw captureError
      return {
        ok: captureStatus >= 200 && captureStatus < 300,
        status: captureStatus,
        json: async () => captureStatus >= 200 && captureStatus < 300
          ? structuredClone(orderFixture)
          : { name: 'INTERNAL_SERVER_ERROR' },
      }
    }
    if (href.endsWith(`/v2/checkout/orders/${ORDER_ID}`)) {
      const value = orderResponses[Math.min(orderIndex, orderResponses.length - 1)]
      orderIndex += 1
      if (value instanceof Error) throw value
      if (value?.httpStatus) {
        return { ok: false, status: value.httpStatus, json: async () => ({ name: 'INTERNAL_SERVER_ERROR' }) }
      }
      return { ok: true, status: 200, json: async () => structuredClone(value) }
    }
    throw new Error(`unexpected_fetch:${href}`)
  }
  return { calls, restore() { globalThis.fetch = original } }
}

function withPayPalEnv(fn) {
  return async () => {
    const before = {
      id: process.env.PAYPAL_CLIENT_ID,
      secret: process.env.PAYPAL_CLIENT_SECRET,
      webhook: process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID,
    }
    process.env.PAYPAL_CLIENT_ID = 'sandbox-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'sandbox-client-secret'
    process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID = '5GP03276FF874683P'
    try {
      await fn()
    } finally {
      for (const [key, value] of Object.entries({
        PAYPAL_CLIENT_ID: before.id,
        PAYPAL_CLIENT_SECRET: before.secret,
        PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID: before.webhook,
      })) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
}

test('diagnostic Sandbox : désactivé hors environnement isolé sans accéder à PayPal', withPayPalEnv(async () => {
  const saved = {
    flag: process.env.EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED,
    vercel: process.env.VERCEL_ENV,
    url: process.env.SUPABASE_URL,
  }
  delete process.env.EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED
  process.env.VERCEL_ENV = 'preview'
  process.env.SUPABASE_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
  const output = response()
  try {
    await inspectLatestSandboxGuidance({ method: 'GET' }, output, {
      from: () => assert.fail('DB must not be read with flag disabled'),
    }, 'sandbox')
    assert.equal(output.code, 404)
  } finally {
    for (const [key, value] of Object.entries({
      EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED: saved.flag,
      VERCEL_ENV: saved.vercel, SUPABASE_URL: saved.url,
    })) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
}))

test('diagnostic Sandbox : un paiement fournisseur confirme reste strictement en lecture seule', withPayPalEnv(async () => {
  const saved = {
    flag: process.env.EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED,
    vercel: process.env.VERCEL_ENV,
    url: process.env.SUPABASE_URL,
  }
  process.env.EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED = 'true'
  process.env.VERCEL_ENV = 'preview'
  process.env.SUPABASE_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
  const paypal = installPayPalFetch()
  let selects = 0
  const db = {
    from(table) {
      assert.equal(table, 'mediumia_email_questions')
      return {
        select() { selects += 1; return this },
        eq() { return this }, not() { return this }, gte() { return this },
        order() { return this }, range(start, end) {
          assert.ok((start === 0 || start === 1) && end === start)
          return this
        },
        maybeSingle: async () => ({ data: guidanceRow({
          capture_started_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }), error: null }),
      }
    },
  }
  const output = response()
  try {
    await inspectLatestSandboxGuidance({ method: 'GET' }, output, db, 'sandbox')
    assert.equal(output.code, 200)
    assert.equal(output.body.sandbox_only, true)
    assert.equal(output.body.read_only, true)
    assert.equal(output.body.capture_post_retried, false)
    assert.equal(output.body.provider_order_status, 'COMPLETED')
    assert.equal(output.body.provider_capture_count, 1)
    assert.equal(output.body.test_order_index, 0)
    assert.equal(output.body.evidence_classification, 'capture_confirmed_readonly')
    assert.equal(selects, 1)
    assert.deepEqual(paypal.calls.map((call) => call.method), ['POST', 'GET', 'GET'])
    assert.equal(paypal.calls.filter((call) => call.href.endsWith('/capture')).length, 0)
  } finally {
    paypal.restore()
    for (const [key, value] of Object.entries({
      EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED: saved.flag,
      VERCEL_ENV: saved.vercel, SUPABASE_URL: saved.url,
    })) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
}))

test('webhook : les en-têtes de signature absents sont rejetés avant tout accès DB ou PayPal', withPayPalEnv(async () => {
  let touched = false
  const db = { from() { touched = true }, rpc() { touched = true } }
  const out = response()
  await handleWebhook({ method: 'POST', body: webhookFixture, headers: {} }, out, db, 'sandbox')
  assert.equal(out.code, 401)
  assert.equal(out.body.error, 'paypal_signature_headers_missing')
  assert.equal(touched, false)
}))

test('webhook : une requête non signée reste rejetée si l’identifiant webhook manque', async () => {
  const previous = process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
  delete process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
  try {
    const out = response()
    await handleWebhook({ method: 'POST', body: webhookFixture, headers: {} }, out, createMemoryDb(), 'sandbox')
    assert.equal(out.code, 401)
    assert.equal(out.body.error, 'paypal_signature_headers_missing')
  } finally {
    if (previous == null) delete process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
    else process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID = previous
  }
})

test('webhook : une signature PayPal invalide est rejetée', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ verification: 'FAILURE' })
  try {
    const out = response()
    await handleWebhook(webhookRequest(), out, createMemoryDb(), 'sandbox')
    assert.equal(out.code, 401)
    assert.equal(out.body.error, 'paypal_signature_invalid')
    assert.equal(paypal.calls.filter((call) => call.href.includes('/verify-webhook-signature')).length, 1)
  } finally {
    paypal.restore()
  }
}))

test('webhook Sandbox réaliste : corrèle par order_id, confirme en GET et conserve les questions pour l’administration', withPayPalEnv(async () => {
  const payload = structuredClone(webhookFixture)
  assert.equal(payload.resource.custom_id, undefined, 'la fixture provider ne suppose pas resource.custom_id')
  const paypal = installPayPalFetch()
  const db = createMemoryDb()
  let notifications = 0
  try {
    const out = response()
    await handleWebhook(webhookRequest(payload), out, db, 'sandbox', {
      sendPurchase: async (_db, row) => {
        notifications += 1
        assert.equal(row.status, 'paid')
        assert.equal(row.questions.length, 2)
        return 'sent'
      },
    })
    assert.equal(out.code, 200)
    assert.equal(out.body.captured, true)
    assert.equal(db.state.row.status, 'paid')
    assert.equal(db.state.row.paypal_capture_id, CAPTURE_ID)
    assert.equal(db.state.row.questions[0].q, 'Est-ce le bon moment pour changer de voie professionnelle ?')
    assert.equal(db.state.row.confirmation_email_status, 'sent')
    assert.equal(notifications, 1)

    const verifyCall = paypal.calls.find((call) => call.href.includes('/verify-webhook-signature'))
    const verificationBody = JSON.parse(verifyCall.body)
    assert.equal(verificationBody.webhook_id, '5GP03276FF874683P')
    assert.equal(verificationBody.webhook_event.id, webhookFixture.id)
    assert.ok(verifyCall.signal instanceof AbortSignal)
  } finally {
    paypal.restore()
  }
}))

test('webhook : replay et concurrence ne produisent qu’une notification', withPayPalEnv(async () => {
  const paypal = installPayPalFetch()
  const db = createMemoryDb()
  let releaseNotification
  const blocked = new Promise((resolve) => { releaseNotification = resolve })
  let notificationCalls = 0
  const sendPurchase = async () => {
    notificationCalls += 1
    await blocked
    return 'sent'
  }
  try {
    const firstOut = response()
    const first = handleWebhook(webhookRequest(), firstOut, db, 'sandbox', { sendPurchase })
    await new Promise((resolve) => setImmediate(resolve))

    const concurrentOut = response()
    await handleWebhook(webhookRequest(), concurrentOut, db, 'sandbox', { sendPurchase })
    assert.equal(concurrentOut.code, 503)
    assert.equal(concurrentOut.body.error, 'webhook_event_busy')

    releaseNotification()
    await first
    assert.equal(firstOut.code, 200)

    const replayOut = response()
    await handleWebhook(webhookRequest(), replayOut, db, 'sandbox', { sendPurchase })
    assert.equal(replayOut.code, 200)
    assert.equal(replayOut.body.idempotent, true)
    assert.equal(notificationCalls, 1)
  } finally {
    paypal.restore()
  }
}))

test('webhook : indisponibilité PayPal temporaire renvoie 503 et reste rejouable', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [{ httpStatus: 503 }, orderFixture] })
  const db = createMemoryDb()
  let notifications = 0
  try {
    const firstOut = response()
    await handleWebhook(webhookRequest(), firstOut, db, 'sandbox', { sendPurchase: async () => 'sent' })
    assert.equal(firstOut.code, 503)
    assert.equal(firstOut.body.retryable, true)
    assert.equal(db.state.events.get(webhookFixture.id).status, 'retryable')

    const retryOut = response()
    await handleWebhook(webhookRequest(), retryOut, db, 'sandbox', {
      sendPurchase: async () => { notifications += 1; return 'sent' },
    })
    assert.equal(retryOut.code, 200)
    assert.equal(db.state.events.get(webhookFixture.id).attempts, 2)
    assert.equal(notifications, 1)
  } finally {
    paypal.restore()
  }
}))

test('capture : timeout réseau du POST déclenche un GET sûr sans second POST', withPayPalEnv(async () => {
  const approved = { ...structuredClone(orderFixture), status: 'APPROVED', purchase_units: [{
    ...structuredClone(orderFixture.purchase_units[0]), payments: undefined,
  }] }
  const timeout = new Error('request aborted')
  timeout.name = 'AbortError'
  const paypal = installPayPalFetch({ orderResponses: [approved, orderFixture], captureError: timeout })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder({ method: 'POST', body: { orderId: ORDER_ID } }, out, db, 'sandbox')
    assert.equal(out.code, 200)
    assert.equal(db.state.row.paypal_capture_id, CAPTURE_ID)
    const orderCalls = paypal.calls.filter((call) => call.href.includes(`/v2/checkout/orders/${ORDER_ID}`))
    assert.deepEqual(orderCalls.map((call) => call.method), ['GET', 'POST', 'GET'])
    assert.equal(orderCalls.filter((call) => call.method === 'POST').length, 1)
    assert.equal(orderCalls[1].headers['PayPal-Request-Id'], `mediumia-email-question-capture-${ORDER_ID}`)
  } finally {
    paypal.restore()
  }
}))

test('capture : réponse PayPal 5xx déclenche aussi une relecture sûre', withPayPalEnv(async () => {
  const approved = { ...structuredClone(orderFixture), status: 'APPROVED', purchase_units: [{
    ...structuredClone(orderFixture.purchase_units[0]), payments: undefined,
  }] }
  const paypal = installPayPalFetch({ orderResponses: [approved, orderFixture], captureStatus: 503 })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder({ method: 'POST', body: { orderId: ORDER_ID } }, out, db, 'sandbox')
    assert.equal(out.code, 200)
    assert.equal(db.state.row.paypal_capture_id, CAPTURE_ID)
    assert.deepEqual(
      paypal.calls.filter((call) => call.href.includes(`/v2/checkout/orders/${ORDER_ID}`)).map((call) => call.method),
      ['GET', 'POST', 'GET'],
    )
  } finally {
    paypal.restore()
  }
}))

test('capture : APPROVED après réponse perdue reste retryable, jamais un faux 409', withPayPalEnv(async () => {
  const approved = { ...structuredClone(orderFixture), status: 'APPROVED' }
  const paypal = installPayPalFetch({ orderResponses: [approved], captureError: new Error('response lost') })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder({ method: 'POST', body: { orderId: ORDER_ID } }, out, db, 'sandbox')
    assert.equal(out.code, 503)
    assert.equal(out.body.retryable, true)
    assert.equal(paypal.calls.filter((call) => call.href.endsWith('/capture')).length, 1)
  } finally { paypal.restore() }
}))

const captureRequest = () => ({ method: 'POST', body: { orderId: ORDER_ID } })
const noDelay = { sleep: async () => {} }
const approvedOrder = () => ({ ...structuredClone(orderFixture), status: 'APPROVED',
  purchase_units: orderFixture.purchase_units.map((unit) => ({ ...unit, payments: undefined })) })

test('capture : deux confirmations concurrentes, cohérence retardée, un POST et une notification', withPayPalEnv(async () => {
  const approved = approvedOrder()
  const paypal = installPayPalFetch({ orderResponses: [approved, approved, approved, orderFixture],
    captureError: new Error('response lost') })
  const db = createMemoryDb(guidanceRow({ questions: [
    { q: 'Première question fictive ?', context: 'Contexte obligatoire fictif de la première question.' },
    { q: 'Deuxième question fictive ?', context: 'Contexte obligatoire fictif de la deuxième question.' },
  ] }))
  const questions = structuredClone(db.state.row.questions)
  let notifications = 0
  const options = { ...noDelay, sendPurchase: async () => { notifications++; return 'collected' } }
  try {
    const a = response(), b = response()
    await Promise.all([captureQuestionOrder(captureRequest(), a, db, 'sandbox', options),
      captureQuestionOrder(captureRequest(), b, db, 'sandbox', options)])
    assert.deepEqual([a.code, b.code], [200, 200])
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 1)
    assert.equal(db.state.updates.filter((u) => u.status === 'paid').length, 1)
    assert.equal(notifications, 1)
    assert.deepEqual(db.state.row.questions, questions)
    const calls = paypal.calls.length
    const replay = response()
    await captureQuestionOrder(captureRequest(), replay, db, 'sandbox', options)
    assert.equal(replay.code, 200)
    assert.equal(replay.body.idempotent, true)
    assert.equal(paypal.calls.length, calls)
    assert.equal(notifications, 1)
  } finally { paypal.restore() }
}))

test('capture : une reprise après incertitude ne peut jamais refaire un POST, même sur APPROVED', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [approvedOrder()], captureStatus: 503 })
  const db = createMemoryDb()
  try {
    for (let i = 0; i < 2; i++) {
      const out = response()
      await captureQuestionOrder(captureRequest(), out, db, 'sandbox', noDelay)
      assert.equal(out.code, 503)
      assert.equal(out.body.retryable, true)
    }
    assert.ok(db.state.row.capture_started_at)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 1)
  } finally { paypal.restore() }
}))

test('capture : panne DB après capture puis reprise GET sans recapture ni double notification', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [approvedOrder(), orderFixture] })
  const db = createMemoryDb()
  db.state.failPaid = true
  let notifications = 0
  const options = { ...noDelay, sendPurchase: async () => { notifications++; return 'collected' } }
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', options)
    assert.equal(out.code, 503)
    assert.equal(out.body.error, 'payment_record_failed')
    assert.equal(out.body.retryable, true)
    assert.equal(notifications, 0)
    db.state.failPaid = false
    const retry = response()
    await captureQuestionOrder(captureRequest(), retry, db, 'sandbox', options)
    assert.equal(retry.code, 200)
    assert.equal(notifications, 1)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 1)
  } finally { paypal.restore() }
}))

test('capture : verrou DB indisponible ferme le paiement avant tout POST', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [approvedOrder()] })
  const db = createMemoryDb()
  db.state.failClaim = true
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', noDelay)
    assert.equal(out.code, 503)
    assert.equal(out.body.retryable, true)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 0)
  } finally { paypal.restore() }
}))

test('capture : ancienne tentative durable ne reprend pas de capture après redémarrage du worker', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [approvedOrder(), { httpStatus: 503 }, orderFixture] })
  const db = createMemoryDb(guidanceRow({ capture_started_at: '2020-01-01T00:00:00Z' }))
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', noDelay)
    assert.equal(out.code, 200)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 0)
  } finally { paypal.restore() }
}))

test('capture : conflit montant avéré reste 409, sans notification', withPayPalEnv(async () => {
  const wrong = structuredClone(orderFixture)
  wrong.purchase_units[0].payments.captures[0].amount.value = '0.01'
  const paypal = installPayPalFetch({ orderResponses: [wrong] })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', { ...noDelay,
      sendPurchase: async () => assert.fail('unexpected notification') })
    assert.equal(out.code, 409)
    assert.equal(out.body.error, 'paypal_order_mismatch')
    assert.equal(db.state.row.status, 'payment_pending')
  } finally { paypal.restore() }
}))

test('capture : plusieurs captures PayPal exigent une réconciliation manuelle', withPayPalEnv(async () => {
  const suspect = structuredClone(orderFixture)
  suspect.purchase_units[0].payments.captures.push({
    ...structuredClone(suspect.purchase_units[0].payments.captures[0]),
    id: 'ANOTHER-CAPTURE-FAKE',
  })
  const paypal = installPayPalFetch({ orderResponses: [suspect] })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', {
      ...noDelay, sendPurchase: async () => assert.fail('unexpected notification'),
    })
    assert.equal(out.code, 409)
    assert.equal(out.body.error, 'paypal_order_mismatch')
    assert.equal(db.state.row.status, 'payment_pending')
    assert.equal(paypal.calls.filter((call) => call.href.endsWith('/capture')).length, 0)
  } finally { paypal.restore() }
}))

test('capture : plusieurs unités PayPal ne déclenchent aucune validation', withPayPalEnv(async () => {
  const suspect = structuredClone(orderFixture)
  suspect.purchase_units.push({ ...structuredClone(suspect.purchase_units[0]), reference_id: 'OTHER_UNIT' })
  const paypal = installPayPalFetch({ orderResponses: [suspect] })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', noDelay)
    assert.equal(out.code, 409)
    assert.equal(db.state.row.status, 'payment_pending')
  } finally { paypal.restore() }
}))

test('webhook : plusieurs captures ne valident aucune guidance', withPayPalEnv(async () => {
  const suspect = structuredClone(orderFixture)
  suspect.purchase_units[0].payments.captures.push({
    ...structuredClone(suspect.purchase_units[0].payments.captures[0]),
    id: 'ANOTHER-CAPTURE-FAKE',
  })
  const paypal = installPayPalFetch({ orderResponses: [suspect] })
  const db = createMemoryDb()
  try {
    const out = response()
    await handleWebhook(webhookRequest(), out, db, 'sandbox', {
      sendPurchase: async () => assert.fail('unexpected notification'),
    })
    assert.equal(out.code, 200)
    assert.equal(out.body.ignored, 'order_mismatch')
    assert.equal(db.state.row.status, 'payment_pending')
    assert.equal(db.state.events.get(webhookFixture.id).status, 'failed')
  } finally { paypal.restore() }
}))

test('interface : conserve la consigne de ne pas recommencer le paiement incertain', () => {
  assert.match(read('src/components/QuestionPage.jsx'), /ne recommencez pas le paiement/i)
})

test('capture : confirmation DB concurrente gagne même si PayPal reste APPROVED', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [approvedOrder()], captureError: new Error('response lost') })
  const db = createMemoryDb()
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', {
      sleep: async () => { Object.assign(db.state.row, { status: 'paid', paypal_capture_id: CAPTURE_ID }) },
      sendPurchase: async () => assert.fail('other worker already owns notification'),
    })
    assert.equal(out.code, 200)
    assert.equal(out.body.idempotent, true)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 1)
  } finally { paypal.restore() }
}))

test('capture : panne DB initiale est retryable et ne contacte jamais PayPal', withPayPalEnv(async () => {
  const paypal = installPayPalFetch()
  const db = createMemoryDb()
  db.state.failReads = true
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, db, 'sandbox', noDelay)
    assert.equal(out.code, 503)
    assert.equal(out.body.retryable, true)
    assert.equal(paypal.calls.length, 0)
  } finally { paypal.restore() }
}))

test('capture : réponse PayPal sans état ne démontre pas un refus définitif', withPayPalEnv(async () => {
  const paypal = installPayPalFetch({ orderResponses: [{ id: ORDER_ID }] })
  try {
    const out = response()
    await captureQuestionOrder(captureRequest(), out, createMemoryDb(), 'sandbox', noDelay)
    assert.equal(out.code, 503)
    assert.equal(out.body.retryable, true)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 0)
  } finally { paypal.restore() }
}))

test('capture et webhook simultanés : une seule validation et notification', withPayPalEnv(async () => {
  const paypal = installPayPalFetch()
  const db = createMemoryDb()
  let notifications = 0
  const sendPurchase = async () => { notifications++; return 'collected' }
  try {
    const capture = response(), webhook = response()
    await Promise.all([
      captureQuestionOrder(captureRequest(), capture, db, 'sandbox', { ...noDelay, sendPurchase }),
      handleWebhook(webhookRequest(), webhook, db, 'sandbox', { sendPurchase }),
    ])
    assert.deepEqual([capture.code, webhook.code], [200, 200])
    assert.equal(db.state.updates.filter((u) => u.status === 'paid').length, 1)
    assert.equal(notifications, 1)
    assert.equal(paypal.calls.filter((c) => c.href.endsWith('/capture')).length, 0)
  } finally { paypal.restore() }
}))

test('notifications : la cliente et accompagnement.medium@gmail.com sont ciblés une seule fois avec clés stables', async () => {
  const before = process.env.EMAIL_QUESTIONS_OWNER_EMAIL
  process.env.EMAIL_QUESTIONS_OWNER_EMAIL = 'accompagnement.medium@gmail.com'
  const deliveries = []
  try {
    const status = await sendPurchaseEmails(createMemoryDb(), guidanceRow({
      paypal_env: 'sandbox',
      paypal_capture_id: CAPTURE_ID,
      status: 'paid',
      due_at: '2026-10-19T18:42:15Z',
    }), {
      allowSandbox: true,
      send: async (message) => { deliveries.push(message); return { status: 'sent', id: `mail-${deliveries.length}` } },
    })
    assert.equal(status, 'sent')
    assert.deepEqual(deliveries.map((item) => item.to), [
      'camille@example.invalid',
      'accompagnement.medium@gmail.com',
    ])
    assert.equal(new Set(deliveries.map((item) => item.idempotencyKey)).size, 2)
    assert.match(deliveries[1].text, /Est-ce le bon moment/)
    assert.match(deliveries[1].text, new RegExp(ORDER_ID))
  } finally {
    if (before == null) delete process.env.EMAIL_QUESTIONS_OWNER_EMAIL
    else process.env.EMAIL_QUESTIONS_OWNER_EMAIL = before
  }
})

test('migration webhook : registre privé, unicité capture et fonctions réservées au service_role', () => {
  const sql = read('supabase/migrations/20261014210000_email_question_paypal_webhook_hardening.sql')
  assert.match(sql, /event_id TEXT PRIMARY KEY/)
  assert.match(sql, /capture_id TEXT NOT NULL UNIQUE/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_email_question_paypal_event/)
  assert.match(sql, /FOR UPDATE/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finish_email_question_paypal_event/)
  assert.match(sql, /FORCE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/)
})

test('route webhook Guidance distincte des webhooks des autres prestations', () => {
  const router = read('api/rdv-config.js')
  const server = read('lib/emailQuestions.js')
  assert.match(router, /questionAction/)
  assert.match(router, /formationPathAction/)
  assert.match(server, /action === 'webhook'/)
  const webhook = server.slice(server.indexOf('export async function handleWebhook'), server.indexOf('export async function handleEmailQuestions'))
  assert.doesNotMatch(webhook, /\/refund/)
})
