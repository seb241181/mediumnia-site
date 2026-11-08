/* global process */
/**
 * « Signaler un problème de paiement ».
 *
 *   POST /api/rdv-config?paymentIssueAction=submit      (public, sans connexion)
 *   GET  /api/rdv-admin?action=payment-issues           (administration)
 *   POST /api/rdv-admin?action=payment-issues {op:'update', id, status?, owner_note?}
 *
 * Un signalement n'appelle jamais PayPal : ni capture, ni commande, ni lecture.
 * Il est enregistré (limites de débit, dédoublonnage et historique dans la base),
 * puis le propriétaire est prévenu par e-mail et le client reçoit un accusé de
 * réception sobre (sans reprise de son commentaire, au plus un par jour).
 */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { isPlatformAdmin } from './proWorkspace.js'

export const ISSUE_REASONS = {
  payment_failed: 'Le paiement n’a pas abouti',
  charged_no_service: 'J’ai été débité mais je n’ai pas reçu le service',
  double_charge: 'J’ai été débité deux fois',
  page_error: 'La page affiche une erreur ou reste bloquée',
  session_expired: 'Ma session a expiré pendant le paiement',
  other: 'Autre problème',
}

export const ISSUE_JOURNEYS = {
  chronosphere: 'ChronoSphère',
  chronosphere_max: 'ChronoSphère MAX',
  rdv_deposit: 'Réservation (arrhes ou paiement intégral)',
  rdv_balance: 'Solde d’un rendez-vous',
  formation: 'Formation MediumIA',
  parcours: 'Parcours mensuel (mensualités)',
  email_question: 'Guidance par e-mail',
  gift_card: 'Carte cadeau',
  conference_pass: 'Pass conférence',
  oracle: 'Oracle',
  other: 'Autre',
}

export const ISSUE_STATUSES = ['new', 'in_progress', 'resolved', 'dismissed']
const CLIENT_KINDS = new Set(['mobile', 'desktop', 'in_app', 'unknown'])
const STEP_RE = /^[a-z_]{1,40}$/
const ATTEMPT_RE = /^[A-Za-z0-9-]{8,64}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BODY_CHARS = 4000

