import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { nextCalendarMonth } from '../src/lib/rdvCalendarAutoAdvance.js'

const readPage = () => fs.readFileSync(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8')

test('no eligible day at the end of October advances to November without a user click', () => {
  const today = new Date(2026, 9, 30)
  const maxDate = new Date(2027, 9, 30)
  assert.equal(nextCalendarMonth(today, maxDate, false)?.getMonth(), 10)
  const page = readPage()
  assert.match(page, /if \(candidates\.length === 0\) \{\s*finishMonth\(false\)\s*return/)
})

test('calendar automatically advances across already-checked full months', () => {
  const page = readPage()
  assert.match(page, /const allKnown = candidates\.every/)
  assert.match(page, /if \(allKnown\) \{\s*finishMonth\(candidates\.some\(d => dayAvailRef\.current\[toDateStr\(d\)\] === true\)\)/)
  assert.match(page, /finishMonth\(monthHasAvailability\)/)
  assert.match(page, /\[monthKey, serviceSlug, practitionerSlug, config\]/)
})

test('availability stops the automatic search and user navigation remains manual', () => {
  const now = new Date(2026, 9, 30)
  const maxDate = new Date(2027, 9, 30)
  assert.equal(nextCalendarMonth(now, maxDate, true), null)
  assert.equal(nextCalendarMonth(now, maxDate, false, false), null)
  const page = readPage()
  assert.match(page, /autoAdvanceRef\.current = false; setViewDate\(new Date\(year, month \+ 1, 1\)\)/)
  assert.match(page, /autoAdvanceRef\.current = false; setViewDate\(new Date\(year, month - 1, 1\)\)/)
})

test('the automatic search respects the configured booking horizon and year boundaries', () => {
  const horizon = new Date(2026, 11, 8)
  assert.equal(nextCalendarMonth(new Date(2026, 10, 30), horizon, false)?.getMonth(), 11)
  assert.equal(nextCalendarMonth(new Date(2026, 11, 1), horizon, false), null)
  const farHorizon = new Date(2027, 0, 31)
  assert.equal(nextCalendarMonth(new Date(2026, 11, 31), farHorizon, false)?.getFullYear(), 2027)
  assert.equal(nextCalendarMonth(new Date(2027, 0, 1), farHorizon, false), null)
})

test('availability loading state is visually prominent', () => {
  const page = readPage()
  assert.match(page, /Recherche des prochaines disponibilités…/)
  assert.match(page, /text-sm font-semibold text-deep/)
  assert.match(page, /animate-spin/)
})
