/**
 * MediumIA — délivrabilité des e-mails (ticket #219).
 *
 *   POST /functions/v1/resend-webhook (Supabase Edge Function)
 *     Webhook Resend signé (Svix). Signature vérifiée sur le corps brut, fenêtre
 *     de 5 minutes, idempotence par identifiant d'événement : un retry ne crée
 *     ni doublon ni seconde alerte. Sans secret RESEND_WEBHOOK_SECRET : 503,
 *     rien n'est accepté.
 *
 *   POST /api/rdv-config?accountAction=email-check  { email }
 *     Avant d'envoyer un code, l'espace client demande si l'adresse est en
 *     difficulté de livraison. Réponse identique qu'un compte existe ou non ;
 *     ni sujet, ni raison, ni historique. Limite anti-abus par visiteur.
 *
 * Jamais : contenu d'e-mail, code OTP, lien magique. Le sujet est caviardé
 * (chiffres, liens, jetons) avant stockage et avant l'alerte.
 * Jamais : déblocage chez Resend ni désactivation d'une protection.
 */
import { Buffer } from 'node:buffer'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { sendEmail as defaultSendEmail, escapeHtml } from './transactionalEmail.js'

export const TRACKED_EVENTS = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained',
  'email.failed', 'email.suppressed', 'suppression.added', 'contact.suppressed',
])
const TOLERANCE_SECONDS = 5 * 60
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY_BYTES = 256 * 1024

// ── Signature Svix (utilisée par Resend) ─────────────────────────────────────
// Contenu signé : `${svix-id}.${svix-timestamp}.${corps brut}`, HMAC-SHA256 avec
// la clé « whsec_… » décodée en base64 ; en-tête : « v1,<base64> » (plusieurs
// signatures possibles, séparées par des espaces, lors d'une rotation de clé).
export function verifySvixSignature({ id, timestamp, signatureHeader, body, secret, now = Date.now() }) {
  if (!id || !timestamp || !signatureHeader || body == null || !secret) return { ok: false, reason: 'missing' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp' }
  const rawSecret = String(secret).startsWith('whsec_') ? String(secret).slice(6) : String(secret)
  let key
  try { key = Buffer.from(rawSecret, 'base64') } catch { return { ok: false, reason: 'secret' } }
  if (!key.length) return { ok: false, reason: 'secret' }
  const payload = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), Buffer.isBuffer(body) ? body : Buffer.from(String(body))])
  const expected = createHmac('sha256', key).update(payload).digest()
  for (const part of String(signatureHeader).split(' ')) {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) continue
    let given
    try { given = Buffer.from(value, 'base64') } catch { continue }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true }
  }
  return { ok: false, reason: 'signature' }
}

// ── Caviardage : jamais de code ni de lien dans ce que l'on garde ────────────
export function redactSubject(subject) {
  const s = String(subject || '')
    .replace(/https?:\/\/\S+/gi, '[lien]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[jeton]')
    .replace(/\d[\d\s-]{3,}\d|\b\d{4,}\b/g, '••••')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.slice(0, 200) : null
}

function redactReason(reason) {
  const s = String(reason || '')
    .replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/gi, '[adresse]')
    .replace(/https?:\/\/\S+/gi, '[lien]')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.slice(0, 300) : null
}

const normalizeEmail = (value) => {
  const e = String(value || '').trim().toLowerCase()
  return EMAIL_RE.test(e) && e.length <= 320 ? e : null
}

// Événement Resend → une entrée par destinataire, champs minimaux.
export function parseResendEvent(payload, webhookId) {
  const type = String(payload?.type || '')
  const data = payload?.data || {}
  const recipients = [...new Set([].concat(data.to || data.email || data.recipient || []).map(normalizeEmail).filter(Boolean))]
  const bounce = data.bounce || {}
  return {
    type,
    tracked: TRACKED_EVENTS.has(type),
    recipients,
    entries: recipients.map((recipient) => ({
      webhook_id: String(webhookId || ''),
      event_type: type,
      email_id: data.email_id ? String(data.email_id).slice(0, 200) : null,
      recipient,
      subject_redacted: redactSubject(data.subject),
      bounce_type: bounce.type ? String(bounce.type).slice(0, 60) : null,
      bounce_subtype: (bounce.subType || bounce.subtype) ? String(bounce.subType || bounce.subtype).slice(0, 60) : null,
      reason: redactReason(bounce.message || data.reason || data.failed?.reason),
      occurred_at: data.created_at || payload?.created_at || null,
    })),
  }
}

// Corps brut de la requête, indispensable à la vérification de signature.
export async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody
  if (!req.readable || req.readableEnded) return null
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' })
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? Buffer.concat(chunks) : null
}

// ── Alerte à Sébastien ───────────────────────────────────────────────────────

const STATUS_LABELS = {
  bounced: 'rejet par la messagerie du client (bounce)',
  suppressed: 'adresse placée en suppression par Resend : plus aucun e-mail ne lui est envoyé',
  failed: 'échec d’envoi',
  complained: 'le client a signalé un e-mail comme indésirable (plainte)',
}

