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
 * Variables d'environnement optionnelles pour les RDV visio :
 *   BOOKING_BANK_IBAN    IBAN du compte de règlement
 *   BOOKING_BANK_HOLDER  titulaire du compte
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

function formatIbanForDisplay(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

function injectBookingBankDetails(html, text) {
  const videoPaymentPlaceholder = 'Le règlement doit être effectué au plus tard 48 h avant la séance. Les informations nécessaires vous seront communiquées séparément.'
  const iban = (process.env.BOOKING_BANK_IBAN || '').trim()
  const holder = (process.env.BOOKING_BANK_HOLDER || '').trim()

  // Le placeholder n'existe que dans la confirmation d'un service visio.
  // Sans coordonnées complètes, on conserve le texte historique et on n'expose rien.
  if (!iban || !holder || (!html?.includes(videoPaymentPlaceholder) && !text?.includes(videoPaymentPlaceholder))) {
    return { html, text }
  }

  const ibanDisplay = formatIbanForDisplay(iban)
  const paymentHtml = [
    'Vous pouvez régler dès maintenant par virement bancaire.',
    '<strong>Si le règlement n’a pas été reçu au plus tard 48 h avant le rendez-vous, celui-ci sera annulé et le créneau libéré.</strong>',
    '',
    `<strong>Titulaire :</strong> ${escapeHtml(holder)}`,
    `<strong>IBAN :</strong> ${escapeHtml(ibanDisplay)}`,
    '<strong>Motif du virement :</strong> merci d’indiquer votre nom et prénom.',
  ].join('<br>')

  const paymentText = [
    'Vous pouvez régler dès maintenant par virement bancaire.',
    'Si le règlement n’a pas été reçu au plus tard 48 h avant le rendez-vous, celui-ci sera annulé et le créneau libéré.',
    '',
    `Titulaire : ${holder}`,
    `IBAN : ${ibanDisplay}`,
    'Motif du virement : merci d’indiquer votre nom et prénom.',
  ].join('\n')

  return {
    html: html?.replace(videoPaymentPlaceholder, paymentHtml),
    text: text?.replace(videoPaymentPlaceholder, paymentText),
  }
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
    console.warn('[transactionalEmail] Configuration Resend absente — email ignoré (not_configured).')
    return { status: 'not_configured' }
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'User-Agent':    'MediumIA/1.0',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const prepared = injectBookingBankDetails(html, text)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ from, to, subject, html: prepared.html, text: prepared.text }),
    })

    if (!res.ok) {
      // Ne jamais journaliser l'adresse destinataire ni le contenu du message.
      console.error(`[transactionalEmail] Resend HTTP ${res.status}`)
      return { status: 'error', httpStatus: res.status }
    }

    const data = await res.json()
    return { status: 'sent', id: data.id }
  } catch (err) {
    // Le type d'erreur suffit pour le diagnostic sans exposer de données personnelles.
    console.error(`[transactionalEmail] Exception réseau (${err?.name || 'Error'})`)
    return { status: 'error' }
  }
}
