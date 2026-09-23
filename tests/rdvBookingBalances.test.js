import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { bookingBalances } from '../lib/rdvDayPayments.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('each agenda booking shows what is left to pay, online payments included', () => {
  const balances = bookingBalances(
    [
      { id: 'a', service_id: 's1', status: 'confirmed', booked_price_cents: 8000 },
      { id: 'b', service_id: 's1', status: 'confirmed', booked_price_cents: null },
      { id: 'c', service_id: 's1', status: 'cancelled', booked_price_cents: 8000 },
    ],
    [{ id: 's1', price_cents: 7000 }],
    [
      { booking_id: 'a', payment_method: 'paypal', direction: 'income', gross_cents: 2000 },
      { booking_id: 'a', payment_method: 'cash', direction: 'income', gross_cents: 1000 },
      { booking_id: 'b', payment_method: 'paypal', direction: 'income', gross_cents: 7000 },
      { booking_id: 'b', payment_method: 'paypal', direction: 'refund', gross_cents: 500 },
    ],
  )
  assert.deepEqual(balances.a, { total_cents: 8000, paid_cents: 3000, online_cents: 2000, remaining_cents: 5000 })
  assert.equal(balances.b.total_cents, 7000)
  assert.equal(balances.b.remaining_cents, 500)
  assert.equal(balances.c.remaining_cents, 0)
})

test('agenda rows use the reconciled status and every payment refreshes the other views', () => {
  const script = read('scripts/apply-rdv-manual-payments.mjs')
  assert.match(script, /<BookingPaymentStatus booking=\{b\} practitionerId=\{activePractitioner\.id\} session=\{session\} \/>/)
  assert.match(script, /import BookingPaymentStatus from '\.\/BookingPaymentStatus\.jsx'/)
  const status = read('src/components/rdv/BookingPaymentStatus.jsx')
  assert.match(status, /action: 'booking-balances'/)
  assert.match(status, /\{!settled && \(/)
  assert.match(status, /Encaisser sur place/)
  assert.match(read('src/components/rdv/ManualPaymentModal.jsx'), /new CustomEvent\('mediumia:finance-saved'\)/)
  assert.match(read('src/components/rdv/DailyPayments.jsx'), /addEventListener\('mediumia:finance-saved', load\)/)
  assert.match(read('api/rdv-admin.js'), /case 'booking-balances':/)
  assert.match(read('lib/rdvDayPayments.js'), /bookingIds\.length > 100/)
})
