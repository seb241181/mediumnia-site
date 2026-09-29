import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  blockingEvents,
  createSlotOffer,
  hashOfferToken,
  loadOpenOffer,
  slotOfferUrl,
  validateOfferSlot,
} from '../lib/rdvSlotOffers.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const OWNER = 'owner-1'
const PRACT = 'pract-1'

function fakeDb({ owner = OWNER, service = {}, offer = null } = {}) {
  const calls = { inserts: [] }
  return {
    calls,
    from(table) {
      const filters = {}
      let insert = null
      const q = {
        select() { return q },
        eq(k, v) { filters[k] = v; return q },
        insert(values) { insert = values; calls.inserts.push({ table, values }); return q },
        maybeSingle() {
          if (table === 'booking_practitioners') return Promise.resolve({ data: filters.owner_id === owner ? { id: PRACT, slug: 'sebastien-seguin' } : null })
          if (table === 'booking_services') return Promise.resolve({ data: { id: 'svc-1', title: 'Guidance', duration_min: 60, booking_mode: 'instant', reservation_payment_kind: 'arrhes', reservation_payment_cents: 2000, is_active: true, ...service } })
          if (table === 'booking_slot_offers') return Promise.resolve({ data: offer && filters.token_hash === offer.token_hash ? offer : null })
          return Promise.resolve({ data: null })
        },
        single() { return Promise.resolve({ data: { id: 'offer-1', ...insert, status: 'open' }, error: null }) },
      }
      return q
    },
  }
}

const NOW = new Date('2026-09-29T08:00:00Z')

test('only events named « Urgence » (or free / cancelled ones) leave the slot open', () => {
  assert.equal(blockingEvents([{ summary: 'URGENCE', status: 'confirmed' }, { summary: 'Créneau urgence', status: 'confirmed' }]).length, 0)
  assert.equal(blockingEvents([{ summary: 'Dentiste', status: 'confirmed' }]).length, 1)
  assert.equal(blockingEvents([{ summary: 'Perso', transparency: 'transparent' }, { summary: 'Annulé', status: 'cancelled' }]).length, 0)
  assert.equal(blockingEvents([{ summary: 'Urgence' }, { summary: 'Rendez-vous client' }]).length, 1)
})

test('a personal link stores only the token fingerprint and expires before the appointment', async () => {
  const db = fakeDb()
  const result = await createSlotOffer({
    db, userId: OWNER, now: NOW, env: {},
    input: { practitioner_id: PRACT, service_id: 'svc-1', date: '2026-09-29', time: '14:00', validity_hours: 24, customer_first_name: ' Marie ' },
  })
  assert.equal(result.status, 201)
  const token = decodeURIComponent(result.body.url.split('#offre=')[1])
  assert.match(result.body.url, /^https:\/\/mediumia\.fr\/rdv\/sebastien-seguin#offre=/)
  const row = db.calls.inserts[0].values
  assert.equal(row.token_hash, hashOfferToken(token))
  assert.ok(!JSON.stringify(row).includes(token))
  assert.equal(row.customer_first_name, 'Marie')
  assert.equal(row.starts_at, '2026-09-29T12:00:00.000Z') // 14 h à Paris (été)
  assert.equal(row.expires_at, row.starts_at) // 24 h > début du RDV : le lien s'arrête au début
})

test('links are refused for someone else, a past slot or a service without deposit', async () => {
  const input = { practitioner_id: PRACT, service_id: 'svc-1', date: '2026-09-29', time: '14:00', validity_hours: 24 }
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: 'intrus', input, now: NOW })).status, 403)
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: OWNER, input: { ...input, time: '09:00' }, now: NOW })).body.error, 'slot_in_past')
  assert.equal((await createSlotOffer({ db: fakeDb({ service: { reservation_payment_cents: 0 } }), userId: OWNER, input, now: NOW })).body.error, 'service_without_deposit')
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: OWNER, input: { ...input, validity_hours: 1000 }, now: NOW })).body.error, 'invalid_validity')
})

test('an expired, used or cancelled link cannot be used, and only for its exact slot', async () => {
  const token = 'a'.repeat(40)
  const base = { id: 'o1', practitioner_id: PRACT, service_id: 'svc-1', starts_at: '2026-09-29T12:00:00.000Z', expires_at: '2026-09-29T11:00:00.000Z', status: 'open', token_hash: hashOfferToken(token) }
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), token, NOW)).offer.id, 'o1')
  assert.equal((await loadOpenOffer(fakeDb({ offer: { ...base, status: 'used' } }), token, NOW)).error, 'offer_used')
  assert.equal((await loadOpenOffer(fakeDb({ offer: { ...base, status: 'cancelled' } }), token, NOW)).error, 'offer_cancelled')
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), token, new Date('2026-09-29T11:30:00Z'))).error, 'offer_expired')
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), 'court', NOW)).error, 'offer_invalid')
  await assert.rejects(
    validateOfferSlot({ supabase: fakeDb({ offer: { ...base, expires_at: '2099-01-01T00:00:00Z', starts_at: '2099-01-02T12:00:00.000Z' } }), practitioner: { id: PRACT, is_active: true }, service: { id: 'svc-1', duration_min: 60 }, date: '2099-01-02', time: '15:00', token }),
    /offer_invalid/,
  )
})

test('preview links stay on the preview deployment', () => {
  assert.equal(slotOfferUrl('sebastien-seguin', 'abc', { VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'x.vercel.app' }), 'https://x.vercel.app/rdv/sebastien-seguin#offre=abc')
})

test('payment, booking page and shortcut are wired to the personal link', () => {
  for (const file of ['lib/rdvDepositApiHandler.js', 'lib/rdvFullPaymentApiHandler.js']) {
    assert.match(read(file), /slot = offer_token\s+\? await validateOfferSlot/)
  }
  assert.match(read('lib/rdvDepositApiHandler.js'), /await markOfferUsed\(supabase, booking\)/)
  assert.match(read('api/rdv-book.js'), /if \(action === 'offer'\) \{\s+if \(req\.method !== 'POST'\)/)
  const page = read('src/components/rdv/RdvPublic.jsx')
  assert.match(page, /window\.location\.hash\.slice\(1\)\)\.get\('offre'\)/)
  assert.match(page, /offerToken=\{offer\?\.token \|\| null\}/)
  assert.match(read('src/components/rdv/RdvDepositCheckout.jsx'), /offer_token: offerToken/)
  assert.match(read('src/components/rdv/AccountingSection.jsx'), /window\.location\.hash === '#proposer'/)
  assert.match(read('src/components/rdv/ManualPaymentModal.jsx'), /mediumia:slot-offer/)
  const sql = read('supabase/migrations/20260929090000_rdv_slot_offers.sql')
  assert.match(sql, /revoke all on table public\.booking_slot_offers from public, anon, authenticated/)
  assert.match(sql, /check \(expires_at <= starts_at\)/)
})