export function alertRecipient(env = process.env) {
  return normalizeEmail(env.EMAIL_DELIVERY_ALERT_EMAIL) || normalizeEmail(env.RDV_BALANCE_ALERT_EMAIL)
}

export function buildDeliveryAlert({ recipient, status, severity, subject, occurredAt, reason, client }) {
  const when = occurredAt ? new Date(occurredAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }) : 'à l’instant'
  const lines = [
    `Un client ne reçoit pas les e-mails de MediumIA.`,
    '',
    `Adresse : ${recipient}`,
    `Problème : ${STATUS_LABELS[status] || status}${severity === 'temporary' ? ' (temporaire, un nouvel essai peut aboutir)' : ''}`,
    `Date : ${when}`,
    subject ? `E-mail concerné : « ${subject} »` : null,
    reason ? `Réponse du serveur de messagerie : ${reason}` : null,
    '',
    client?.bookings
      ? `Ce client a ${client.bookings} rendez-vous MediumIA${client.next ? `, le prochain le ${client.next}` : ''}${client.phone ? ` — téléphone : ${client.phone}` : ''}.`
      : 'Aucun rendez-vous MediumIA n’est enregistré avec cette adresse.',
    '',
    'Que faire :',
    '1. Contacter le client (téléphone ou SMS) pour vérifier l’orthographe de son adresse.',
    '2. Si l’adresse était erronée : le client peut en saisir une autre dans « Mon espace » ; corrigez-la aussi sur sa réservation.',
    status === 'complained'
      ? '3. Plainte : ne retirez PAS la suppression chez Resend sans l’accord explicite du client.'
      : '3. Si l’adresse est correcte et la boîte fonctionne : retirez la suppression dans Resend (Suppressions), puis marquez l’incident résolu.',
    '',
    'Aucun code de connexion ni lien n’est inclus dans cette alerte.',
  ].filter((l) => l !== null)
  const text = lines.join('\n')
  const html = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#1c1b2e">${lines.map((l) => (l ? `<p style="margin:0 0 6px">${escapeHtml(l)}</p>` : '<br>')).join('')}</div>`
  return {
    subject: `MediumIA — un client ne reçoit pas ses e-mails (${STATUS_LABELS[status] ? status : 'livraison'})`,
    text,
    html,
  }
}

async function clientContext(db, recipient) {
  const { data } = await db.from('bookings')
    .select('starts_at, customer_phone, status')
    .ilike('customer_email', recipient)
    .order('starts_at', { ascending: true })
    .limit(50)
  const rows = data || []
  const upcoming = rows.filter((r) => r.status === 'confirmed' && Date.parse(r.starts_at) > Date.now())
  const next = upcoming[0]?.starts_at
  return {
    bookings: rows.length,
    next: next ? new Date(next).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }) : null,
    phone: rows.find((r) => r.customer_phone)?.customer_phone || null,
  }
}

