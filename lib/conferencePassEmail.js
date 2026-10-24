/* global process */

import { escapeHtml, sendEmail } from './transactionalEmail.js'

const FROM = 'MediumIA <conference@mail.mediumia.fr>'
const REPLY_TO = 'contact@mediumia.fr'
// Espace élève : l'environnement TEST a le sien (relié à Supabase TEST).
const studentSpaceUrl = () => String(process.env.MEDIUMIA_STUDENT_APP_URL || 'https://espace.mediumia.fr').replace(/\/+$/, '')
const CGV_URL = 'https://mediumia.fr/cgv-formation.html'
const SELLER = 'MediumIA · Sébastien Seguin, entrepreneur individuel — SIRET 81918584400027 · contact@mediumia.fr'

const DEEP = '#1a1535'
const GOLD = '#c9a84c'
const CREAM = '#f5f0e6'
const INK = '#514b62'
const MUTED = '#716b7c'

// Formulation validée : jamais de durée, de frais ou d'accord garantis.
export const PAYPAL_INSTALMENTS_NOTICE = 'Paiement en plusieurs fois possible avec PayPal, sous réserve d’éligibilité et selon les conditions proposées lors du règlement.'

function formatDate(value, withTime = true) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', withTime
    ? { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }
    : { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(value))
}

export function formatPrice(cents) {
  if (!Number.isInteger(cents) || cents <= 0) return ''
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
    .format(cents / 100).replace(/ /g, ' ')
}

const INCLUDED = [
  'La formation complète : 25 modules en 4 niveaux et 84 exercices guidés',
  'Votre PDF complet personnel, envoyé après le paiement',
  'Le carnet de pratique intégré à votre espace élève',
  '365 jours d’accès à votre espace élève MediumIA, dès le paiement confirmé',
]

export const NON_CUMULATIVE_NOTICE = 'Tarif conférence non cumulable avec la Découverte à 29 € ni avec le parcours au mois.'

function footer(line) {
  return `<tr><td style="background:${CREAM};padding:18px 32px;font-size:12px;line-height:1.6;color:${MUTED}"><p style="margin:0 0 6px">${line}</p><p style="margin:0">${escapeHtml(SELLER)}</p></td></tr>`
}

function shell(eyebrow, title, subtitle, rows) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;color:${DEEP}">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation"><tr><td align="center" style="padding:32px 14px">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="max-width:620px;background:#fffdf8;border:1px solid #e0c987;border-radius:14px;overflow:hidden">
<tr><td style="background:${DEEP};padding:34px 32px 30px;color:#fffaf0">
<p style="margin:0;color:${GOLD};font-size:12px;letter-spacing:2.4px">${eyebrow}</p>
<h1 style="margin:14px 0 0;font-size:29px;line-height:1.25;font-weight:normal">${title}</h1>
${subtitle ? `<p style="margin:10px 0 0;color:#ddd7e7;font-size:16px;line-height:1.5">${subtitle}</p>` : ''}
</td></tr>
${rows}
</table></td></tr></table></body></html>`
}

export function buildConferencePassEmail({ firstName, eventTitle, expiresAt, passUrl, offerLabel, amountCents, normalAmountCents, consentAt }) {
  const h = escapeHtml
  const name = String(firstName || '').trim()
  const normalCents = normalAmountCents || 59700
  const price = formatPrice(amountCents)
  const normal = formatPrice(normalCents)
  const savings = Number.isInteger(amountCents) ? formatPrice(normalCents - amountCents) : ''
  const quarter = Number.isInteger(amountCents) ? formatPrice(Math.round(amountCents / 4)) : ''
  const expiry = formatDate(expiresAt)
  const consentDate = formatDate(consentAt, false)
  const greeting = name ? `Bonjour ${h(name)},` : 'Bonjour,'
  const label = String(offerLabel || 'Tarif réservé aux participants de la conférence')
  const labelLower = label.charAt(0).toLowerCase() + label.slice(1)
  const consentLine = consentDate
    ? `Vous recevez cet e-mail parce que vous avez demandé votre Pass participant sur mediumia.fr le ${h(consentDate)}.`
    : 'Vous recevez cet e-mail parce que vous avez demandé votre Pass participant sur mediumia.fr.'
  const optOut = 'Pour ne plus recevoir d’offre de MediumIA, répondez simplement « STOP » à cet e-mail.'
  const example = quarter ? `Par exemple, avec le Paiement en 4X PayPal : 4 échéances de ${quarter}, sous réserve d’acceptation par PayPal.` : ''
  const optionsLine = 'Les options auxquelles vous avez droit, et leur coût éventuel, vous sont présentées par PayPal avant que vous validiez.'

  const included = INCLUDED.map((item) => `<tr><td style="padding:5px 10px 5px 0;color:${GOLD};font-size:15px;vertical-align:top">✓</td><td style="padding:5px 0;color:${DEEP};font-size:15px;line-height:1.5">${h(item)}</td></tr>`).join('')
  const priceBlock = price
    ? `<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation"><tr>
