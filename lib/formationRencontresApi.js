/**
 * /api/rdv-config?rencontresAction=…  — « Mes rencontres » (élève) et suivi (propriétaire).
 *
 *   GET  mine          rencontres à venir, droits et réservations de l'élève connecté
 *   POST book          { rencontreId }
 *   POST cancel        { bookingId }            jusqu'à 24 h avant
 *   GET  admin         rencontres, places et inscrits (propriétaire)
 *   POST admin-update  { rencontreId, capacity?, bookingsOpen? }
 *   POST admin-mark    { bookingId, status: attended | absent | released | cancelled }
 *
 * Authentification : Authorization: Bearer <jeton Supabase>. Les droits sont toujours
 * recalculés ici ; les fonctions SQL verrouillent la rencontre (capacité, doublons).
 */
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { PLATFORM_ADMIN_PRACTITIONER_SLUGS } from './pilotageConference.js'
import { pathEnv } from './formationPath.js'
import { rencontreRights, rencontreAvailability, RENCONTRES_CANCEL_HOURS } from './formationRencontres.js'
import { loadFiveBridgeRights } from './conferenceFiveRencontresTest.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADMIN_STATUSES = new Set(['attended', 'absent', 'released', 'cancelled'])
const SESSION_FIELDS = 'id, theme_key, title, starts_at, ends_at, capacity, bookings_open, status'

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(body)
}

async function currentUser(req, supabase) {
  const match = String(req.headers?.authorization || '').trim().match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await supabase.auth.getUser(match[1])
  return error || !data?.user?.id ? null : data.user
}

async function isOwner(supabase, userId) {
  const { data, error } = await supabase.from('booking_practitioners').select('id').eq('owner_id', userId).in('slug', PLATFORM_ADMIN_PRACTITIONER_SLUGS).limit(1)
  return !error && Boolean(data?.length)
}

async function loadRights(supabase, userId, env, now = new Date()) {
  const { data, error } = await supabase.from('mediumia_entitlements').select('type, status, access_level, max_module, access_started_at, origin_ref').eq('user_id', userId)
  if (error) throw new Error('entitlements_unavailable')
  const full = rencontreRights(data || [], { env })
  if (full.eligible) return full
  // Separate test-only rights; never grant access to the full 25 modules.
  return await loadFiveBridgeRights(supabase, userId, env, now) || full
}

async function loadBookings(supabase, rencontreIds) {
  if (!rencontreIds.length) return []
  const { data, error } = await supabase.from('formation_rencontre_bookings').select('id, rencontre_id, user_id, theme_key, status, created_at').in('rencontre_id', rencontreIds)
  if (error) throw new Error('bookings_unavailable')
  return data || []
}

const bookedCount = (bookings, rencontreId) => bookings.filter((b) => b.rencontre_id === rencontreId && b.status === 'booked').length

async function mine(supabase, user, now, env) {
  const rights = await loadRights(supabase, user.id, env, now)
  const { data: sessions, error } = await supabase.from('formation_rencontres').select(SESSION_FIELDS).eq('status', 'scheduled').gte('ends_at', now.toISOString()).order('starts_at')
  if (error) throw new Error('sessions_unavailable')
  const all = await loadBookings(supabase, (sessions || []).map((s) => s.id))
  const { data: myRows, error: myError } = await supabase.from('formation_rencontre_bookings').select('id, rencontre_id, theme_key, status').eq('user_id', user.id)
  if (myError) throw new Error('bookings_unavailable')
  const usedThemes = new Set((myRows || []).filter((b) => ['booked', 'attended', 'absent'].includes(b.status)).map((b) => b.theme_key))
  return {
    rights: { eligible: rights.eligible, until: rights.until },
    cancelHours: RENCONTRES_CANCEL_HOURS,
    sessions: (sessions || []).map((s) => {
      const myBooking = (myRows || []).find((b) => b.rencontre_id === s.id && b.status === 'booked') || null
      const count = bookedCount(all, s.id)
      const availability = rencontreAvailability({ rights, rencontre: s, bookedCount: count, myBooking, themeUsed: usedThemes.has(s.theme_key), now })
      return { id: s.id, themeKey: s.theme_key, title: s.title, startsAt: s.starts_at, endsAt: s.ends_at, capacity: s.capacity, placesLeft: Math.max(0, s.capacity - count), bookingId: myBooking?.id || null, ...availability }
    }),
  }
}

