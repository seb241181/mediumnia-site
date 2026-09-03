import { escapeHtml } from './transactionalEmail.js'

function formatDate(startsAt, timezone = 'Europe/Paris') {
  const date = new Date(startsAt)
  const dateText = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
  }).format(date)
  const timeText = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date)
  return { dateText: dateText.charAt(0).toUpperCase() + dateText.slice(1), timeText }
}

export function buildPaidRdvConfirmation({ firstName, serviceTitle, startsAt, durationMin, timezone, amountCents, meetLink, cancelUrl }) {
  const { dateText, timeText } = formatDate(startsAt, timezone)
  const amount = `${(amountCents / 100).toFixed(2).replace('.', ',')} EUR`
  const meetHtml = meetLink
    ? `<p style="margin:22px 0;"><a href="${escapeHtml(meetLink)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;">Rejoindre la visioconférence</a></p>`
    : '<p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Votre rendez-vous est bien confirmé. Le lien de visioconférence est en cours de préparation et vous sera communiqué séparément.</p>'
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Votre rendez-vous MediumIA est confirmé</title></head><body style="margin:0;padding:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;"><div style="max-width:560px;margin:0 auto;padding:40px 24px;"><p style="font-size:20px;font-weight:700;margin:0 0 28px;letter-spacing:.12em;color:#C9A84C;">✦ MEDIUMIA</p><h1 style="font-size:22px;margin:0 0 20px;">Votre rendez-vous est confirmé</h1><p style="font-size:15px;line-height:1.7;">Bonjour ${escapeHtml(firstName)},</p><div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;"><p style="margin:0;font-size:15px;font-weight:bold;">${escapeHtml(serviceTitle)}</p><p style="margin:8px 0 0;font-size:14px;color:#4A3F6B;"><strong>Date :</strong> ${escapeHtml(dateText)}</p><p style="margin:4px 0 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(timeText)}</p><p style="margin:4px 0 0;font-size:14px;color:#4A3F6B;"><strong>Durée :</strong> ${durationMin} min</p><p style="margin:12px 0 0;font-size:14px;color:#4A3F6B;"><strong>Règlement reçu :</strong> ${amount}<br>Paiment PayPal confirmé</p></div>${meetHtml}<p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Vous pouvez annuler vous-même jusqu’à 24 heures avant le rendez-vous.</p><p style="margin:22px 0 30px;"><a href="${escapeHtml(cancelUrl)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;">Annuler mon rendez-vous</a></p><p style="font-size:12px;line-height:1.6;color:#756B89;">À moins de 24 heures, l’annulation automatique est bloquée. Contactez directement Sébastien.</p><p style="font-size:15px;line-height:1.7;margin-top:28px;">À bientôt,<br><strong>Sébastien</strong><br>MediumIA</p></div></body></html>`
  const text = [`Bonjour ${firstName},`, '', 'Votre rendez-vous MediumIA est confirmé.', '', `Prestation : ${serviceTitle}`, `Date : ${dateText}`, `Heure : ${timeText}`, `Durée : ${durationMin} min`, `Règlement reçu : ${amount}`, 'Paiement PayPal confirmé', '', meetLink ? `Rejoindre la visioconférence : ${meetLink}` : 'Le lien de visioconférence est en cours de préparation et vous sera communiqué séparément.', '', 'Vous pouvez annuler vous-même jusqu’à 24 heures avant le rendez-vous :', cancelUrl, '', 'À bientôt,', 'Sébastien', 'MediumIA'].join('\n')
  return { subject: 'Votre rendez-vous MediumIA est confirmé', html, text }
}
