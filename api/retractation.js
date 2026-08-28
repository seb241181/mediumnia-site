/* global process */
/**
 * POST /api/retractation
 *
 * Enregistre une demande de rétractation et envoie un accusé de réception.
 * Aucune base de données — email uniquement via Resend.
 */
import { escapeHtml, sendEmail } from '../lib/transactionalEmail.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN  = { short: 200, ref: 100 }
const PRODUCT  = 'Oracle Au-delà de l’Âme'
const OWNER_EMAIL = 'contact@mediumia.fr'

function trimField(val, max) {
  return typeof val === 'string' ? val.trim().slice(0, max) : ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }

  try {
    const body = req.body || {}

    const prenom       = trimField(body.prenom, MAX_LEN.short)
    const nom          = trimField(body.nom, MAX_LEN.short)
    const email        = trimField(body.email, MAX_LEN.short)
    const emailAchat   = trimField(body.emailAchat, MAX_LEN.short)
    const reference    = trimField(body.reference, MAX_LEN.ref)
    const dateAchat    = trimField(body.dateAchat, MAX_LEN.short)

    const errors = {}
    if (!prenom) errors.prenom = 'Requis'
    if (!nom) errors.nom = 'Requis'
    if (!email || !EMAIL_RE.test(email)) errors.email = 'Email invalide'
    if (!emailAchat || !EMAIL_RE.test(emailAchat)) errors.emailAchat = 'Email invalide'
    if (!reference) errors.reference = 'Requis'
    if (!dateAchat) errors.dateAchat = 'Requis'

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Champs invalides.', fields: errors })
    }

    const now = new Date()
    const dateReception = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' })
    const heureReception = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' })

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
  <p>Cet email constitue l'accusé de réception de votre demande de rétractation, conformément aux articles L. 221-18 et suivants du Code de la consommation. Il ne constitue pas une acceptation de la rétractation — votre demande sera examinée dans les meilleurs délais.</p>
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

Cet email constitue l'accusé de réception de votre demande de rétractation, conformément aux articles L. 221-18 et suivants du Code de la consommation. Il ne constitue pas une acceptation de la rétractation — votre demande sera examinée dans les meilleurs délais.

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
</div>`

    const [ack, copy] = await Promise.all([
      sendEmail({
        to: email,
        subject: 'Accusé de réception — demande de rétractation',
        html: htmlContent,
        text: textContent,
      }),
      sendEmail({
        to: OWNER_EMAIL,
        subject: `Rétractation — ${prenom} ${nom}`,
        html: ownerHtml,
        text: `Nouvelle demande de rétractation de ${prenom} ${nom} (${email}). Référence: ${reference}. Date achat: ${dateAchat}. Reçue le ${dateReception} à ${heureReception}.`,
      }),
    ])

    if (ack.status === 'error') {
      return res.status(502).json({ error: 'Impossible d\'envoyer l\'accusé de réception. Veuillez réessayer.' })
    }

    return res.status(200).json({ ok: true })
  } catch {
    return res.status(500).json({ error: 'Une erreur est survenue. Veuillez réessayer.' })
  }
}
