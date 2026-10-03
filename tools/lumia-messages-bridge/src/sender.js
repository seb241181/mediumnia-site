/**
 * Envoi d'une demande à l'API Lumia existante. Interprète la réponse :
 *   ok      → 201 created, 200 updated / duplicate (idempotent : succès) ;
 *   retry   → réseau, délai dépassé, 429, 5xx (le serveur déduplique sur
 *             canal + identifiant : réessayer ne crée jamais de doublon) ;
 *   auth    → 401 / 403 : jeton refusé, on arrête d'envoyer pour ce passage ;
 *   reject  → autre 4xx (demande invalide) : pas de nouvel essai.
 */
export const DEFAULT_ENDPOINT = 'https://mediumia.fr/api/rdv-admin?action=lumia-rdv-intake'

export function assertSafeEndpoint(endpoint) {
  const url = new URL(endpoint)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('endpoint_must_be_https')
  return url
}

export async function sendIntake({ endpoint = DEFAULT_ENDPOINT, token, payload, timeoutMs = 15_000, fetchImpl = fetch }) {
  assertSafeEndpoint(endpoint)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { result: 'retry', status: 0, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  let body = null
  try { body = await response.json() } catch { body = null }
  const status = response.status
  if ((status === 200 || status === 201) && ['created', 'updated', 'duplicate'].includes(body?.outcome)) {
    return { result: 'ok', status, outcome: body.outcome }
  }
  if (status === 401 || status === 403) return { result: 'auth', status, reason: body?.error || 'unauthorized' }
  if (status === 429 || status >= 500 || status === 200 || status === 201) {
    return { result: 'retry', status, reason: body?.error || 'unexpected_response' }
  }
  const fields = Array.isArray(body?.fields) ? body.fields.join(',') : ''
  return { result: 'reject', status, reason: `${body?.error || 'rejected'}${fields ? `:${fields}` : ''}` }
}
