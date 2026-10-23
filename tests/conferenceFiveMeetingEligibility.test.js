import test from 'node:test'
import assert from 'node:assert/strict'
import { CONFERENCE_FIVE_PLAN, conferenceFiveMeetingEligibility } from '../lib/conferenceFiveInstallments.js'

const USER_ID = 'student-authorized-by-owner'
const SUBSCRIPTION_ID = 'I-TESTABC1234'
const date = [
  '2026-10-23T10:00:00Z',
  '2026-11-23T10:00:00Z',
  '2026-12-23T10:00:00Z',
  '2027-01-23T10:00:00Z',
  '2027-02-23T10:00:00Z',
]
const contract = {
  userId: USER_ID,
  offerCode: CONFERENCE_FIVE_PLAN.code,
  paypalEnv: 'sandbox',
  paypalSubscriptionId: SUBSCRIPTION_ID,
  status: 'active',
  meetingsApproved: true,
}
const capture = i => ({
  subscriptionId: SUBSCRIPTION_ID,
  captureId: `CAPTURE-${i}`,
  status: 'COMPLETED',
  currency: 'EUR',
  amountCents: 9980,
  paypalEnv: 'sandbox',
})
const eligible = (paid, options = {}) => conferenceFiveMeetingEligibility({
  contract,
  userId: USER_ID,
  captures: Array.from({ length: paid }, (_, i) => capture(i + 1)),
  dueDates: date,
  now: '2027-01-16T09:00:00Z', // 10:00 Paris, Jan 16 2027
  paypalEnv: 'sandbox',
  ...options,
})

test('5x conference: three settled payments suffice for the January meeting (not all five)', () => {
  assert.deepEqual(eligible(3), {
    eligible: true,
    reason: null,
    scope: 'conference_meetings_only',
    fullyPaid: false,
  })
})

test('5x conference: due fourth payment blocks February if unpaid', () => {
  assert.deepEqual(eligible(3, { now: '2027-01-24T09:00:00Z' }), {
    eligible: false,
    reason: 'payment_overdue',
    scope: 'conference_meetings_only',
  })
  assert.equal(eligible(4, { now: '2027-01-24T09:00:00Z' }).eligible, true)
})

test('5x conference: first payment is mandatory; repeat notifications do not multiply instalments', () => {
  assert.equal(eligible(0, { now: '2026-10-24T10:00:00Z' }).reason, 'first_payment_missing')
  assert.equal(eligible(1, { now: '2027-01-16T09:00:00Z', captures: [capture(1), capture(1), capture(1)] }).reason, 'payment_overdue')
})

test('5x conference: a refund suspends provisional meeting rights immediately', () => {
  const refund = {
    subscriptionId: SUBSCRIPTION_ID,
    refundId: 'REFUND-1',
    captureId: 'CAPTURE-1',
    status: 'COMPLETED',
    currency: 'EUR',
    amountCents: 9980,
    paypalEnv: 'sandbox',
  }
  assert.equal(eligible(3, { refunds: [refund] }).reason, 'payment_refunded')
  assert.equal(eligible(5, { refunds: [refund] }).eligible, false)
})

test('5x conference: no privilege if access not personally approved, or different student', () => {
  assert.equal(eligible(3, { userId: 'another-student' }).reason, 'not_individually_authorized')
  assert.equal(eligible(3, { contract: { ...contract, meetingsApproved: false } }).reason, 'not_individually_authorized')
  assert.equal(eligible(3, { contract: { ...contract, offerCode: 'ordinary-progressive-597' } }).reason, 'not_individually_authorized')
  assert.equal(eligible(3, { contract: { ...contract, status: 'cancelled' } }).reason, 'contract_not_active')
  assert.equal(eligible(3, { contract: { ...contract, status: 'suspended' } }).reason, 'contract_not_active')
})

test('5x conference: never accept unrelated payments or a Sandbox/Live mismatch', () => {
  assert.equal(eligible(3, { captures: [capture(1), capture(2), { ...capture(3), subscriptionId: 'I-OTHER' }] }).reason, 'payment_source_mismatch')
  assert.equal(eligible(3, { contract: { ...contract, paypalEnv: 'live' } }).reason, 'payment_environment_mismatch')
  assert.equal(eligible(3, { contract: { ...contract, paypalSubscriptionId: '' } }).reason, 'subscription_unverified')
})

test('5x conference: invalid schedule cannot grant rights', () => {
  assert.equal(eligible(3, { dueDates: [date[0], date[1]] }).reason, 'invalid_payment_schedule')
  assert.equal(eligible(3, { dueDates: [date[0], date[2], date[1], date[3], date[4]] }).reason, 'invalid_payment_schedule')
  assert.equal(eligible(3, { now: 'not-a-date' }).reason, 'invalid_current_time')
  assert.equal(eligible(3, { now: '2026-10-22T10:00:00Z' }).reason, 'contract_not_started')
})

test('5x conference: a fully paid participant remains eligible for visios with no full-module grant from this helper', () => {
  assert.deepEqual(eligible(5, { now: '2027-03-13T09:00:00Z', contract: { ...contract, status: 'completed' } }), {
    eligible: true,
    reason: null,
    scope: 'conference_meetings_only',
    fullyPaid: true,
  })
})