async function notifyOwner({ db, entry, outcome, env, send }) {
  const to = alertRecipient(env)
  if (!to) return 'not_configured'
  const claimed = await db.rpc('claim_email_delivery_alert', { p_recipient: entry.recipient })
  if (claimed.error || claimed.data !== true) return 'already_sent'
  let client
  try { client = await clientContext(db, entry.recipient) } catch { client = null }
  const message = buildDeliveryAlert({
    recipient: entry.recipient, status: outcome.status, severity: outcome.severity,
    subject: entry.subject_redacted, occurredAt: entry.occurred_at, reason: entry.reason, client,
  })
  const hash = createHash('sha256').update(entry.recipient).digest('hex').slice(0, 24)
  const sent = await send({ to, ...message, idempotencyKey: `email-delivery-alert/${hash}/${outcome.first_seen_at || ''}/${outcome.severity}` })
  if (sent?.status !== 'sent') {
    await db.rpc('release_email_delivery_alert', { p_recipient: entry.recipient })
    return 'alert_failed'
  }
  return 'alert_sent'
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export async function handleResendWebhook(req, res, { db = null, env = process.env, send = defaultSendEmail, now = Date.now() } = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const secret = String(env.RESEND_WEBHOOK_SECRET || '').trim()
  if (!secret) return res.status(503).json({ error: 'webhook_not_configured' })
  if (!db && !isSupabaseConfigured()) return res.status(503).json({ error: 'supabase_not_configured' })

  const header = (name) => req.headers?.[name] || req.headers?.[name.replace('svix-', 'webhook-')] || null
  const id = header('svix-id')
  const timestamp = header('svix-timestamp')
  const signature = header('svix-signature')

  let raw
  try { raw = await readRawBody(req) } catch (error) {
    return res.status(error?.code === 'body_too_large' ? 413 : 400).json({ error: 'invalid_body' })
  }
  // Certains environnements ont déjà lu le flux : la signature est alors
  // vérifiée sur la sérialisation du corps. Si elle diffère des octets signés,
  // la vérification échoue et l'événement est refusé (jamais accepté sans preuve).
  const candidates = [raw, raw ? null : (req.body && typeof req.body === 'object' ? Buffer.from(JSON.stringify(req.body)) : (typeof req.body === 'string' ? Buffer.from(req.body) : null))].filter(Boolean)
  const verified = candidates.find((body) => verifySvixSignature({ id, timestamp, signatureHeader: signature, body, secret, now }).ok)
  if (!verified) return res.status(401).json({ error: 'invalid_signature' })

  let payload
  try { payload = JSON.parse(verified.toString('utf8')) } catch { return res.status(400).json({ error: 'invalid_json' }) }
  const event = parseResendEvent(payload, id)
  if (!event.tracked || !event.entries.length) return res.status(200).json({ received: true, ignored: true })

  const database = db || getSupabaseAdmin()
  const results = []
  for (const entry of event.entries) {
    const recorded = await database.rpc('record_email_delivery_event', { p_event: entry })
    // Erreur base : 500 → Resend renverra l'événement (idempotent).
    if (recorded.error) {
      console.error('[email-delivery] record failed')
      return res.status(500).json({ error: 'record_failed' })
    }
    const outcome = recorded.data || {}
    let alert = null
    if (outcome.alert_due) {
      try { alert = await notifyOwner({ db: database, entry, outcome, env, send }) } catch { alert = 'alert_failed' }
    }
    results.push({ duplicate: Boolean(outcome.duplicate), status: outcome.status || null, alert })
  }
  return res.status(200).json({ received: true, results })
}

// ── Vérification avant envoi (espace client) ─────────────────────────────────

function visitorKey(req) {
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim().toLowerCase()
  return createHash('sha256').update(`email-check:${xff || 'unknown'}`).digest('hex')
}

export async function handleEmailCheck(req, res, { db = null } = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const email = normalizeEmail(req.body?.email)
  if (!email) return res.status(400).json({ error: 'invalid_email' })
  if (!db && !isSupabaseConfigured()) return res.status(200).json({ delivery: 'unknown' })
  const database = db || getSupabaseAdmin()
  const limit = await database.rpc('consume_api_rate_limit', {
    p_ip_hash: visitorKey(req), p_endpoint: 'account_email_check', p_hourly_limit: 30, p_daily_limit: 120,
  })
  if (limit.error) return res.status(200).json({ delivery: 'unknown' })
  if (!limit.data?.allowed) return res.status(429).json({ error: 'too_many_requests' })
  const checked = await database.rpc('email_delivery_check', { p_email: email })
  // Panne ou table absente : on ne bloque jamais l'envoi (« unknown »).
  if (checked.error) return res.status(200).json({ delivery: 'unknown' })
  const delivery = ['ok', 'blocked', 'temporary'].includes(checked.data?.delivery) ? checked.data.delivery : 'unknown'
  return res.status(200).json({ delivery, ...(delivery !== 'ok' && checked.data?.since ? { since: checked.data.since } : {}) })
}

// ── Administration (propriétaire du profil sebastien-seguin) ─────────────────
// GET : incidents ouverts (adresse, type, dates, sujet caviardé).
// POST { op: 'resolve', recipient, note } : marque l'incident traité dans
// MediumIA. Ne touche pas à Resend : la suppression s'y retire à la main.

async function isMailOwner(db, userId) {
  const { data, error } = await db.from('booking_practitioners').select('id').eq('owner_id', userId).eq('slug', 'sebastien-seguin').limit(1)
  if (error) return null
  return Boolean(data?.length)
}

export async function handleEmailDeliveryAdmin({ db, userId, method, input = {} }) {
  const allowed = await isMailOwner(db, userId)
  if (allowed === null) return { status: 503, body: { error: 'email_delivery_unavailable' } }
  if (!allowed) return { status: 403, body: { error: 'forbidden' } }
  if (method === 'GET') {
    const { data, error } = await db.from('email_delivery_issues')
      .select('recipient, status, severity, first_seen_at, last_event_at, last_event_type, last_subject_redacted, events_count, alert_sent_at')
      .is('resolved_at', null).order('last_event_at', { ascending: false }).limit(200)
    if (error) return { status: 503, body: { error: 'email_delivery_unavailable' } }
    return { status: 200, body: { issues: data || [] } }
  }
  if (method === 'POST' && input.op === 'resolve') {
    const recipient = normalizeEmail(input.recipient)
    if (!recipient) return { status: 400, body: { error: 'invalid_email' } }
    const { data, error } = await db.rpc('resolve_email_delivery_issue', {
      p_recipient: recipient, p_actor: userId, p_note: String(input.note || '').slice(0, 300),
    })
    if (error) return { status: 503, body: { error: 'email_delivery_unavailable' } }
    return { status: data?.resolved ? 200 : 409, body: data || { resolved: false } }
  }
  return { status: 400, body: { error: 'invalid_request' } }
}
