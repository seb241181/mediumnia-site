/**
 * /api/rdv/availability
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * GET ?practitioner_id=<uuid>
 *   Retourne les règles de disponibilité hebdomadaire.
 *
 * PUT body: { practitioner_id, rules: [{day_of_week, start_time, end_time}] }
 *   Remplace toutes les règles de façon atomique (DELETE + INSERT).
 *   day_of_week : 0=Lun, 1=Mar, 2=Mer, 3=Jeu, 4=Ven, 5=Sam, 6=Dim (convention DB)
 *   start_time / end_time : format "HH:MM" ou "HH:MM:SS"
 */
import { requireAuth, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

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

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('booking_availability_rules')
      .select('id, day_of_week, start_time, end_time')
      .eq('practitioner_id', practitionerId)
      .order('day_of_week')
      .order('start_time')

    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ rules: data })
  }

  if (req.method === 'PUT') {
    const { rules } = req.body || {}

    if (!Array.isArray(rules)) {
      return res.status(400).json({ error: 'rules (tableau) requis dans le body' })
    }

    for (const r of rules) {
      if (typeof r.day_of_week !== 'number' || r.day_of_week < 0 || r.day_of_week > 6) {
        return res.status(400).json({ error: 'day_of_week doit être entre 0 (Lun) et 6 (Dim)' })
      }
      if (!r.start_time || !TIME_RE.test(r.start_time)) {
        return res.status(400).json({ error: 'start_time invalide — format attendu : HH:MM' })
      }
      if (!r.end_time || !TIME_RE.test(r.end_time)) {
        return res.status(400).json({ error: 'end_time invalide — format attendu : HH:MM' })
      }
      if (r.start_time >= r.end_time) {
        return res.status(400).json({ error: `Créneau invalide jour ${r.day_of_week} : end_time doit être après start_time` })
      }
    }

    const { error: delErr } = await supabase
      .from('booking_availability_rules')
      .delete()
      .eq('practitioner_id', practitionerId)

    if (delErr) return res.status(500).json({ error: 'db_error_delete', code: delErr.code })

    if (rules.length === 0) {
      return res.status(200).json({ rules: [] })
    }

    const toInsert = rules.map(r => ({
      practitioner_id: practitionerId,
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
    }))

    const { data, error: insErr } = await supabase
      .from('booking_availability_rules')
      .insert(toInsert)
      .select('id, day_of_week, start_time, end_time')

    if (insErr) return res.status(500).json({ error: 'db_error_insert', code: insErr.code })
    return res.status(200).json({ rules: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
