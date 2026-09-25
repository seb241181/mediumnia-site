import test from 'node:test'
import assert from 'node:assert/strict'

const { summarize, scheduleFor, nextStepModules, exceedsCap, CAP_CENTS } = await import('../lib/formationProgression.js')

const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 86_400_000).toISOString()
const discovery = { kind: 'discovery', value_cents: 2900, paid_at: day(0) }
const monthly = (n) => ({ kind: 'monthly', value_cents: 3400, paid_at: day(30 * n) })

test('the whole path costs exactly 397 € and opens the 25 modules', () => {
  const schedule = scheduleFor(summarize([discovery]).remainingCents)
  assert.deepEqual([schedule.mode, schedule.regularCount, schedule.finalCents], ['subscription', 10, 2800])
  const payments = [discovery]
  const opened = []
  for (let i = 1; i <= 10; i += 1) {
    payments.push(monthly(i))
    opened.push(summarize(payments).maxModule)
  }
  assert.deepEqual(opened, [3, 5, 7, 9, 11, 13, 15, 17, 19, 21], 'each intermediate step opens 2 modules')
  payments.push({ kind: 'monthly', value_cents: 2800, paid_at: day(330) })
  const end = summarize(payments)
  assert.deepEqual([end.paidCents, end.maxModule, end.complete, end.remainingCents], [CAP_CENTS, 25, true, 0], 'the final step opens modules 22 to 25')
  assert.equal(scheduleFor(end.remainingCents), null, 'nothing more is ever scheduled')
})

test('resuming after the Discovery and 2 instalments: 300 € left, 8 × 34 € then 28 €', () => {
  const s = summarize([discovery, monthly(1), monthly(2)])
  assert.deepEqual([s.paidCents, s.maxModule, s.remainingCents], [9700, 5, 30000])
  const schedule = scheduleFor(s.remainingCents)
  assert.deepEqual([schedule.regularCount, schedule.finalCents], [8, 2800])
  assert.equal(8 * 3400 + 2800 + 9700, CAP_CENTS)
  assert.deepEqual(nextStepModules(s), [6, 7])
})

test('former Discovery buyers: 368 € left, their 29 € count', () => {
  const s = summarize([discovery])
  assert.deepEqual([s.maxModule, s.remainingCents], [1, 36800])
  assert.deepEqual(nextStepModules(s), [2, 3])
})

test('"unlock everything" pays exactly what is left, and any path ends at 397 €', () => {
  for (let m = 0; m <= 10; m += 1) {
    const payments = [discovery, ...Array.from({ length: m }, (_, i) => monthly(i + 1))]
    const s = summarize(payments)
    const unlock = { kind: 'unlock', value_cents: s.remainingCents, paid_at: day(400) }
    const after = summarize([...payments, unlock])
    assert.equal(after.paidCents, CAP_CENTS)
    assert.equal(after.maxModule, 25)
  }
})

test('when 34 € or less is left, the last step is a single payment opening every remaining module', () => {
  const payments = [discovery, ...Array.from({ length: 10 }, (_, i) => monthly(i + 1))]
  const s = summarize(payments)
  assert.deepEqual(scheduleFor(s.remainingCents), { mode: 'single', regularCount: 0, finalCents: 2800, totalCents: 2800 })
  assert.deepEqual(nextStepModules(s), [22, 23, 24, 25])
})

test('the server refuses anything above 397 €', () => {
  const s = summarize([discovery, ...Array.from({ length: 10 }, (_, i) => monthly(i + 1))])
  assert.equal(exceedsCap(s, 2800), false)
  assert.equal(exceedsCap(s, 3400), true)
})

test('refunds lower the total and close the matching step', () => {
  const s = summarize([discovery, monthly(1), monthly(2), { kind: 'refund', refunded_kind: 'monthly', value_cents: 3400, paid_at: day(70) }])
  assert.deepEqual([s.paidCents, s.monthlyCount, s.maxModule], [6300, 1, 3])
})

test('coach: 12 months after the last payment, 30 days for a Discovery alone; the 597 € buyers are complete', () => {
  assert.equal(summarize([discovery]).coachUntil, day(30))
  assert.equal(summarize([discovery, monthly(1)]).coachUntil, '2027-10-31T00:00:00.000Z')
  const founder = summarize([{ kind: 'full', value_cents: 59700, paid_at: day(0) }])
  assert.deepEqual([founder.complete, founder.maxModule, founder.remainingCents], [true, 25, 0])
})
