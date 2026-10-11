/* global process */
import { escapeHtml } from './transactionalEmail.js'

function money(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`
}

function formatWhen(value, timezone = 'Europe/Paris') {
  const date = new Date(value)
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
  }).format(date)
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(date)
  return { day: day.charAt(0).toUpperCase() + day.slice(1), time }
}

function emailShell(title, firstName, bodyHtml) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:580px;margin:0 auto;padding:40px 24px;">
  <p style="font-size:20px;font-weight:700;letter-spacing:.12em;color:#C9A84C;margin:0 0 26px;">✦ MEDIUMIA</p>
  <h1 style="font-size:24px;margin:0 0 18px;">${escapeHtml(title)}</h1>
  <p style="font-size:15px;line-height:1.7;">Bonjour ${escapeHtml(firstName)},</p>
  ${bodyHtml}
  <p style="font-size:15px;line-height:1.7;margin-top:30px;">À bientôt,<br><strong>Sébastien</strong><br>MediumIA</p>
</div></body></html>`
}

export function balancePaymentUrl(token) {
  const configured = process.env.BOOKING_PUBLIC_URL?.trim().replace(/\/$/, '')
  let base
  if (process.env.VERCEL_ENV === 'preview') {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) base = `https://${previewHost}`
  }
  if (!base) base = configured
  if (!base) base = 'https://mediumia.fr'
  return `${base}/rdv/solde#token=${encodeURIComponent(token)}`
}

export function buildRdvBalanceReminder({
  firstName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
  balanceCents,
  deadlineAt,
  paymentUrl,
}) {
  const when = formatWhen(startsAt, timezone)
  const deadline = formatWhen(deadlineAt, timezone)
  const subject = 'MediumIA — Règlement du solde de votre rendez-vous'
  const bodyHtml = `
  <p style="font-size:15px;line-height:1.7;">Votre rendez-vous approche. Il reste <strong>${money(balanceCents)}</strong> à régler pour votre séance <strong>${escapeHtml(serviceTitle)}</strong>.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Rendez-vous :</strong> ${escapeHtml(when.day)} à ${escapeHtml(when.time)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Solde restant :</strong> ${money(balanceCents)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>À régler au plus tard :</strong> ${escapeHtml(deadline.day)} à ${escapeHtml(deadline.time)}</p>
  </div>
  <p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Si le solde n’est pas reçu avant cette échéance, le rendez-vous sera automatiquement annulé et le créneau libéré.</p>
  <p style="margin:22px 0;"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:14px 22px;border-radius:9px;font-weight:bold;">Régler mon solde — ${money(balanceCents)}</a></p>
  <p style="font-size:12px;line-height:1.6;color:#756B89;">Le traitement des arrhes en cas d’annulation reste soumis aux conditions de réservation acceptées et aux droits légaux applicables.</p>`
  const html = emailShell('Règlement de votre solde', firstName, bodyHtml)
  const text = [
    `Bonjour ${firstName},`, '',
    `Votre rendez-vous approche. Il reste ${money(balanceCents)} à régler pour ${serviceTitle}.`, '',
    `Rendez-vous : ${when.day} à ${when.time}`,
    `Solde restant : ${money(balanceCents)}`,
    `À régler au plus tard : ${deadline.day} à ${deadline.time}`, '',
    'Si le solde n’est pas reçu avant cette échéance, le rendez-vous sera automatiquement annulé et le créneau libéré.', '',
    `Régler mon solde : ${paymentUrl}`, '',
    'Le traitement des arrhes en cas d’annulation reste soumis aux conditions de réservation acceptées et aux droits légaux applicables.', '',
    'À bientôt,', 'Sébastien', 'MediumIA',
  ].join('\n')
  return { subject, html, text }
}

