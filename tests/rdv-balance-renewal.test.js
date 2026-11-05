import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('reminder payment window lasts to H-12, protected against H-48 auto cancellation', () => {
  const cron = read('lib/rdvBalanceCronHandler.js')
  const reminder = cron.slice(cron.indexOf('async function processReminder('), cron.indexOf('async function processAutoCancel('))
  assert.match(reminder, /getTime\(\) - 12 \* 3_600_000/)
  assert.match(reminder, /balance_late_payment_until: deadlineAt\.toISOString\(\)/)
  assert.match(reminder, /if \(extensionError \|\| !extended\) throw new Error/)
  assert.match(reminder, /balancePaymentUrl\(token\)/)
  const cancellation = cron.slice(cron.indexOf('async function processAutoCancel('), cron.indexOf('export function needsPreCancelAlert('))
  assert.match(cancellation, /booking\.balance_late_payment_until/)
  assert.match(cron, /const deadlineMs = item\.booking\.balance_late_payment_until/)
  const confirm = read('lib/rdvDepositConfirmationEmail.js')
  assert.match(confirm, /reste normalement utilisable jusqu’à 12 heures avant la séance/)
})

test('confirmed balance renewal is owner-only, never creates a second booking or ignores PayPal attempts', () => {
  const admin = read('api/rdv-admin.js')
  const handler = read('lib/rdvBalanceReviewAdmin.js')
  const ui = read('src/components/rdv/RdvBalanceWatch.jsx')
  assert.match(admin, /input\.op === 'renew'\) result = await renewConfirmedBalanceLink/)
  const renew = handler.slice(handler.indexOf('export async function renewConfirmedBalanceLink('))
  assert.match(renew, /await authorize\(supabase, userId, input\.practitioner_id\)/)
  assert.match(renew, /booking\.status !== 'confirmed'/)
  assert.match(renew, /booking\.balance_paid_at \|\| booking\.balance_cancel_claimed_at/)
  assert.match(renew, /\.from\('rdv_balance_payments'\)/)
  assert.match(renew, /if \(paymentError \|\| existing\)/)
  assert.match(renew, /randomBytes\(32\)\.toString\('base64url'\)/)
  assert.match(renew, /balance_late_payment_until: expiresAt\.toISOString\(\)/)
  assert.match(renew, /sendRestoredEmail\(/)
  assert.doesNotMatch(renew, /\.from\('bookings'\)\.insert\(/)
  assert.match(ui, /op: 'renew', booking_id: item\.booking_id, hours_before: 1, send_email: true/)
})
