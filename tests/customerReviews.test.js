import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

const { handleCustomerReviews, validateReview } = await import('../lib/customerReviews.js')

const valid = {
  displayName: 'Marie D.',
  email: 'Marie@Exemple.fr',
  offering: 'consultation',
  rating: 4,
  body: 'Une consultation très à l’écoute, claire et respectueuse de mon rythme.',
  experienceMonth: '2026-08',
  consentPublication: true,
}

// In-memory PostgREST stand-in behind global fetch.
let rows = []
let tableExists = true
const requests = []
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = init.method || 'GET'
  requests.push({ method, path: url.pathname, search: url.search })
  if (url.pathname.startsWith('/auth/v1/user')) return new Response(JSON.stringify({ message: 'invalid' }), { status: 401 })
  if (!tableExists) return new Response(JSON.stringify({ code: 'PGRST205', message: 'missing table' }), { status: 404 })
  if (method === 'POST') {
    rows.push({ ...JSON.parse(init.body), status: 'pending', created_at: new Date().toISOString() })
    return new Response(null, { status: 201 })
  }
  if (method === 'HEAD') {
    const email = url.searchParams.get('email')?.replace(/^eq\./, '')
    const count = rows.filter((r) => r.email === email).length
    return new Response(null, { status: 200, headers: { 'content-range': `0-0/${count}` } })
  }
  const status = url.searchParams.get('status')?.replace(/^eq\./, '')
  return new Response(JSON.stringify(rows.filter((r) => !status || r.status === status)), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function call(action, { method = 'GET', body, headers = {} } = {}) {
  let status = 0
  let payload = null
  const res = { setHeader() {}, status(code) { status = code; return this }, json(p) { payload = p; return this } }
  await handleCustomerReviews({ method, body, headers, query: { reviewsAction: action } }, res, action)
  return { status, payload }
}

test('validation keeps only clean, bounded fields and normalizes the e-mail', () => {
  const { review } = validateReview(valid, Date.parse('2026-09-23T10:00:00Z'))
  assert.equal(review.email, 'marie@exemple.fr')
  assert.equal(review.consent_publication, true)
  assert.equal(review.status, undefined, 'status is never taken from the client')
  assert.equal(validateReview({ ...valid, rating: 6 }).field, 'rating')
  assert.equal(validateReview({ ...valid, body: 'trop court' }).field, 'body')
  assert.equal(validateReview({ ...valid, consentPublication: 'yes' }).field, 'consentPublication')
  assert.equal(validateReview({ ...valid, experienceMonth: '2031-01' }, Date.parse('2026-09-23')).field, 'experienceMonth')
  assert.equal(validateReview({ ...valid, offering: 'autre-chose' }).field, 'offering')
})

test('robots get a success response without anything being stored', async () => {
  rows = []
  assert.equal((await call('submit', { method: 'POST', body: { ...valid, _hp: 'x', _elapsedMs: 9000 } })).status, 200)
  assert.equal((await call('submit', { method: 'POST', body: { ...valid, _elapsedMs: 800 } })).status, 200)
  assert.equal(rows.length, 0)
})

test('a genuine review is stored as pending, and an e-mail is limited to two per day', async () => {
  rows = []
  const first = await call('submit', { method: 'POST', body: { ...valid, _elapsedMs: 9000 } })
  assert.equal(first.status, 200)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  await call('submit', { method: 'POST', body: { ...valid, _elapsedMs: 9000 } })
  const third = await call('submit', { method: 'POST', body: { ...valid, _elapsedMs: 9000 } })
  assert.equal(third.status, 429)
  assert.equal(rows.length, 2)
})

test('the public list only ever asks for approved reviews and never the e-mail', async () => {
  rows = [{ ...valid, email: 'x@y.fr', status: 'pending' }]
  requests.length = 0
  const { status, payload } = await call('list')
  assert.equal(status, 200)
  assert.deepEqual(payload.reviews, [])
  const listRequest = requests.find((r) => r.path === '/rest/v1/customer_reviews')
  assert.match(listRequest.search, /status=eq\.approved/)
  assert.doesNotMatch(decodeURIComponent(listRequest.search), /email/)
})

test('before the migration is applied the site degrades gracefully', async () => {
  tableExists = false
  assert.deepEqual((await call('list')).payload, { available: false, reviews: [] })
  assert.equal((await call('submit', { method: 'POST', body: { ...valid, _elapsedMs: 9000 } })).status, 503)
  tableExists = true
})

test('moderation requires the owner account', async () => {
  assert.equal((await call('pending')).status, 401)
  assert.equal((await call('moderate', { method: 'POST', body: { id: 'x', decision: 'approved' }, headers: { authorization: 'Bearer forged' } })).status, 401)
})

test('migration keeps the table private to the server and stores no IP', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260923180000_customer_reviews.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on table public\.customer_reviews from public, anon, authenticated/)
  assert.doesNotMatch(sql, /create policy/)
  assert.doesNotMatch(sql, /\binet\b/i)
  assert.doesNotMatch(sql, /^\s*(ip|ip_address|ip_hash|remote_addr)\s/im)
  assert.match(sql, /status text not null default 'pending'/)
})

test('public page states the moderation rules required for published reviews', () => {
  const page = fs.readFileSync(new URL('../src/components/ReviewsPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /Les avis positifs comme négatifs sont publiés/)
  assert.match(page, /Aucun avis n’est rémunéré/)
  assert.match(page, /du plus récent au plus ancien/)
  assert.match(page, /demander la modification ou le retrait/)
})

test('reviews are reachable, indexed, and the moderation page is not', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  assert.match(read('src/App.jsx'), /p === '\/avis' \|\| p\.startsWith\('\/avis\/'\) \? 'avis'/)
  assert.match(read('src/App.jsx'), /<ReviewsHighlight \/>/)
  assert.match(read('api/rdv-config.js'), /handleCustomerReviews\(req, res, reviewsAction\)/)
  assert.match(read('scripts/apply-mobile-seo-sprint.mjs'), /'\/avis',/)
  assert.match(read('scripts/apply-route-seo-cro.mjs'), /pathname\.startsWith\('\/avis\/moderation'\)/)
})
