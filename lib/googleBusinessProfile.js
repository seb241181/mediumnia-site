/**
 * Avis Google de la fiche MediumIA via l'API Google Business Profile.
 *
 * Pourquoi : Places API (New) ne renvoie que 5 avis « pertinents », sans ordre
 * chronologique. L'API Business Profile donne tous les avis de NOTRE fiche.
 *
 * Tri : l'API ne trie que par date de MODIFICATION (orderBy « updateTime desc »,
 * 50 avis par page). On lit donc toutes les pages (jusqu'à MAX_PAGES), puis on
 * trie nous-mêmes par date de PUBLICATION (createTime). Un ancien avis modifié
 * reste à sa place ; la mention « modifié le » est affichée.
 *
 * Séparation stricte avec Google Agenda :
 *   - client OAuth dédié : GOOGLE_BUSINESS_CLIENT_ID / _SECRET / _REDIRECT_URI
 *     (jamais GOOGLE_CLIENT_ID ni GOOGLE_REDIRECT_URI, utilisés par l'agenda) ;
 *   - seul droit demandé : business.manage (pas d'include_granted_scopes) ;
 *   - jeton stocké à part (table google_business_connection), chiffré ;
 *   - la déconnexion ne révoque que l'autorisation de ce client dédié.
 *
 * Rien n'est conservé des avis : ils sont lus à la demande, mis en cache 1 h
 * par Vercel. Un avis supprimé sur Google disparaît donc du site.
 * Aucun jeton, secret ou identifiant n'est écrit dans les logs ni renvoyé.
 */
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { encrypt, decrypt } from './googleOAuth.js'
import { requirePractitionerOwner, getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { GOOGLE_REVIEW_PROFILES } from './googleReviews.js'

export const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage'
export const BUSINESS_OWNER_SLUG = 'sebastien-seguin'
const PROFILE = GOOGLE_REVIEW_PROFILES[BUSINESS_OWNER_SLUG]
const TABLE = 'google_business_connection'
const STATE_TTL_MS = 10 * 60 * 1000
const PAGE_SIZE = 50
export const MAX_PAGES = 6
export const MAX_PUBLIC_REVIEWS = 30
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
const ERROR_CODE_RE = /^[a-z0-9_]{1,60}$/

const REQUIRED_ENV = ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET', 'GOOGLE_BUSINESS_REDIRECT_URI', 'CALENDAR_TOKEN_ENCRYPTION_KEY']

export function missingBusinessEnv(env = process.env) {
  return REQUIRED_ENV.filter((name) => !String(env[name] || '').trim())
    .concat(env.CALENDAR_TOKEN_ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(env.CALENDAR_TOKEN_ENCRYPTION_KEY) ? ['CALENDAR_TOKEN_ENCRYPTION_KEY (64 hex)'] : [])
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const safeCode = (value, fallback) => (ERROR_CODE_RE.test(String(value || '')) ? String(value) : fallback)

// ── State OAuth signé, à usage unique (empreinte du nonce en base) ───────────

function stateKey(env) {
  return Buffer.from(String(env.CALENDAR_TOKEN_ENCRYPTION_KEY || ''), 'hex')
}

export function signBusinessState(nonce, exp, env = process.env) {
  const payload = Buffer.from(JSON.stringify({ p: 'gbp', n: nonce, exp })).toString('base64url')
  const sig = crypto.createHmac('sha256', stateKey(env)).update(`gbp_oauth_state:${payload}`).digest('hex')
  return `${payload}.${sig}`
}

export function verifyBusinessState(state, env = process.env, now = Date.now()) {
  const text = String(state || '')
  const dot = text.lastIndexOf('.')
  if (dot < 1) return null
  const payload = text.slice(0, dot)
  const sig = Buffer.from(text.slice(dot + 1), 'hex')
  const expected = crypto.createHmac('sha256', stateKey(env)).update(`gbp_oauth_state:${payload}`).digest()
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null
  let parsed
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (parsed?.p !== 'gbp' || typeof parsed.n !== 'string' || !(Number(parsed.exp) > now)) return null
  return parsed.n
}

// ── Appels Google ────────────────────────────────────────────────────────────

async function tokenRequest(params, env, fetchImpl) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_BUSINESS_CLIENT_ID, client_secret: env.GOOGLE_BUSINESS_CLIENT_SECRET, ...params }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error('token_failed'), { code: `token_${safeCode(body?.error, 'failed')}` })
  return body
}