// ── Données sensibles ───────────────────────────────────────────────────────
// Numéros de carte (13 à 19 chiffres, espaces ou tirets), IBAN, jetons d'URL.
export function redactSensitive(text) {
  return String(text || '')
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gi, '[IBAN masqué]')
    .replace(/\d(?:[ -]?\d){12,18}/g, '[numéro masqué]')
    .replace(/\b(token|code|cvv|cvc|password|mot de passe)\s*[=:]\s*\S+/gi, '$1=[masqué]')
    .replace(/https?:\/\/\S+/gi, (url) => url.split(/[?#]/)[0])
}

// Chemin de page sans paramètres ni fragment ; segments porteurs de jetons masqués.
export function safePagePath(value) {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/')) return null
  const path = raw.split(/[?#]/)[0]
    .replace(/^\/carte-cadeau\/[^/]+/, '/carte-cadeau/[masqué]')
    .replace(/^\/pass\/mediumia\/([^/]+)\/[^/]+/, '/pass/mediumia/$1/[masqué]')
    .replace(/^\/live\/[^/]+/, '/live/[masqué]')
  return path.slice(0, 200)
}

export function clientKind(userAgent) {
  const ua = String(userAgent || '')
  if (!ua) return 'unknown'
  if (/FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)/i.test(ua)) return 'in_app'
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function rateLimitSecret(env = process.env) {
  const secret = String(env.PAYMENT_ISSUE_RATE_LIMIT_SECRET || env.RDV_RATE_LIMIT_SECRET || '').trim()
  if (secret.length >= 32) return secret
  // Hors Production uniquement : clé locale pour les essais isolés.
  return env.VERCEL_ENV === 'production' ? null : 'mediumia-payment-issue-local-only-key'
}

export function hashIp(ip, secret) {
  const value = String(ip || '').trim()
  if (!value || !secret) return null
  return createHmac('sha256', secret).update(`payment-issue|${value}`).digest('hex')
}

function requestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || String(req.headers?.['x-real-ip'] || '').trim() || null
}

/** Valide et nettoie un signalement. Renvoie { input } ou { error }. */
export function normalizeIssueInput(body = {}, { now = new Date() } = {}) {
  if (JSON.stringify(body || {}).length > MAX_BODY_CHARS) return { error: 'payload_too_large' }
  // Piège à robots : champ invisible pour un humain.
  if (String(body.website || '').trim()) return { error: 'spam_detected' }
  // Formulaire rempli trop vite pour un humain.
  const elapsed = Number(body.elapsed_ms)
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2500) return { error: 'too_fast' }

  const email = String(body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'invalid_email' }
  const reason = String(body.reason || '')
  if (!ISSUE_REASONS[reason]) return { error: 'invalid_reason' }
  const journey = ISSUE_JOURNEYS[String(body.journey || '')] ? String(body.journey) : 'other'
  const step = STEP_RE.test(String(body.step || '')) ? String(body.step) : null
  const attemptRef = ATTEMPT_RE.test(String(body.attempt_ref || '')) ? String(body.attempt_ref) : null
  let attemptAt = null
  if (body.attempt_at) {
    const date = new Date(body.attempt_at)
    // Tentative récente seulement (7 jours), jamais dans le futur.
    if (Number.isFinite(date.getTime()) && date <= new Date(now.getTime() + 60_000) && date > new Date(now.getTime() - 7 * 86_400_000)) {
      attemptAt = date.toISOString()
    }
  }
  const comment = redactSensitive(String(body.comment || '').trim()).slice(0, 1000) || null
  return {
    input: { email, reason, journey, step, attemptRef, attemptAt, comment, pagePath: safePagePath(body.page_path) },
  }
}

export function ownerRecipient(env = process.env) {
  for (const key of ['PAYMENT_ISSUE_OWNER_EMAIL', 'RDV_BALANCE_ALERT_EMAIL', 'BOOKING_NOTIFICATION_EMAIL', 'EMAIL_QUESTIONS_OWNER_EMAIL']) {
    const value = String(env[key] || '').trim()
    if (EMAIL_RE.test(value)) return value
  }
  return null
}

export function buildOwnerIssueEmail({ reference, input, kind, createdAt }) {
  const rows = [
    ['Référence', reference],
    ['Parcours', ISSUE_JOURNEYS[input.journey]],
    ['Étape', input.step || 'inconnue'],
    ['Tentative (commande ou paiement)', input.attemptRef || '—'],
    ['Heure de la tentative', input.attemptAt ? new Date(input.attemptAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'],
    ['Motif', ISSUE_REASONS[input.reason]],
    ['Contact', input.email],
    ['Page', input.pagePath || '—'],
    ['Appareil', kind],
    ['Signalé le', new Date(createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })],
  ]
  const html = `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px">
<h2 style="font-weight:500">Problème de paiement signalé</h2>
<p>Un client signale un problème. Vérifiez la commande dans votre activité PayPal avant toute action : aucun paiement n’a été relancé automatiquement.</p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B6585">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`).join('')}</table>
${input.comment ? `<p style="margin-top:16px"><strong>Commentaire du client</strong><br>${escapeHtml(input.comment).replace(/\n/g, '<br>')}</p>` : ''}
<p style="margin-top:16px;color:#6B6585;font-size:13px">À traiter dans Les Coulisses → Incidents de paiement.</p></div>`
  const text = [
    'Problème de paiement signalé',
    ...rows.map(([k, v]) => `${k} : ${v}`),
    input.comment ? `\nCommentaire du client :\n${input.comment}` : '',
    '\nÀ traiter dans Les Coulisses → Incidents de paiement. Aucun paiement n’a été relancé automatiquement.',
  ].join('\n')
  return { subject: `Problème de paiement signalé — ${ISSUE_JOURNEYS[input.journey]} (${reference})`, html, text }
}

// Accusé de réception : volontairement générique (aucune reprise du texte saisi).
export function buildClientAckEmail({ reference }) {
  const text = [
    'Bonjour,',
    '',
    `Nous avons bien reçu votre signalement de problème de paiement (référence ${reference}).`,
    'Sébastien le vérifie et revient vers vous rapidement à cette adresse.',
    '',
    'En attendant : si votre compte a été débité, ne refaites pas de paiement. Rien n’est débité du fait de ce signalement.',
    '',
    'Si vous n’êtes pas à l’origine de ce message, ignorez-le simplement.',
    '',
    'MediumIA',
  ].join('\n')
  const html = `<div style="font-family:Georgia,serif;color:#1A1535;max-width:560px;line-height:1.6">
<p>Bonjour,</p>
<p>Nous avons bien reçu votre signalement de problème de paiement (référence <strong>${escapeHtml(reference)}</strong>).<br>Sébastien le vérifie et revient vers vous rapidement à cette adresse.</p>
<p><strong>En attendant :</strong> si votre compte a été débité, ne refaites pas de paiement. Rien n’est débité du fait de ce signalement.</p>
<p style="color:#6B6585;font-size:13px">Si vous n’êtes pas à l’origine de ce message, ignorez-le simplement.</p>
<p>MediumIA</p></div>`
  return { subject: `MediumIA — Signalement bien reçu (${reference})`, html, text }
}

const SUBMIT_ERRORS = {
  invalid_email: 400, invalid_reason: 400, payload_too_large: 413, too_fast: 400, rate_limited: 429,
}

export async function submitPaymentIssue({ supabase, req, env = process.env, send = sendEmail, now = new Date() }) {
  const normalized = normalizeIssueInput(req.body || {}, { now })
  // Robot détecté : réponse identique à un succès, rien n'est enregistré ni envoyé.
  if (normalized.error === 'spam_detected') return { status: 200, body: { ok: true, reference: null } }
  if (normalized.error) return { status: SUBMIT_ERRORS[normalized.error] || 400, body: { error: normalized.error } }
  const { input } = normalized

  const secret = rateLimitSecret(env)
  if (!secret) return { status: 503, body: { error: 'reporting_unavailable' } }
  const kind = clientKind(req.headers?.['user-agent'])

  const { data, error } = await supabase.rpc('submit_payment_issue_report', {
    p_email: input.email,
    p_reason: input.reason,
    p_comment: input.comment,
    p_journey: input.journey,
    p_step: input.step,
    p_attempt_ref: input.attemptRef,
    p_attempt_at: input.attemptAt,
    p_page_path: input.pagePath,
    p_client_kind: kind,
    p_ip_hash: hashIp(requestIp(req), secret),
    p_now: now.toISOString(),
  })
  if (error) return { status: error.code === 'PGRST202' ? 503 : 500, body: { error: 'reporting_unavailable' } }
  if (!data?.ok) return { status: SUBMIT_ERRORS[data?.error] || 400, body: { error: data?.error || 'reporting_unavailable' } }
  // Doublon : même réponse, aucun nouvel e-mail.
  if (data.duplicate) return { status: 200, body: { ok: true, reference: data.reference, duplicate: true } }

  const recipient = ownerRecipient(env)
  if (recipient) {
    const owner = await send({ to: recipient, ...buildOwnerIssueEmail({ reference: data.reference, input, kind, createdAt: now }), replyTo: input.email, idempotencyKey: `payment-issue-owner/${data.id}` }).catch(() => ({ status: 'error' }))
    if (owner?.status === 'sent') await supabase.rpc('mark_payment_issue_notified', { p_report_id: data.id, p_kind: 'owner' })
  } else {
    console.error('[payment-issue] owner recipient not configured')
  }
  if (data.ack_allowed) {
    const ack = await send({ to: input.email, ...buildClientAckEmail({ reference: data.reference }), idempotencyKey: `payment-issue-ack/${data.id}` }).catch(() => ({ status: 'error' }))
    if (ack?.status === 'sent') await supabase.rpc('mark_payment_issue_notified', { p_report_id: data.id, p_kind: 'ack' })
  }
  return { status: 201, body: { ok: true, reference: data.reference } }
}

export async function handlePaymentIssuePublic(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (action !== 'submit') return res.status(400).json({ error: 'invalid_action' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'reporting_unavailable' })
  try {
    const result = await submitPaymentIssue({ supabase: getSupabaseAdmin(), req })
    return res.status(result.status).json(result.body)
  } catch {
    console.error('[payment-issue] submit failed')
    return res.status(500).json({ error: 'reporting_unavailable' })
  }
}

// ── Administration ─────────────────────────────────────────────────────────
export async function handlePaymentIssuesAdmin({ supabase, userId, method, query = {}, input = {} }) {
  const admin = await isPlatformAdmin(supabase, userId)
  if (admin.error) return { status: 500, body: { error: 'access_check_failed' } }
  if (!admin.allowed) return { status: 403, body: { error: 'forbidden' } }

  if (method === 'GET') {
    const status = String(query.status || 'open')
    let request = supabase.from('payment_issue_reports')
      .select('id, reference, created_at, contact_email, reason, comment, journey, step, attempt_ref, attempt_at, page_path, client_kind, status, owner_note, handled_at, owner_notified_at, ack_sent_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (status === 'open') request = request.in('status', ['new', 'in_progress'])
    else if (ISSUE_STATUSES.includes(status)) request = request.eq('status', status)
    const { data, error } = await request
    if (error) return { status: error.code === '42P01' ? 503 : 500, body: { error: error.code === '42P01' ? 'migration_pending' : 'issues_unavailable' } }
    return { status: 200, body: { issues: data || [] } }
  }

  if (method === 'POST' && input.op === 'update') {
    if (!UUID_RE.test(String(input.id || ''))) return { status: 400, body: { error: 'invalid_request' } }
    const status = input.status == null ? null : String(input.status)
    if (status !== null && !ISSUE_STATUSES.includes(status)) return { status: 400, body: { error: 'invalid_status' } }
    const note = input.owner_note == null ? null : redactSensitive(String(input.owner_note)).slice(0, 1000)
    const { data, error } = await supabase.rpc('update_payment_issue_report', {
      p_actor: userId, p_report_id: input.id, p_status: status, p_owner_note: note,
    })
    if (error) return { status: 500, body: { error: 'issues_unavailable' } }
    if (!data?.ok) return { status: data?.error === 'report_not_found' ? 404 : 400, body: { error: data?.error || 'invalid_request' } }
    return { status: 200, body: data }
  }
  return { status: 400, body: { error: 'invalid_request' } }
}
