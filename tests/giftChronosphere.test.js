import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
process.env.RDV_RATE_LIMIT_SECRET = 'a'.repeat(64)

const { handleGiftChronosphere, findUsableGiftCard, hashGiftCode, giftUsageText } = await import('../lib/giftCards.js')
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// In-memory Supabase: eq / is filters, update, insert (with unique paypal_order_id), auth.
function fakeDb(tables, { users = {}, failPackInsert = false } = {}) {
  const inserts = []
  const from = (name) => {
    const filters = []
    let patch = null
    const rows = () => (tables[name] ||= []).filter((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)))
    const run = () => {
      const found = rows()
      if (patch) found.forEach((r) => Object.assign(r, patch))
      return found
    }
    const api = {
      select() { return api },
      eq(k, v) { filters.push([k, v]); return api },
      is(k, v) { filters.push([k, v]); return api },
      update(p) { patch = p; return api },
      insert(row) {
        inserts.push([name, row])
        if (name === 'chronosphere_credit_packs') {
          if (failPackInsert || (tables[name] ||= []).some((r) => r.paypal_order_id === row.paypal_order_id)) {
            return Promise.resolve({ data: null, error: { code: '23505' } })
          }
        }
        ;(tables[name] ||= []).push({ ...row })
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle() { const found = run(); return Promise.resolve({ data: found[0] || null, error: null }) },
      then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject) },
    }
    return api
  }
  return {
    from,
    inserts,
    rpc: async () => ({ data: { allowed: true } }),
    auth: { getUser: async (jwt) => (users[jwt] ? { data: { user: users[jwt] }, error: null } : { data: null, error: { message: 'bad' } }) },
  }
}

function fakeRes() {
  return {
    statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader() {},
  }
}

