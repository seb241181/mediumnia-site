import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encrypt } from '../lib/googleOAuth.js'
import {
  blockingEvents,
  cancelSlotOffer,
  createSlotOffer,
  hashOfferToken,
  loadOpenOffer,
  offerBlocksCapture,
  offerErrorFromClaim,
  slotOfferUrl,
  validateOfferSlot,
} from '../lib/rdvSlotOffers.js'

// Clé factice, uniquement pour chiffrer un faux jeton Google dans ces tests.
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = '0'.repeat(64)

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const OWNER = 'owner-1'
const PRACT = 'pract-1'
const NOW = new Date('2026-09-29T08:00:00Z')

function fakeDb({ owner = OWNER, service = {}, offer = null, bookings = [], hold = null, holdsCapturing = [], payment = null } = {}) {
  const calls = { inserts: [], updates: [] }
  return {
    calls,
    from(table) {
      const filters = {}
      let insert = null
      let update = null
      const q = {
        select() { return q },
        eq(k, v) { filters[k] = v; return q },
        in(k, v) { filters[k] = v; return q },
        lt() { return q },
        gt() { return q },
        limit() { return q },
        insert(values) { insert = values; calls.inserts.push({ table, values }); return q },
        update(values) { update = values; calls.updates.push({ table, values, filters }); return q },
        maybeSingle() {
          if (table === 'booking_practitioners') return Promise.resolve({ data: filters.owner_id === owner ? { id: PRACT, slug: 'sebastien-seguin', buffer_before_min: 0, buffer_after_min: 0 } : null })
          if (table === 'booking_services') return Promise.resolve({ data: { id: 'svc-1', title: 'Guidance', duration_min: 60, booking_mode: 'instant', reservation_payment_kind: 'arrhes', reservation_payment_cents: 2000, is_active: true, ...service } })
          if (table === 'booking_slot_offers') return Promise.resolve({ data: offer && (filters.token_hash === offer.token_hash || filters.id === offer.id) ? offer : null })
          if (table === 'rdv_paypal_payments') return Promise.resolve({ data: payment })
          if (table === 'rdv_booking_holds') return Promise.resolve({ data: hold })
          return Promise.resolve({ data: null })
        },
        single() {
          if (table === 'booking_calendar_connections') return Promise.resolve({ data: { google_calendar_id: 'cal@group', access_token_enc: encrypt('tok'), token_expiry: '2099-01-01T00:00:00Z' } })
          return Promise.resolve({ data: { id: 'offer-1', ...insert, status: 'open' }, error: null })
        },
        then(resolve) {
          if (table === 'bookings') return resolve({ data: bookings, error: null })
          if (table === 'rdv_booking_holds' && !update) return resolve({ data: holdsCapturing, error: null })
          if (table === 'booking_slot_offers' && update) return resolve({ data: [{ id: 'o1' }], error: null })
          return resolve({ data: [], error: null })
        },
      }
      return q
    },
  }
}

function googleWith(items) {
  const calls = []
  const impl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ items }) } }
  impl.calls = calls
  return impl
}

const input = { practitioner_id: PRACT, service_id: 'svc-1', date: '2026-09-29', time: '14:00', validity_hours: 24, customer_first_name: ' Marie ' }

test('only events whose title STARTS with « Urgence » (or free / cancelled ones) leave the slot open', () => {
  assert.equal(blockingEvents([{ summary: 'URGENCE' }, { summary: 'Urgence - bloc réservé' }, { summary: '  urgence' }]).length, 0)
  assert.equal(blockingEvents([{ summary: 'Consultation urgence Marie' }]).length, 1)
  assert.equal(blockingEvents([{ summary: 'Urgences dentaires' }]).length, 1)
  assert.equal(blockingEvents([{ summary: 'Dentiste' }]).length, 1)
  assert.equal(blockingEvents([{ summary: 'Perso', transparency: 'transparent' }, { summary: 'Annulé', status: 'cancelled' }]).length, 0)
})

