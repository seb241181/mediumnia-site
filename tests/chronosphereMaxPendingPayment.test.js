import test from 'node:test'
import assert from 'node:assert/strict'
import { findPendingChronosphereMaxOrder } from '../lib/chronospherePayPal.js'

function fixture(rows) {
  const filters = new Map()
  const query = {
    select(column) { assert.equal(column, 'paypal_order_id'); return this },
    eq(column, value) { filters.set(column, value); return this },
    order(column, options) { assert.equal(column, 'created_at'); assert.equal(options.ascending, false); return this },
    limit(value) { assert.equal(value, 1); return this },
    async maybeSingle() {
      const data = rows.filter((row) => [...filters].every(([column, value]) => row[column] === value))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      return { data: data ? { paypal_order_id: data.paypal_order_id } : null, error: null }
    },
  }
  return { from(table) { assert.equal(table, 'chronosphere_credit_packs'); return query } }
}

test('pending MAX order is recovered by authenticated owner, product, environment and state', async () => {
  const rows = [
    { user_id: 'A', product_type: 'max3', paypal_env: 'sandbox', status: 'payment_pending', paypal_order_id: 'A-older', created_at: '2026-10-01' },
    { user_id: 'A', product_type: 'max3', paypal_env: 'sandbox', status: 'payment_pending', paypal_order_id: 'A-latest', created_at: '2026-10-02' },
    { user_id: 'B', product_type: 'max3', paypal_env: 'sandbox', status: 'payment_pending', paypal_order_id: 'B-order', created_at: '2026-10-03' },
    { user_id: 'A', product_type: 'max3', paypal_env: 'live', status: 'payment_pending', paypal_order_id: 'A-live', created_at: '2026-10-04' },
    { user_id: 'A', product_type: 'pack3', paypal_env: 'sandbox', status: 'payment_pending', paypal_order_id: 'A-classic', created_at: '2026-10-05' },
    { user_id: 'A', product_type: 'max3', paypal_env: 'sandbox', status: 'active', paypal_order_id: 'A-captured', created_at: '2026-10-06' },
  ]
  const db = fixture(rows)
  assert.equal(await findPendingChronosphereMaxOrder(db, 'A', 'sandbox'), 'A-latest')
  assert.equal(await findPendingChronosphereMaxOrder(db, 'B', 'sandbox'), 'B-order')
  assert.equal(await findPendingChronosphereMaxOrder(db, 'C', 'sandbox'), null)
})
