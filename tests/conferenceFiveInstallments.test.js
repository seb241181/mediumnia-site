import test from 'node:test'
import assert from 'node:assert/strict'
import { CONFERENCE_FIVE_PLAN, conferenceFiveDueDates, summarizeConferenceFiveLedger } from '../lib/conferenceFiveInstallments.js'

const payment = (number, overrides = {}) => ({
  captureId: `TEST-CAPTURE-${number}`,
  status: 'COMPLETED',
  amountCents: 9980,
  currency: 'EUR',
  paypalEnv: 'sandbox',
  ...overrides,
})

test('conference 5x: exactly five 99.80 EUR payments total 499 EUR', () => {
  assert.equal(CONFERENCE_FIVE_PLAN.instalments, 5)
  assert.equal(CONFERENCE_FIVE_PLAN.instalmentCents * CONFERENCE_FIVE_PLAN.instalments, CONFERENCE_FIVE_PLAN.totalCents)
  assert.equal(CONFERENCE_FIVE_PLAN.totalCents, 49900)
})

test('conference 5x: monthly dates retain anchor day and clamp month-end', () => {
  assert.deepEqual(conferenceFiveDueDates('2026-10-31T09:30:00Z'), [
    '2026-10-31T09:30:00.000Z',
    '2026-11-30T09:30:00.000Z',
    '2026-12-31T09:30:00.000Z',
    '2027-01-31T09:30:00.000Z',
    '2027-02-28T09:30:00.000Z',
  ])
  assert.throws(() => conferenceFiveDueDates('bad-date'), /invalid_first_charge_date/)
})

test('conference 5x: no full rights before the fifth verified payment', () => {
  for (let n = 0; n < 5; n++) {
    const status = summarizeConferenceFiveLedger({ captures: Array.from({ length: n }, (_, i) => payment(i + 1)) })
    assert.equal(status.fullyPaid, false)
    assert.equal(status.paidInstalments, n)
    assert.equal(status.remainingCents, 49900 - n * 9980)
  }
  assert.deepEqual(summarizeConferenceFiveLedger({ captures: [1, 2, 3, 4, 5].map(n => payment(n)) }), {
    netCents: 49900,
    paidInstalments: 5,
    remainingCents: 0,
    fullyPaid: true,
    anomalies: [],
  })
})

test('conference 5x: webhook replay does not count twice', () => {
  const status = summarizeConferenceFiveLedger({ captures: [payment(1), payment(1), payment(1)] })
  assert.equal(status.paidInstalments, 1)
  assert.equal(status.netCents, 9980)
  assert.equal(status.fullyPaid, false)
})

test('conference 5x: wrong amount, uncompleted or wrong environment cannot unlock', () => {
  const captures = [
    payment(1),
    payment(2, { amountCents: 59700 }),
    payment(3, { status: 'PENDING' }),
    payment(4, { paypalEnv: 'live' }),
    payment(5, { currency: 'USD' }),
  ]
  const status = summarizeConferenceFiveLedger({ captures })
  assert.equal(status.paidInstalments, 1)
  assert.equal(status.fullyPaid, false)
  assert.ok(status.anomalies.includes('unexpected_capture_amount'))
})

test('conference 5x: refunds revoke fully-paid calculation, even if paid before', () => {
  const captures = [1, 2, 3, 4, 5].map(n => payment(n))
  const refunds = [
    { refundId: 'REFUND-1', captureId: 'TEST-CAPTURE-2', status: 'COMPLETED', amountCents: 1000, currency: 'EUR', paypalEnv: 'sandbox' },
  ]
  const summary = summarizeConferenceFiveLedger({ captures, refunds: [...refunds, ...refunds] })
  assert.equal(summary.paidInstalments, 4)
  assert.equal(summary.netCents, 48900)
  assert.equal(summary.remainingCents, 1000)
  assert.equal(summary.fullyPaid, false)
})

test('conference 5x: a sixth distinct capture is anomalous, not authorization', () => {
  const summary = summarizeConferenceFiveLedger({ captures: [1, 2, 3, 4, 5, 6].map(n => payment(n)) })
  assert.ok(summary.anomalies.includes('too_many_captures'))
  assert.equal(summary.fullyPaid, false)
})

test('conference 5x: refunds referencing unknown captures are anomalous', () => {
  const status = summarizeConferenceFiveLedger({
    captures: [1, 2, 3, 4, 5].map(n => payment(n)),
    refunds: [{ refundId: 'unknown', captureId: 'not-recorded', status: 'COMPLETED', amountCents: 9980, currency: 'EUR', paypalEnv: 'sandbox' }],
  })
  assert.ok(status.anomalies.includes('invalid_refund'))
  assert.equal(status.fullyPaid, false)
})
