/**
 * Espace client MediumIA — lecture des rendez-vous et règlements du compte.
 *
 * GET /api/rdv-config?accountAction=overview
 * En-tête : Authorization: Bearer <jeton de session Supabase>
 *
 * Sécurité :
 * - l'identité vient UNIQUEMENT du jeton vérifié par Supabase Auth ; aucun
 *   identifiant ni e-mail fourni dans la requête n'est pris en compte ;
 * - l'adresse du compte doit être confirmée ;
 * - la base ne renvoie que les rendez-vous réservés avec une adresse vérifiée
 *   du compte (fonction mediumia_account_bookings, réservée au serveur) ;
 * - seuls des champs choisis sont renvoyés (jamais de note du praticien).
 *
 * Montants : écritures réelles (rdv_financial_entries). Un paiement PayPal
 * non capturé n'est jamais compté : il est seulement signalé « en attente ».
 */
import { createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const HOURLY_LIMIT = 120
const DAILY_LIMIT = 600
const MODES = new Set(['video', 'in-person'])
const CHANNELS = new Set(['whatsapp', 'facetime'])

const int = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

function sumEntries(entries, kinds, direction) {
  return entries
    .filter((entry) => kinds.includes(entry.kind) && entry.direction === direction)
    .reduce((total, entry) => total + entry.amountCents, 0)
}

// Un rendez-vous tel que le client peut le voir.
export function shapeAccountBooking(row = {}) {
  const payments = (Array.isArray(row.entries) ? row.entries : []).map((entry) => ({
    kind: text(entry.kind),
    direction: entry.direction === 'refund' ? 'refund' : 'income',
    method: text(entry.method),
    occurredAt: entry.occurred_at || null,
    amountCents: int(entry.gross_cents),
  }))
  const mode = MODES.has(row.modality) ? row.modality : null
  const priceCents = row.price_cents == null ? null : int(row.price_cents)
  const paidCents = int(row.paid_cents)
  const confirmed = row.status === 'confirmed'

  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone || 'Europe/Paris',
    status: row.status,
    serviceTitle: text(row.service_title),
    durationMin: row.duration_min == null ? null : int(row.duration_min),
    practitionerName: text(row.practitioner_name),
    // « En présence », « à distance », ou inconnu pour les anciens rendez-vous.
    mode,
    // WhatsApp ou FaceTime seulement si le client l'a réellement choisi.
    videoChannel: mode === 'video' && CHANNELS.has(row.video_channel) ? row.video_channel : null,
    contact: {
      firstName: text(row.customer_first_name),
      lastName: text(row.customer_last_name),
      phone: text(row.customer_phone),
    },
    amounts: {
      priceCents,
      depositPaidCents: sumEntries(payments, ['arrhes', 'deposit_transfer'], 'income')
        - sumEntries(payments, ['deposit_transfer'], 'refund'),
      balancePaidCents: sumEntries(payments, ['balance'], 'income'),
      fullPaymentCents: sumEntries(payments, ['full_payment'], 'income'),
      refundedCents: sumEntries(payments, ['refund'], 'refund'),
      // Total réellement encaissé, remboursements déduits (source de vérité : la base).
      paidCents,
      // Reste dû : seulement pour un rendez-vous confirmé dont le prix est connu.
      dueCents: confirmed && priceCents != null ? Math.max(0, priceCents - paidCents) : null,
      paymentPending: row.payment_pending === true,
    },
    payments,
    cancellation: row.status === 'cancelled'
      ? { at: row.cancelled_at || null, origin: text(row.cancel_origin) || 'other' }
      : null,
  }
}

// À venir : confirmé et pas encore terminé. Tout le reste est de l'historique.
export function buildAccountOverview(rows, now = new Date()) {
  const nowMs = now.getTime()
  const upcoming = []
  const past = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const booking = shapeAccountBooking(row)
    const endsMs = new Date(booking.endsAt || booking.startsAt).getTime()
    if (booking.status === 'confirmed' && Number.isFinite(endsMs) && endsMs > nowMs) upcoming.push(booking)
    else past.push(booking)
  }
  const byStart = (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  upcoming.sort(byStart)
  past.sort((a, b) => byStart(b, a))
  return { upcoming, past }
}

function fail(res, status, error) {
  return res.status(status).json({ error })
}

// Identité = jeton vérifié par Supabase Auth, adresse confirmée.
export async function requireVerifiedAccount(req, supabase) {
  const header = String(req.headers?.authorization || '').trim()
  if (!header.startsWith('Bearer ')) return { status: 401, error: 'unauthenticated' }
  const token = header.slice(7).trim()
  if (!token) return { status: 401, error: 'unauthenticated' }
  const { data, error } = await supabase.auth.getUser(token)
  const user = data?.user
  if (error || !user?.id) return { status: 401, error: 'unauthenticated' }
  if (!user.email || !user.email_confirmed_at) return { status: 403, error: 'email_not_verified' }
  return { user: { id: user.id, email: String(user.email).trim().toLowerCase() } }
}

async function handleOverview(req, res, supabase, now) {
  if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed')

  const auth = await requireVerifiedAccount(req, supabase)
  if (!auth.user) return fail(res, auth.status, auth.error)
  const { user } = auth

  const limit = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: createHash('sha256').update(`account:${user.id}`).digest('hex'),
    p_endpoint: 'account_overview',
    p_hourly_limit: HOURLY_LIMIT,
    p_daily_limit: DAILY_LIMIT,
  })
  if (limit.error) return fail(res, 503, 'account_unavailable')
  if (!limit.data?.allowed) return fail(res, 429, 'too_many_requests')

  // Rattache l'adresse confirmée du compte (sans jamais fusionner deux comptes).
  const sync = await supabase.rpc('mediumia_account_sync_primary_email', { p_user_id: user.id })
  if (sync.error) return fail(res, 503, 'account_unavailable')
  const emailLinkedElsewhere = sync.data?.error === 'email_linked_to_other_account'

  const { data, error } = await supabase.rpc('mediumia_account_bookings', { p_user_id: user.id })
  if (error) return fail(res, 503, 'account_unavailable')

  return res.status(200).json({
    account: { email: user.email, emailLinkedElsewhere },
    ...buildAccountOverview(data, now),
  })
}

export async function handleAccountApi(req, res, action, { supabase, now } = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (action !== 'overview') return fail(res, 404, 'unknown_account_action')
  if (!supabase && !isSupabaseConfigured()) return fail(res, 503, 'account_unavailable')
  try {
    return await handleOverview(req, res, supabase || getSupabaseAdmin(), now || new Date())
  } catch {
    console.error('[account] overview failed')
    return fail(res, 503, 'account_unavailable')
  }
}
