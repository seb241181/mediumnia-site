import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

const { findUsableGiftCard, reserveGiftBalance, restoreGiftBalance, hashGiftCode, restoreGiftForCancelledBooking } = await import('../lib/giftCards.js')
const { summarizeDay, parisDayBounds } = await import('../lib/rdvDayPayments.js')
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Minimal in-memory Supabase query builder (eq / is / select / update / insert).
function fakeDb(tables) {
  const inserts = []
  const from = (name) => {
    const filters = []
    let patch = null
    let insertRow = null
    const rows = () => (tables[name] || []).filter((r) => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)))
    const api = {
      select() { return api }, eq(k, v) { filters.push([k, v]); return api }, is(k, v) { filters.push([k, v]); return api },
      update(p) { patch = p; return api }, insert(row) { insertRow = row; inserts.push([name, row]); return Promise.resolve({ data: null, error: null }) },
      maybeSingle() {
        const found = rows()
        if (patch) { found.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: found[0] ? { id: found[0].id } : null, error: null }) }
        return Promise.resolve({ data: found[0] || null, error: null })
      },
      then(resolve) { return resolve({ data: rows(), error: null }) },
    }
    return api
  }
  return { from, inserts, rpc: async () => ({ data: { allowed: true } }) }
}

const future = new Date(Date.now() + 200 * 86_400_000).toISOString()
const card = () => ({ id: 'g1', code_hash: hashGiftCode('MDIA-ABCD-EFGH'), code_last4: 'EFGH', status: 'active', expires_at: future, balance_cents: 8000, consultation_credit_cents: 8000, chronosphere_product: null, label: 'Carte cadeau 80,00 €' })

test('a code is found whatever the typing, and refused when expired or used', async () => {
  const db = fakeDb({ gift_cards: [card()] })
  assert.equal((await findUsableGiftCard(db, 'mdia abcd efgh')).card.id, 'g1')
  assert.equal((await findUsableGiftCard(db, 'MDIA-ZZZZ-ZZZZ')).error, 'gift_code_invalid')
  assert.equal((await findUsableGiftCard(fakeDb({ gift_cards: [{ ...card(), expires_at: '2020-01-01T00:00:00Z' }] }), 'MDIA-ABCD-EFGH')).error, 'gift_code_expired')
  assert.equal((await findUsableGiftCard(fakeDb({ gift_cards: [{ ...card(), balance_cents: 0 }] }), 'MDIA-ABCD-EFGH')).error, 'gift_code_used')
})

test('a balance can only be spent once, and is restored if the booking fails', async () => {
  const tables = { gift_cards: [card()] }
  const db = fakeDb(tables)
  const snapshot = { ...tables.gift_cards[0] }
  assert.equal(await reserveGiftBalance(db, snapshot, 8000), true)
  assert.equal(tables.gift_cards[0].balance_cents, 0)
  assert.equal(tables.gift_cards[0].status, 'used')
  // A second booking holding the same (stale) snapshot cannot spend it again.
  assert.equal(await reserveGiftBalance(db, snapshot, 8000), false)
  assert.equal(await reserveGiftBalance(db, snapshot, 9000), false, 'never more than the balance')
  assert.equal(await restoreGiftBalance(db, 'g1', 8000), true)
  assert.deepEqual([tables.gift_cards[0].balance_cents, tables.gift_cards[0].status], [8000, 'active'])
})

test('cancelling in time gives the amount back to the card', async () => {
  const tables = { gift_cards: [{ ...card(), balance_cents: 1000, status: 'active' }], gift_card_redemptions: [{ gift_card_id: 'g1', booking_id: 'b1', amount_cents: 7000 }] }
  const db = fakeDb(tables)
  assert.equal(await restoreGiftForCancelledBooking(db, { id: 'b1', practitioner_id: 'p1' }), 7000)
  assert.equal(tables.gift_cards[0].balance_cents, 8000)
  const refund = db.inserts.find(([t, row]) => t === 'rdv_financial_entries' && row.direction === 'refund')
  assert.equal(refund[1].payment_method, 'gift_card')
})

test('a gift card use settles the booking but is not counted again as revenue', () => {
  const { start, end } = parisDayBounds('2026-10-02')
  const result = summarizeDay(
    [{ id: 'b1', service_id: 's1', status: 'confirmed', booked_price_cents: 8000, customer_first_name: 'Claire', starts_at: '2026-10-02T08:00:00Z', ends_at: '2026-10-02T09:00:00Z' }],
    [{ id: 's1', title: 'Guidance', price_cents: 8000, vat_rate_bps: 2000 }],
    [
      { id: 'e1', booking_id: 'b1', payment_method: 'gift_card', entry_kind: 'arrhes', direction: 'income', occurred_at: '2026-10-02T07:00:00Z', gross_cents: 5000, net_cents: 5000, vat_cents: 0 },
      { id: 'e2', booking_id: 'b1', payment_method: 'cash', entry_kind: 'balance', direction: 'income', occurred_at: '2026-10-02T09:00:00Z', gross_cents: 3000, net_cents: 2500, vat_cents: 500 },
    ],
    start, end,
  )
  assert.equal(result.bookings[0].remaining_cents, 0)
  assert.equal(result.collected.totals.gross_cents, 3000, 'only the cash is revenue today')
  assert.match(read('scripts/apply-rdv-accounting-dashboard.mjs'), /\.neq\('payment_method', 'gift_card'\)/)
})

test('rdv-book refuses a deposit service without payment, unless a gift card covers the deposit', () => {
  const api = read('api/rdv-book.js')
  const guard = api.indexOf("code: 'online_payment_required'")
  assert.ok(guard > 0)
  assert.ok(guard < api.indexOf("supabase.rpc('create_booking'"), 'checked before any booking is created')
  assert.match(api, /code: 'gift_balance_too_low'/)
  assert.match(api, /code: 'gift_must_cover_full'/)
  // Balance reserved just before the insert, and restored if the insert fails.
  assert.ok(api.indexOf('reserveGiftBalance(supabase, gift.card, gift.appliedCents)') < api.indexOf("supabase.rpc('create_booking'"))
  assert.match(api, /if \(gift && \(rpcErr \|\| !rpcResult \|\| rpcResult\.conflict\)\) \{\n    await restoreGiftBalance/)
  assert.match(api, /restoreGiftForCancelledBooking\(supabase, booking\)/)
})