<td style="vertical-align:bottom"><p style="margin:0;color:#bcb5c9;font-size:12px;letter-spacing:1.4px">PRIX HABITUEL</p><p style="margin:3px 0 14px;color:#bcb5c9;font-size:20px;text-decoration:line-through">${h(normal)}</p>
<p style="margin:0;color:${GOLD};font-size:12px;letter-spacing:1.4px">OFFRE SPÉCIALE CONFÉRENCE</p><p style="margin:3px 0 0;color:#fffaf0;font-size:38px;line-height:1.1">${h(price)} <span style="font-size:15px;color:#ddd7e7">TTC</span></p></td>
<td align="right" style="vertical-align:bottom"><p style="display:inline-block;margin:0;border:1px solid ${GOLD};border-radius:999px;padding:8px 14px;color:${GOLD};font-size:15px">Économie : ${h(savings)}</p></td>
</tr></table>`
    : ''

  const rows = `
<tr><td style="padding:30px 32px 6px;font-size:16px;line-height:1.7;color:${INK}">
<p style="margin:0 0 14px">${greeting}</p>
<p style="margin:0 0 14px">Merci de l’intérêt que vous portez à cette conférence. Comme vous l’avez demandé, voici votre Pass personnel : il vous ouvre le ${h(labelLower)} pour la formation MediumIA complète.</p>
</td></tr>
<tr><td style="padding:6px 32px">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="background:${DEEP};border-radius:12px"><tr><td style="padding:24px 26px">${priceBlock}</td></tr></table>
</td></tr>
<tr><td style="padding:16px 32px 0">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="border:1px solid #e0c987;border-left:4px solid ${GOLD};border-radius:10px;background:#fffaf0"><tr><td style="padding:16px 18px;font-size:15px;line-height:1.6;color:${INK}">
<p style="margin:0 0 6px;color:${DEEP};font-weight:bold">Facilités de paiement</p>
<p style="margin:0 0 6px">${h(PAYPAL_INSTALMENTS_NOTICE)}</p>
${example ? `<p style="margin:0 0 6px">${h(example)}</p>` : ''}
<p style="margin:0;font-size:13px;color:${MUTED}">${h(optionsLine)} Paiement sécurisé par PayPal, avec votre compte PayPal ou par carte bancaire.</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px 4px">
<p style="margin:0 0 8px;color:${GOLD};font-size:12px;letter-spacing:2px">CE QUE COMPREND LA FORMATION</p>
<table cellspacing="0" cellpadding="0" border="0" role="presentation">${included}</table>
<p style="margin:10px 0 0;font-size:13px;color:${MUTED}">${h(NON_CUMULATIVE_NOTICE)}</p>
</td></tr>
<tr><td align="center" style="padding:24px 32px 6px">
<a href="${h(passUrl)}" style="display:inline-block;background:${GOLD};color:${DEEP};text-decoration:none;padding:15px 28px;border-radius:9px;font-weight:bold;font-size:16px">Ouvrir mon Pass personnel</a>
<p style="margin:12px 0 0;font-size:14px;color:${DEEP}">Lien personnel valable jusqu’au <strong>${h(expiry)}</strong></p>
</td></tr>
<tr><td style="padding:14px 32px 4px;font-size:14px;line-height:1.65;color:${INK}">
<p style="margin:0 0 10px">Votre Pass est utilisable une seule fois. Il est lié à votre adresse d’inscription : merci de ne pas le transférer.</p>
<p style="margin:0">Votre accès s’ouvre automatiquement dès le paiement confirmé, avec l’adresse e-mail utilisée pour votre inscription à la conférence.</p>
</td></tr>
<tr><td style="padding:24px 32px 30px;font-size:16px;line-height:1.6;color:${INK}">
<p style="margin:0">À très bientôt,<br><strong style="color:${DEEP}">Sébastien Seguin — MediumIA</strong></p>
</td></tr>
${footer(`${consentLine} ${optOut}`)}`

  const html = shell('PASS PARTICIPANT · MEDIUMIA', 'Merci pour votre inscription à la conférence.', `« ${h(eventTitle || 'Conférence MediumIA')} »`, rows)

  const text = [
    greeting,
    '',
    `Merci de l’intérêt que vous portez à la conférence « ${eventTitle || 'Conférence MediumIA'} ».`,
    `Comme vous l’avez demandé, voici votre Pass personnel : il vous ouvre le ${labelLower} pour la formation MediumIA complète.`,
    '',
    price ? `Prix habituel : ${normal}. Offre spéciale conférence : ${price} TTC. Économie : ${savings}.` : '',
    '',
    'Facilités de paiement',
    PAYPAL_INSTALMENTS_NOTICE,
    example,
    `${optionsLine} Paiement sécurisé par PayPal, avec votre compte PayPal ou par carte bancaire.`,
    '',
    'Ce que comprend la formation :',
    ...INCLUDED.map((item) => `- ${item}`),
    NON_CUMULATIVE_NOTICE,
    '',
    `Ouvrir mon Pass personnel : ${passUrl}`,
    `Lien personnel valable jusqu’au ${expiry}.`,
    '',
    'Votre Pass est utilisable une seule fois. Il est lié à votre adresse d’inscription : merci de ne pas le transférer.',
    'Votre accès s’ouvre automatiquement dès le paiement confirmé, avec l’adresse e-mail utilisée pour votre inscription à la conférence.',
    '',
    'À très bientôt,',
    'Sébastien Seguin — MediumIA',
    '',
    '—',
    `${consentLine} ${optOut}`,
    SELLER,
  ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n')

  const subjectPrice = price ? ` : la formation complète à ${price} au lieu de ${normal}` : ''
  return { subject: `Votre Pass Conférence MediumIA${subjectPrice}`, html, text }
}

export async function sendConferencePassEmail({ to, registrationId, sendCount = 1, ...payload }) {
  const email = buildConferencePassEmail(payload)
  return sendEmail({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    ...email,
    idempotencyKey: `conference-pass-${registrationId}-${sendCount}`,
  })
}

// Confirmation de commande : support durable rappelant le prix, l'accès et les accords donnés
// (CGV, demande d'accès immédiat et renonciation au droit de rétractation pour ces contenus).
export function buildConferencePassConfirmationEmail({ firstName, eventTitle, amount, normalAmountCents, capturedAt, accessExpiresAt, captureId, termsVersion, termsAcceptedAt, immediateAccessAcceptedAt, pdfUrl, pdfExpiresAt, licenseNumber }) {
  const h = escapeHtml
  const name = String(firstName || '').trim()
  const greeting = name ? `Bonjour ${h(name)},` : 'Bonjour,'
  const paidCents = /^\d+\.\d{2}$/.test(String(amount || '')) ? Math.round(Number(amount) * 100) : null
  const paid = formatPrice(paidCents)
  const normal = formatPrice(normalAmountCents || 59700)
  const lines = [
    ['Formation', 'MediumIA — formation complète (offre spéciale conférence)'],
    ['Montant payé', paid ? `${paid} TTC (prix habituel : ${normal})` : ''],
    ['Date du paiement', formatDate(capturedAt)],
    ['Référence PayPal', captureId || ''],
    ['Accès', `25 modules et 84 exercices, jusqu’au ${formatDate(accessExpiresAt, false)}`],
  ].filter(([, value]) => value)
  const pdfLine = licenseNumber
    ? `Votre document est préparé spécialement pour vous : votre nom et votre numéro de licence ${licenseNumber} seront inscrits sur chaque page.`
    : 'Votre document est préparé spécialement pour vous, à votre nom.'
  const pdfBlock = pdfUrl
    ? `<tr><td style="padding:18px 32px 0"><table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="background:${DEEP};border-radius:12px"><tr><td style="padding:20px 22px;color:#fffaf0;font-size:15px;line-height:1.6">
