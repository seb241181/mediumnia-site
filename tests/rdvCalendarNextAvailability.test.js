import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('calendar automatically advances until a month with availability is found', () => {
  const page = fs.readFileSync(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8')
  assert.match(page, /const autoAdvanceRef = useRef\(true\)/)
  assert.match(page, /let monthHasAvailability = candidates\.some/)
  assert.match(page, /if \(nextMonth <= maxDate\)/)
  assert.match(page, /setViewDate\(nextMonth\)/)
})

test('availability loading state is visually prominent', () => {
  const page = fs.readFileSync(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8')
  assert.match(page, /Recherche des prochaines disponibilités…/)
  assert.match(page, /text-sm font-semibold text-deep/)
  assert.match(page, /animate-spin/)
})
