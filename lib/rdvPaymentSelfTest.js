/* global process */
// Autotest serveur du paiement des rendez-vous — TEST UNIQUEMENT (refusé en Production).
// Exécute le parcours réel (base TEST, commandes PayPal Sandbox) sur le praticien de test
// à agenda fictif, sans aucun appel Google. Commit séparé, retiré avant la Production.
import { randomUUID } from 'node:crypto'
import { isTestFakeCalendar } from './rdvTestCalendar.js'

const TEST_PRACTITIONER = 'seb-test'
const TEST_SERVICE = 'qa-exception-old-20261021'

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  res.end = () => res
  return res
}
const mask = (id) => (id ? `…${String(id).slice(-4)}` : null)

export async function runRdvPaymentSelfTest(req, supabase, handlers) {
  if (process.env.VERCEL_ENV === 'production') return { status: 404, body: { error: 'not_found' } }
  const { data: practitioner } = await supabase.from('booking_practitioners').select('id').eq('slug', TEST_PRACTITIONER).maybeSingle()
  const { data: conn } = await supabase.from('booking_calendar_connections').select('google_calendar_id').eq('practitioner_id', practitioner?.id || '').eq('is_active', true).maybeSingle()
  if (!practitioner || !isTestFakeCalendar(conn)) return { status: 409, body: { error: 'test_practitioner_not_ready' } }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.date || '')) ? req.query.date : '2026-11-20'
  const time = /^\d{2}:\d{2}$/.test(String(req.query?.time || '')) ? req.query.time : '16:00'
  const slot = { practitioner_slug: TEST_PRACTITIONER, service_slug: TEST_SERVICE, date, time, selected_modality: 'in-person', terms_accepted: true, early_performance_requested: true }
  const clientA = { firstName: 'Test', lastName: 'Serveur', email: 'test-serveur-a@example.org' }
  const clientB = { firstName: 'Autre', lastName: 'Client', email: 'test-serveur-b@example.org' }
  const headers = { 'x-forwarded-for': req.headers?.['x-forwarded-for'] || '127.0.0.1', 'user-agent': 'MediumIA-autotest (iPhone)' }
  const call = async (fn, body) => { const res = fakeRes(); await fn({ method: 'POST', body, headers, query: {} }, res, supabase); return res }
  const c1 = randomUUID(); const c2 = randomUUID(); const c3 = randomUUID()
  const report = { slot: `${date} ${time}`, steps: [] }
  const step = (name, res, extra = {}) => report.steps.push({ name, http: res.statusCode, error: res.body?.error || null, ...extra })

  const a1 = await call(handlers.create, { ...slot, customer: clientA, client_checkout_id: c1 })
  step('1 création réservation provisoire + commande PayPal Sandbox', a1, { commande: mask(a1.body?.id), montant: a1.body?.amount, expire: a1.body?.expiresAt })
  const a1bis = await call(handlers.create, { ...slot, customer: clientA, client_checkout_id: c1 })
  step('2 double clic (même identifiant)', a1bis, { memeCommande: a1bis.body?.id === a1.body?.id })
  const b = await call(handlers.create, { ...slot, customer: clientB, client_checkout_id: c2 })
  step('3 autre client, même créneau', b, { retryAt: b.body?.retryAt || null })
  const a3 = await call(handlers.create, { ...slot, customer: clientA, client_checkout_id: c3 })
  step('4 même client, nouvel onglet', a3, { commande: mask(a3.body?.id), nouvelleCommande: Boolean(a3.body?.id) && a3.body?.id !== a1.body?.id })
  const oldCapture = await call(handlers.capture, { orderId: a1.body?.id })
  step('5 capture de l’ancienne commande', oldCapture, { statut: oldCapture.body?.status || null })
  const oldRetry = await call(handlers.create, { ...slot, customer: clientA, client_checkout_id: c1 })
  step('6 ancien onglet relancé', oldRetry)
  const unapproved = await call(handlers.capture, { orderId: a3.body?.id })
  step('7 capture sans approbation PayPal', unapproved, { restartable: unapproved.body?.restartable ?? null, statut: unapproved.body?.status || null })

  const { data: rows } = await supabase
    .from('rdv_paypal_payments')
    .select('client_checkout_id, status, paypal_order_id, paypal_capture_id, last_error_code, capture_attempts, hold:rdv_booking_holds(status, converted_booking_id)')
    .in('client_checkout_id', [c1, c2, c3])
  report.base = (rows || []).map((r) => ({
    tentative: r.client_checkout_id === c1 ? 'A1' : r.client_checkout_id === c3 ? 'A3' : 'B',
    paiement: r.status,
    hold: r.hold?.status,
    commande: mask(r.paypal_order_id),
    capture: r.paypal_capture_id ? 'OUI' : 'non',
    rdv: r.hold?.converted_booking_id ? 'OUI' : 'non',
    erreur: r.last_error_code,
    essaisCapture: r.capture_attempts,
  }))
  report.refs = { A1: c1.slice(0, 8), B: c2.slice(0, 8), A3: c3.slice(0, 8) }
  return { status: 200, body: report }
}
