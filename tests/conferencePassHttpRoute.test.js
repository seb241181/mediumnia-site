/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'

// Trajet HTTP réel : la requête exacte de la page du Pass (URL, méthode, corps) part vers un
// vrai serveur HTTP local qui exécute api/rdv-config.js, sans le patch de build ; le routeur
// doit l'envoyer au handler du Pass. PayPal Sandbox et la base Supabase sont simulés au niveau
// réseau. Aucun vrai lien de Pass, aucune vraie commande, aucune base réelle.

process.env.PAYPAL_ENV = 'sandbox'
process.env.PAYPAL_CLIENT_ID = 'test-client'
process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
process.env.SUPABASE_URL = 'https://supabase.test.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
delete process.env.VERCEL_ENV

const page = fs.readFileSync(new URL('../src/components/ConferencePassPage.jsx', import.meta.url), 'utf8')
const API = page.match(/const API = '([^']+)'/)[1]
const { default: handler } = await import('../api/rdv-config.js')

const OLD = 'OLDORDER12345678A'
const NEW = 'NEWORDER12345678B'
const realFetch = globalThis.fetch

function pass(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111', event_id: 'e', registration_id: 'r', status: 'reserved',
    paypal_order_id: OLD, paypal_capture_id: null, paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR',
    reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', redeemed_at: null, expires_at: '2099-01-01T00:00:00Z',
    terms_accepted_at: '2026-11-01T12:20:06Z', immediate_access_accepted_at: '2026-11-01T12:20:06Z', ...overrides,
  }
}

// Serveur HTTP local au format des fonctions Vercel (req.query, req.body, res.status().json()).
async function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const vreq = Object.assign(req, { query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : {} })
    const vres = Object.assign(res, {
      status(code) { res.statusCode = code; return vres },
      json(body) { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return vres },
      send(body) { res.end(typeof body === 'string' ? body : JSON.stringify(body)); return vres },
    })
    if (url.pathname !== '/api/rdv-config') { res.statusCode = 404; return res.end('{}') }
    try { await handler(vreq, vres) } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ crash: error.message })) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

