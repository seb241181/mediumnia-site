/**
 * lib/transactionalEmail.js
 *
 * Helper générique pour l'envoi d'emails via l'API HTTP Resend.
 * Pas de SDK — fetch uniquement.
 *
 * Variables d'environnement requises :
 *   RESEND_API_KEY      clé secrète Resend (jamais exposée en frontend ni loggée)
 *   RESEND_FROM_EMAIL   adresse expéditeur, ex: "MediumIA <rendezvous@mediumia.fr>"
 *
 * Ne lance jamais d'exception. Retourne toujours { status } pour permettre
 * au code appelant d'ignorer proprement les échecs email.
 */

/**
 * Échappe les caractères HTML dangereux.
 * À appliquer sur toute donnée saisie par un utilisateur avant insertion dans du HTML.
 */
export function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
}

/**
 * Envoie un email via l'API Resend.
 *
 * @param {object} opts
 * @param {string}  opts.to             Adresse du destinataire
 * @param {string}  opts.subject        Sujet de l'email
 * @param {string}  opts.html           Corps HTML
 * @param {string}  opts.text           Corps texte brut (fallback)
 * @param {string}  [opts.idempotencyKey]  Clé d'idempotence (évite les doublons sur retry)
 *
 * @returns {Promise<{status: 'sent'|'error'|'not_configured', id?: string, httpStatus?: number, message?: string}>}
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    console.warn('[transactionalEmail] RESEND_API_KEY ou RESEND_FROM_EMAIL manquant — email ignoré (not_configured).')
    return { status: 'not_configured' }
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'User-Agent':    'MediumIA/1.0',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ from, to, subject, html, text }),
    })

    if (!res.ok) {
      // Loguer sans révéler la clé ni le contenu du message
      console.error(`[transactionalEmail] Resend HTTP ${res.status} — sujet: "${subject}" — destinataire: ${to}`)
      return { status: 'error', httpStatus: res.status }
    }

    const data = await res.json()
    return { status: 'sent', id: data.id }
  } catch (err) {
    console.error(`[transactionalEmail] Exception réseau — sujet: "${subject}":`, err?.message)
    return { status: 'error', message: err?.message }
  }
}
