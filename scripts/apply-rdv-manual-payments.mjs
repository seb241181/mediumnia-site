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

  if (!source.includes('async function handleFinanceManualPayment(')) {
    const marker = '// ── action=finance ────────────────────────────────────────────────────────────\n\n'
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_finance_marker_missing')

    const helper = String.raw`const MANUAL_PAYMENT_METHODS = new Set(['cash', 'check', 'card', 'transfer', 'other'])
const MANUAL_PAYMENT_SOURCES = new Set(['reservio', 'manual'])

function manualPaymentPreviewWriteAllowed() {
  if (process.env.VERCEL_ENV === 'production') return true
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return url.includes('wnbwhnqiulsdjcvkuwos')
}

function amountBreakdown(grossCents, vatRateBps) {
  const net = Math.round((grossCents * 10000) / (10000 + vatRateBps))
  return { gross_cents: grossCents, net_cents: net, vat_cents: grossCents - net, vat_rate_bps: vatRateBps }
}

async function financeBookingContext(supabase, practitionerId, bookingId) {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, status, booking_source, booked_price_cents, reservation_payment_cents, customer_first_name, customer_last_name, customer_email, starts_at')
    .eq('id', bookingId)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (bookingError || !booking) return { error: 'booking_not_found', status: 404 }

  const { data: service, error: serviceError } = await supabase
    .from('booking_services')
    .select('id, title, price_cents, vat_rate_bps')
    .eq('id', booking.service_id)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (serviceError || !service) return { error: 'service_not_found', status: 404 }

  const { data: entries, error: entriesError } = await supabase
    .from('rdv_financial_entries')
    .select('direction, gross_cents')
    .eq('booking_id', booking.id)
    .eq('practitioner_id', practitionerId)
  if (entriesError) return { error: 'finance_lookup_error', status: 500 }

  const paidCents = (entries || []).reduce((sum, entry) => (
    sum + (entry.direction === 'refund' ? -1 : 1) * Number(entry.gross_cents || 0)
  ), 0)
  const totalCents = Number(booking.booked_price_cents || service.price_cents || 0)
  const remainingCents = Math.max(0, totalCents - paidCents)

  return {
    status: 200,
    booking: {
      id: booking.id,
      status: booking.status,
      source: booking.booking_source || 'mediumia',
      service_id: booking.service_id,
      service_title: service.title,
      starts_at: booking.starts_at,
      customer_name: [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' '),
      customer_email: booking.customer_email || null,
      total_cents: totalCents,
      paid_cents: paidCents,
      remaining_cents: remainingCents,
      vat_rate_bps: Number(service.vat_rate_bps || 0),
    },
  }
}

async function handleFinanceManualPayment(req, res, supabase, userId) {
  if (!manualPaymentPreviewWriteAllowed()) {
    return res.status(403).json({ error: 'preview_manual_write_disabled' })
  }

  const body = req.body || {}
  const practitionerId = String(body.practitioner_id || '').trim()
  const bookingId = body.booking_id ? String(body.booking_id).trim() : null
  const source = bookingId ? null : String(body.source || '').trim()
  const paymentMethod = String(body.payment_method || '').trim()
  const clientRequestId = String(body.client_request_id || '').trim()
  const grossCents = Number(body.gross_cents)
  const occurredAt = new Date(body.occurred_at)

  if (!practitionerId || !await verifyOwner(supabase, userId, practitionerId)) {
    return res.status(403).json({ error: 'forbidden' })
  }
  if (!MANUAL_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({ error: 'payment_method_invalide' })
  }
  if (!clientRequestId || clientRequestId.length < 16 || clientRequestId.length > 120) {
    return res.status(400).json({ error: 'client_request_id_invalide' })
  }
  if (!Number.isInteger(grossCents) || grossCents <= 0 || grossCents > 10000000) {
    return res.status(400).json({ error: 'montant_invalide' })
  }
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'date_encaissement_invalide' })
  }

  let finalSource
  let serviceId
  let customerName
  let customerEmail
  let appointmentStartsAt
  let servicePriceCents
  let vatRateBps
  let entryKind

  if (bookingId) {
    const context = await financeBookingContext(supabase, practitionerId, bookingId)
    if (context.error) return res.status(context.status).json({ error: context.error })
    const booking = context.booking
    if (booking.status !== 'confirmed') return res.status(409).json({ error: 'booking_non_confirmed' })
    if (booking.remaining_cents <= 0) return res.status(409).json({ error: 'booking_deja_regle' })
    if (grossCents > booking.remaining_cents) {
      return res.status(409).json({ error: 'montant_superieur_au_solde', remaining_cents: booking.remaining_cents })
    }
    finalSource = ['mediumia', 'reservio', 'manual'].includes(booking.source) ? booking.source : 'mediumia'
    serviceId = booking.service_id
    customerName = booking.customer_name || null
    customerEmail = booking.customer_email || null
    appointmentStartsAt = booking.starts_at || null
    servicePriceCents = booking.total_cents || null
    vatRateBps = booking.vat_rate_bps
    entryKind = booking.paid_cents > 0 ? 'balance' : (grossCents === booking.total_cents ? 'full_payment' : 'adjustment')
  } else {
    if (!MANUAL_PAYMENT_SOURCES.has(source)) return res.status(400).json({ error: 'source_invalide' })
    finalSource = source
    serviceId = String(body.service_id || '').trim()
    if (!serviceId) return res.status(400).json({ error: 'service_id_requis' })

    const { data: service, error: serviceError } = await supabase
      .from('booking_services')
      .select('id, title, price_cents, vat_rate_bps')
      .eq('id', serviceId)
      .eq('practitioner_id', practitionerId)
      .maybeSingle()
    if (serviceError || !service) return res.status(404).json({ error: 'service_not_found' })

    customerName = String(body.customer_name || '').trim().slice(0, 180) || null
    customerEmail = String(body.customer_email || '').trim().slice(0, 240) || null
    appointmentStartsAt = body.appointment_starts_at ? new Date(body.appointment_starts_at) : null
    if (appointmentStartsAt && !Number.isFinite(appointmentStartsAt.getTime())) {
      return res.status(400).json({ error: 'date_rdv_invalide' })
    }
    servicePriceCents = Number(service.price_cents || 0) || null
    vatRateBps = Number(service.vat_rate_bps || 0)
    entryKind = servicePriceCents && grossCents === servicePriceCents ? 'full_payment' : 'adjustment'
  }

  const externalPaymentRef = `manual:${clientRequestId}`
  const { data: existing } = await supabase
    .from('rdv_financial_entries')
    .select('id, gross_cents, occurred_at')
    .eq('source', finalSource)
    .eq('external_payment_ref', externalPaymentRef)
    .maybeSingle()
  if (existing) return res.status(200).json({ ok: true, already_recorded: true, entry: existing })

  const breakdown = amountBreakdown(grossCents, vatRateBps)
  const notePrefix = bookingId ? 'Encaissement manuel lié au rendez-vous' : (finalSource === 'reservio' ? 'Encaissement Reservio saisi manuellement' : 'Encaissement manuel')
  const userNote = String(body.note || '').trim().slice(0, 500)

  const { data: entry, error: insertError } = await supabase
    .from('rdv_financial_entries')
    .insert({
      practitioner_id: practitionerId,
      booking_id: bookingId,
      service_id: serviceId,
      source: finalSource,
      entry_kind: entryKind,
      direction: 'income',
      payment_method: paymentMethod,
      occurred_at: occurredAt.toISOString(),
      ...breakdown,
      vat_status: 'taxable',
      currency: 'EUR',
      service_price_cents: servicePriceCents,
      appointment_starts_at: appointmentStartsAt ? appointmentStartsAt.toISOString() : null,
      customer_name: customerName,
      customer_email: customerEmail,
      external_payment_ref: externalPaymentRef,
      note: userNote ? `${notePrefix} — ${userNote}` : notePrefix,
    })
    .select('id, booking_id, source, entry_kind, payment_method, occurred_at, gross_cents, net_cents, vat_cents')
    .single()

  if (insertError) return res.status(500).json({ error: 'finance_insert_error', code: insertError.code })
  return res.status(201).json({ ok: true, already_recorded: false, entry })
}

`
    source = source.replace(marker, `${marker}${helper}`)
    changed = true
  }

  if (!source.includes("if (req.method === 'POST') return handleFinanceManualPayment")) {
    const marker = `async function handleFinance(req, res, supabase, userId) {\n  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })`
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_handle_finance_marker_missing')
    source = source.replace(marker, `async function handleFinance(req, res, supabase, userId) {\n  if (req.method === 'POST') return handleFinanceManualPayment(req, res, supabase, userId)\n  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })`)
    changed = true
  }

  if (!source.includes('return res.status(context.status).json(context)')) {
    const marker = `  if (!await verifyOwner(supabase, userId, pid)) {\n    return res.status(403).json({ error: 'forbidden' })\n  }\n\n  const from = new Date(fromRaw)`
    if (!source.includes(marker)) throw new Error('rdv_manual_payment_booking_context_marker_missing')
    source = source.replace(marker, `  if (!await verifyOwner(supabase, userId, pid)) {\n    return res.status(403).json({ error: 'forbidden' })\n  }\n\n  if (req.query.booking_id) {\n    const context = await financeBookingContext(supabase, pid, String(req.query.booking_id))\n    if (context.error) return res.status(context.status).json({ error: context.error })\n    return res.status(context.status).json(context)\n  }\n\n  const from = new Date(fromRaw)`)
    changed = true
  }

  if (changed) fs.writeFileSync(apiPath, source)
}

patchDashboard()
patchApi()
console.log('MediumIA RDV: manual payments and Reservio accounting applied')