test('a personal link checks the calendar first, stores only the token fingerprint and closes 15 min before', async () => {
  const db = fakeDb()
  const fetchImpl = googleWith([{ summary: 'Urgence' }])
  const result = await createSlotOffer({ db, userId: OWNER, now: NOW, env: {}, fetchImpl, input })
  assert.equal(result.status, 201)
  assert.equal(fetchImpl.calls.length, 1)
  const token = decodeURIComponent(result.body.url.split('#offre=')[1])
  assert.match(result.body.url, /^https:\/\/mediumia\.fr\/rdv\/sebastien-seguin#offre=/)
  const row = db.calls.inserts[0].values
  assert.equal(row.token_hash, hashOfferToken(token))
  assert.ok(!JSON.stringify(row).includes(token))
  assert.equal(row.customer_first_name, 'Marie')
  assert.equal(row.starts_at, '2026-09-29T12:00:00.000Z') // 14 h à Paris (été)
  assert.equal(row.expires_at, '2026-09-29T11:45:00.000Z')
})

test('no link for a busy slot: other Google event, existing appointment or Google down', async () => {
  const busy = await createSlotOffer({ db: fakeDb(), userId: OWNER, now: NOW, fetchImpl: googleWith([{ summary: 'Consultation urgence Marie' }]), input })
  assert.deepEqual([busy.status, busy.body.error], [409, 'slot_busy'])
  const booked = await createSlotOffer({ db: fakeDb({ bookings: [{ id: 'b1' }] }), userId: OWNER, now: NOW, fetchImpl: googleWith([]), input })
  assert.deepEqual([booked.status, booked.body.error], [409, 'slot_booked'])
  const down = await createSlotOffer({ db: fakeDb(), userId: OWNER, now: NOW, fetchImpl: async () => ({ ok: false }), input })
  assert.deepEqual([down.status, down.body.error], [503, 'google_calendar_unavailable'])
})

test('links are refused for someone else, a past slot or a service without deposit', async () => {
  const fetchImpl = googleWith([])
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: 'intrus', input, now: NOW, fetchImpl })).status, 403)
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: OWNER, input: { ...input, time: '09:00' }, now: NOW, fetchImpl })).body.error, 'slot_in_past')
  assert.equal((await createSlotOffer({ db: fakeDb({ service: { reservation_payment_cents: 0 } }), userId: OWNER, input, now: NOW, fetchImpl })).body.error, 'service_without_deposit')
  assert.equal((await createSlotOffer({ db: fakeDb(), userId: OWNER, input: { ...input, validity_hours: 1000 }, now: NOW, fetchImpl })).body.error, 'invalid_validity')
})

test('an expired, used or cancelled link cannot be used, and only for its exact slot', async () => {
  const token = 'a'.repeat(40)
  const base = { id: 'o1', practitioner_id: PRACT, service_id: 'svc-1', starts_at: '2026-09-29T12:00:00.000Z', expires_at: '2026-09-29T11:00:00.000Z', status: 'open', token_hash: hashOfferToken(token) }
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), token, NOW)).offer.id, 'o1')
  assert.equal((await loadOpenOffer(fakeDb({ offer: { ...base, status: 'used' } }), token, NOW)).error, 'offer_used')
  assert.equal((await loadOpenOffer(fakeDb({ offer: { ...base, status: 'cancelled' } }), token, NOW)).error, 'offer_cancelled')
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), token, new Date('2026-09-29T11:30:00Z'))).error, 'offer_expired')
  assert.equal((await loadOpenOffer(fakeDb({ offer: base }), 'court', NOW)).error, 'offer_invalid')
  const future = { ...base, expires_at: '2099-01-01T00:00:00Z', starts_at: '2099-01-02T14:00:00.000Z' }
  const args = { practitioner: { id: PRACT, is_active: true }, service: { id: 'svc-1', duration_min: 60 }, date: '2099-01-02', token }
  await assert.rejects(validateOfferSlot({ supabase: fakeDb({ offer: future }), ...args, time: '16:00', fetchImpl: googleWith([]) }), /offer_invalid/)
  await assert.rejects(validateOfferSlot({ supabase: fakeDb({ offer: future }), ...args, time: '15:00', fetchImpl: googleWith([{ summary: 'Dentiste' }]) }), /slot_unavailable/)
  const ok = await validateOfferSlot({ supabase: fakeDb({ offer: future }), ...args, time: '15:00', fetchImpl: googleWith([{ summary: 'Urgence' }]) })
  assert.equal(ok.offerId, 'o1')
})

