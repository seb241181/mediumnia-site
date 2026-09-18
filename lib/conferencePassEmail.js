import { escapeHtml, sendEmail } from './transactionalEmail.js'

const FROM = 'MediumIA <conference@mail.mediumia.fr>'

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value))
}

export function buildConferencePassEmail({ firstName, eventTitle, expiresAt, passUrl, offerLabel }) {
  const h = escapeHtml
  const safeName = h(firstName || 'Bonjour')
  const safeTitle = h(eventTitle || 'Conférence MediumIA')
  const safeUrl = h(passUrl)
  const safeLabel = h(offerLabel || 'Offre spéciale conférence')
  const expiry = formatDate(expiresAt)

  return {
    subject: 'Votre Pass Conférence MediumIA',
    html: `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif;color:#1a1535"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #e0c987"><tr><td style="background:#1a1535;padding:34px 30px;color:#fffaf0"><p style="margin:0;color:#c9a84c;font-size:12px;letter-spacing:2px">PASS MEDIUMIA · CONFÉRENCE</p><h1 style="margin:14px 0 0;font-size:30px;line-height:1.2">Votre Pass personnel est prêt.</h1></td></tr><tr><td style="padding:32px 30px;font-size:16px;line-height:1.65;color:#514b62"><p>Bonjour ${safeName},</p><p>Merci pour votre présence à <strong>${safeTitle}</strong>.</p><p>Votre Pass MediumIA personnel vous donne accès à ${safeLabel}. Il est lié à votre e-mail d’inscription, valable 1 mois et utilisable une seule fois.</p><p style="text-align:center;margin:30px 0"><a href="${safeUrl}" style="display:inline-block;background:#c9a84c;color:#1a1535;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Ouvrir mon Pass MediumIA</a></p><p style="font-size:13px;color:#716b7c">Expiration : ${h(expiry)}. Ce lien est personnel : ne le partagez pas.</p><p>À très bientôt,<br><strong>Sébastien · MediumIA</strong></p></td></tr></table></td></tr></table></body></html>`,
    text: `Bonjour ${firstName || ''}\n\nMerci pour votre présence à ${eventTitle || 'la conférence MediumIA'}.\n\nVotre Pass MediumIA personnel vous donne accès à ${offerLabel || 'l’offre spéciale conférence'}. Il est lié à votre e-mail d’inscription, valable 1 mois et utilisable une seule fois.\n\nOuvrir mon Pass MediumIA : ${passUrl}\n\nExpiration : ${expiry}\n\nCe lien est personnel : ne le partagez pas.\n\nSébastien · MediumIA`,
  }
}

export async function sendConferencePassEmail({ to, registrationId, ...payload }) {
  const email = buildConferencePassEmail(payload)
  return sendEmail({
    from: FROM,
    to,
    ...email,
    idempotencyKey: `conference-pass-${registrationId}`,
  })
}
