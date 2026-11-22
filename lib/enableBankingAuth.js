/* global process */
/**
 * Enable Banking AIS-only authentication helpers.
 * This module is server-only. Never log or return a private key, JWT or session.
 */
import { createHash, createPrivateKey, createSign, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const APP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REDIRECT_URI = 'https://mediumia.fr/api/banking/callback'

export const enableBankingCallbackUrl = REDIRECT_URI

export function readBankConnectionConfig(env = process.env) {
  const appId = String(env.ENABLE_BANKING_APP_ID || '')
  const privateKey64 = String(env.ENABLE_BANKING_PRIVATE_KEY_B64 || '')
  const dataKeyHex = String(env.ENABLE_BANKING_DATA_KEY || '')
  const aspsp = String(env.ENABLE_BANKING_ASPSP_NAME || '').trim()
  // Never call the real bank from Vercel previews or local builds.
  const enabled = env.ENABLE_BANKING_CONNECT_ENABLED === 'true' && env.VERCEL_ENV === 'production'
  if (!enabled || !APP_ID_RE.test(appId) || !/^[a-f0-9]{64}$/i.test(dataKeyHex)
    || !privateKey64 || !aspsp || aspsp.length > 120) return null
  try {
    const privateKey = createPrivateKey(Buffer.from(privateKey64, 'base64').toString('utf8'))
    if (privateKey.asymmetricKeyType !== 'rsa') return null
    return { appId, privateKey, dataKey: Buffer.from(dataKeyHex, 'hex'), aspsp }
  } catch {
    return null
  }
}

export function newBankState() {
  return randomBytes(32).toString('base64url')
}

export function bankStateHash(state) {
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null
  return createHash('sha256').update('mediumia-enable-banking-state:' + state).digest('hex')
}

export function applicationJwt(config, nowMs = Date.now()) {
  const issued = Math.floor(nowMs / 1000)
  const header = { typ: 'JWT', alg: 'RS256', kid: config.appId }
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: issued, exp: issued + 300 }
  const encoded = [header, payload].map(item => Buffer.from(JSON.stringify(item)).toString('base64url')).join('.')
  const signer = createSign('RSA-SHA256')
  signer.update(encoded)
  signer.end()
  return encoded + '.' + signer.sign(config.privateKey).toString('base64url')
}

export function protectBankValue(value, config) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.dataKey, iv)
  const result = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), result].map(part => part.toString('base64url')).join('.')
}

export function unprotectBankValue(value, config) {
  const parts = String(value || '').split('.')
  if (parts.length !== 3) throw new Error('invalid_ciphertext')
  const [iv, tag, cipherText] = parts.map(value => Buffer.from(value, 'base64url'))
  if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid_ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', config.dataKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8')
}

export async function enableBankingApi(config, path, body, fetchImpl = fetch) {
  if (!['/auth', '/sessions'].includes(path)) throw new Error('unsupported_bank_action')
  const response = await fetchImpl('https://api.enablebanking.com' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + applicationJwt(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('bank_provider_unavailable')
  return response.json()
}

export function safeBankAuthorizationUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'enablebanking.com' || url.hostname.endsWith('.enablebanking.com'))
  } catch { return false }
}

/**
 * Restrict account-data API calls to exact, UUID-validated GET endpoints.
 * Never accept a provider URL, arbitrary path or payment-initiation endpoint.
 */
export async function enableBankingGet(config, kind, id, query = {}, fetchImpl = fetch) {
  if (!APP_ID_RE.test(String(id || ''))) throw new Error('invalid_bank_id')
  if (!['session', 'transactions'].includes(kind)) throw new Error('unsupported_bank_action')
  const path = kind === 'session'
    ? '/sessions/' + id
    : '/accounts/' + id + '/transactions'
  const url = new URL('https://api.enablebanking.com' + path)
  if (kind === 'transactions') {
    const from = String(query.date_from || '')
    const to = String(query.date_to || '')
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(from) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(to))
      throw new Error('invalid_bank_date')
    url.searchParams.set('date_from', from)
    url.searchParams.set('date_to', to)
    url.searchParams.set('transaction_status', 'BOOK')
    if (query.continuation_key) {
      const key = String(query.continuation_key)
      if (key.length > 2048) throw new Error('invalid_continuation_key')
      url.searchParams.set('continuation_key', key)
    }
  }
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + applicationJwt(config),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('bank_provider_unavailable')
  return response.json()
}