<p style="margin:0 0 6px;color:${GOLD};font-size:12px;letter-spacing:2px">VOTRE PDF COMPLET PERSONNEL</p>
<p style="margin:0 0 14px">${h(pdfLine)}</p>
<a href="${h(pdfUrl)}" style="display:inline-block;background:${GOLD};color:${DEEP};text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Télécharger mon PDF personnel</a>
<p style="margin:12px 0 0;font-size:13px;color:#ddd7e7">Ce lien privé est valable jusqu’au ${h(formatDate(pdfExpiresAt, false))}. Conservez ensuite votre PDF sur votre appareil ; il est nominatif et destiné à votre usage personnel.</p>
</td></tr></table></td></tr>`
    : `<tr><td style="padding:14px 32px 0;font-size:14px;line-height:1.6;color:${INK}"><p style="margin:0">Votre PDF complet personnel vous sera adressé dans un prochain e-mail.</p></td></tr>`
  const consents = [
    `Le ${formatDate(termsAcceptedAt)}, vous avez accepté les conditions générales de vente (version ${termsVersion}).`,
    `Le ${formatDate(immediateAccessAcceptedAt)}, vous avez demandé expressément la fourniture immédiate des contenus numériques et renoncé expressément à votre droit de rétractation pour ces contenus, dont vous avez reconnu la perte dès le début de leur fourniture.`,
  ]

  const table = lines.map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:${MUTED};font-size:14px;vertical-align:top;white-space:nowrap">${h(k)}</td><td style="padding:6px 0;color:${DEEP};font-size:15px">${h(v)}</td></tr>`).join('')
  const rows = `
<tr><td style="padding:30px 32px 6px;font-size:16px;line-height:1.7;color:${INK}">
<p style="margin:0 0 14px">${greeting}</p>
<p style="margin:0 0 14px">Votre paiement est confirmé et votre accès à la formation MediumIA est activé. Voici le récapitulatif de votre commande, à conserver.</p>
<table cellspacing="0" cellpadding="0" border="0" role="presentation" style="margin:6px 0 10px">${table}</table>
</td></tr>
<tr><td align="center" style="padding:10px 32px 6px">
<a href="${h(studentSpaceUrl())}" style="display:inline-block;background:${GOLD};color:${DEEP};text-decoration:none;padding:15px 28px;border-radius:9px;font-weight:bold;font-size:16px">Accéder à mon espace élève</a>
<p style="margin:12px 0 0;font-size:14px;color:${INK}">Connectez-vous avec l’adresse e-mail utilisée pour votre inscription à la conférence.</p>
</td></tr>
${pdfBlock}
<tr><td style="padding:18px 32px 4px">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="border:1px solid #e0c987;border-radius:10px;background:#fffaf0"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.65;color:${INK}">
<p style="margin:0 0 6px;color:${DEEP};font-weight:bold">Vos accords lors de la commande</p>
${consents.map((c) => `<p style="margin:0 0 6px">${h(c)}</p>`).join('')}
<p style="margin:0">Conditions générales de vente : <a href="${CGV_URL}" style="color:${DEEP}">${CGV_URL}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 32px 30px;font-size:16px;line-height:1.6;color:${INK}">
<p style="margin:0">Belle traversée,<br><strong style="color:${DEEP}">Sébastien Seguin — MediumIA</strong></p>
</td></tr>
${footer('Cet e-mail confirme votre commande. Pour toute question, répondez simplement à ce message.')}`

  const html = shell('CONFIRMATION DE COMMANDE · MEDIUMIA', 'Votre accès MediumIA est activé.', eventTitle ? `Offre spéciale conférence « ${h(eventTitle)} »` : '', rows)
  const text = [
    greeting,
    '',
    'Votre paiement est confirmé et votre accès à la formation MediumIA est activé. Voici le récapitulatif de votre commande, à conserver.',
    '',
    ...lines.map(([k, v]) => `${k} : ${v}`),
    '',
    `Accéder à mon espace élève : ${studentSpaceUrl()}`,
    'Connectez-vous avec l’adresse e-mail utilisée pour votre inscription à la conférence.',
    '',
    ...(pdfUrl
      ? ['Votre PDF complet personnel', pdfLine, `Télécharger mon PDF personnel : ${pdfUrl}`, `Ce lien privé est valable jusqu’au ${formatDate(pdfExpiresAt, false)}.`, '']
      : ['Votre PDF complet personnel vous sera adressé dans un prochain e-mail.', '']),
    'Vos accords lors de la commande',
    ...consents,
    `Conditions générales de vente : ${CGV_URL}`,
    '',
    'Belle traversée,',
    'Sébastien Seguin — MediumIA',
    '',
    '—',
    'Cet e-mail confirme votre commande. Pour toute question, répondez simplement à ce message.',
    SELLER,
  ].join('\n')
  return { subject: 'Confirmation de votre commande MediumIA — accès activé', html, text }
}

