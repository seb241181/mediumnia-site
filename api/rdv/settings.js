/**
 * /api/rdv/settings
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * GET ?practitioner_id=<uuid>
 *   Retourne les paramètres de réservation du praticien.
 *
 * PUT body: { practitioner_id, ...champs }
 *   Met à jour les paramètres autorisés (whitelist).
 *
 * Champs modifiables :
 *   booking_horizon_days  INTEGER   — horizon en jours
 *   buffer_before_min     INTEGER   — tampon avant séance (minutes)
 *   buffer_after_min      INTEGER   — tampon après séance (minutes)
 *   min_advance_hours     INTEGER   — délai minimum avant réservation (heures)
 *   max_per_day           INTEGER   — max réservations/jour (null = illimité)
 *   booking_enabled       BOOLEAN   — réservations ouvertes ou fermées
 *   timezone              TEXT      — ex: 'Europe/Paris'
 */
import { requireAuth, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

const ALLOWED_FIELDS = [
  'booking_horizon_days',
  'buffer_before_min',
  'buffer_after_min',
  'min_advance_hours',
  'max_per_day',
  'booking_enabled',
  'timezone',
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const supabase = getSupabaseAdmin()
  const practitionerId = req.query.practitioner_id || req.body?.practitioner_id

  if (!practitionerId) return res.status(400).json({ error: 'practitioner_id requis' })

  const owns = await verifyOwner(supabase, auth.userId, practitionerId)
  if (!owns) return res.status(403).json({ error: 'forbidden' })

  const SELECT_COLS = 'id, booking_horizon_days, buffer_before_min, buffer_after_min, min_advance_hours, max_per_day, booking_enabled, timezone'

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('booking_practitioners')
      .select(SELECT_COLS)
      .eq('id', practitionerId)
      .single()

    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ settings: data })
  }

  if (req.method === 'PUT') {
    const body = req.body || {}
    const update = {}
    for (const k of ALLOWED_FIELDS) {
      if (k in body) update[k] = body[k]
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: `Aucun champ modifiable fourni. Champs acceptés : ${ALLOWED_FIELDS.join(', ')}` })
    }

    // Validations basiques
    const intFields = ['booking_horizon_days', 'buffer_before_min', 'buffer_after_min', 'min_advance_hours']
    for (const f of intFields) {
      if (f in update && (typeof update[f] !== 'number' || update[f] < 0 || !Number.isInteger(update[f]))) {
        return res.status(400).json({ error: `${f} doit être un entier ≥ 0` })
      }
    }
    if ('max_per_day' in update && update.max_per_day !== null && (typeof update.max_per_day !== 'number' || update.max_per_day < 1)) {
      return res.status(400).json({ error: 'max_per_day doit être un entier ≥ 1 ou null' })
    }
    if ('booking_enabled' in update && typeof update.booking_enabled !== 'boolean') {
      return res.status(400).json({ error: 'booking_enabled doit être un booléen' })
    }

    const { data, error } = await supabase
      .from('booking_practitioners')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', practitionerId)
      .select(SELECT_COLS)
      .single()

    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ settings: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
