import { escapeHtml, sendEmail } from './transactionalEmail.js'

const FROM = 'MediumIA <conference@mail.mediumia.fr>'
const REPLY_TO = 'contact@mediumia.fr'

const DEEP = '#1a1535'
const GOLD = '#c9a84c'
const CREAM = '#f5f0e6'
const INK = '#514b62'
const MUTED = '#716b7c'

function formatDate(value, withTime = true) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', withTime
    ? { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }
    : { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(value))
}

function formatPrice(cents) {
  if (!Number.isInteger(cents) || cents <= 0) return ''
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100).replace(/ /g, ' ')
}

const INCLUDED = [
  '25 modules en 4 niveaux (269 pages) et 84 exercices guidés',
  'Le carnet de pratique intégré à votre espace élève',
  '365 jours d’accès à votre espace élève MediumIA, dès le paiement confirmé',
  'Vos modules PDF téléchargés restent à vous pour votre usage personnel',
]

export function buildConferencePassEmail({ firstName, eventTitle, expiresAt, passUrl, offerLabel, amountCents, normalAmountCents, consentAt }) {
  const h = escapeHtml
  const name = String(firstName || '').trim()
  const safeName = h(name)
  const safeTitle = h(eventTitle || 'Conférence MediumIA')
  const safeUrl = h(passUrl)
  const safeLabel = h(offerLabel || 'Tarif réservé aux participants de la conférence')
  const price = formatPrice(amountCents)
  const normal = formatPrice(normalAmountCents || 59700)
  const expiry = formatDate(expiresAt)
  const consentDate = formatDate(consentAt, false)
  const greeting = name ? `Bonjour ${safeName},` : 'Bonjour,'
  const subjectPrice = price ? ` : la formation complète à ${price} au lieu de ${normal}` : ''

  const included = INCLUDED.map((item) => `<tr><td style="padding:5px 10px 5px 0;color:${GOLD};font-size:15px;vertical-align:top">✓</td><td style="padding:5px 0;color:${DEEP};font-size:15px;line-height:1.5">${h(item)}</td></tr>`).join('')
  const priceBlock = price
    ? `<p style="margin:0;color:${MUTED};font-size:13px;letter-spacing:1px">PRIX HABITUEL</p><p style="margin:2px 0 14px;color:${MUTED};font-size:20px;text-decoration:line-through">${h(normal)}</p><p style="margin:0;color:${GOLD};font-size:13px;letter-spacing:1px">AVEC VOTRE PASS</p><p style="margin:2px 0 0;color:#fffaf0;font-size:38px;line-height:1.1">${h(price)} <span style="font-size:15px;color:#ddd7e7">TTC</span></p>`
    : ''
  const consentLine = consentDate
    ? `Vous recevez cet e-mail parce que vous avez demandé votre Pass participant sur mediumia.fr le ${h(consentDate)}.`
    : 'Vous recevez cet e-mail parce que vous avez demandé votre Pass participant sur mediumia.fr.'

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;color:${DEEP}">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation"><tr><td align="center" style="padding:32px 14px">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="max-width:620px;background:#fffdf8;border:1px solid #e0c987;border-radius:14px;overflow:hidden">
<tr><td style="background:${DEEP};padding:34px 32px 30px;color:#fffaf0">
<p style="margin:0;color:${GOLD};font-size:12px;letter-spacing:2.4px">PASS PARTICIPANT · MEDIUMIA</p>
<h1 style="margin:14px 0 0;font-size:29px;line-height:1.25;font-weight:normal">Merci pour votre inscription à la conférence.</h1>
<p style="margin:10px 0 0;color:#ddd7e7;font-size:16px;line-height:1.5">« ${safeTitle} »</p>
</td></tr>
<tr><td style="padding:30px 32px 6px;font-size:16px;line-height:1.7;color:${INK}">
<p style="margin:0 0 14px">${greeting}</p>
<p style="margin:0 0 14px">Merci d’avoir pris ce temps avec moi. Comme vous l’avez demandé, voici votre Pass personnel : il vous ouvre le ${safeLabel.charAt(0).toLowerCase() + safeLabel.slice(1)} pour la formation MediumIA complète.</p>
</td></tr>
<tr><td style="padding:6px 32px">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="background:${DEEP};border-radius:12px"><tr><td style="padding:24px 26px">${priceBlock}</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px 4px">
<p style="margin:0 0 8px;color:${GOLD};font-size:12px;letter-spacing:2px">CE QUE COMPREND LA FORMATION</p>
<table cellspacing="0" cellpadding="0" border="0" role="presentation">${included}</table>
</td></tr>
<tr><td align="center" style="padding:26px 32px 8px">
<a href="${safeUrl}" style="display:inline-block;background:${GOLD};color:${DEEP};text-decoration:none;padding:15px 28px;border-radius:9px;font-weight:bold;font-size:16px">Ouvrir mon Pass personnel</a>
</td></tr>
<tr><td style="padding:14px 32px 4px;font-size:14px;line-height:1.65;color:${INK}">
<p style="margin:0 0 10px"><strong style="color:${DEEP}">Paiement sécurisé par PayPal</strong>, avec votre compte PayPal ou par carte bancaire. Selon votre éligibilité, PayPal peut aussi vous proposer de régler en 4 fois : cette possibilité est accordée par PayPal et n’est pas garantie.</p>
<p style="margin:0 0 10px">Votre Pass est valable jusqu’au <strong style="color:${DEEP}">${h(expiry)}</strong> et utilisable une seule fois. Il est lié à votre adresse d’inscription : merci de ne pas le transférer.</p>
<p style="margin:0">Votre accès s’ouvre automatiquement dès le paiement confirmé, avec l’adresse e-mail utilisée pour votre inscription à la conférence.</p>
</td></tr>
<tr><td style="padding:24px 32px 30px;font-size:16px;line-height:1.6;color:${INK}">
<p style="margin:0">À très bientôt,<br><strong style="color:${DEEP}">Sébastien Seguin — MediumIA</strong></p>
</td></tr>
<tr><td style="background:${CREAM};padding:18px 32px;font-size:12px;line-height:1.6;color:${MUTED}">
<p style="margin:0 0 6px">${consentLine} Pour ne plus recevoir d’offre de MediumIA, répondez simplement « STOP » à cet e-mail.</p>
<p style="margin:0">MediumIA · Sébastien Seguin, entrepreneur individuel — SIRET 81918584400027 · contact@mediumia.fr</p>
</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    greeting,
    '',
    `Merci pour votre inscription à la conférence « ${eventTitle || 'Conférence MediumIA'} ».`,
    `Comme vous l’avez demandé, voici votre Pass personnel : il vous ouvre le ${String(offerLabel || 'tarif réservé aux participants de la conférence').replace(/^./, (c) => c.toLowerCase())} pour la formation MediumIA complète.`,
    '',
    price ? `Prix habituel : ${normal}. Avec votre Pass : ${price} TTC.` : '',
    '',
    'Ce que comprend la formation :',
    ...INCLUDED.map((item) => `- ${item}`),
    '',
    `Ouvrir mon Pass personnel : ${passUrl}`,
    '',
    'Paiement sécurisé par PayPal, avec votre compte PayPal ou par carte bancaire. Selon votre éligibilité, PayPal peut aussi vous proposer de régler en 4 fois : cette possibilité est accordée par PayPal et n’est pas garantie.',
    `Votre Pass est valable jusqu’au ${expiry} et utilisable une seule fois. Il est lié à votre adresse d’inscription : merci de ne pas le transférer.`,
    'Votre accès s’ouvre automatiquement dès le paiement confirmé, avec l’adresse e-mail utilisée pour votre inscription à la conférence.',
    '',
    'À très bientôt,',
    'Sébastien Seguin — MediumIA',
    '',
    '—',
    `${consentLine} Pour ne plus recevoir d’offre de MediumIA, répondez simplement « STOP » à cet e-mail.`,
    'MediumIA · Sébastien Seguin, entrepreneur individuel — SIRET 81918584400027 · contact@mediumia.fr',
  ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n')

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
