/**
 * Client Supabase côté serveur avec service role key.
 * Ne jamais exposer côté frontend (pas de préfixe VITE_).
 */
import { createClient } from '@supabase/supabase-js'

let _client = null

export function getSupabaseAdmin() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis')
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  })
  return _client
}

export function isSupabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Vérifie que la requête est authentifiée via Supabase JWT ET que l'utilisateur
 * connecté est propriétaire du praticien identifié par `slug`.
 *
 * Attend un en-tête : Authorization: Bearer <supabase_access_token>
 *
 * Retourne { practitionerId: string }        si autorisé.
 * Retourne { status: number, error: string } si refusé.
 *
 * Important : booking_practitioners.owner_id doit être renseigné avec l'UUID
 * auth.users.id du praticien pour que la vérification fonctionne.
 * Avec owner_id = NULL (seed initial), toute demande est rejetée (403).
 */
export async function requirePractitionerOwner(req, slug) {
  if (!isSupabaseConfigured()) {
    return { status: 503, error: 'supabase_not_configured' }
  }

  const authHeader = (req.headers['authorization'] || '').trim()
  if (!authHeader.startsWith('Bearer ')) {
    return { status: 401, error: 'unauthenticated' }
  }
  const token = authHeader.slice(7)

  const supabase = getSupabaseAdmin()

  // Valide le JWT Supabase via l'API auth admin
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return { status: 401, error: 'unauthenticated' }
  }

  // Vérifie que le praticien existe ET que owner_id correspond à l'utilisateur connecté.
  // NULL owner_id ne matche jamais un user.id → accès refusé par conception.
  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', slug)
    .eq('owner_id', user.id)
    .single()

  if (!practitioner) {
    return { status: 403, error: 'forbidden' }
  }

  return { practitionerId: practitioner.id }
}