async function googleGet(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    // 429/403 avant l'accord de Google (quota 0) : code explicite pour l'écran propriétaire.
    const code = response.status === 429 ? 'api_quota_zero_or_exceeded' : response.status === 403 ? 'api_access_denied' : response.status === 404 ? 'location_not_found' : `api_http_${response.status}`
    throw Object.assign(new Error(code), { code })
  }
  return response.json()
}

export async function discoverLocation(accessToken, env = process.env, fetchImpl = fetch) {
  const wanted = String(env.GOOGLE_BUSINESS_LOCATION_ID || '').trim().replace(/^locations\//, '')
  const accounts = await googleGet('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', accessToken, fetchImpl)
  const found = []
  for (const account of (accounts.accounts || []).slice(0, 10)) {
    if (!/^accounts\/[A-Za-z0-9_-]+$/.test(account?.name || '')) continue
    const page = await googleGet(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`, accessToken, fetchImpl)
    for (const location of page.locations || []) {
      if (/^locations\/[A-Za-z0-9_-]+$/.test(location?.name || '')) found.push({ account: account.name, location: location.name, title: String(location.title || '').slice(0, 120) })
    }
  }
  if (wanted) {
    const match = found.find((f) => f.location === `locations/${wanted}`)
    if (!match) throw Object.assign(new Error('location_not_found'), { code: 'location_not_found' })
    return match
  }
  if (found.length === 1) return found[0]
  throw Object.assign(new Error('location_choice'), { code: found.length ? 'multiple_locations' : 'no_location' })
}

// Texte d'origine de l'auteur : si Google ajoute une traduction automatique,
// on garde la partie « (Original) ». Jamais de réécriture.
export function originalComment(comment) {
  const text = String(comment || '').trim()
  const original = text.match(/\(Original\)\s*([\s\S]+)$/)
  return (original ? original[1] : text).trim()
}

export function mapBusinessReviews(pages) {
  const first = pages[0] || {}
  const seen = new Set()
  const reviews = pages.flatMap((p) => p.reviews || [])
    .filter((r) => {
      const id = r?.reviewId || r?.name
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map((r) => {
      const anonymous = Boolean(r.reviewer?.isAnonymous)
      const created = Date.parse(r.createTime || '')
      const updated = Date.parse(r.updateTime || '')
      return {
        author: anonymous ? 'Utilisateur Google' : (String(r.reviewer?.displayName || '').trim() || 'Utilisateur Google'),
        authorUrl: null,
        photoUrl: anonymous ? null : (r.reviewer?.profilePhotoUrl || null),
        rating: STARS[r.starRating] || null,
        publishedAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
        // « modifié » seulement si l'auteur a vraiment changé son avis plus tard (> 1 jour).
        updatedAt: Number.isFinite(updated) && Number.isFinite(created) && updated - created > 86_400_000 ? new Date(updated).toISOString() : null,
        when: '',
        text: originalComment(r.comment).slice(0, 700),
      }
    })
    // Les notes sans commentaire comptent dans la moyenne Google, mais ne font pas une carte.
    .filter((r) => r.text)
    .sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
    .slice(0, MAX_PUBLIC_REVIEWS)
  return {
    available: true,
    source: 'business_profile',
    rating: Number(first.averageRating) || null,
    count: Number(first.totalReviewCount) || 0,
    mapsUrl: PROFILE.profileUrl,
    writeUrl: PROFILE.writeUrl,
    reviews,
  }
}

async function readConnection(db) {
  const { data, error } = await db.from(TABLE).select('*').eq('id', 1).maybeSingle()
  if (error) throw Object.assign(new Error('connection_unavailable'), { code: 'connection_unavailable' })
  return data || null
}

async function recordOutcome(db, patch) {
  try { await db.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1) } catch { /* jamais bloquant */ }
}

/**
 * Avis Business Profile, ou null si la connexion n'est pas prête (le site
 * retombe alors sur Places). Lève une erreur avec .code si Google refuse.
 */
export async function fetchBusinessReviews({ db, env = process.env, fetchImpl = fetch } = {}) {
  if (missingBusinessEnv(env).length) return null
  const connection = await readConnection(db)
  if (!connection?.refresh_token_enc || !connection.account_name || !connection.location_name) return null
  try {
    const refreshToken = decrypt(connection.refresh_token_enc)
    const { access_token: accessToken } = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, env, fetchImpl)
    const pages = []
    let pageToken = ''
    for (let i = 0; i < MAX_PAGES; i++) {
      const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), orderBy: 'updateTime desc' })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await googleGet(`https://mybusiness.googleapis.com/v4/${connection.account_name}/${connection.location_name}/reviews?${params}`, accessToken, fetchImpl)
      pages.push(page)
      pageToken = page.nextPageToken || ''
      if (!pageToken) break
    }
    await recordOutcome(db, { last_success_at: new Date().toISOString(), last_error: null, last_error_at: null })
    return mapBusinessReviews(pages)
  } catch (error) {
    const code = safeCode(error?.code, 'business_reviews_failed')
    console.warn(`[google-business] reviews ${code}`)
    await recordOutcome(db, { last_error: code, last_error_at: new Date().toISOString() })
    throw Object.assign(new Error(code), { code })
  }
}

// ── Connexion (propriétaire uniquement) ──────────────────────────────────────

export async function startConnect({ db, env = process.env, userId = null, now = Date.now() }) {
  const missing = missingBusinessEnv(env)
  if (missing.length) return { status: 503, body: { error: 'google_business_not_configured', missing_env_vars: missing } }
  if (env.VERCEL_ENV === 'preview') {
    let host = ''
    try { host = new URL(env.GOOGLE_BUSINESS_REDIRECT_URI).hostname } catch { /* invalide */ }
    if (!host.endsWith('.vercel.app')) return { status: 503, body: { error: 'redirect_uri_not_preview' } }
  }
  const nonce = crypto.randomBytes(16).toString('hex')
  const exp = now + STATE_TTL_MS
  const { error } = await db.from(TABLE).upsert({ id: 1, pending_state_hash: sha256(nonce), pending_expires_at: new Date(exp).toISOString(), pending_user_id: userId, updated_at: new Date(now).toISOString() }, { onConflict: 'id' })
  if (error) return { status: 503, body: { error: 'google_business_unavailable' } }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_BUSINESS_CLIENT_ID,
    redirect_uri: env.GOOGLE_BUSINESS_REDIRECT_URI,
    response_type: 'code',
    scope: BUSINESS_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: signBusinessState(nonce, exp, env),
  })
  return { status: 200, body: { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` } }
}

export async function completeConnect({ db, env = process.env, query = {}, now = Date.now(), fetchImpl = fetch }) {
  if (query.error) return 'refused'
  if (missingBusinessEnv(env).length) return 'not_configured'
  const nonce = verifyBusinessState(query.state, env, now)
  if (!nonce || typeof query.code !== 'string' || !query.code) return 'invalid_state'
  const connection = await readConnection(db).catch(() => null)
  const pendingOk = connection?.pending_state_hash === sha256(nonce) && Date.parse(connection.pending_expires_at || 0) > now
  // Usage unique : l'empreinte est effacée quoi qu'il arrive.
  await db.from(TABLE).update({ pending_state_hash: null, pending_expires_at: null, pending_user_id: null }).eq('id', 1)
  if (!pendingOk) return 'invalid_state'
  const userId = connection.pending_user_id || null

  let tokens
  try {
    tokens = await tokenRequest({ code: query.code, redirect_uri: env.GOOGLE_BUSINESS_REDIRECT_URI, grant_type: 'authorization_code' }, env, fetchImpl)
  } catch (error) {
    console.warn(`[google-business] connect ${safeCode(error?.code, 'token_failed')}`)
    return 'token_failed'
  }
  const scopes = String(tokens.scope || '').split(/\s+/)
  if (!scopes.includes(BUSINESS_SCOPE)) return 'scope_missing'
  if (!tokens.refresh_token) return 'no_refresh_token'

  const base = {
    refresh_token_enc: encrypt(tokens.refresh_token),
    granted_scope: BUSINESS_SCOPE,
    connected_by: userId,
    connected_at: new Date(now).toISOString(),
    account_name: null, location_name: null, location_title: null,
    last_error: null, last_error_at: null,
    updated_at: new Date(now).toISOString(),
  }
  let status = 'connected'
  try {
    const found = await discoverLocation(tokens.access_token, env, fetchImpl)
    Object.assign(base, { account_name: found.account, location_name: found.location, location_title: found.title || null })
  } catch (error) {
    // Typiquement avant l'accord de Google (quota 0) : le jeton est gardé,
    // la fiche sera retrouvée à la prochaine connexion.
    status = 'pending_access'
    Object.assign(base, { last_error: safeCode(error?.code, 'location_lookup_failed'), last_error_at: new Date(now).toISOString() })
  }
  const { error } = await db.from(TABLE).update(base).eq('id', 1)
  if (error) return 'storage_failed'
  return status
}

export async function connectionStatus({ db, env = process.env }) {
  const missing = missingBusinessEnv(env)
  const connection = await readConnection(db).catch(() => null)
  return {
    configured: missing.length === 0,
    missing_env_vars: missing,
    connected: Boolean(connection?.refresh_token_enc),
    ready: Boolean(connection?.refresh_token_enc && connection.location_name),
    location_title: connection?.location_title || null,
    connected_at: connection?.connected_at || null,
    last_success_at: connection?.last_success_at || null,
    last_error: connection?.last_error || null,
    last_error_at: connection?.last_error_at || null,
  }
}

export async function disconnect({ db, fetchImpl = fetch }) {
  const connection = await readConnection(db).catch(() => null)
  let revoked = false
  if (connection?.refresh_token_enc) {
    try {
      // Révoque uniquement l'autorisation du client dédié Business Profile.
      const token = decrypt(connection.refresh_token_enc)
      const response = await fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      })
      revoked = response.ok
    } catch { revoked = false }
  }
  const { error } = await db.from(TABLE).update({
    refresh_token_enc: null, granted_scope: null, account_name: null, location_name: null, location_title: null,
    connected_by: null, connected_at: null, pending_state_hash: null, pending_expires_at: null, pending_user_id: null,
    last_error: null, last_error_at: null, updated_at: new Date().toISOString(),
  }).eq('id', 1)
  if (error) return { status: 503, body: { error: 'google_business_unavailable' } }
  return { status: 200, body: { disconnected: true, revoked } }
}

// ── Routeur : /api/rdv-config?googleBusinessAction=… ─────────────────────────

export async function handleGoogleBusinessAction(req, res, action, deps = {}) {
  res.setHeader('Cache-Control', 'no-store')
  const env = deps.env || process.env
  if (!deps.db && !isSupabaseConfigured()) return res.status(503).json({ error: 'supabase_not_configured' })
  const db = deps.db || getSupabaseAdmin()
  const fetchImpl = deps.fetchImpl || fetch

  if (action === 'callback') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const status = await completeConnect({ db, env, query: req.query || {}, fetchImpl })
    res.statusCode = 302
    res.setHeader('Location', `/avis/moderation?google=${encodeURIComponent(status)}`)
    return res.end()
  }

  const auth = await (deps.requireOwner || requirePractitionerOwner)(req, BUSINESS_OWNER_SLUG)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (action === 'connect') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const out = await startConnect({ db, env, userId: auth.userId || null })
    return res.status(out.status).json(out.body)
  }
  if (action === 'status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    return res.status(200).json(await connectionStatus({ db, env }))
  }
  if (action === 'disconnect') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const out = await disconnect({ db, fetchImpl })
    return res.status(out.status).json(out.body)
  }
  return res.status(400).json({ error: 'unknown_action' })
}
