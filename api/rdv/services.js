/**
 * /api/rdv/services
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * GET    ?practitioner_id=<uuid>           Liste les services du praticien
 * POST   body: { practitioner_id, title, slug, ... }  Crée un service
 * PUT    body: { id, practitioner_id, ...champs }      Modifie un service
 * DELETE ?id=<uuid>&practitioner_id=<uuid>             Supprime un service
 *
 * Chaque opération vérifie que practitioner.owner_id === auth.userId.
 */
import { requireAuth, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]{2}$/
const ALLOWED_MODALITIES = ['video', 'phone', 'in-person']

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

  if (req.method === 'GET') {
    const practitionerId = req.query.practitioner_id
    if (!practitionerId) return res.status(400).json({ error: 'practitioner_id requis' })

    const owns = await verifyOwner(supabase, auth.userId, practitionerId)
    if (!owns) return res.status(403).json({ error: 'forbidden' })

    const { data, error } = await supabase
      .from('booking_services')
      .select('*')
      .eq('practitioner_id', practitionerId)
      .order('sort_order')

    if (error) return res.status(500).json({ error: 'db_error', code: error.code })
    return res.status(200).json({ services: data })
  }

  if (req.method === 'POST') {
    const { practitioner_id, title, slug, description, duration_min, price_cents, modality, is_active, sort_order } = req.body || {}

    if (!practitioner_id || !title || !slug || !duration_min) {
      return res.status(400).json({ error: 'Champs requis : practitioner_id, title, slug, duration_min' })
    }
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'slug invalide — uniquement a-z, 0-9 et tirets, 2-60 caractères' })
    }
    if (typeof duration_min !== 'number' || duration_min <= 0) {
      return res.status(400).json({ error: 'duration_min doit être un entier positif' })
    }
    if (modality && !modality.every(m => ALLOWED_MODALITIES.includes(m))) {
      return res.status(400).json({ error: `modality invalide — valeurs autorisées : ${ALLOWED_MODALITIES.join(', ')}` })
    }

    const owns = await verifyOwner(supabase, auth.userId, practitioner_id)
    if (!owns) return res.status(403).json({ error: 'forbidden' })

    const { data, error } = await supabase
      .from('booking_services')
      .insert({
        practitioner_id,
        title,
        slug,
        description: description || '',
        duration_min,
        price_cents: price_cents ?? null,
        currency: 'EUR',
        modality: modality || [],
        is_active: is_active !== false,
        sort_order: sort_order || 0,
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(201).json({ service: data })
  }

  if (req.method === 'PUT') {
    const { id, practitioner_id, ...fields } = req.body || {}

    if (!id || !practitioner_id) {
      return res.status(400).json({ error: 'id et practitioner_id requis' })
    }

    const owns = await verifyOwner(supabase, auth.userId, practitioner_id)
    if (!owns) return res.status(403).json({ error: 'forbidden' })

    const ALLOWED = ['title', 'slug', 'description', 'duration_min', 'price_cents', 'modality', 'is_active', 'sort_order']
    const update = {}
    for (const k of ALLOWED) {
      if (k in fields) update[k] = fields[k]
    }

    if (update.slug && !SLUG_RE.test(update.slug)) {
      return res.status(400).json({ error: 'slug invalide' })
    }
    if (update.duration_min !== undefined && (typeof update.duration_min !== 'number' || update.duration_min <= 0)) {
      return res.status(400).json({ error: 'duration_min doit être un entier positif' })
    }
    if (update.modality && !update.modality.every(m => ALLOWED_MODALITIES.includes(m))) {
      return res.status(400).json({ error: `modality invalide — valeurs autorisées : ${ALLOWED_MODALITIES.join(', ')}` })
    }

    const { data, error } = await supabase
      .from('booking_services')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('practitioner_id', practitioner_id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ service: data })
  }

  if (req.method === 'DELETE') {
    const id = req.query.id
    const practitioner_id = req.query.practitioner_id

    if (!id || !practitioner_id) {
      return res.status(400).json({ error: 'id et practitioner_id requis' })
    }

    const owns = await verifyOwner(supabase, auth.userId, practitioner_id)
    if (!owns) return res.status(403).json({ error: 'forbidden' })

    const { error } = await supabase
      .from('booking_services')
      .delete()
      .eq('id', id)
      .eq('practitioner_id', practitioner_id)

    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
