/* global process */
/**
 * Client Supabase côté serveur avec service role key.
 * Ne jamais exposer côté frontend (pas de préfixe VITE_).
 */
import { createClient } from '@supabase/supabase-js'
import { assertDatabaseAccess, checkDatabaseAccess } from './environmentGuard.js'

let _client = null

export function getSupabaseAdmin() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis')
  }
  // Séparation TEST / PRODUCTION : une préversion ne reçoit jamais de client
  // vers la base de Production, et la Production jamais vers une autre base.
  assertDatabaseAccess(process.env, url, 'supabase-admin')
  _client = createClient(url, key, {
    auth: { persistSession: false },
  })
  return _client
}

// « Non configuré » aussi quand la base ne correspond pas à l'environnement :
// les routes répondent alors leur état « configuration requise » au lieu
// d'écrire dans la mauvaise base.
export function isSupabaseConfigured() {
  if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return false
  return checkDatabaseAccess(process.env, process.env.SUPABASE_URL).ok
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

  return { practitionerId: practitioner.id, userId: user.id }
}

/**
 * Authentifie la requête via JWT Supabase uniquement (sans vérification de propriété).
 * Utilisé pour les endpoints qui vérifient owner_id eux-mêmes.
 *
 * Retourne { userId: string }        si authentifié.
 * Retourne { status: number, error } sinon.
 */
export async function requireAuth(req) {
  if (!isSupabaseConfigured()) return { status: 503, error: 'supabase_not_configured' }
  const authHeader = (req.headers['authorization'] || '').trim()
  if (!authHeader.startsWith('Bearer ')) return { status: 401, error: 'unauthenticated' }
  const token = authHeader.slice(7)
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { status: 401, error: 'unauthenticated' }
  return { userId: user.id }
}
