/**
 * lib/transactionalEmail.js
 *
 * Helper générique pour l'envoi d'emails via l'API HTTP Resend.
 * Pas de SDK — fetch uniquement.
 *
 * Variables d'environnement requises :
 *   RESEND_API_KEY      clé Resend d'envoi, idéalement limitée à "sending access"
 *   RESEND_FROM_EMAIL   adresse expéditeur, ex: "MediumIA <rendezvous@mediumia.fr>"
 *
 * Variable recommandée pour la gestion :
 *   RESEND_MANAGEMENT_API_KEY  clé Resend "full access" utilisée uniquement pour
 *                              annuler les e-mails programmés. Si absente, le helper
 *                              retombe sur RESEND_API_KEY pour compatibilité.
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

function resendHeaders(apiKey, idempotencyKey) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'MediumIA/1.0',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return headers
}

export async function sendEmail({ to, subject, html, text, idempotencyKey, scheduledAt, fromOverride }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = fromOverride || process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    console.warn('[transactionalEmail] Configuration Resend absente — email ignoré (not_configured).')
    return { status: 'not_configured' }
  }

  const prepared = injectBookingBankDetails(html, text)
  const payload = { from, to, subject, html: prepared.html, text: prepared.text }
  if (scheduledAt) payload.scheduled_at = scheduledAt

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: resendHeaders(apiKey, idempotencyKey),
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.error(`[transactionalEmail] Resend HTTP ${res.status}`)
      return { status: 'error', httpStatus: res.status }
    }

    const data = await res.json()
    return { status: 'sent', id: data.id }
  } catch (err) {
    console.error(`[transactionalEmail] Exception réseau (${err?.name || 'Error'})`)
    return { status: 'error' }
  }
}

/**
 * Annule un e-mail Resend encore programmé.
 * La clé de gestion est volontairement séparée de la clé d'envoi afin que
 * l'application conserve une clé "send only" pour son fonctionnement courant.
 */
export async function cancelScheduledEmail(emailId) {
  const apiKey = process.env.RESEND_MANAGEMENT_API_KEY || process.env.RESEND_API_KEY
  const normalizedId = typeof emailId === 'string' ? emailId.trim() : ''

  if (!apiKey) return { status: 'not_configured' }
  if (!normalizedId) return { status: 'error', httpStatus: 400 }

  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(normalizedId)}/cancel`, {
      method: 'POST',
      headers: resendHeaders(apiKey),
    })

    if (!res.ok) {
      if ([400, 404, 409, 422].includes(res.status)) return { status: 'not_pending', httpStatus: res.status }
      console.error(`[transactionalEmail] Resend cancel HTTP ${res.status}`)
      return { status: 'error', httpStatus: res.status }
    }

    return { status: 'cancelled' }
  } catch (err) {
    console.error(`[transactionalEmail] Cancel exception réseau (${err?.name || 'Error'})`)
    return { status: 'error' }
  }
}
