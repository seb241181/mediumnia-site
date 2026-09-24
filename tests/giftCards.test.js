import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  resolveGiftOffer, validateGiftPeople, generateGiftCode, hashGiftCode, normalizeGiftCode,
  buildGiftEmail, addMonths, GIFT_AMOUNTS_CENTS, handleGiftCards,
} from '../lib/giftCards.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const services = [{ id: 's1', title: 'Guidance', price_cents: 7000 }, { id: 's2', title: 'Consultation vidéo', price_cents: 8000 }]

test('prices are decided by the server, never by the browser', () => {
  assert.equal(resolveGiftOffer({ kind: 'amount', amountCents: 5000 }, services).priceCents, 5000)
  assert.equal(resolveGiftOffer({ kind: 'amount', amountCents: 1 }, services), null)
  assert.equal(resolveGiftOffer({ kind: 'consultation', serviceId: 's2', priceCents: 1 }, services).priceCents, 8000)
  const coffret = resolveGiftOffer({ kind: 'coffret', serviceId: 's1' }, services)
  assert.deepEqual([coffret.priceCents, coffret.consultationCreditCents, coffret.chronosphereProduct], [7990, 7000, 'pack3'])
  const chrono = resolveGiftOffer({ kind: 'chronosphere', chronosphereProduct: 'max3' }, services)
  assert.deepEqual([chrono.priceCents, chrono.consultationCreditCents], [1990, 0])
  assert.equal(resolveGiftOffer({ kind: 'consultation', serviceId: 'unknown' }, services), null)
  assert.deepEqual(GIFT_AMOUNTS_CENTS, [3000, 5000, 8000, 10000, 15000])
})

test('buyer, recipient and delivery date are validated', () => {
  const base = { buyerName: 'Aurélie', buyerEmail: 'A@Exemple.fr', recipientName: 'Claire', termsAccepted: true }
  const today = new Date('2026-09-24T10:00:00Z')
  assert.equal(validateGiftPeople(base, today).people.buyerEmail, 'a@exemple.fr')
  assert.equal(validateGiftPeople({ ...base, termsAccepted: false }, today).field, 'termsAccepted')
  assert.equal(validateGiftPeople({ ...base, sendOn: '2026-12-24' }, today).field, 'sendOn', 'a date needs a recipient e-mail')
  assert.equal(validateGiftPeople({ ...base, recipientEmail: 'claire@exemple.fr', sendOn: '2026-12-24' }, today).people.sendOn, '2026-12-24')
  assert.equal(validateGiftPeople({ ...base, recipientEmail: 'claire@exemple.fr', sendOn: '2026-09-01' }, today).field, 'sendOn')
  assert.equal(validateGiftPeople({ ...base, recipientEmail: 'claire@exemple.fr', sendOn: '2027-09-01' }, today).field, 'sendOn')
})

test('codes are readable, unique enough and looked up by hash whatever the typing', () => {
  const code = generateGiftCode()
  assert.match(code, /^MDIA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
  assert.equal(hashGiftCode(code.toLowerCase().replace(/-/g, ' ')), hashGiftCode(code))
  assert.equal(normalizeGiftCode('mdia-ab12-cd34'), 'MDIAAB12CD34')
  assert.equal(new Set(Array.from({ length: 500 }, generateGiftCode)).size, 500)
  assert.equal(addMonths(new Date('2026-09-24T10:00:00Z'), 12).toISOString(), '2027-09-24T10:00:00.000Z')
})

test('e-mails carry the code, the validity and how to use it, escaped', () => {
  const card = { label: 'Coffret « Guidance » + ChronoSphère', buyer_name: 'Aurélie', recipient_name: '<Claire>', recipient_email: 'c@exemple.fr', send_on: '2026-12-24', message: 'Joyeux Noël', consultation_credit_cents: 7000, chronosphere_product: 'pack3', expires_at: '2027-09-24T10:00:00Z' }
  const buyer = buildGiftEmail({ card, code: 'MDIA-ABCD-EFGH', viewUrl: 'https://mediumia.fr/carte-cadeau/x', forRecipient: false })
  assert.match(buyer.text, /MDIA-ABCD-EFGH/)
  assert.match(buyer.text, /24 septembre 2027/)
  assert.match(buyer.text, /envoyée par e-mail à c@exemple\.fr le 24 décembre/)
  assert.match(buyer.text, /70,00 € à utiliser pour une consultation/)
  assert.match(buyer.text, /ChronoSphère — pack de 3 tirages/)
  const recipient = buildGiftEmail({ card, code: 'MDIA-ABCD-EFGH', viewUrl: 'x', forRecipient: true })
  assert.equal(recipient.subject, 'Aurélie vous offre une carte cadeau MediumIA')
  assert.doesNotMatch(recipient.html, /<Claire>/)
  assert.match(recipient.html, /Joyeux Noël/)
})

test('sales stay closed in production until the owner switches them on', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
  process.env.VERCEL_ENV = 'production'
  delete process.env.PAYPAL_GIFT_CARDS_ENABLED
  let status = 0, body = null
  const res = { setHeader() {}, status(c) { status = c; return this }, json(p) { body = p; return this } }
  await handleGiftCards({ method: 'POST', body: {}, query: {} }, res, 'create')
  assert.deepEqual([status, body.error], [503, 'gift_cards_closed'])
  delete process.env.VERCEL_ENV
})

test('the migration keeps gift cards server-only and counts VAT once', () => {
  const sql = read('supabase/migrations/20260924120000_gift_cards.sql')
  for (const table of ['gift_cards', 'gift_card_redemptions', 'gift_card_delivery_secrets']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`))
  }
  assert.doesNotMatch(sql, /create policy/)
  assert.match(sql, /'gift_card_sale'/)
  assert.match(sql, /'gift_card'\)/)
  const lib = read('lib/giftCards.js')
  assert.match(lib, /entry_kind: 'gift_card_sale'/)
  assert.match(lib, /PAYPAL_GIFT_CARDS_ENABLED !== 'true'/)
})

test('gift card pages are routed, indexed (shop page) and private (card page)', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(vercel.rewrites.some((r) => r.source === '/cartes-cadeaux'))
  assert.ok(vercel.rewrites.some((r) => r.source === '/carte-cadeau/:token'))
  assert.match(read('src/App.jsx'), /p === '\/cartes-cadeaux' \|\| p\.startsWith\('\/carte-cadeau\/'\) \? 'cartes-cadeaux'/)
  assert.match(read('scripts/apply-route-seo-cro.mjs'), /pathname\.startsWith\('\/carte-cadeau\/'\)/)
  assert.match(read('src/components/GiftCardsPage.jsx'), /enable-funding=paylater/)
})


test('gift card checkout always shows a visible payment call-to-action', () => {
  const page = read('src/components/GiftCardsPage.jsx')
  assert.match(page, /Passer au règlement/)
  assert.match(page, /Pour activer le règlement/)
  assert.match(page, /catalog\?\.open && ready/)
})