async function scenario({ passRow, order }) {
  const calls = { rpc: [], paypal: [] }
  const realError = console.error
  console.error = () => {}
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = init.method || (input instanceof Request ? input.method : 'GET')
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init)
    if (url.startsWith(process.env.SUPABASE_URL)) {
      const path = new URL(url).pathname
      const body = init.body ? JSON.parse(init.body) : null
      if (path.startsWith('/rest/v1/rpc/')) {
        const name = path.slice('/rest/v1/rpc/'.length)
        calls.rpc.push({ name, body })
        const data = {
          validate_conference_pass: { ok: true, offerEnabled: true, offerAmountCents: 49900 },
          release_conference_pass_checkout: { ok: true },
          reserve_conference_pass_checkout: { ok: true },
        }[name]
        return new Response(JSON.stringify(data ?? null), { status: data ? 200 : 404, headers: { 'Content-Type': 'application/json' } })
      }
      if (path === '/rest/v1/conference_passes') {
        const headers = new Headers(init.headers || {})
        const wantsObject = (headers.get('Accept') || '').includes('vnd.pgrst.object')
        return new Response(JSON.stringify(wantsObject ? passRow : [passRow]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.startsWith('https://api-m.sandbox.paypal.com')) {
      calls.paypal.push({ url, method, body: String(init.body || '').startsWith('{') ? JSON.parse(init.body) : null })
      if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      if (url.endsWith(`/v2/checkout/orders/${OLD}`)) return new Response(JSON.stringify(order.body), { status: order.status })
      if (url.endsWith('/v2/checkout/orders') && method === 'POST') return new Response(JSON.stringify({ id: NEW, status: 'CREATED' }), { status: 201 })
    }
    if (url.startsWith('https://api-m.paypal.com')) throw new Error('aucun appel PayPal Live autorisé dans ce test')
    throw new Error(`appel réseau inattendu : ${url}`)
  }
  const { server, base } = await startServer()
  try {
    // Exactement la requête de ConferencePassPage.jsx : fetch(`${API}create`, { method: 'POST', JSON })
    const response = await realFetch(`${base}${API}create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passToken: 'p'.repeat(43), termsAccepted: true, immediateAccessAccepted: true }),
    })
    return { status: response.status, body: await response.json(), calls }
  } finally {
    server.close()
    globalThis.fetch = realFetch
    console.error = realError
  }
}

const createdOrders = (calls) => calls.paypal.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders'))

test('la page envoie bien conferencePassAction à /api/rdv-config, routé dans le source (sans patch de build)', () => {
  assert.equal(API, '/api/rdv-config?conferencePassAction=')
  assert.match(page, /fetch\(`\$\{API\}create`, \{\s*method: 'POST'/)
  assert.match(page, /JSON\.stringify\(\{ passToken, termsAccepted: true, immediateAccessAccepted: true \}\)/)
  const api = fs.readFileSync(new URL('../api/rdv-config.js', import.meta.url), 'utf8')
  assert.match(api, /import \{ handleConferencePassPayPal \} from '\.\.\/lib\/conferencePassPayPal\.js'/)
  assert.match(api, /if \(req\.query\.conferencePassAction\) return handleConferencePassPayPal\(req, res, req\.query\.conferencePassAction\)/)
})

test('HTTP : Pass bloqué par une commande expirée -> libéré, nouvelle commande, paiement possible', async () => {
  const { status, body, calls } = await scenario({
    passRow: pass(),
    order: { status: 404, body: { name: 'RESOURCE_NOT_FOUND', debug_id: 'abc123', details: [{ issue: 'INVALID_RESOURCE_ID' }] } },
  })
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.id, NEW)
  assert.deepEqual(calls.rpc.map((c) => c.name), ['validate_conference_pass', 'release_conference_pass_checkout', 'reserve_conference_pass_checkout'])
  assert.equal(calls.rpc[1].body.p_reason, 'paypal_order_expired')
  assert.equal(createdOrders(calls).length, 1)
  assert.deepEqual(createdOrders(calls)[0].body.purchase_units[0].amount, { currency_code: 'EUR', value: '1.00' })
})

test('HTTP : commande déjà payée -> rapprochement, aucune nouvelle commande (pas de double paiement)', async () => {
  const { status, body, calls } = await scenario({ passRow: pass(), order: { status: 200, body: { id: OLD, status: 'COMPLETED' } } })
  assert.equal(status, 200)
  assert.deepEqual(body, { id: OLD, env: 'sandbox', completed: true })
  assert.equal(createdOrders(calls).length, 0)
  assert.ok(!calls.rpc.some((c) => c.name === 'release_conference_pass_checkout'))
})

test('HTTP : PayPal indisponible -> erreur propre, Pass intact, aucune commande créée', async () => {
  const { status, body, calls } = await scenario({ passRow: pass(), order: { status: 503, body: { name: 'SERVICE_UNAVAILABLE' } } })
  assert.equal(status, 502)
  assert.equal(body.error, 'paypal_order_fetch_failed')
  assert.equal(createdOrders(calls).length, 0)
  assert.ok(!calls.rpc.some((c) => c.name === 'release_conference_pass_checkout'))
})

test('HTTP : premier achat d’un Pass neuf -> une seule commande Sandbox', async () => {
  const { status, body, calls } = await scenario({ passRow: pass({ status: 'opened', paypal_order_id: null }), order: { status: 404, body: {} } })
  assert.equal(status, 201, JSON.stringify(body))
  assert.equal(body.id, NEW)
  assert.equal(createdOrders(calls).length, 1)
  assert.ok(!calls.paypal.some((c) => c.url.includes(`/orders/${OLD}`)), 'aucune ancienne commande relue')
})
