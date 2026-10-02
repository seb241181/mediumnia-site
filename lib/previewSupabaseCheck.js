/* global process, Buffer */
/**
 * Préversions Vercel uniquement : vérifier que le backend parle à la bonne base
 * Supabase avec une vraie clé serveur. Rien ne s'exécute en production ni en
 * local. Aucune valeur secrète n'est jamais affichée : seulement l'identifiant
 * public du projet (sous-domaine) et le TYPE de clé.
 */

// Type de clé, sans jamais révéler sa valeur.
export function supabaseKeyKind(key) {
  const value = String(key || '').trim()
  if (!value) return 'missing'
  if (value.startsWith('sb_secret_')) return 'secret'
  if (value.startsWith('sb_publishable_')) return 'publishable'
  const parts = value.split('.')
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role
      if (role === 'service_role') return 'jwt_service_role'
      if (role === 'anon') return 'jwt_anon'
    } catch { /* clé illisible */ }
  }
  return 'unknown'
}

export const SERVER_KEY_KINDS = ['secret', 'jwt_service_role']

export function supabaseProjectRef(url) {
  try {
    return new URL(url).hostname.split('.')[0] || 'invalide'
  } catch {
    return 'invalide'
  }
}

// Appelé à la création du client serveur. En préversion : journalise le projet
// et le type de clé, et refuse une clé qui n'est pas une clé serveur.
// Seulement à l'exécution réelle d'une fonction en préversion : jamais pendant
// les tests (y compris ceux lancés par le build Vercel, où VERCEL_ENV=preview).
const previewRuntime = (env) => env.VERCEL_ENV === 'preview' && !env.NODE_TEST_CONTEXT

export function checkPreviewServerKey(env = process.env) {
  if (!previewRuntime(env)) return { checked: false }
  const project = supabaseProjectRef(env.SUPABASE_URL)
  const kind = supabaseKeyKind(env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn(`[preview-check] backend supabase=${project} key=${kind}`)
  if (!SERVER_KEY_KINDS.includes(kind)) throw new Error('supabase_server_key_invalid')
  return { checked: true, project, kind }
}

// Vérification en lecture seule, une fois par instance : praticien Lumia et
// tables des migrations Lumia joignables. Ne lit aucune donnée client.
let previewTablesChecked = false
export async function checkPreviewLumiaTables(client, env = process.env) {
  if (!previewRuntime(env) || previewTablesChecked) return null
  previewTablesChecked = true
  const slug = String(env.LUMIA_INTAKE_PRACTITIONER_SLUG || 'sebastien-seguin').trim()
  const result = {}
  try {
    const { data, error } = await client.from('booking_practitioners').select('name').eq('slug', slug).maybeSingle()
    result.practitioner = error ? 'error' : data ? `ok (${String(data.name || '').slice(0, 60)})` : 'absent'
    for (const table of ['mediumia_customers', 'booking_request_intake_events']) {
      const { error: tableError } = await client.from(table).select('id', { head: true, count: 'exact' }).limit(1)
      result[table] = tableError ? 'absente' : 'ok'
    }
    const { error: columnError } = await client.from('booking_requests').select('video_channel, customer_id', { head: true }).limit(1)
    result.booking_requests_lumia_columns = columnError ? 'absentes' : 'ok'
  } catch {
    result.error = 'check_failed'
  }
  console.warn(`[preview-check] lumia ${Object.entries(result).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  return result
}