const future = new Date(Date.now() + 200 * 86_400_000).toISOString()
const CODE = 'MDIA-ABCD-EFGH'
const chronoCard = (extra = {}) => ({
  id: 'g1', code_hash: hashGiftCode(CODE), code_last4: 'EFGH', kind: 'chronosphere', label: 'ChronoSphère — pack de 3 tirages',
  status: 'active', expires_at: future, balance_cents: 0, consultation_credit_cents: 0,
  chronosphere_product: 'pack3', chronosphere_redeemed_at: null, paypal_env: 'live', ...extra,
})
const request = (body, headers = {}) => ({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9', ...headers }, body: { code: CODE, consentAccepted: true, ...body } })

test('a ChronoSphère card creates one paid pack of 3 draws, usable with the returned link', async () => {
  const tables = { gift_cards: [chronoCard()] }
  const db = fakeDb(tables)
  const res = fakeRes()
  await handleGiftChronosphere(request({ product: 'pack3', code: 'mdia abcd efgh' }), res, db)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.status, 'ACTIVATED')
  assert.equal(res.body.creditsRemaining, 3)
  const pack = tables.chronosphere_credit_packs[0]
  assert.equal(pack.pack_token_hash, createHash('sha256').update(res.body.packToken).digest('hex'), 'only the hash of the link is stored')
  assert.deepEqual([pack.status, pack.credits_remaining, pack.product_type, pack.amount_cents, pack.paypal_order_id], ['active', 3, 'pack3', 990, 'GIFT-g1'])
  assert.ok(pack.captured_at && pack.consent_accepted_at, 'the 6-month validity starts at activation')
  assert.ok(tables.gift_cards[0].chronosphere_redeemed_at)
  assert.equal(tables.gift_cards[0].status, 'used')
  assert.equal(tables.gift_card_redemptions[0].amount_cents, 990)

  const again = fakeRes()
  await handleGiftChronosphere(request({ product: 'pack3' }), again, db)
  assert.equal(again.statusCode, 409)
  assert.equal(again.body.error, 'gift_chronosphere_redeemed')
  assert.equal(tables.chronosphere_credit_packs.length, 1, 'never two packs for one card')
})

test('a coffret activates its draws and keeps the consultation balance', async () => {
  const tables = { gift_cards: [chronoCard({ kind: 'coffret', balance_cents: 8000, consultation_credit_cents: 8000 })] }
  const res = fakeRes()
  await handleGiftChronosphere(request({ product: 'pack3' }), res, fakeDb(tables))
  assert.equal(res.statusCode, 200)
  assert.deepEqual([tables.gift_cards[0].status, tables.gift_cards[0].balance_cents], ['active', 8000])
  assert.equal((await findUsableGiftCard(fakeDb(tables), CODE)).card.id, 'g1', 'the consultation part stays usable')
})

test('MAX needs the recipient account and is attached to it', async () => {
  const tables = { gift_cards: [chronoCard({ chronosphere_product: 'max3' })] }
  const db = fakeDb(tables, { users: { jwt1: { id: 'u1' } } })
  const anonymous = fakeRes()
  await handleGiftChronosphere(request({ product: 'max3' }), anonymous, db)
  assert.equal(anonymous.statusCode, 401)
  assert.equal(tables.gift_cards[0].chronosphere_redeemed_at, null)

  const res = fakeRes()
  await handleGiftChronosphere(request({ product: 'max3' }, { authorization: 'Bearer jwt1' }), res, db)
  assert.equal(res.statusCode, 200)
  assert.deepEqual([tables.chronosphere_credit_packs[0].user_id, tables.chronosphere_credit_packs[0].product_type, tables.chronosphere_credit_packs[0].amount_cents], ['u1', 'max3', 1990])
})

test('wrong page, missing consent, expiry and consultation-only cards are refused without side effects', async () => {
  const cases = [
    [chronoCard({ chronosphere_product: 'max3' }), { product: 'pack3' }, 409, 'gift_wrong_product'],
    [chronoCard(), { product: 'pack3', consentAccepted: false }, 400, 'consent_required'],
    [chronoCard({ expires_at: '2020-01-01T00:00:00Z' }), { product: 'pack3' }, 409, 'gift_code_expired'],
    [chronoCard({ kind: 'amount', chronosphere_product: null, balance_cents: 5000, consultation_credit_cents: 5000 }), { product: 'pack3' }, 409, 'gift_no_chronosphere'],
    [chronoCard({ status: 'payment_pending' }), { product: 'pack3' }, 404, 'gift_code_invalid'],
  ]
  for (const [card, body, status, error] of cases) {
    const tables = { gift_cards: [card] }
    const res = fakeRes()
    await handleGiftChronosphere(request(body), res, fakeDb(tables))
    assert.deepEqual([res.statusCode, res.body.error], [status, error])
    assert.equal(tables.chronosphere_credit_packs, undefined)
    assert.equal(tables.gift_cards[0].chronosphere_redeemed_at ?? null, null)
  }
})

test('if the pack cannot be created, the card can be activated again', async () => {
  const tables = { gift_cards: [chronoCard()] }
  const res = fakeRes()
  await handleGiftChronosphere(request({ product: 'pack3' }), res, fakeDb(tables, { failPackInsert: true }))
  assert.equal(res.statusCode, 502)
  assert.deepEqual([tables.gift_cards[0].chronosphere_redeemed_at, tables.gift_cards[0].status], [null, 'active'])
})

test('a ChronoSphère-only card gets a clear message on the booking page', async () => {
  assert.equal((await findUsableGiftCard(fakeDb({ gift_cards: [chronoCard()] }), CODE)).error, 'gift_code_chronosphere_only')
  assert.match(read('api/rdv-book.js'), /gift_code_chronosphere_only/)
  assert.match(read('src/components/rdv/GiftCardRedeem.jsx'), /gift_code_chronosphere_only/)
})

test('both ChronoSphère pages offer the gift card box, and the e-mail says where to use it', () => {
  assert.match(read('src/components/ChronospherePage.jsx'), /<GiftChronosphereRedeem[\s\S]*?product="pack3"/)
  assert.match(read('src/components/ChronosphereMaxPage.jsx'), /<GiftChronosphereRedeem[\s\S]*?product="max3"/)
  assert.match(read('lib/giftCards.js'), /action === 'chronosphere'\) return handleGiftChronosphere/)
  assert.match(giftUsageText({ consultation_credit_cents: 0, chronosphere_product: 'max3' }).join(' '), /chronosphere-max.*code/)
})
