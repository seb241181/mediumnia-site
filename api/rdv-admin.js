/**
 * /api/rdv-admin?action=<action>
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * Endpoint unique pour toutes les opérations d'administration RDV.
 * (Contrainte Vercel Hobby : 12 Serverless Functions max.)
 *
 * Actions :
 *   GET  action=me                                           → tout l'espace pro
 *   GET  action=services&practitioner_id=X                  → liste services
 *   POST action=services                                     → créer service
 *   PUT  action=services                                     → modifier service
 *   DEL  action=services&id=X&practitioner_id=X             → supprimer service
 *   GET  action=availability&practitioner_id=X              → règles hebdo
 *   PUT  action=availability                                 → remplacer règles
 *   GET  action=settings&practitioner_id=X                  → paramètres
 *   PUT  action=settings                                     → modifier paramètres
 *   GET  action=exceptions&practitioner_id=X                → congés/exceptions
 *   PUT  action=exceptions                                   → ajouter/modifier exception
 *   DEL  action=exceptions&id=X&practitioner_id=X           → supprimer exception
 *
 * Sécurité : chaque action vérifie requireAuth (JWT Supabase) puis
 * que booking_practitioners.owner_id === auth.userId avant toute mutation.
 */
import { requireAuth, getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { decrypt, encrypt, refreshGoogleToken } from '../lib/googleOAuth.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
const ALLOWED_MODALITIES = ['video', 'phone', 'in-person']
const SETTINGS_FIELDS = [
  'booking_horizon_days', 'buffer_before_min', 'buffer_after_min',
  'min_advance_hours', 'max_per_day', 'booking_enabled', 'timezone',
]

async function verifyOwner(supabase, userId, practitionerId) {
  const { data } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .single()
  return !!data
}

// ── action=me ─────────────────────────────────────────────────────────────────

async function handleMe(req, res, supabase, userId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { data: practitioners, error } = await supabase
    .from('booking_practitioners')
    .select(`
      id, slug, name, role, photo_url, tagline, timezone, is_active,
      booking_horizon_days, buffer_before_min, buffer_after_min,
      min_advance_hours, max_per_day, booking_enabled
    `)
    .eq('owner_id', userId)
    .order('slug')

  if (error) return res.status(500).json({ error: 'db_error', code: error.code })
  if (!practitioners?.length) return res.status(200).json({ practitioners: [] })

  const ids = practitioners.map(p => p.id)
  const now = new Date().toISOString()

  const [
    { data: services },
    { data: rules },
    { data: connections },
    { data: bookings },
    { data: exceptions },
    { data: requests },
  ] = await Promise.all([
    supabase.from('booking_services')
      .select('id, slug, title, description, duration_min, price_cents, currency, modality, is_active, sort_order, booking_mode, practitioner_id')
      .in('practitioner_id', ids).order('sort_order'),
    supabase.from('booking_availability_rules')
      .select('id, practitioner_id, day_of_week, start_time, end_time')
      .in('practitioner_id', ids).order('day_of_week').order('start_time'),
    supabase.from('booking_calendar_connections')
      .select('practitioner_id, google_email, google_calendar_id, token_expiry, is_active')
      .in('practitioner_id', ids),
    supabase.from('bookings')
      .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, starts_at, ends_at, status, google_meet_link')
      .in('practitioner_id', ids).eq('status', 'confirmed').gte('starts_at', now)
      .order('starts_at').limit(20),
    supabase.from('booking_exceptions')
      .select('id, practitioner_id, exception_date, exception_type, slots, note')
      .in('practitioner_id', ids).order('exception_date'),
    supabase.from('booking_requests')
      .select('id, service_id, status, customer_first_name, customer_last_name, customer_email, customer_phone, address_line1, address_line2, postal_code, city, customer_message, preferred_period, created_at, scheduled_at, travel_fee_cents, final_price_cents, practitioner_notes, practitioner_id')
      .in('practitioner_id', ids)
      .in('status', ['pending', 'contacted', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const result = practitioners.map(p => ({
    ...p,
    services:          (services    || []).filter(s => s.practitioner_id === p.id),
    availability_rules:(rules       || []).filter(r => r.practitioner_id === p.id),
    calendar:          (connections || []).find(c  => c.practitioner_id  === p.id) || null,
    upcoming_bookings: (bookings    || []).filter(b => b.practitioner_id === p.id),
    exceptions:        (exceptions  || []).filter(e => e.practitioner_id === p.id),
    pending_requests:  (requests    || []).filter(r => r.practitioner_id === p.id),
  }))

  return res.status(200).json({ practitioners: result })
}

// ── action=services ───────────────────────────────────────────────────────────

async function handleServices(req, res, supabase, userId) {
  if (req.method === 'GET') {
    const pid = req.query.practitioner_id
    if (!pid) return res.status(400).json({ error: 'practitioner_id requis' })
    if (!await verifyOwner(supabase, userId, pid)) return res.status(403).json({ error: 'forbidden' })
    const { data, error } = await supabase.from('booking_services').select('*').eq('practitioner_id', pid).order('sort_order')
    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ services: data })
  }

  if (req.method === 'POST') {
    const { practitioner_id, title, slug, description, duration_min, price_cents, modality, is_active, sort_order, booking_mode } = req.body || {}
    if (!practitioner_id || !title || !slug || !duration_min) return res.status(400).json({ error: 'practitioner_id, title, slug, duration_min requis' })
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug invalide (a-z, 0-9, tirets, 2-60 chars)' })
    if (typeof duration_min !== 'number' || duration_min <= 0) return res.status(400).json({ error: 'duration_min doit être un entier positif' })
    if (modality && !modality.every(m => ALLOWED_MODALITIES.includes(m))) return res.status(400).json({ error: 'modality invalide' })
    if (booking_mode && !['instant', 'request'].includes(booking_mode)) return res.status(400).json({ error: 'booking_mode invalide (instant | request)' })
    if (!await verifyOwner(supabase, userId, practitioner_id)) return res.status(403).json({ error: 'forbidden' })
    const { data, error } = await supabase.from('booking_services').insert({
      practitioner_id, title, slug, description: description || '',
      duration_min, price_cents: price_cents ?? null, currency: 'EUR',
      modality: modality || [], is_active: is_active !== false, sort_order: sort_order || 0,
      booking_mode: booking_mode || 'instant',
    }).select().single()
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(201).json({ service: data })
  }

  if (req.method === 'PUT') {
    const { id, practitioner_id, ...fields } = req.body || {}
    if (!id || !practitioner_id) return res.status(400).json({ error: 'id et practitioner_id requis' })
    if (!await verifyOwner(supabase, userId, practitioner_id)) return res.status(403).json({ error: 'forbidden' })
    const ALLOWED = ['title', 'slug', 'description', 'duration_min', 'price_cents', 'modality', 'is_active', 'sort_order', 'booking_mode']
    const update = {}
    for (const k of ALLOWED) if (k in fields) update[k] = fields[k]
    if (update.slug && !SLUG_RE.test(update.slug)) return res.status(400).json({ error: 'slug invalide' })
    if (update.modality && !update.modality.every(m => ALLOWED_MODALITIES.includes(m))) return res.status(400).json({ error: 'modality invalide' })
    if (update.booking_mode && !['instant', 'request'].includes(update.booking_mode)) return res.status(400).json({ error: 'booking_mode invalide (instant | request)' })
    const { data, error } = await supabase.from('booking_services')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', id).eq('practitioner_id', practitioner_id).select().single()
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ service: data })
  }

  if (req.method === 'DELETE') {
    const { id, practitioner_id } = req.query
    if (!id || !practitioner_id) return res.status(400).json({ error: 'id et practitioner_id requis' })
    if (!await verifyOwner(supabase, userId, practitioner_id)) return res.status(403).json({ error: 'forbidden' })
    const { error } = await supabase.from('booking_services').delete().eq('id', id).eq('practitioner_id', practitioner_id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── action=availability ───────────────────────────────────────────────────────

async function handleAvailability(req, res, supabase, userId) {
  const pid = req.query.practitioner_id || req.body?.practitioner_id
  if (!pid) return res.status(400).json({ error: 'practitioner_id requis' })
  if (!await verifyOwner(supabase, userId, pid)) return res.status(403).json({ error: 'forbidden' })

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('booking_availability_rules')
      .select('id, day_of_week, start_time, end_time').eq('practitioner_id', pid)
      .order('day_of_week').order('start_time')
    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ rules: data })
  }

  if (req.method === 'PUT') {
    const { rules } = req.body || {}
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules (tableau) requis' })
    for (const r of rules) {
      if (typeof r.day_of_week !== 'number' || r.day_of_week < 0 || r.day_of_week > 6)
        return res.status(400).json({ error: 'day_of_week doit être entre 0 (Lun) et 6 (Dim)' })
      if (!r.start_time || !TIME_RE.test(r.start_time))
        return res.status(400).json({ error: 'start_time invalide (HH:MM)' })
      if (!r.end_time || !TIME_RE.test(r.end_time))
        return res.status(400).json({ error: 'end_time invalide (HH:MM)' })
      if (r.start_time >= r.end_time)
        return res.status(400).json({ error: `Créneau invalide jour ${r.day_of_week}: end_time doit être après start_time` })
    }
    const { error: delErr } = await supabase.from('booking_availability_rules').delete().eq('practitioner_id', pid)
    if (delErr) return res.status(500).json({ error: 'db_error_delete', code: delErr.code })
    if (rules.length === 0) return res.status(200).json({ rules: [] })
    const { data, error: insErr } = await supabase.from('booking_availability_rules')
      .insert(rules.map(r => ({ practitioner_id: pid, day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time })))
      .select('id, day_of_week, start_time, end_time')
    if (insErr) return res.status(500).json({ error: 'db_error_insert', code: insErr.code })
    return res.status(200).json({ rules: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── action=settings ───────────────────────────────────────────────────────────

async function handleSettings(req, res, supabase, userId) {
  const pid = req.query.practitioner_id || req.body?.practitioner_id
  if (!pid) return res.status(400).json({ error: 'practitioner_id requis' })
  if (!await verifyOwner(supabase, userId, pid)) return res.status(403).json({ error: 'forbidden' })

  const SELECT = 'id, booking_horizon_days, buffer_before_min, buffer_after_min, min_advance_hours, max_per_day, booking_enabled, timezone'

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('booking_practitioners').select(SELECT).eq('id', pid).single()
    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ settings: data })
  }

  if (req.method === 'PUT') {
    const body = req.body || {}
    const update = {}
    for (const k of SETTINGS_FIELDS) if (k in body) update[k] = body[k]
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Aucun champ modifiable fourni' })
    for (const f of ['booking_horizon_days', 'buffer_before_min', 'buffer_after_min', 'min_advance_hours']) {
      if (f in update && (typeof update[f] !== 'number' || update[f] < 0 || !Number.isInteger(update[f])))
        return res.status(400).json({ error: `${f} doit être un entier ≥ 0` })
    }
    if ('max_per_day' in update && update.max_per_day !== null && (typeof update.max_per_day !== 'number' || update.max_per_day < 1))
      return res.status(400).json({ error: 'max_per_day doit être un entier ≥ 1 ou null' })
    if ('booking_enabled' in update && typeof update.booking_enabled !== 'boolean')
      return res.status(400).json({ error: 'booking_enabled doit être un booléen' })
    const { data, error } = await supabase.from('booking_practitioners')
      .update({ ...update, updated_at: new Date().toISOString() }).eq('id', pid).select(SELECT).single()
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ settings: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── action=exceptions ─────────────────────────────────────────────────────────

async function handleExceptions(req, res, supabase, userId) {
  const pid = req.query.practitioner_id || req.body?.practitioner_id
  if (!pid) return res.status(400).json({ error: 'practitioner_id requis' })
  if (!await verifyOwner(supabase, userId, pid)) return res.status(403).json({ error: 'forbidden' })

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('booking_exceptions')
      .select('id, exception_date, exception_type, slots, note').eq('practitioner_id', pid).order('exception_date')
    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ exceptions: data || [] })
  }

  if (req.method === 'PUT') {
    const { exception_date, exception_type, slots, note } = req.body || {}
    if (!exception_date || !/^\d{4}-\d{2}-\d{2}$/.test(exception_date))
      return res.status(400).json({ error: 'exception_date requis (YYYY-MM-DD)' })
    if (!['closed', 'modified'].includes(exception_type))
      return res.status(400).json({ error: 'exception_type doit être "closed" ou "modified"' })
    const { data, error } = await supabase.from('booking_exceptions')
      .upsert({ practitioner_id: pid, exception_date, exception_type, slots: slots || null, note: note || null },
               { onConflict: 'practitioner_id,exception_date' })
      .select().single()
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ exception: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id requis' })
    const { error } = await supabase.from('booking_exceptions').delete().eq('id', id).eq('practitioner_id', pid)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── action=requests ───────────────────────────────────────────────────────────

async function handleRequests(req, res, supabase, userId) {
  const pid = req.query.practitioner_id || req.body?.practitioner_id
  if (!pid) return res.status(400).json({ error: 'practitioner_id requis' })
  if (!await verifyOwner(supabase, userId, pid)) return res.status(403).json({ error: 'forbidden' })

  if (req.method === 'GET') {
    const status = req.query.status
    let q = supabase.from('booking_requests').select('*').eq('practitioner_id', pid)
    if (status) q = q.eq('status', status)
    q = q.order('created_at', { ascending: false }).limit(100)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ requests: data || [] })
  }

  if (req.method === 'PUT') {
    const { id, status, practitioner_notes, travel_fee_cents, final_price_cents, scheduled_at } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id requis' })

    const VALID_STATUSES = ['pending', 'contacted', 'scheduled', 'rejected', 'cancelled']
    if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'status invalide' })

    const { data: request, error: reqErr } = await supabase
      .from('booking_requests').select('*').eq('id', id).eq('practitioner_id', pid).single()
    if (reqErr || !request) return res.status(404).json({ error: 'Demande introuvable' })

    if (status === 'scheduled') {
      if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at requis pour confirmer le RDV' })
      const scheduledDate = new Date(scheduled_at)
      if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'scheduled_at invalide (ISO 8601 attendu)' })

      // Validation des montants
      const travelFee  = travel_fee_cents  != null ? Math.round(Number(travel_fee_cents))  : 0
      const finalPrice = final_price_cents != null ? Math.round(Number(final_price_cents)) : null
      if (isNaN(travelFee) || travelFee < 0)                       return res.status(400).json({ error: 'travel_fee_cents invalide (entier >= 0)' })
      if (finalPrice != null && (isNaN(finalPrice) || finalPrice < 0)) return res.status(400).json({ error: 'final_price_cents invalide (entier >= 0)' })

      // Garde anti-double-confirmation (le RPC refait cette vérification sous verrou)
      if (request.confirmed_booking_id || request.status === 'scheduled') {
        return res.status(409).json({ error: 'Cette demande a déjà été confirmée.', booking_id: request.confirmed_booking_id })
      }
      if (['rejected', 'cancelled'].includes(request.status)) {
        return res.status(409).json({ error: `Impossible de confirmer une demande en statut "${request.status}".` })
      }

      // ── Google FreeBusy (optionnel — fail open si non connecté ou erreur réseau) ──
      const { data: conn } = await supabase.from('booking_calendar_connections')
        .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
        .eq('practitioner_id', pid).eq('is_active', true).single()

      if (conn) {
        try {
          const [{ data: svcFB }, { data: practFB }] = await Promise.all([
            supabase.from('booking_services').select('duration_min').eq('id', request.service_id).single(),
            supabase.from('booking_practitioners').select('buffer_before_min, buffer_after_min').eq('id', pid).single(),
          ])
          const durationMin = svcFB?.duration_min || 60
          const endsAtFB    = new Date(scheduledDate.getTime() + durationMin * 60_000)
          const bufBefore   = (practFB?.buffer_before_min ?? 0) * 60_000
          const bufAfter    = (practFB?.buffer_after_min  ?? 0) * 60_000

          let accessToken
          if (Date.now() > new Date(conn.token_expiry).getTime() - 60_000) {
            const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
            accessToken = refreshed.access_token
            await supabase.from('booking_calendar_connections').update({
              access_token_enc: encrypt(accessToken),
              token_expiry:     refreshed.expires_at,
              updated_at:       new Date().toISOString(),
            }).eq('practitioner_id', pid)
          } else {
            accessToken = decrypt(conn.access_token_enc)
          }

          const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timeMin:  new Date(scheduledDate.getTime() - bufBefore).toISOString(),
              timeMax:  new Date(endsAtFB.getTime()     + bufAfter).toISOString(),
              timeZone: 'Europe/Paris',
              items: [{ id: conn.google_calendar_id || 'primary' }],
            }),
          })
          if (fbRes.ok) {
            const fbData = await fbRes.json()
            const busy = fbData.calendars?.[conn.google_calendar_id || 'primary']?.busy ?? []
            if (busy.length > 0) {
              return res.status(409).json({ error: 'Ce créneau est déjà occupé dans votre Google Agenda. Choisissez une autre plage.' })
            }
          }
          // Si FreeBusy échoue (réseau, token) : on laisse passer — planification manuelle
        } catch { /* fail open */ }
      }

      // ── Confirmation atomique via RPC (verrou + anti-doublons + anti-chevauchement) ─
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('confirm_booking_request', {
        p_request_id:         id,
        p_practitioner_id:    pid,
        p_scheduled_at:       scheduledDate.toISOString(),
        p_travel_fee_cents:   travelFee,
        p_final_price_cents:  finalPrice,
        p_practitioner_notes: practitioner_notes?.trim() || null,
      })

      if (rpcErr) {
        if (rpcErr.code === 'PGRST202') {
          return res.status(503).json({ error: 'Fonction confirm_booking_request non créée — appliquez docs/rdv-confirm-request-migration.sql.' })
        }
        return res.status(500).json({ error: 'Erreur lors de la confirmation.', code: rpcErr.code })
      }

      if (rpcResult?.error) {
        const MAP = {
          already_confirmed: [409, 'Cette demande a déjà été confirmée.'],
          request_not_found: [404, 'Demande introuvable.'],
          request_closed:    [409, 'Impossible de confirmer une demande clôturée.'],
          service_not_found: [500, 'Service introuvable.'],
          conflict:          [409, rpcResult.message || 'Conflit de créneau MediumIA.'],
        }
        const [httpStatus, msg] = MAP[rpcResult.error] || [500, rpcResult.error]
        return res.status(httpStatus).json({ error: msg })
      }

      return res.status(200).json({ booking_id: rpcResult.booking_id, scheduled_at: scheduledDate.toISOString() })
    }

    const update = { updated_at: new Date().toISOString() }
    if (status) update.status = status
    if ('practitioner_notes' in (req.body || {})) update.practitioner_notes = practitioner_notes ?? null
    if ('travel_fee_cents' in (req.body || {})) {
      const v = travel_fee_cents != null ? Math.round(Number(travel_fee_cents)) : 0
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'travel_fee_cents invalide (entier >= 0)' })
      update.travel_fee_cents = v
    }
    if ('final_price_cents' in (req.body || {})) {
      if (final_price_cents == null) {
        update.final_price_cents = null
      } else {
        const v = Math.round(Number(final_price_cents))
        if (isNaN(v) || v < 0) return res.status(400).json({ error: 'final_price_cents invalide (entier >= 0)' })
        update.final_price_cents = v
      }
    }

    const { data, error } = await supabase.from('booking_requests')
      .update(update).eq('id', id).select().single()
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ request: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Router principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const supabase = getSupabaseAdmin()
  const { userId } = auth
  const action = req.query.action || 'me'

  switch (action) {
    case 'me':           return handleMe(req, res, supabase, userId)
    case 'services':     return handleServices(req, res, supabase, userId)
    case 'availability': return handleAvailability(req, res, supabase, userId)
    case 'settings':     return handleSettings(req, res, supabase, userId)
    case 'exceptions':   return handleExceptions(req, res, supabase, userId)
    case 'requests':     return handleRequests(req, res, supabase, userId)
    default:             return res.status(400).json({ error: `action inconnue: ${action}` })
  }
}
