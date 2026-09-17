import fs from 'node:fs'

const dashboardPath = 'src/components/rdv/RdvDashboard.jsx'
const apiPath = 'api/rdv-admin.js'

function patchDashboard() {
  let source = fs.readFileSync(dashboardPath, 'utf8')
  let changed = false

  const accountingMarker = `                  <AccountingSection\n                    practitionerId={activePractitioner.id}\n                    session={session}\n                  />`
  if (source.includes(accountingMarker) && !source.includes('upcomingBookings={activePractitioner.upcoming_bookings || []}')) {
    source = source.replace(accountingMarker, `                  <AccountingSection\n                    practitionerId={activePractitioner.id}\n                    session={session}\n                    services={activePractitioner.services || []}\n                    upcomingBookings={activePractitioner.upcoming_bookings || []}\n                  />`)
    changed = true
  }

  if (!source.includes("mediumia:manual-payment")) {
    const marker = `                              <button\n                                onClick={() => handleResendConfirmation(b)}`
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_booking_button_marker_missing')
    const button = `                              <button\n                                type="button"\n                                onClick={() => {\n                                  window.dispatchEvent(new CustomEvent('mediumia:manual-payment', { detail: { bookingId: b.id } }))\n                                  document.getElementById('mediumia-accounting')?.scrollIntoView({ behavior: 'smooth', block: 'start' })\n                                }}\n                                className="font-georgia text-xs text-deep border border-gold/30 px-3 py-1.5 rounded-lg hover:bg-gold/10 shrink-0"\n                              >\n                                Encaisser sur place\n                              </button>\n`
    source = source.replace(marker, `${button}${marker}`)
    changed = true
  }

  if (changed) fs.writeFileSync(dashboardPath, source)
}

function patchApi() {
  let source = fs.readFileSync(apiPath, 'utf8')
  let changed = false

  const importLine = "import { createManualPayment, getManualPaymentBookingContext } from '../lib/rdvManualPaymentsAdmin.js'\n"
  if (!source.includes(importLine.trim())) {
    const marker = "import { bookingCancellationUrl, createCancellationToken } from '../lib/bookingCancellation.js'\n"
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_import_marker_missing')
    source = source.replace(marker, `${marker}${importLine}`)
    changed = true
  }

  if (!source.includes("if (req.method === 'POST')")) {
    const marker = `async function handleFinance(req, res, supabase, userId) {\n  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })`
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_handle_finance_marker_missing')
    source = source.replace(marker, `async function handleFinance(req, res, supabase, userId) {\n  if (req.method === 'POST') {\n    const result = await createManualPayment({ supabase, userId, body: req.body || {} })\n    return res.status(result.status).json(result.body)\n  }\n  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })`)
    changed = true
  }

  if (!source.includes('getManualPaymentBookingContext({ supabase, userId')) {
    const marker = `  if (!await verifyOwner(supabase, userId, pid)) {\n    return res.status(403).json({ error: 'forbidden' })\n  }\n\n  const from = new Date(fromRaw)`
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_context_marker_missing')
    source = source.replace(marker, `  if (!await verifyOwner(supabase, userId, pid)) {\n    return res.status(403).json({ error: 'forbidden' })\n  }\n\n  if (req.query.booking_id) {\n    const result = await getManualPaymentBookingContext({ supabase, userId, practitionerId: pid, bookingId: String(req.query.booking_id) })\n    return res.status(result.status).json(result.body)\n  }\n\n  const from = new Date(fromRaw)`)
    changed = true
  }

  if (changed) fs.writeFileSync(apiPath, source)
}

patchDashboard()
patchApi()
console.log('MediumIA RDV: manual payments and Reservio accounting applied')