export function buildRdvBalancePaidConfirmation({
  firstName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
  paidCents,
  // « Visio — … » ; jamais de lien Meet.
  visio = null,
}) {
  const when = formatWhen(startsAt, timezone)
  const subject = 'MediumIA — Votre rendez-vous est entièrement réglé'
  const bodyHtml = `
  <p style="font-size:15px;line-height:1.7;">Nous avons bien reçu votre règlement de <strong>${money(paidCents)}</strong>. Votre rendez-vous est maintenant <strong>entièrement réglé</strong>.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:bold;">${escapeHtml(serviceTitle)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Date :</strong> ${escapeHtml(when.day)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(when.time)}</p>
    ${visio ? `<p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Modalité :</strong> ${escapeHtml(visio)}</p>` : ''}
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Solde restant :</strong> 0,00 €</p>
  </div>`
  const html = emailShell('Votre rendez-vous est entièrement réglé', firstName, bodyHtml)
  const text = [
    `Bonjour ${firstName},`, '',
    `Nous avons bien reçu votre règlement de ${money(paidCents)}. Votre rendez-vous est maintenant entièrement réglé.`, '',
    `Prestation : ${serviceTitle}`,
    `Date : ${when.day}`,
    `Heure : ${when.time}`,
    ...(visio ? [`Modalité : ${visio}`] : []),
    'Solde restant : 0,00 €', '',
    'À bientôt,', 'Sébastien', 'MediumIA',
  ].join('\n')
  return { subject, html, text }
}

export function buildRdvBalanceAutoCancellation({
  firstName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
}) {
  const when = formatWhen(startsAt, timezone)
  const subject = 'MediumIA — Votre rendez-vous a été annulé'
  const bodyHtml = `
  <p style="font-size:15px;line-height:1.7;">Le solde de votre rendez-vous n’ayant pas été reçu avant l’échéance de 48 heures, le rendez-vous a été automatiquement annulé et le créneau a été libéré.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:bold;">${escapeHtml(serviceTitle)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Date prévue :</strong> ${escapeHtml(when.day)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(when.time)}</p>
  </div>
  <p style="font-size:12px;line-height:1.6;color:#756B89;">Le traitement des arrhes reste soumis aux conditions de réservation acceptées et aux droits légaux applicables.</p>`
  const html = emailShell('Votre rendez-vous a été annulé', firstName, bodyHtml)
  const text = [
    `Bonjour ${firstName},`, '',
    'Le solde de votre rendez-vous n’ayant pas été reçu avant l’échéance de 48 heures, le rendez-vous a été automatiquement annulé et le créneau a été libéré.', '',
    `Prestation : ${serviceTitle}`,
    `Date prévue : ${when.day}`,
    `Heure : ${when.time}`, '',
    'Le traitement des arrhes reste soumis aux conditions de réservation acceptées et aux droits légaux applicables.', '',
    'Sébastien', 'MediumIA',
  ].join('\n')
  return { subject, html, text }
}

// Motifs affichés au propriétaire quand le cron refuse ou s'apprête à annuler.
export const OWNER_REVIEW_REASONS = {
  pre_cancel: 'annulation automatique prévue au prochain passage du cron (vers 9 h)',
  owner_not_alerted: 'annulation suspendue : vous n’aviez pas encore été prévenu',
  payment_uncertain: 'paiement PayPal engagé mais non confirmé : à vérifier avant toute décision',
  external_payment_recorded: 'un paiement externe est enregistré pour ce rendez-vous : aucune annulation',
  awaiting_owner_decision: 'mode « décision du propriétaire » : rien ne sera annulé sans vous',
  cancel_aborted: 'annulation interrompue (décision ou paiement apparu entre-temps) : vérifiez Google Agenda',
}

export function adminDashboardUrl() {
  const configured = process.env.BOOKING_PUBLIC_URL?.trim().replace(/\/$/, '')
  return `${configured || 'https://mediumia.fr'}/rdv`
}

