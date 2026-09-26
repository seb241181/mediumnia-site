import test from 'node:test'
import assert from 'node:assert/strict'

const { summarize, scheduleFor, nextStepModules, exceedsCap, CAP_CENTS, STEP_CENTS, DISCOVERY_CENTS } = await import('../lib/formationProgression.js')

const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 86_400_000).toISOString()
const discovery = { kind: 'discovery', value_cents: 2900, paid_at: day(0) }
const monthly = (n) => ({ kind: 'monthly', value_cents: 4800, paid_at: day(30 * n) })
const months = (k) => Array.from({ length: k }, (_, i) => monthly(i + 1))

test('the amounts are the validated ones: 597 € cap, 29 € Découverte, 48 € steps', () => {
  assert.deepEqual([CAP_CENTS, DISCOVERY_CENTS, STEP_CENTS], [59700, 2900, 4800])
})

test('the whole path is 29 € + 11 × 48 € + 40 € = 597 € and opens the 25 modules', () => {
  const schedule = scheduleFor(summarize([discovery]).remainingCents)
  assert.deepEqual([schedule.mode, schedule.regularCount, schedule.finalCents, schedule.totalCents], ['subscription', 11, 4000, 56800])
  assert.equal(2900 + 11 * 4800 + 4000, CAP_CENTS)
  const payments = [discovery]
  const opened = []
  for (let i = 1; i <= 11; i += 1) {
    payments.push(monthly(i))
    opened.push(summarize(payments).maxModule)
  }
  assert.deepEqual(opened, [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23], 'each 48 € step opens 2 modules')
  payments.push({ kind: 'monthly', value_cents: 4000, paid_at: day(360) })
  const end = summarize(payments)
  assert.deepEqual([end.paidCents, end.maxModule, end.complete, end.remainingCents], [CAP_CENTS, 25, true, 0], 'the last 40 € opens modules 24 and 25')
  assert.equal(scheduleFor(end.remainingCents), null, 'nothing more is ever scheduled')
})

test('the running total matches the published table (29 · 77 · 125 … 557 · 597)', () => {
  const totals = [summarize([discovery]).paidCents]
  for (let k = 1; k <= 11; k += 1) totals.push(summarize([discovery, ...months(k)]).paidCents)
  assert.deepEqual(totals.map((c) => c / 100), [29, 77, 125, 173, 221, 269, 317, 365, 413, 461, 509, 557])
})

test('after k instalments, the rest is (11 − k) × 48 € then 40 €, never more than 597 € in all', () => {
  for (let k = 0; k <= 10; k += 1) {
    const s = summarize([discovery, ...months(k)])
    const schedule = scheduleFor(s.remainingCents)
    assert.deepEqual([schedule.regularCount, schedule.finalCents], [11 - k, 4000], `after ${k} instalments`)
    assert.equal(s.paidCents + schedule.totalCents, CAP_CENTS)
    assert.deepEqual(nextStepModules(s), [2 + 2 * k, 3 + 2 * k])
  }
})

test('after 11 instalments, the last step is a single 40 € payment opening modules 24 and 25', () => {
  const s = summarize([discovery, ...months(11)])
  assert.deepEqual([s.paidCents, s.maxModule, s.remainingCents], [55700, 23, 4000])
  assert.deepEqual(scheduleFor(s.remainingCents), { mode: 'single', regularCount: 0, finalCents: 4000, totalCents: 4000 })
  assert.deepEqual(nextStepModules(s), [24, 25])
})

test('"unlock everything" pays exactly what is left, and any path ends at 597 €', () => {
  for (let k = 0; k <= 11; k += 1) {
    const payments = [discovery, ...months(k)]
    const s = summarize(payments)
    assert.equal(s.remainingCents, CAP_CENTS - 2900 - 4800 * k)
    const after = summarize([...payments, { kind: 'unlock', value_cents: s.remainingCents, paid_at: day(400) }])
    assert.deepEqual([after.paidCents, after.maxModule, after.complete], [CAP_CENTS, 25, true])
  }
  assert.equal(summarize([discovery]).remainingCents, 56800, 'right after the Découverte: 568 €')
})

test('the server refuses anything above 597 €', () => {
  const s = summarize([discovery, ...months(11)])
  assert.equal(exceedsCap(s, 4000), false)
  assert.equal(exceedsCap(s, 4800), true)
  assert.equal(exceedsCap(summarize([discovery]), 56800), false)
  assert.equal(exceedsCap(summarize([discovery]), 59700), true, 'a Découverte holder never pays 597 € more')
})

test('refunds lower the total and close the matching step', () => {
  const s = summarize([discovery, monthly(1), monthly(2), { kind: 'refund', refunded_kind: 'monthly', value_cents: 4800, paid_at: day(70) }])
  assert.deepEqual([s.paidCents, s.monthlyCount, s.maxModule], [7700, 1, 3])
})

test('a refunded Découverte no longer opens the parcours and no longer counts', () => {
  const s = summarize([discovery, { kind: 'refund', refunded_kind: 'discovery', value_cents: 2900, paid_at: day(5) }])
  assert.deepEqual([s.hasDiscovery, s.paidCents, s.maxModule, s.remainingCents, s.coachUntil], [false, 0, 0, CAP_CENTS, null])
})

test('stop and resume: nothing unlocked is lost, the schedule restarts from what is left', () => {
  const stopped = summarize([discovery, ...months(4)])
  assert.deepEqual([stopped.maxModule, stopped.remainingCents], [9, 37600])
  const resumed = scheduleFor(stopped.remainingCents)
  assert.deepEqual([resumed.regularCount, resumed.finalCents], [7, 4000])
})

test('coach: 12 months after the last payment, 30 days for a Découverte alone; complete buyers are complete', () => {
  assert.equal(summarize([discovery]).coachUntil, day(30))
  assert.equal(summarize([discovery, monthly(1)]).coachUntil, '2027-10-31T00:00:00.000Z')
  for (const full of [59700, 56800]) {
    const buyer = summarize([{ kind: 'full', value_cents: full, paid_at: day(0) }])
    assert.deepEqual([buyer.complete, buyer.maxModule, buyer.remainingCents], [true, 25, 0])
    assert.equal(scheduleFor(buyer.remainingCents), null, 'a complete student is never charged again')
  }
})
