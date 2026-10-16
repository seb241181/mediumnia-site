import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import DailyPayments from '../../src/components/rdv/DailyPayments.jsx'
import RequestShortcuts from '../../src/components/rdv/RequestShortcuts.jsx'
import UpcomingBookings from '../../src/components/rdv/UpcomingBookings.jsx'
import { filterRequests } from '../../src/components/rdv/rdvCoulissesHelpers.js'

const pid = '11111111-1111-4111-8111-111111111111'
const session = { access_token: 'LOCAL_FIXTURE_NOT_A_CREDENTIAL' }
const services = [{ id: 'service-fixture', title: 'Consultation fictive', modality: ['phone'] }]
const makeBooking = (id, customer_name, paid_cents) => ({ id, customer_name, status: 'confirmed', service_id: 'service-fixture',
  customer_first_name: customer_name, customer_last_name: '', starts_at: new Date().toISOString(),
  ends_at: new Date().toISOString(), total_cents: 7000, paid_cents, remaining_cents: 7000 - paid_cents,
  payments: paid_cents ? [{ id: `p-${id}`, payment_method: 'paypal', entry_kind: paid_cents === 7000 ? 'full_payment' : 'arrhes',
    gross_cents: paid_cents, occurred_at: new Date().toISOString(), online: true }] : [], service_title: 'Consultation fictive' })
const bookings = [makeBooking('22222222-2222-4222-8222-222222222222', 'Client fictif A', 2000),
  makeBooking('33333333-3333-4333-8333-333333333333', 'Client fictif B', 7000)]
const future = bookings.map((booking, index) => ({ ...booking,
  id: index ? '55555555-5555-4555-8555-555555555555' : '44444444-4444-4444-8444-444444444444',
  starts_at: new Date(Date.now() + 2 * 86400_000).toISOString() }))
const requests = [{ status: 'pending', label: 'Demande fictive A' }, { status: 'contacted', label: 'Demande fictive B' }, { status: 'scheduled', label: 'Demande fictive C' }]
window.__fixtureRequests = []
// Deliberately no real transport. Every component fetch is resolved locally.
window.fetch = async (url, options = {}) => {
  const parsed = new URL(url, location.origin)
  window.__fixtureRequests.push({ path: parsed.pathname, action: parsed.searchParams.get('action'), method: options.method || 'GET' })
  if (options.method && options.method !== 'GET') throw new Error('Fixture refuses all mutations')
  let body
  const action = parsed.searchParams.get('action')
  if (action === 'day-payments') body = { day: parsed.searchParams.get('day'), bookings,
    collected: { by_method: {}, totals: { gross_cents: 0, net_cents: 0, vat_cents: 0 } }, remaining_cents: 5000 }
  else if (action === 'booking-balances') body = { balances: Object.fromEntries(future.map(booking => [booking.id,
    { total_cents: 7000, paid_cents: booking.paid_cents, remaining_cents: booking.remaining_cents }])) }
  else if (action === 'booking-cancel-preview') body = { execution_enabled: false, requires_explicit_confirmation: true,
    requires_financial_review: true, blockers: [], finance: { net_recorded_cents: 2000, entries: 1 }, google: { required: true } }
  else throw new Error(`Unexpected fixture request: ${action}`)
  return { ok: true, status: 200, json: async () => body }
}

export default function Fixture() {
  const [status, setStatus] = useState('all')
  return <main className="mx-auto max-w-4xl px-4 py-6 font-georgia text-deep">
    <p className="text-xs text-mist">Validation locale · données fictives</p>
    <h1 className="my-4 text-2xl font-semibold">Les Coulisses · Rendez-vous</h1>
    <RequestShortcuts counts={{ pending: 1, contacted: 1, scheduled: 1 }} selected={status} onSelect={setStatus} />
    <DailyPayments practitionerId={pid} session={session} />
    <section className="my-6 border-t border-gold/20 pt-4" aria-label="Liste des demandes fictives"><h2 className="mb-3 text-lg">Demandes de rendez-vous</h2>
      {filterRequests(requests, status).map(request => <p className="py-2 text-sm" key={request.label}>{request.label}</p>)}
    </section>
    <UpcomingBookings bookings={future} services={services} practitionerId={pid} session={session} onResend={() => {}} />
  </main>
}

createRoot(document.getElementById('root')).render(<Fixture />)