async function admin(supabase) {
  const { data: sessions, error } = await supabase.from('formation_rencontres').select(SESSION_FIELDS).order('starts_at')
  if (error) throw new Error('sessions_unavailable')
  const bookings = await loadBookings(supabase, (sessions || []).map((s) => s.id))
  const emails = new Map()
  for (const id of new Set(bookings.map((b) => b.user_id))) {
    const { data } = await supabase.auth.admin.getUserById(id)
    emails.set(id, data?.user?.email || null)
  }
  return {
    sessions: (sessions || []).map((s) => ({
      id: s.id, title: s.title, themeKey: s.theme_key, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status,
      capacity: s.capacity, bookingsOpen: s.bookings_open, booked: bookedCount(bookings, s.id),
      participants: bookings.filter((b) => b.rencontre_id === s.id && b.status !== 'cancelled')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((b) => ({ bookingId: b.id, email: emails.get(b.user_id), status: b.status, bookedAt: b.created_at })),
    })),
  }
}

async function rpc(supabase, fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error('rpc_failed')
  return data
}

export async function handleFormationRencontres(req, res, action, { supabase: injected, now = new Date(), env = pathEnv() } = {}) {
  if (!injected && !isSupabaseConfigured()) return send(res, 503, { error: 'not_configured' })
  const supabase = injected || getSupabaseAdmin()
  const write = ['book', 'cancel', 'admin-update', 'admin-mark'].includes(action)
  if (!['mine', 'admin', 'book', 'cancel', 'admin-update', 'admin-mark'].includes(action)) return send(res, 404, { error: 'unknown_action' })
  if (req.method !== (write ? 'POST' : 'GET')) return send(res, 405, { error: 'method_not_allowed' })

  const user = await currentUser(req, supabase)
  if (!user) return send(res, 401, { error: 'auth_required' })
  const body = (req.body && typeof req.body === 'object') ? req.body : {}

  try {
    if (action === 'mine') return send(res, 200, await mine(supabase, user, now, env))

    if (action === 'book') {
      if (!UUID_RE.test(String(body.rencontreId || ''))) return send(res, 400, { error: 'invalid_rencontre' })
      const rights = await loadRights(supabase, user.id, env)
      if (!rights.eligible) return send(res, 403, { error: 'not_eligible' })
      const result = await rpc(supabase, 'formation_rencontre_book', { p_user_id: user.id, p_rencontre_id: body.rencontreId, p_rights_from: rights.from, p_rights_until: rights.until })
      return result?.ok ? send(res, 200, { ok: true, placesLeft: result.places_left }) : send(res, 409, { error: result?.reason || 'refused' })
    }

    if (action === 'cancel') {
      if (!UUID_RE.test(String(body.bookingId || ''))) return send(res, 400, { error: 'invalid_booking' })
      const result = await rpc(supabase, 'formation_rencontre_cancel', { p_user_id: user.id, p_booking_id: body.bookingId })
      return result?.ok ? send(res, 200, { ok: true }) : send(res, 409, { error: result?.reason || 'refused' })
    }

    if (!(await isOwner(supabase, user.id))) return send(res, 403, { error: 'forbidden' })

    if (action === 'admin') return send(res, 200, await admin(supabase))

    if (action === 'admin-update') {
      if (!UUID_RE.test(String(body.rencontreId || ''))) return send(res, 400, { error: 'invalid_rencontre' })
      const capacity = body.capacity === undefined || body.capacity === null ? null : Number(body.capacity)
      if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= 100)) return send(res, 400, { error: 'invalid_capacity' })
      const open = typeof body.bookingsOpen === 'boolean' ? body.bookingsOpen : null
      const result = await rpc(supabase, 'formation_rencontre_admin_update', { p_rencontre_id: body.rencontreId, p_capacity: capacity, p_bookings_open: open })
      return result?.ok ? send(res, 200, { ok: true }) : send(res, 409, { error: result?.reason || 'refused', booked: result?.booked })
    }

    if (!UUID_RE.test(String(body.bookingId || ''))) return send(res, 400, { error: 'invalid_booking' })
    if (!ADMIN_STATUSES.has(body.status)) return send(res, 400, { error: 'invalid_status' })
    const result = await rpc(supabase, 'formation_rencontre_admin_mark', { p_booking_id: body.bookingId, p_status: body.status })
    return result?.ok ? send(res, 200, { ok: true }) : send(res, 409, { error: result?.reason || 'refused' })
  } catch (error) {
    console.error('formation_rencontres_failed', action, error.message)
    return send(res, 500, { error: 'server_error' })
  }
}
