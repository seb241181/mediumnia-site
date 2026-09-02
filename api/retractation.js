/* global process */
/**
 * POST /api/retractation
 *
 * Enregistre une demande de rétractation et envoie un accusé de réception.
 * Aucune base de données — email uniquement via Resend.
 */
import { createHash } from 'node:crypto'
import { escapeHtml, sendEmail } from '../lib/transactionalEmail.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN  = { short: 200, ref: 100 }
const PRODUCT  = 'Oracle Au-delà de l’Âme'
const OWNER_EMAIL = 'contact@mediumia.fr'
const DECLARATION = 'Je vous informe de ma décision de me rétracter du contrat portant sur l’Oracle Au-delà de l’Âme identifié par les informations ci-dessus.'

function validateField(val, max) {
  if (typeof val !== 'string') return { value: '', over: false }
  const trimmed = val.trim()
  return { value: trimmed, over: trimmed.length > max }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }

  try {
    const body = req.body || {}

    const fields = {
      prenom:    validateField(body.prenom, MAX_LEN.short),
      nom:       validateField(body.nom, MAX_LEN.short),
      email:     validateField(body.email, MAX_LEN.short),
      emailAchat: validateField(body.emailAchat, MAX_LEN.short),
      reference: validateField(body.reference, MAX_LEN.ref),
      dateAchat: validateField(body.dateAchat, MAX_LEN.short),
    }

    const errors = {}
    if (!fields.prenom.value) errors.prenom = 'Requis'
    else if (fields.prenom.over) errors.prenom = 'Trop long'
    if (!fields.nom.value) errors.nom = 'Requis'
    else if (fields.nom.over) errors.nom = 'Trop long'
    if (!fields.email.value || !EMAIL_RE.test(fields.email.value)) errors.email = 'Email invalide'
    else if (fields.email.over) errors.email = 'Trop long'
    if (!fields.emailAchat.value || !EMAIL_RE.test(fields.emailAchat.value)) errors.emailAchat = 'Email invalide'
    else if (fields.emailAchat.over) errors.emailAchat = 'Trop long'
    if (!fields.reference.value) errors.reference = 'Requis'
    else if (fields.reference.over) errors.reference = 'Trop long'
    if (!fields.dateAchat.value) errors.dateAchat = 'Requis'
    else if (fields.dateAchat.over) errors.dateAchat = 'Trop long'

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Champs invalides.', fields: errors })
    }

    const prenom     = fields.prenom.value
    const nom        = fields.nom.value
    const email      = fields.email.value
    const emailAchat = fields.emailAchat.value
    const reference  = fields.reference.value
    const dateAchat  = fields.dateAchat.value

    const now = new Date()
    const dateReception = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' })
    const heureReception = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' })

    const idempotencyBase = createHash('sha256').update(`${emailAchat}:${reference}:${PRODUCT}`).digest('hex').slice(0, 24)
    const idempotencyAck   = `retract-ack-${idempotencyBase}`
    const idempotencyOwner = `retract-owner-${idempotencyBase}`

    const e = (s) => escapeHtml(s)

    const htmlContent = `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1A1535;">
  <h1 style="font-size:18px;color:#C9A84C;margin-bottom:24px;">Accusé de réception de votre demande de rétractation</h1>
  <p>Bonjour ${e(prenom)} ${e(nom)},</p>
  <p>Nous avons bien reçu votre demande de rétractation. Voici le récapitulatif :</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;width:40%;">Produit</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(PRODUCT)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Nom</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(prenom)} ${e(nom)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Email déclaré lors de l'achat</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(emailAchat)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Référence commande / transaction</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(reference)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Date d'achat déclarée</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(dateAchat)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Date de réception de la demande</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${dateReception} à ${heureReception}</td></tr>
  </table>
  <p style="font-style:italic;margin:20px 0;">${e(DECLARATION)}</p>
  <p>Cet email constitue l'accusé de réception de votre déclaration de rétractation.</p>
  <p style="margin-top:24px;font-size:13px;color:#4A3F6B;">MediumIA — Sébastien Seguin<br/>contact@mediumia.fr — 06 29 97 38 78</p>
</div>`

    const textContent = `Accusé de réception de votre demande de rétractation

Bonjour ${prenom} ${nom},

Nous avons bien reçu votre demande de rétractation. Voici le récapitulatif :

Produit : ${PRODUCT}
Nom : ${prenom} ${nom}
Email déclaré lors de l'achat : ${emailAchat}
Référence commande / transaction : ${reference}
Date d'achat déclarée : ${dateAchat}
Date de réception de la demande : ${dateReception} à ${heureReception}

${DECLARATION}

Cet email constitue l'accusé de réception de votre déclaration de rétractation.

MediumIA — Sébastien Seguin
contact@mediumia.fr — 06 29 97 38 78`

    const ownerHtml = `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1A1535;">
  <h1 style="font-size:18px;color:#C9A84C;margin-bottom:24px;">Nouvelle demande de rétractation</h1>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;width:40%;">Produit</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(PRODUCT)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Prénom</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(prenom)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Nom</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(nom)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Email pour l'accusé</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(email)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Email déclaré lors de l'achat</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(emailAchat)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Référence commande / transaction</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(reference)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Date d'achat déclarée</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${e(dateAchat)}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e5e5e5;font-weight:bold;">Reçue le</td><td style="padding:8px 12px;border:1px solid #e5e5e5;">${dateReception} à ${heureReception}</td></tr>
  </table>
  <p style="font-style:italic;">${e(DECLARATION)}</p>
</div>`

    const [ack, copy] = await Promise.all([
      sendEmail({
        to: email,
        subject: 'Accusé de réception — demande de rétractation',
        html: htmlContent,
        text: textContent,
        idempotencyKey: idempotencyAck,
      }),
      sendEmail({
        to: OWNER_EMAIL,
        subject: `Rétractation — ${prenom} ${nom}`,
        html: ownerHtml,
        text: `Nouvelle demande de rétractation de ${prenom} ${nom} (${email}). Référence: ${reference}. Date achat: ${dateAchat}. Reçue le ${dateReception} à ${heureReception}.`,
        idempotencyKey: idempotencyOwner,
      }),
    ])

    if (ack.status !== 'sent' || copy.status !== 'sent') {
      return res.status(502).json({ error: 'Impossible d’envoyer les emails de confirmation. Veuillez réessayer.' })
    }

    return res.status(200).json({ ok: true })
  } catch {
    return res.status(500).json({ error: 'Une erreur est survenue. Veuillez réessayer.' })
  }
}
