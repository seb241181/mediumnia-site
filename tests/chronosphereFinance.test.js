import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getChronosphereIncome, splitVat, summarizeChronosphereIncome } from '../lib/chronosphereFinance.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ChronoSphère income: single draws, packs and MAX, gift-card activations excluded', () => {
  const summary = summarizeChronosphereIncome({
    draws: [
      { paypal_capture_id: 'CAP1', amount_cents: 500, captured_at: '2026-09-03T10:00:00Z' },
      { paypal_capture_id: null, amount_cents: 500, captured_at: null },
    ],
    packs: [
      { paypal_capture_id: 'CAP2', amount_cents: 990, captured_at: '2026-09-03T12:00:00Z', product_type: 'pack3' },
      { paypal_capture_id: 'CAP3', amount_cents: 1990, captured_at: '2026-09-10T09:00:00Z', product_type: 'max3' },
      { paypal_capture_id: 'GIFT-abc', amount_cents: 990, captured_at: '2026-09-11T09:00:00Z', product_type: 'pack3' },
    ],
  })
  assert.equal(summary.gross_cents, 500 + 990 + 1990)
  assert.equal(summary.count, 3)
  assert.equal(summary.products.single.count, 1)
  assert.equal(summary.products.pack3.gross_cents, 990)
  assert.equal(summary.products.max3.gross_cents, 1990)
  assert.equal(summary.gift_activations_excluded, 1)
  assert.equal(summary.net_cents + summary.vat_cents, summary.gross_cents)
  assert.deepEqual(summary.daily, [{ date: '2026-09-03', gross_cents: 1490 }, { date: '2026-09-10', gross_cents: 1990 }])
})

test('VAT is split at 20 % from TTC prices', () => {
  assert.deepEqual(splitVat(1200), { net_cents: 1000, vat_cents: 200 })
  assert.deepEqual(splitVat(990), { net_cents: 825, vat_cents: 165 })
})

function fakeSupabase({ admin = true, draws = [], packs = [] } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const q = { table, filters: [] }
      const b = {
        select() { return b }, order() { return b }, limit() { return b }, in() { return b },
        eq(k, v) { q.filters.push(['eq', k, v]); return b },
        not(k, op, v) { q.filters.push(['not', k, op, v]); return b },
        gte(k, v) { q.filters.push(['gte', k, v]); return b },
        lt(k, v) { q.filters.push(['lt', k, v]); return b },
        range() { return b },
        then(resolve) {
          calls.push(q)
          if (table === 'booking_practitioners') return Promise.resolve({ data: admin ? [{ id: 'p' }] : [], error: null }).then(resolve)
          return Promise.resolve({ data: table === 'chronosphere_paid_draws' ? draws : packs, error: null }).then(resolve)
        },
      }
      return b
    },
  }
}

test('only live PayPal payments are read, and only the platform admin sees them', async () => {
  const query = { from: '2026-08-31T22:00:00.000Z', to: '2026-09-30T22:00:00.000Z' }
  const sb = fakeSupabase({ draws: [{ paypal_capture_id: 'C', amount_cents: 500, captured_at: '2026-09-02T10:00:00Z' }] })
  const ok = await getChronosphereIncome({ supabase: sb, userId: 'u', query })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.gross_cents, 500)
  for (const table of ['chronosphere_paid_draws', 'chronosphere_credit_packs']) {
    const call = sb.calls.find((c) => c.table === table)
    assert.ok(call.filters.some(([op, k, v]) => op === 'eq' && k === 'paypal_env' && v === 'live'), `${table} live only`)
  }
  assert.equal((await getChronosphereIncome({ supabase: fakeSupabase({ admin: false }), userId: 'x', query })).status, 403)
  assert.equal((await getChronosphereIncome({ supabase: fakeSupabase(), userId: 'u', query: { from: 'x' } })).status, 400)
  assert.doesNotMatch(JSON.stringify(ok.body), /email|draw_token|pack_token|user_id/)
})

test('the accounting shows ChronoSphère next to appointments and books', () => {
  const section = read('src/components/rdv/AccountingSection.jsx')
  assert.match(section, /<ChronosphereIncome session=\{session\} from=\{monthRange\.from\} to=\{monthRange\.to\} onTotal=\{setChronosphereCents\} \/>/)
  assert.match(section, /Number\(data\?\.activity_generated_cents \|\| 0\) \+ chronosphereCents/)
  assert.match(read('api/rdv-admin.js'), /case 'chronosphere-finance':[\s\S]*getChronosphereIncome/)
})

test('Urssaf is estimated at 24,6 % of the amount before VAT', () => {
  const ui = read('src/components/rdv/ChronosphereIncome.jsx')
  assert.match(ui, /export const URSSAF_RATE = 0\.246/)
  assert.match(ui, /Math\.round\(Number\(data\.net_cents \|\| 0\) \* URSSAF_RATE\)/)
  assert.match(ui, /Net après TVA et Urssaf/)
})
