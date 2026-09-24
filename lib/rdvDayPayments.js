/**
 * GET /api/rdv-admin?action=day-payments&practitioner_id=X&day=YYYY-MM-DD
 *
 * Caisse du jour : chaque rendez-vous du jour (heure de Paris) avec ce qui est déjà
 * encaissé — y compris les paiements en ligne (arrhes, solde, paiement intégral
 * PayPal), quelle que soit leur date — et le reste à encaisser sur place.
 * Le récapitulatif du jour regroupe les encaissements datés de ce jour par moyen
 * de paiement, en TTC / HT / TVA (mêmes écritures que l'export comptable).
 *
 * Lecture seule : l'enregistrement d'un règlement passe par action=finance (POST),
 * qui recalcule le solde et la TVA côté serveur.
 */
import { parisUTCOffsetMs } from './googleOAuth.js'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const METHODS = ['card', 'cash', 'check', 'transfer', 'paypal', 'other']

function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Clocks change at 2-3 a.m., so midnight starting day D still has the offset of
// day D-1, and midnight ending it has the offset of day D.
export function parisDayBounds(day) {
  const nextDay = addDays(day, 1)
  const start = new Date(day + 'T00:00:00Z').getTime() + parisUTCOffsetMs(addDays(day, -1))
  const end = new Date(nextDay + 'T00:00:00Z').getTime() + parisUTCOffsetMs(day)
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

const signed = (entry, key) => (entry.direction === 'refund' ? -1 : 1) * Number(entry[key] || 0)

export function summarizeDay(bookings, services, entries, dayStart, dayEnd) {
  const serviceMap = new Map((services || []).map(s => [s.id, s]))
  const byBooking = new Map()
  for (const entry of entries || []) {
    if (!entry.booking_id) continue
    if (!byBooking.has(entry.booking_id)) byBooking.set(entry.booking_id, [])
    byBooking.get(entry.booking_id).push(entry)
  }

  const rows = (bookings || []).map(b => {
    const service = serviceMap.get(b.service_id) || {}
    const paid = byBooking.get(b.id) || []
    const totalCents = Number(b.booked_price_cents || service.price_cents || 0)
    const paidCents = paid.reduce((sum, e) => sum + signed(e, 'gross_cents'), 0)
    return {
      id: b.id,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      status: b.status,
      source: b.booking_source || 'mediumia',
      customer_name: [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' '),
      service_title: service.title || null,
      vat_rate_bps: Number(service.vat_rate_bps || 0),
      total_cents: totalCents,
      paid_cents: paidCents,
      remaining_cents: b.status === 'confirmed' ? Math.max(0, totalCents - paidCents) : 0,
      payments: paid
        .sort((a, b2) => Date.parse(a.occurred_at) - Date.parse(b2.occurred_at))
        .map(e => ({
          id: e.id,
          occurred_at: e.occurred_at,
          payment_method: e.payment_method,
          entry_kind: e.entry_kind,
          direction: e.direction,
          gross_cents: signed(e, 'gross_cents'),
          online: e.payment_method === 'paypal',
        })),
    }
  })

  // Encaissements datés de ce jour (RDV du jour, soldes d'autres RDV, Reservio, saisies libres).
  // Supabase returns '+00:00' timestamps, so compare as dates, not strings.
  const from = Date.parse(dayStart)
  const to = Date.parse(dayEnd)
  // Gift card uses settle a booking but are not revenue (counted when the card was sold).
  const dayEntries = (entries || []).filter(e => { const t = Date.parse(e.occurred_at); return t >= from && t < to && e.payment_method !== 'gift_card' })
  const byMethod = Object.fromEntries(METHODS.map(m => [m, { gross_cents: 0, net_cents: 0, vat_cents: 0, count: 0 }]))
  const totals = { gross_cents: 0, net_cents: 0, vat_cents: 0, count: 0 }
  for (const e of dayEntries) {
    const bucket = byMethod[e.payment_method] || byMethod.other
    for (const target of [bucket, totals]) {
      target.gross_cents += signed(e, 'gross_cents')
      target.net_cents += signed(e, 'net_cents')
      target.vat_cents += signed(e, 'vat_cents')
      target.count += 1
    }
  }

  return {
    bookings: rows,
    collected: { totals, by_method: byMethod },
    remaining_cents: rows.reduce((sum, r) => sum + r.remaining_cents, 0),
  }
}

export async function getDayPayments({ supabase, userId, practitionerId, day }) {
  if (!practitionerId || !DAY_RE.test(String(day || ''))) {
    return { status: 400, body: { error: 'practitioner_id et day (AAAA-MM-JJ) requis' } }
  }
  const { data: owner } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (!owner) return { status: 403, body: { error: 'forbidden' } }

  const { start, end } = parisDayBounds(day)

  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, service_id, status, booking_source, booked_price_cents, customer_first_name, customer_last_name, starts_at, ends_at')
    .eq('practitioner_id', practitionerId)
    .neq('status', 'cancelled')
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at', { ascending: true })
  if (bookingsError) return { status: 500, body: { error: 'bookings_lookup_error', code: bookingsError.code } }

  const bookingIds = (bookings || []).map(b => b.id)
  const fields = 'id, booking_id, payment_method, entry_kind, direction, occurred_at, gross_cents, net_cents, vat_cents'
  const [linked, dated] = await Promise.all([
    bookingIds.length
      ? supabase.from('rdv_financial_entries').select(fields).eq('practitioner_id', practitionerId).in('booking_id', bookingIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('rdv_financial_entries').select(fields).eq('practitioner_id', practitionerId).gte('occurred_at', start).lt('occurred_at', end),
  ])
  if (linked.error || dated.error) return { status: 500, body: { error: 'finance_lookup_error' } }

  const entries = [...new Map([...(linked.data || []), ...(dated.data || [])].map(e => [e.id, e])).values()]

  const serviceIds = [...new Set((bookings || []).map(b => b.service_id).filter(Boolean))]
  let services = []
  if (serviceIds.length) {
    const { data, error } = await supabase.from('booking_services').select('id, title, price_cents, vat_rate_bps').in('id', serviceIds)
    if (error) return { status: 500, body: { error: 'service_lookup_error', code: error.code } }
    services = data || []
  }

  return { status: 200, body: { day, ...summarizeDay(bookings, services, entries, start, end) } }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Reste à payer de chaque rendez-vous listé dans l'agenda du tableau de bord.
export function bookingBalances(bookings, services, entries) {
  const serviceMap = new Map((services || []).map(s => [s.id, s]))
  const result = {}
  for (const b of bookings || []) {
    const paid = (entries || []).filter(e => e.booking_id === b.id)
    const totalCents = Number(b.booked_price_cents || serviceMap.get(b.service_id)?.price_cents || 0)
    const paidCents = paid.reduce((sum, e) => sum + signed(e, 'gross_cents'), 0)
    result[b.id] = {
      total_cents: totalCents,
      paid_cents: paidCents,
      online_cents: paid.filter(e => e.payment_method === 'paypal').reduce((sum, e) => sum + signed(e, 'gross_cents'), 0),
      remaining_cents: b.status === 'confirmed' ? Math.max(0, totalCents - paidCents) : 0,
    }
  }
  return result
}

export async function getBookingBalances({ supabase, userId, practitionerId, ids }) {
  const bookingIds = [...new Set(String(ids || '').split(',').map(s => s.trim()).filter(Boolean))]
  if (!practitionerId || !bookingIds.length || bookingIds.length > 100 || !bookingIds.every(id => UUID_RE.test(id))) {
    return { status: 400, body: { error: 'practitioner_id et ids (100 max) requis' } }
  }
  const { data: owner } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (!owner) return { status: 403, body: { error: 'forbidden' } }

  const [bookingsRes, entriesRes] = await Promise.all([
    supabase.from('bookings').select('id, service_id, status, booked_price_cents').eq('practitioner_id', practitionerId).in('id', bookingIds),
    supabase.from('rdv_financial_entries').select('booking_id, payment_method, direction, gross_cents').eq('practitioner_id', practitionerId).in('booking_id', bookingIds),
  ])
  if (bookingsRes.error || entriesRes.error) return { status: 500, body: { error: 'finance_lookup_error' } }

  const serviceIds = [...new Set((bookingsRes.data || []).map(b => b.service_id).filter(Boolean))]
  let services = []
  if (serviceIds.length) {
    const { data, error } = await supabase.from('booking_services').select('id, price_cents').in('id', serviceIds)
    if (error) return { status: 500, body: { error: 'service_lookup_error' } }
    services = data || []
  }
  return { status: 200, body: { balances: bookingBalances(bookingsRes.data, services, entriesRes.data) } }
}
