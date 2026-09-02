/**
 * Helpers serveur-side : chiffrement AES-256-GCM, state OAuth signé HMAC,
 * rafraîchissement des tokens Google.
 *
 * NE JAMAIS importer ce fichier côté frontend — il utilise le module crypto de Node.
 * Aucun token, secret ou clé ne doit apparaître dans les logs, réponses API ou erreurs client.
 */
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12   // 96 bits — recommandé pour GCM
const STATE_TTL_MS = 5 * 60 * 1000   // 5 minutes

function getKey() {
  const hex = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY doit être une chaîne hex de 64 caractères (32 octets)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Chiffrement AES-256-GCM.
 * Retourne "<iv_hex>:<tag_hex>:<ct_hex>".
 */
export function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

/**
 * Déchiffrement AES-256-GCM. Inverse de encrypt().
 */
export function decrypt(stored) {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Format de valeur chiffrée invalide')
  const [ivHex, tagHex, ctHex] = parts
  const key = getKey()
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8')
}

/**
 * Génère un state OAuth signé HMAC-SHA256.
 * Format : base64url(payload) + "." + hmac_hex
 *
 * Sécurité : signature cryptographique + expiry 5 min + nonce unique.
 * Limitation Preview : sans table oauth_states en DB, la consommation unique
 * n'est pas garantie. Pour la Production, appliquer le SQL dans docs/rdv-schema.sql.
 */
export function generateState(practitionerSlug) {
  const payload = Buffer.from(JSON.stringify({
    slug: practitionerSlug,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  })).toString('base64url')
  const key = getKey()
  const sig = crypto.createHmac('sha256', key).update('oauth_state:' + payload).digest('hex')
  return `${payload}.${sig}`
}

/**
 * Valide un state OAuth. Retourne le practitionerSlug ou lève une Error.
 * Vérifie : signature HMAC, expiry.
 */
export function validateState(state) {
  if (!state || typeof state !== 'string') throw new Error('State absent')
  const dot = state.lastIndexOf('.')
  if (dot === -1) throw new Error('Format state invalide')
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const key = getKey()
  const expected = crypto.createHmac('sha256', key).update('oauth_state:' + payload).digest('hex')
  // Comparaison en temps constant pour prévenir les timing attacks
  const sigBuf = Buffer.from(sig.padEnd(64, '0').slice(0, 64), 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Signature state invalide')
  }
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (Date.now() > parsed.exp) throw new Error('State expiré')
  return parsed.slug
}

/**
 * Rafraîchit l'access token Google via le refresh token chiffré.
 * Ne logue jamais les tokens.
 * Retourne { access_token, expires_at }.
 */
export async function refreshGoogleToken(refreshTokenEnc) {
  const refreshToken = decrypt(refreshTokenEnc)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // Ne pas loguer la réponse brute — elle peut contenir des données sensibles
    throw new Error(`Google token refresh: HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error('Google token refresh: no access_token in response')
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  }
}

/**
 * Calcule l'offset UTC de Europe/Paris en ms pour une date donnée (YYYY-MM-DD).
 * Retourne une valeur négative pour UTC+ (ex. -7200000 pour UTC+2 en été).
 * Utilisé pour convertir les créneaux Paris → UTC pour l'API freeBusy.
 */
export function parisUTCOffsetMs(dateStr) {
  const utcNoon = new Date(dateStr + 'T12:00:00Z')
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcNoon)
  const p = {}
  parts.forEach(({ type, value }) => { p[type] = value })
  const parisAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
  return utcNoon.getTime() - parisAsUTC.getTime()
}
