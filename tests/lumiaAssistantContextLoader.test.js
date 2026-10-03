import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LumiaContextError, loadLumiaRdvContext, lumiaContextLogDetail } from '../lib/lumiaAssistantContext.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Fausse base : chaque requête est une chaîne select/in/eq/order/limit…,
// résolue par answer(table, filtres). Aucune écriture possible.
function fakeDb(answer) {
  return {
    from(table) {
      const filters = []
      const chain = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            return (resolve, reject) => Promise.resolve(answer(table, filters)).then(resolve, reject)
          }
          return (...args) => { filters.push(prop, ...args); return chain }
        },
      })
      return chain
    },
  }
}

const step = (table, filters) => (table === 'bookings' ? (filters.includes('lt') ? 'bookings_recent' : 'bookings_upcoming') : table)

const okData = {
  booking_practitioners: [{ id: 'p1', name: 'Sébastien', slug: 'sebastien-seguin', timezone: 'Europe/Paris' }],
  booking_services: [{ id: 's1', practitioner_id: 'p1', title: 'Guidance', slug: 'guidance', duration_min: 60, price_cents: 7000, modality: ['video'], booking_mode: 'instant' }],
  booking_requests: [{ id: 'r1', practitioner_id: 'p1', service_id: 's1', status: 'pending', customer_first_name: 'Claire' }],
  bookings_upcoming: [{ id: 'b1', practitioner_id: 'p1', service_id: 's1', starts_at: '2026-10-10T08:00:00Z', status: 'confirmed' }],
  bookings_recent: [{ id: 'b0', practitioner_id: 'p1', service_id: 's1', starts_at: '2026-09-20T08:00:00Z', status: 'confirmed' }],
}

test('agent-chat imports the Lumia context loader it calls (regression: ReferenceError → 503)', () => {
  const src = read('api/agent-chat.js')
  assert.match(src, /import\s*\{[^}]*\bloadLumiaRdvContext\b[^}]*\}\s*from\s*'\.\.\/lib\/lumiaAssistantContext\.js'/)
  assert.match(src, /import\s*\{[^}]*\blumiaContextLogDetail\b[^}]*\}\s*from\s*'\.\.\/lib\/lumiaAssistantContext\.js'/)
  assert.match(src, /catch \(error\) \{\s*technicalLog\(requestId, 'chat', 'failed', startedAt, lumiaContextLogDetail\(error\)\)/)
})

test('Lumia context loads the five read-only RDV reads', async () => {
  const seen = []
  const db = fakeDb((table, filters) => {
    seen.push(step(table, filters))
    return { data: okData[step(table, filters)], error: null }
  })
  const context = await loadLumiaRdvContext({ db, userId: 'u1', now: new Date('2026-10-03T10:00:00Z') })
  assert.deepEqual(seen.sort(), ['booking_practitioners', 'booking_requests', 'booking_services', 'bookings_recent', 'bookings_upcoming'])
  assert.match(context, /private_rdv_read_only/)
  assert.match(context, /"open_requests": \[\s*\{\s*"id": "r1"/)
  assert.match(context, /"upcoming_bookings": \[\s*\{\s*"id": "b1"/)
  assert.match(context, /"recent_bookings": \[\s*\{\s*"id": "b0"/)
})

for (const failing of ['booking_practitioners', 'booking_services', 'booking_requests', 'bookings_upcoming', 'bookings_recent']) {
  test(`a failing ${failing} read names its step and Supabase code`, async () => {
    const db = fakeDb((table, filters) => (step(table, filters) === failing
      ? { data: null, error: { code: '42703', message: 'column "x" of claire@example.test does not exist (id 3f2a9c1e-1111-2222-3333-444455556666)' } }
      : { data: okData[step(table, filters)], error: null }))
    await assert.rejects(loadLumiaRdvContext({ db, userId: 'u1' }), (error) => {
      assert.ok(error instanceof LumiaContextError)
      assert.equal(error.step, failing)
      assert.equal(error.code, '42703')
      const detail = lumiaContextLogDetail(error)
      assert.match(detail, new RegExp(`^lumia_context_unavailable step=${failing} code=42703 message=`))
      assert.doesNotMatch(detail, /claire|example\.test|3f2a9c1e|"x"/)
      assert.doesNotMatch(detail.split(' message=')[1], /\s/)
      return true
    })
  })
}

test('a JavaScript exception before any read is logged as such, without data', () => {
  const detail = lumiaContextLogDetail(new ReferenceError('loadLumiaRdvContext is not defined'))
  assert.equal(detail, 'lumia_context_unavailable step=exception code=ReferenceError message=loadLumiaRdvContext_is_not_defined')
})
