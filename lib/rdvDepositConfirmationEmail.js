import { escapeHtml } from './transactionalEmail.js'

function formatDate(startsAt, timezone = 'Europe/Paris') {
  const value = new Date(startsAt)
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
  }).format(value)
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(value)
  return { date: date.charAt(0).toUpperCase() + date.slice(1), time }
}

function money(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`
}

export function buildRdvDepositConfirmation({
  firstName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
  servicePriceCents,
  depositCents,
  cancelUrl,
  meetLink = null,
}) {
  const when = formatDate(startsAt, timezone)
  const balanceCents = Math.max(0, servicePriceCents - depositCents)
  const subject = 'MediumIA — Votre rendez-vous est confirmé'

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:580px;margin:0 auto;padding:40px 24px;">
  <p style="font-size:20px;font-weight:700;letter-spacing:.12em;color:#C9A84C;margin:0 0 26px;">✦ MEDIUMIA</p>
  <h1 style="font-size:24px;margin:0 0 18px;">Votre rendez-vous est confirmé</h1>
  <p style="font-size:15px;line-height:1.7;">Bonjour ${escapeHtml(firstName)},</p>
  <p style="font-size:15px;line-height:1.7;">Vos arrhes de réservation ont bien été réglées. Votre créneau est maintenant confirmé.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:bold;">${escapeHtml(serviceTitle)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Date :</strong> ${escapeHtml(when.date)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(when.time)}</p>
    <p style="margin:14px 0 4px;font-size:14px;color:#4A3F6B;"><strong>Prix total :</strong> ${money(servicePriceCents)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Arrhes réglées :</strong> ${money(depositCents)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Solde restant :</strong> ${money(balanceCents)}</p>
  </div>
  ${meetLink ? `<p style="margin:22px 0;"><a href="${escapeHtml(meetLink)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;">Rejoindre la visioconférence</a></p>` : ''}
  <p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Vous pouvez annuler vous-même jusqu’à 48 heures avant le rendez-vous via le lien ci-dessous.</p>
  <p style="margin:20px 0 12px;"><a href="${escapeHtml(cancelUrl)}" style="display:inline-block;border:1px solid #C9A84C;color:#1A1535;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold;">Annuler mon rendez-vous</a></p>
  <p style="font-size:12px;line-height:1.6;color:#756B89;">À moins de 48 heures, l’annulation automatique est bloquée. Le traitement des arrhes dépend des conditions de réservation acceptées et des droits légaux applicables.</p>
  <p style="font-size:15px;line-height:1.7;margin-top:30px;">À bientôt,<br><strong>Sébastien</strong><br>MediumIA</p>
</div></body></html>`

  const text = [
    `Bonjour ${firstName},`, '',
    'Votre rendez-vous est confirmé.',
    'Vos arrhes de réservation ont bien été réglées.', '',
    `Prestation : ${serviceTitle}`,
    `Date : ${when.date}`,
    `Heure : ${when.time}`,
    `Prix total : ${money(servicePriceCents)}`,
    `Arrhes réglées : ${money(depositCents)}`,
    `Solde restant : ${money(balanceCents)}`, '',
    ...(meetLink ? [`Lien de visioconférence : ${meetLink}`, ''] : []),
    'Vous pouvez annuler vous-même jusqu’à 48 heures avant le rendez-vous :',
    cancelUrl, '',
    'À moins de 48 heures, l’annulation automatique est bloquée. Le traitement des arrhes dépend des conditions de réservation acceptées et des droits légaux applicables.', '',
    'À bientôt,', 'Sébastien', 'MediumIA',
  ].join('\n')

  return { subject, html, text }
}
