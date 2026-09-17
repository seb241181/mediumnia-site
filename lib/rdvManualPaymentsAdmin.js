const PAYMENT_METHODS = new Set(['cash', 'check', 'card', 'transfer', 'other'])
const EXTERNAL_SOURCES = new Set(['reservio', 'manual'])

async function verifyOwner(supabase, userId, practitionerId) {
  const { data } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .maybeSingle()
  return !!data
}

function previewWriteAllowed() {
  if (process.env.VERCEL_ENV === 'production') return true
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return url.includes('wnbwhnqiulsdjcvkuwos')
}

function amountBreakdown(grossCents, vatRateBps) {
  const net = Math.round((grossCents * 10000) / (10000 + vatRateBps))
  return {
    gross_cents: grossCents,
    net_cents: net,
    vat_cents: grossCents - net,
    vat_rate_bps: vatRateBps,
  }
}

async function findExistingManualPayment(supabase, practitionerId, externalPaymentRef) {
  const { data, error } = await supabase
    .from('rdv_financial_entries')
    .select('id, gross_cents, occurred_at')
    .eq('practitioner_id', practitionerId)
    .eq('external_payment_ref', externalPaymentRef)
    .limit(1)
    .maybeSingle()
  return { data, error }
}

export async function getManualPaymentBookingContext({ supabase, userId, practitionerId, bookingId }) {
  if (!practitionerId || !await verifyOwner(supabase, userId, practitionerId)) {
    return { status: 403, body: { error: 'forbidden' } }
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, status, booking_source, booked_price_cents, reservation_payment_cents, customer_first_name, customer_last_name, customer_email, starts_at')
    .eq('id', bookingId)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (bookingError || !booking) return { status: 404, body: { error: 'booking_not_found' } }

  const { data: service, error: serviceError } = await supabase
    .from('booking_services')
    .select('id, title, price_cents, vat_rate_bps')
    .eq('id', booking.service_id)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (serviceError || !service) return { status: 404, body: { error: 'service_not_found' } }

  const { data: entries, error: entriesError } = await supabase
    .from('rdv_financial_entries')
    .select('direction, gross_cents')
    .eq('booking_id', booking.id)
    .eq('practitioner_id', practitionerId)
  if (entriesError) return { status: 500, body: { error: 'finance_lookup_error' } }

  const paidCents = (entries || []).reduce((sum, entry) => (
    sum + (entry.direction === 'refund' ? -1 : 1) * Number(entry.gross_cents || 0)
  ), 0)
  const totalCents = Number(booking.booked_price_cents || service.price_cents || 0)
  const remainingCents = Math.max(0, totalCents - paidCents)

  return {
    status: 200,
    body: {
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
    },
  }
}

export async function createManualPayment({ supabase, userId, body }) {
  if (!previewWriteAllowed()) {
    return { status: 403, body: { error: 'preview_manual_write_disabled' } }
  }

  const practitionerId = String(body?.practitioner_id || '').trim()
  const bookingId = body?.booking_id ? String(body.booking_id).trim() : null
  const externalSource = bookingId ? null : String(body?.source || '').trim()
  const paymentMethod = String(body?.payment_method || '').trim()
  const clientRequestId = String(body?.client_request_id || '').trim()
  const grossCents = Number(body?.gross_cents)
  const occurredAt = new Date(body?.occurred_at)

  if (!practitionerId || !await verifyOwner(supabase, userId, practitionerId)) {
    return { status: 403, body: { error: 'forbidden' } }
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return { status: 400, body: { error: 'payment_method_invalide' } }
  }
  if (!clientRequestId || clientRequestId.length < 16 || clientRequestId.length > 120) {
    return { status: 400, body: { error: 'client_request_id_invalide' } }
  }
  if (!Number.isInteger(grossCents) || grossCents <= 0 || grossCents > 10000000) {
    return { status: 400, body: { error: 'montant_invalide' } }
  }
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { status: 400, body: { error: 'date_encaissement_invalide' } }
  }

  const externalPaymentRef = 'manual:' + clientRequestId
  const earlyReplay = await findExistingManualPayment(supabase, practitionerId, externalPaymentRef)
  if (earlyReplay.error) return { status: 500, body: { error: 'finance_lookup_error', code: earlyReplay.error.code } }
  if (earlyReplay.data) {
    return { status: 200, body: { ok: true, already_recorded: true, entry: earlyReplay.data } }
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
    const context = await getManualPaymentBookingContext({ supabase, userId, practitionerId, bookingId })
    if (context.status !== 200) return context
    const booking = context.body.booking
    if (booking.status !== 'confirmed') return { status: 409, body: { error: 'booking_non_confirmed' } }
    if (booking.remaining_cents <= 0) return { status: 409, body: { error: 'booking_deja_regle' } }
    if (grossCents > booking.remaining_cents) {
      return { status: 409, body: { error: 'montant_superieur_au_solde', remaining_cents: booking.remaining_cents } }
    }

    finalSource = ['mediumia', 'reservio', 'manual'].includes(booking.source) ? booking.source : 'mediumia'
    serviceId = booking.service_id
    customerName = booking.customer_name || null
    customerEmail = booking.customer_email || null
    appointmentStartsAt = booking.starts_at ? new Date(booking.starts_at) : null
    if (appointmentStartsAt && !Number.isFinite(appointmentStartsAt.getTime())) {
      return { status: 500, body: { error: 'booking_date_invalide' } }
    }
    servicePriceCents = booking.total_cents || null
    vatRateBps = booking.vat_rate_bps
    entryKind = booking.paid_cents > 0 ? 'balance' : (grossCents === booking.total_cents ? 'full_payment' : 'adjustment')
  } else {
    if (!EXTERNAL_SOURCES.has(externalSource)) return { status: 400, body: { error: 'source_invalide' } }
    finalSource = externalSource
    serviceId = String(body?.service_id || '').trim()
    if (!serviceId) return { status: 400, body: { error: 'service_id_requis' } }

    const { data: service, error: serviceError } = await supabase
      .from('booking_services')
      .select('id, title, price_cents, vat_rate_bps')
      .eq('id', serviceId)
      .eq('practitioner_id', practitionerId)
      .maybeSingle()
    if (serviceError || !service) return { status: 404, body: { error: 'service_not_found' } }

    customerName = String(body?.customer_name || '').trim().slice(0, 180) || null
    customerEmail = String(body?.customer_email || '').trim().slice(0, 240) || null
    appointmentStartsAt = body?.appointment_starts_at ? new Date(body.appointment_starts_at) : null
    if (appointmentStartsAt && !Number.isFinite(appointmentStartsAt.getTime())) {
      return { status: 400, body: { error: 'date_rdv_invalide' } }
    }
    servicePriceCents = Number(service.price_cents || 0) || null
    vatRateBps = Number(service.vat_rate_bps || 0)
    entryKind = servicePriceCents && grossCents === servicePriceCents ? 'full_payment' : 'adjustment'
  }

  const breakdown = amountBreakdown(grossCents, vatRateBps)
  const notePrefix = bookingId
    ? 'Encaissement manuel lié au rendez-vous'
    : finalSource === 'reservio'
      ? 'Encaissement Reservio saisi manuellement'
      : 'Encaissement manuel'
  const userNote = String(body?.note || '').trim().slice(0, 500)

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
      note: userNote ? notePrefix + ' — ' + userNote : notePrefix,
    })
    .select('id, booking_id, source, entry_kind, payment_method, occurred_at, gross_cents, net_cents, vat_cents')
    .single()

  if (insertError?.code === '23505') {
    const replay = await findExistingManualPayment(supabase, practitionerId, externalPaymentRef)
    if (replay.data) return { status: 200, body: { ok: true, already_recorded: true, entry: replay.data } }
  }
  if (insertError) return { status: 500, body: { error: 'finance_insert_error', code: insertError.code } }
  return { status: 201, body: { ok: true, already_recorded: false, entry } }
}