test('cancel and capture go through the database transactions (no JS race)', async () => {
  const rpcDb = (reply) => {
    const db = fakeDb()
    db.rpcCalls = []
    db.rpc = (name, args) => { db.rpcCalls.push({ name, args }); return Promise.resolve({ data: reply, error: null }) }
    return db
  }
  const late = rpcDb({ ok: false, error: 'offer_payment_in_progress' })
  const tooLate = await cancelSlotOffer({ db: late, userId: OWNER, input: { id: 'o1', practitioner_id: PRACT } })
  assert.deepEqual([tooLate.status, tooLate.body.error], [409, 'offer_payment_in_progress'])
  assert.deepEqual(late.rpcCalls[0], { name: 'cancel_slot_offer', args: { p_offer_id: 'o1', p_practitioner_id: PRACT } })
  assert.equal((await cancelSlotOffer({ db: rpcDb({ ok: true }), userId: OWNER, input: { id: 'o1', practitioner_id: PRACT } })).status, 200)
  assert.equal((await cancelSlotOffer({ db: rpcDb({ ok: true }), userId: 'intrus', input: { id: 'o1', practitioner_id: PRACT } })).status, 403)

  // Ordre créé avant expiration, approuvé après : la base expire hold + paiement.
  const expired = rpcDb({ ok: true, released: true, error: 'offer_expired' })
  assert.equal(await offerBlocksCapture(expired, 'ORDER1'), 'offer_expired')
  assert.deepEqual(expired.rpcCalls[0], { name: 'release_slot_offer_hold', args: { p_paypal_order_id: 'ORDER1' } })
  assert.equal(await offerBlocksCapture(rpcDb({ ok: true, released: false }), 'ORDER1'), null)

  // Annulation arrivée pendant la réclamation : le déclencheur fait échouer claim.
  assert.equal(offerErrorFromClaim({ message: 'slot_offer_cancelled' }), 'offer_cancelled')
  assert.equal(offerErrorFromClaim({ message: 'slot_offer_expired' }), 'offer_expired')
  assert.equal(offerErrorFromClaim({ message: 'other' }), null)
  assert.equal(offerErrorFromClaim(null), null)
})

test('the database guard covers cancel ↔ capture and expiry (SQL scenarios A–E)', () => {
  const sql = read('supabase/migrations/20260929042858_rdv_slot_offers.sql')
  assert.match(sql, /before update of status on public\.rdv_booking_holds\s+for each row execute function public\.guard_slot_offer_capture\(\)/)
  assert.match(sql, /v_offer\.expires_at <= now\(\) or v_offer\.starts_at <= now\(\) then raise exception 'slot_offer_expired'/)
  assert.match(sql, /select \* into v_offer from public\.booking_slot_offers where id = new\.slot_offer_id for update/)
  // Même ordre de verrouillage que claim_rdv_deposit_capture : hold + paiement, puis offre.
  const cancel = sql.slice(sql.indexOf('function public.cancel_slot_offer'), sql.indexOf('function public.release_slot_offer_hold'))
  assert.ok(cancel.indexOf('for update of h, p') < cancel.indexOf('from public.booking_slot_offers'))
  assert.match(sql, /grant execute on function public\.cancel_slot_offer\(uuid, uuid\) to service_role/)
  const race = read('supabase/tests/rdv_slot_offers_race/run.sh')
  assert.match(race, /A\. La capture réclame d'abord/)
  assert.match(race, /C\. Ordre PayPal créé avant expiration, approuvé après/)
})

test('preview links stay on the preview deployment', () => {
  assert.equal(slotOfferUrl('sebastien-seguin', 'abc', { VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'x.vercel.app' }), 'https://x.vercel.app/rdv/sebastien-seguin#offre=abc')
})

test('payment, booking page and shortcut are wired to the personal link', () => {
  for (const file of ['lib/rdvDepositApiHandler.js', 'lib/rdvFullPaymentApiHandler.js']) {
    const src = read(file)
    assert.match(src, /slot = offer_token\s+\? await validateOfferSlot/)
    assert.match(src, /await attachOfferToHold\(supabase, holdResult\.hold_id, slot\.offerId\)/)
  }
  const deposit = read('lib/rdvDepositApiHandler.js')
  assert.ok(deposit.indexOf('offerBlocksCapture(supabase, orderId)') < deposit.indexOf("rpc('claim_rdv_deposit_capture'"))
  assert.match(deposit, /const claimOfferError = offerErrorFromClaim\(claimError\)/)
  assert.match(deposit, /await markOfferUsed\(supabase, booking\)/)
  assert.match(read('api/rdv-book.js'), /if \(action === 'offer'\) \{\s+if \(req\.method !== 'POST'\)/)
  const page = read('src/components/rdv/RdvPublic.jsx')
  assert.match(page, /window\.location\.hash\.slice\(1\)\)\.get\('offre'\)/)
  assert.match(page, /offerToken=\{offer\?\.token \|\| null\}/)
  assert.match(read('src/components/rdv/RdvDepositCheckout.jsx'), /offer_token: offerToken/)
  assert.match(read('src/components/rdv/AccountingSection.jsx'), /window\.location\.hash === '#proposer'/)
  assert.match(read('src/components/rdv/ManualPaymentModal.jsx'), /mediumia:slot-offer/)
  const sql = read('supabase/migrations/20260929042858_rdv_slot_offers.sql')
  assert.match(sql, /revoke all on table public\.booking_slot_offers from public, anon, authenticated/)
  assert.match(sql, /check \(expires_at <= starts_at\)/)
  assert.match(sql, /add column if not exists slot_offer_id uuid references public\.booking_slot_offers\(id\)/)
})