// PDF remis après coup (reprise) : même lien privé que pour un achat à 597 €.
export function buildConferencePassPdfEmail({ firstName, pdfUrl, pdfExpiresAt, licenseNumber }) {
  const h = escapeHtml
  const name = String(firstName || '').trim()
  const greeting = name ? `Bonjour ${h(name)},` : 'Bonjour,'
  const pdfLine = licenseNumber
    ? `Votre document est préparé spécialement pour vous : votre nom et votre numéro de licence ${licenseNumber} sont inscrits sur chaque page.`
    : 'Votre document est préparé spécialement pour vous, à votre nom.'
  const expiry = formatDate(pdfExpiresAt, false)
  const rows = `
<tr><td style="padding:30px 32px 6px;font-size:16px;line-height:1.7;color:${INK}">
<p style="margin:0 0 14px">${greeting}</p>
<p style="margin:0 0 14px">Comme annoncé, voici votre PDF complet personnel de la formation MediumIA. ${h(pdfLine)}</p>
</td></tr>
<tr><td align="center" style="padding:10px 32px 6px">
<a href="${h(pdfUrl)}" style="display:inline-block;background:${GOLD};color:${DEEP};text-decoration:none;padding:15px 28px;border-radius:9px;font-weight:bold;font-size:16px">Télécharger mon PDF personnel</a>
<p style="margin:12px 0 0;font-size:14px;color:${INK}">Ce lien privé est valable jusqu’au ${h(expiry)}. Conservez ensuite votre PDF sur votre appareil ; il est nominatif et destiné à votre usage personnel.</p>
</td></tr>
<tr><td style="padding:24px 32px 30px;font-size:16px;line-height:1.6;color:${INK}">
<p style="margin:0">Belle traversée,<br><strong style="color:${DEEP}">Sébastien Seguin — MediumIA</strong></p>
</td></tr>
${footer('Cet e-mail fait suite à votre commande de la formation MediumIA. Pour toute question, répondez simplement à ce message.')}`
  const html = shell('VOTRE PDF · MEDIUMIA', 'Votre PDF complet personnel est prêt.', '', rows)
  const text = [
    greeting, '',
    `Comme annoncé, voici votre PDF complet personnel de la formation MediumIA. ${pdfLine}`, '',
    `Télécharger mon PDF personnel : ${pdfUrl}`,
    `Ce lien privé est valable jusqu’au ${expiry}. Conservez ensuite votre PDF sur votre appareil ; il est nominatif et destiné à votre usage personnel.`, '',
    'Belle traversée,', 'Sébastien Seguin — MediumIA', '', '—',
    'Cet e-mail fait suite à votre commande de la formation MediumIA. Pour toute question, répondez simplement à ce message.',
    SELLER,
  ].join('\n')
  return { subject: 'Votre PDF complet personnel MediumIA', html, text }
}

export async function sendConferencePassPdfEmail({ to, captureId, sendNumber = 1, ...payload }) {
  return sendEmail({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    ...buildConferencePassPdfEmail(payload),
    idempotencyKey: `conference-pass-pdf-${captureId}-${sendNumber}`,
  })
}

export async function sendConferencePassConfirmationEmail({ to, captureId, ...payload }) {
  const email = buildConferencePassConfirmationEmail({ captureId, ...payload })
  return sendEmail({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    ...email,
    idempotencyKey: `conference-pass-confirmation-${captureId}`,
  })
}