// E-mail interne au propriétaire : jamais envoyé au client.
export function buildRdvBalanceOwnerAlert({
  customerName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
  dueCents,
  deadlineAt,
  reminderSentAt,
  reason,
  dashboardUrl = adminDashboardUrl(),
}) {
  const when = formatWhen(startsAt, timezone)
  const deadline = formatWhen(deadlineAt, timezone)
  const label = OWNER_REVIEW_REASONS[reason] || reason
  const subject = `MediumIA — Solde visio à vérifier : ${customerName}, ${when.day} ${when.time}`
  const lines = [
    `Client : ${customerName}`,
    `Séance : ${serviceTitle}`,
    `Rendez-vous : ${when.day} à ${when.time}`,
    `Solde restant : ${money(dueCents)}`,
    `Échéance H-48 : ${deadline.day} à ${deadline.time}`,
    `Rappel de solde au client : ${reminderSentAt ? 'envoyé' : 'non envoyé'}`,
    `Situation : ${label}`,
  ]
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:580px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:18px;font-weight:700;letter-spacing:.12em;color:#C9A84C;margin:0 0 20px;">✦ MEDIUMIA · ALERTE INTERNE</p>
  <h1 style="font-size:21px;margin:0 0 16px;">Solde de visio à vérifier</h1>
  <div style="background:#F0EDE8;border-radius:12px;padding:18px 22px;">
    ${lines.map(line => `<p style="margin:4px 0;font-size:14px;color:#4A3F6B;">${escapeHtml(line)}</p>`).join('\n    ')}
  </div>
  <p style="font-size:14px;line-height:1.7;">Depuis le tableau de bord (Comptabilité → Soldes visio à surveiller), vous pouvez <strong>Maintenir</strong> le rendez-vous, <strong>approuver l’annulation</strong>, ou laisser la règle habituelle s’appliquer.</p>
  <p style="margin:20px 0;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:bold;">Ouvrir le tableau de bord</a></p>
  <p style="font-size:12px;color:#756B89;">Alerte envoyée une seule fois par rendez-vous et par situation. Aucune action n’a été faite auprès du client.</p>
</div></body></html>`
  const text = [
    'Alerte interne MediumIA — solde de visio à vérifier', '',
    ...lines, '',
    'Tableau de bord (Comptabilité → Soldes visio à surveiller) : Maintenir, approuver l’annulation, ou laisser la règle habituelle.',
    dashboardUrl, '',
    'Alerte envoyée une seule fois par rendez-vous et par situation. Aucune action n’a été faite auprès du client.',
  ].join('\n')
  return { subject, html, text }
}

// Lien de règlement après restauration : solde exact, arrhes déjà déduites.
export function buildRdvBalanceRestored({
  firstName,
  serviceTitle,
  startsAt,
  timezone = 'Europe/Paris',
  balanceCents,
  paidCents,
  deadlineAt,
  paymentUrl,
}) {
  const when = formatWhen(startsAt, timezone)
  const deadline = formatWhen(deadlineAt, timezone)
  const subject = 'MediumIA — Votre rendez-vous est maintenu : règlement du solde'
  const bodyHtml = `
  <p style="font-size:15px;line-height:1.7;">Votre rendez-vous <strong>${escapeHtml(serviceTitle)}</strong> est maintenu. Les <strong>${money(paidCents)}</strong> déjà versés sont bien pris en compte : il reste uniquement <strong>${money(balanceCents)}</strong> à régler.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Rendez-vous :</strong> ${escapeHtml(when.day)} à ${escapeHtml(when.time)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Solde restant :</strong> ${money(balanceCents)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>À régler au plus tard :</strong> ${escapeHtml(deadline.day)} à ${escapeHtml(deadline.time)}</p>
  </div>
  <p style="margin:22px 0;"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:14px 22px;border-radius:9px;font-weight:bold;">Régler mon solde — ${money(balanceCents)}</a></p>
  <p style="font-size:12px;line-height:1.6;color:#756B89;">Paiement sécurisé par PayPal. Ce lien est personnel ; il remplace tout lien de solde reçu auparavant.</p>`
  const html = emailShell('Votre rendez-vous est maintenu', firstName, bodyHtml)
  const text = [
    `Bonjour ${firstName},`, '',
    `Votre rendez-vous ${serviceTitle} est maintenu. Les ${money(paidCents)} déjà versés sont bien pris en compte : il reste uniquement ${money(balanceCents)} à régler.`, '',
    `Rendez-vous : ${when.day} à ${when.time}`,
    `Solde restant : ${money(balanceCents)}`,
    `À régler au plus tard : ${deadline.day} à ${deadline.time}`, '',
    `Régler mon solde : ${paymentUrl}`, '',
    'Paiement sécurisé par PayPal. Ce lien est personnel ; il remplace tout lien de solde reçu auparavant.', '',
    'À bientôt,', 'Sébastien', 'MediumIA',
  ].join('\n')
  return { subject, html, text }
}
