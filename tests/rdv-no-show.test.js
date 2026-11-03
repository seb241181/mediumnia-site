import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { markAgendaNoShow } from '../lib/rdvNoShow.js'
import { mergeAgendaEvents } from '../lib/rdvUnifiedAgenda.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const bookingId = '0df8cc33-6895-4ab3-a1e0-f07390695ec5'
const ownerId = '46dd4576-4e60-4c9b-98f4-c51fe3f3f7f8'
const practitionerId = 'c84fda92-75f7-40c0-b575-9640c7723365'

test('no-show schema is access controlled, auditable, and never writes a second receipt', () => {
  const schema = read('supabase/migrations/20261103140500_rdv_no_show_attendance_and_deposit_retention.sql')
  assert.match(schema, /'no_show'/)
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/)
  assert.match(schema, /REVOKE ALL ON FUNCTION public\.mark_rdv_booking_no_show/)
  assert.match(schema, /TO service_role/)
  assert.match(schema, /IF v_booking\.ends_at > now\(\)/)
  assert.match(schema, /v_owner_id IS DISTINCT FROM p_actor/)
  assert.match(schema, /v_payment\.status <> 'captured'/)
  assert.match(schema, /v_payment\.settlement_status <> 'open'/)
  assert.match(schema, /COALESCE\(v_payment\.refunded_cents,0\) <> 0/)
  assert.match(schema, /rdv_payment_refunds/)
  assert.match(schema, /public\.rdv_booking_paid_cents\(v_booking\.id\) <> v_payment\.amount_cents/)
  assert.match(schema, /settlement_status='retained'/)
  assert.match(schema, /INSERT INTO public\.rdv_booking_no_show_events/)
  assert.doesNotMatch(schema, /INSERT INTO public\.rdv_financial_entries/)
  assert.doesNotMatch(schema, /UPDATE public\.bookings SET status='cancelled'/)
})

test('owner-only agenda operation returns the retained amount and no email or new income', async () => {
  const captured = []
  const supabase = { rpc: async (name, args) => {
    captured.push({ name, args })
    return { data: { ok: true, retained_cents: 2000, already: false }, error: null }
  } }
  const response = await markAgendaNoShow({
    supabase, userId: ownerId, input: { booking_id: bookingId, practitioner_id: practitionerId },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    ok: true, status: 'no_show', retained_cents: 2000, already: false,
    accounting_entry_created: false, client_email_sent: false,
  })
  assert.deepEqual(captured, [{
    name: 'mark_rdv_booking_no_show',
    args: { p_booking_id: bookingId, p_practitioner_id: practitionerId, p_actor: ownerId },
  }])
})

test('invalid IDs never reach the database; database refusals fail closed', async () => {
  const missing = await markAgendaNoShow({
    supabase: { rpc: () => { throw new Error('should not run') } },
    userId: ownerId, input: { booking_id: 'fake', practitioner_id: practitionerId },
  })
  assert.equal(missing.status, 400)
  const refused = await markAgendaNoShow({
    supabase: { rpc: async () => ({ data: { ok: false, error: 'deposit_payment_review_required' }, error: null }) },
    userId: ownerId, input: { booking_id: bookingId, practitioner_id: practitionerId },
  })
  assert.equal(refused.status, 409)
  const forbidden = await markAgendaNoShow({
    supabase: { rpc: async () => ({ data: { ok: false, error: 'forbidden' }, error: null }) },
    userId: ownerId, input: { booking_id: bookingId, practitioner_id: practitionerId },
  })
  assert.equal(forbidden.status, 403)
})

test('no-show keeps its historical calendar entry and uses a separate status', () => {
  const events = mergeAgendaEvents({
    bookings: [{
      id: bookingId, status: 'no_show', customer_first_name: 'QA',
      customer_last_name: 'NoShow', starts_at: '2026-11-03T10:00:00Z',
      ends_at: '2026-11-03T11:00:00Z', google_event_id: 'google123',
    }],
    googleEvents: [], linkedIds: new Set(['google123']), calendarId: 'calendar',
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].status, 'no_show')
  assert.equal(events[0].source, 'mediumia')
  assert.equal(events[0].google_linked, true)
  const ui = read('src/components/rdv/UnifiedAgenda.jsx')
  const api = read('api/rdv-admin.js')
  assert.match(ui, /Pas venu — conserver les arrhes/)
  assert.match(ui, /appointment_not_finished/)
  assert.match(ui, /window\.confirm/)
  assert.match(api, /req\.body\?\.op === 'no_show'/)
})
