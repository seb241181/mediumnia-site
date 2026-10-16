/* global Buffer, process */
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { summarizeGuidancePayPalEvidence } from './emailQuestionPayPalEvidence.js'

export const EMAIL_QUESTION_TERMS_VERSION = 'email-question-2026-10-06-v2'
export const EMAIL_QUESTION_DAILY_CAP = 5
export const EMAIL_QUESTION_SUSPENDED_MESSAGE = 'Les commandes de Guidances par e-mail sont momentanément suspendues pour maintenance. Vos demandes déjà enregistrées restent prises en charge.'
export const EMAIL_QUESTION_PACKS = Object.freeze({
  q1: { count: 1, amountCents: 1990, label: 'Une question' },
  q2: { count: 2, amountCents: 2990, label: 'Deux questions' },
})

const PAYPAL = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}
const SITE = 'https://mediumia.fr'
const PAYPAL_TIMEOUT_MS = 8_000
const PAYPAL_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export function emailQuestionEnv() {
  const isProd = process.env.VERCEL_ENV === 'production'
  const configured = String(process.env.PAYPAL_ENV || '').trim().toLowerCase()
  const env = isProd ? configured : 'sandbox'
  if (!PAYPAL[env]) throw new Error('paypal_env_invalid')
  if (isProd && env !== 'live') throw new Error('paypal_env_mismatch')
  if (!isProd && env !== 'sandbox') throw new Error('paypal_env_mismatch')
  return env
}

export function emailQuestionsOpen() {
  return process.env.VERCEL_ENV !== 'production' || process.env.EMAIL_QUESTIONS_ENABLED === 'true'
}

export function emailQuestionPurchasesSuspended() {
  return process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED === 'true'
}

function cleanText(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function cleanParagraph(value, max) {
  return String(value || '').trim().replace(/\r\n/g, '\n').slice(0, max)
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function normalizePack(value) {
  const pack = String(value || '').trim()
  return EMAIL_QUESTION_PACKS[pack] ? pack : null
}

function normalizeBirthDate(value) {
  if (!value) return null
  const s = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : s
}

function normalizeQuestions(pack, value) {
  const meta = EMAIL_QUESTION_PACKS[pack]
  if (!meta || !Array.isArray(value) || value.length !== meta.count) return null
  const rows = value.map((item) => ({
    q: cleanParagraph(item?.q, 1000),
    context: cleanParagraph(item?.context, 2000),
  }))
  return rows.every((row) => row.q.length >= 10 && row.context.length >= 20) ? rows : null
}

function addBusinessDays(date, count) {
  const d = new Date(date)
  let remaining = count
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return d
}

function money(cents) {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function paypalTimeoutMs() {
  const configured = Number(process.env.PAYPAL_REQUEST_TIMEOUT_MS)
  return Number.isFinite(configured) && configured >= 250 && configured <= 30_000
    ? configured
    : PAYPAL_TIMEOUT_MS
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), paypalTimeoutMs())
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function paypalAccessToken(env) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !secret) throw new Error('paypal_not_configured')
  let res
  try {
    res = await timedFetch(`${PAYPAL[env]}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? 'paypal_auth_timeout' : 'paypal_auth_unavailable', { cause: error })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function paypalRequest(env, access, method, path, body = null, requestId = null) {
  try {
    const res = await timedFetch(`${PAYPAL[env]}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
    return {
      ok: res.ok,
      status: res.status,
      data,
      retryable: PAYPAL_RETRYABLE_STATUS.has(res.status),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {},
      networkError: error?.name === 'AbortError' ? 'timeout' : 'unavailable',
      retryable: true,
    }
  }
}

async function paidLast24h(db, env) {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count, error } = await db.from('mediumia_email_questions')
    .select('id', { count: 'exact', head: true })
    .eq('paypal_env', env)
    .gte('paid_at', since)
  if (error) return 0
  return Number(count || 0)
}

function publicPacks() {
  return Object.entries(EMAIL_QUESTION_PACKS).map(([id, p]) => ({
    id, count: p.count, amountCents: p.amountCents, label: p.label,
  }))
}

// Préparer le contenu destiné au propriétaire, après confirmation du paiement.
// Les questions restent privées : jamais envoyées aux visiteurs ou dans les logs.
export function buildOwnerQuestionEmail(row, due = null) {
  const questionRows = (Array.isArray(row.questions) ? row.questions : [])
    .slice(0, Number(row.question_count) || 0)
    .map((item, i) => ({
      label: `Question ${i + 1}`,
      question: String(item?.q || '').trim(),
      context: String(item?.context || '').trim(),
    }))
  const textQuestions = questionRows.map((item) =>
    `${item.label} :\n${item.question}${item.context ? `\nContexte : ${item.context}` : ''}`,
  ).join('\n\n')
  const htmlQuestions = questionRows.map((item) =>
    `<section style="margin:18px 0;padding:16px;border:1px solid #e1d2aa;border-radius:12px;background:#fffdf8"><strong>${escapeHtml(item.label)}</strong><p style="white-space:pre-wrap">${escapeHtml(item.question)}</p>${item.context ? `<p style="white-space:pre-wrap;color:#59516b">Contexte : ${escapeHtml(item.context)}</p>` : ''}</section>`,
  ).join('')
  const amount = money(row.amount_cents)
  const subject = `[MediumIA] Nouvelle demande e-mail — ${row.question_count} question${row.question_count > 1 ? 's' : ''}`
  return {
    subject,
    text: `Nouvelle demande avec paiement confirmé de ${row.first_name}.\nE-mail : ${row.email}\nRéférence PayPal : ${row.paypal_order_id}\nMontant : ${amount}\nÉchéance : ${due || '72 h ouvrées'}\n\n${textQuestions || 'Questions indisponibles : vérifier dans MediumIA.'}\n\nRépondre depuis l'administration MediumIA.`,
    html: `<div style="font-family:Georgia,serif;color:#1a1535;max-width:620px"><h2>Nouvelle demande avec paiement confirmé</h2><p>${escapeHtml(row.first_name)} · ${row.question_count} question${row.question_count > 1 ? 's' : ''} · ${escapeHtml(amount)}</p><p>E-mail : ${escapeHtml(row.email)}<br>Référence PayPal : ${escapeHtml(row.paypal_order_id)}<br>Échéance : ${escapeHtml(due || '72 h ouvrées')}</p>${htmlQuestions || '<p>Questions indisponibles : vérifier dans MediumIA.</p>'}<p>Répondre depuis l’administration MediumIA.</p></div>`,
  }
}

export async function sendPurchaseEmails(db, row, { send = sendEmail, allowSandbox = false } = {}) {
  if (row.paypal_env !== 'live' && !allowSandbox) return 'sandbox_skipped'
  const replyTo = String(process.env.EMAIL_QUESTIONS_REPLY_TO || '').trim() || undefined
  const ownerEmail = String(process.env.EMAIL_QUESTIONS_OWNER_EMAIL || '').trim()
  const due = row.due_at
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(new Date(row.due_at))
    : null
  const client = await send({
    to: row.email,
    subject: 'Votre question à Sébastien est bien enregistrée ✦',
    text: `Bonjour ${row.first_name},\n\nVotre demande est bien enregistrée. Sébastien prendra personnellement connaissance de ${row.question_count === 1 ? 'votre question' : 'vos deux questions'} et vous répondra par e-mail${due ? ` avant le ${due}` : ' sous 72 heures ouvrées'}.\n\nRéférence : ${row.paypal_order_id}\nMontant : ${money(row.amount_cents)}\n\nSébastien · MediumIA\n${SITE}/question`,
    html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Votre demande est enregistrée ✦</h2><p>Bonjour ${escapeHtml(row.first_name)},</p><p>Sébastien prendra personnellement connaissance de ${row.question_count === 1 ? 'votre question' : 'vos deux questions'} et vous répondra par e-mail${due ? ` avant le <strong>${escapeHtml(due)}</strong>` : ' sous 72 heures ouvrées'}.</p><p style="font-size:13px;color:#716b7c">Référence : ${escapeHtml(row.paypal_order_id)} · ${escapeHtml(money(row.amount_cents))}</p></div>`,
    idempotencyKey: `email-question-confirm/${row.id}`,
    replyTo,
  }).catch(() => ({ status: 'error', uncertain: true }))

  if (ownerEmail) {
    const ownerContent = buildOwnerQuestionEmail(row, due)
    const ownerResult = await send({
      to: ownerEmail,
      ...ownerContent,
      idempotencyKey: `email-question-owner/${row.id}`,
    }).catch(() => ({ status: 'error' }))
    if (ownerResult.status !== 'sent') console.error('[emailQuestions] owner_notification_failed')
  }

  return client.status === 'sent' ? 'sent' : client.uncertain ? 'uncertain' : client.status
}

export async function createQuestionOrder(req, res, db, env) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!emailQuestionsOpen()) return res.status(404).json({ error: 'service_closed' })
  if (emailQuestionPurchasesSuspended()) {
    return res.status(503).json({ error: 'email_questions_suspended', message: EMAIL_QUESTION_SUSPENDED_MESSAGE })
  }

  const pack = normalizePack(req.body?.pack)
  const meta = pack ? EMAIL_QUESTION_PACKS[pack] : null
  const firstName = cleanText(req.body?.firstName, 80)
  const email = normalizeEmail(req.body?.email)
  const birthDate = req.body?.birthDate ? normalizeBirthDate(req.body.birthDate) : null
  const questions = pack ? normalizeQuestions(pack, req.body?.questions) : null
  if (!meta || !firstName || !email || !questions) return res.status(400).json({ error: 'invalid_form' })
  if (req.body?.birthDate && !birthDate) return res.status(400).json({ error: 'invalid_birth_date' })
  if (req.body?.retractationWaived !== true || req.body?.rulesAccepted !== true) return res.status(400).json({ error: 'consent_required' })

  const already = await paidLast24h(db, env)
  if (already >= EMAIL_QUESTION_DAILY_CAP) return res.status(409).json({ error: 'daily_capacity_reached' })

  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  if (!clientId) return res.status(503).json({ error: 'paypal_not_configured' })

  const id = randomUUID()
  const access = await paypalAccessToken(env)
  const reference = `MEDIUMIA_EMAIL_${pack.toUpperCase()}`
  const created = await paypalRequest(env, access, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: reference,
      custom_id: id,
      description: `MediumIA — ${meta.label} à Sébastien par e-mail`,
      amount: { currency_code: 'EUR', value: (meta.amountCents / 100).toFixed(2) },
    }],
    application_context: {
      brand_name: 'MediumIA',
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
    },
  }, `mediumia-email-question-create-${id}`)
  if (!created.ok || !created.data?.id) return res.status(502).json({ error: 'paypal_create_failed' })

  const acceptedAt = new Date().toISOString()
  const { error } = await db.from('mediumia_email_questions').insert({
    id,
    paypal_env: env,
    paypal_order_id: created.data.id,
    pack,
    question_count: meta.count,
    amount_cents: meta.amountCents,
    currency: 'EUR',
    first_name: firstName,
    email,
    birth_date: birthDate,
    questions,
    status: 'payment_pending',
    terms_version: EMAIL_QUESTION_TERMS_VERSION,
    terms_accepted_at: acceptedAt,
    immediate_service_accepted_at: acceptedAt,
  })
  if (error) return res.status(503).json({ error: 'order_record_failed' })
  return res.status(200).json({ id: created.data.id })
}

export async function captureQuestionOrder(req, res, db, env, {
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sendPurchase = sendPurchaseEmails,
} = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const orderId = cleanText(req.body?.orderId, 128)
  if (!/^[A-Z0-9-]{8,128}$/i.test(orderId)) return res.status(400).json({ error: 'invalid_order' })

  const { data: row, error } = await db.from('mediumia_email_questions').select('*').eq('paypal_order_id', orderId).maybeSingle()
  if (error) return res.status(503).json({ error: 'payment_record_unavailable', retryable: true })
  if (!row || row.paypal_env !== env) return res.status(404).json({ error: 'order_not_found' })
  if (['paid','in_progress','answered'].includes(row.status) && row.paypal_capture_id) {
    return res.status(200).json({ ok: true, id: row.id, due_at: row.due_at, idempotent: true })
  }
  if (row.status !== 'payment_pending') return res.status(409).json({ error: 'order_not_payable' })

  const meta = EMAIL_QUESTION_PACKS[row.pack]
  if (!meta || row.amount_cents !== meta.amountCents || row.question_count !== meta.count) return res.status(409).json({ error: 'stored_order_invalid' })

  const access = await paypalAccessToken(env)

  // Lire l'état actuel avant toute capture : si déjà COMPLETED, ne pas re-capturer.
  const preCheck = await paypalRequest(env, access, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)
  if (!preCheck.ok) {
    return res.status(503).json({ error: 'paypal_order_lookup_unavailable', retryable: true })
  }
  let captured = preCheck
  if (preCheck.ok && preCheck.data?.status === 'COMPLETED') {
    // Commande déjà capturée (idempotence ou replay navigateur).
  } else if (preCheck.data?.status === 'APPROVED' || row.capture_started_at) {
    if (preCheck.data?.id !== orderId) return res.status(409).json({ error: 'paypal_order_mismatch' })
    if (preCheck.data?.status === 'APPROVED' && !row.capture_started_at) {
      // Atomic, durable claim across workers. Never expire/reset an uncertain capture:
      // a later request may reconcile by GET, but must not submit another capture POST.
      const { data: claimed, error: claimError } = await db.from('mediumia_email_questions')
        .update({ capture_started_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'payment_pending').is('capture_started_at', null)
        .select('*').maybeSingle()
      if (claimError) return res.status(503).json({ error: 'payment_capture_claim_unavailable', retryable: true })
      if (claimed) {
        captured = await paypalRequest(env, access, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, null, `mediumia-email-question-capture-${orderId}`)
      }
    }
    // Both the claim loser and an uncertain POST use bounded, read-only reconciliation.
    // PayPal can temporarily return APPROVED even after a successful capture.
    for (const delay of [0, 100, 300]) {
      if (captured.ok && captured.data?.status === 'COMPLETED') break
      if (delay) await sleep(delay)
      const { data: current, error: readError } = await db.from('mediumia_email_questions')
        .select('*').eq('id', row.id).maybeSingle()
      if (readError) return res.status(503).json({ error: 'payment_record_unavailable', retryable: true })
      if (current?.paypal_env === env && current.paypal_order_id === orderId
        && current.paypal_capture_id && ['paid','in_progress','answered'].includes(current.status)) {
        return res.status(200).json({ ok: true, id: current.id, due_at: current.due_at, idempotent: true })
      }
      captured = await paypalRequest(env, access, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)
    }
  } else {
    if (['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(preCheck.data?.status)) {
      return res.status(409).json({ error: 'paypal_order_not_approved', orderStatus: preCheck.data.status })
    }
    return res.status(503).json({ error: 'paypal_capture_unconfirmed', retryable: true })
  }

  const units = Array.isArray(captured.data?.purchase_units) ? captured.data.purchase_units : []
  const unit = units[0]
  const captures = Array.isArray(unit?.payments?.captures) ? unit.payments.captures : []
  const capture = captures[0]
  // A single guidance order must never validate multiple purchase units/captures.
  if (captured.ok && captured.data?.status === 'COMPLETED' && (
    captured.data.id !== orderId || units.length !== 1 || unit.custom_id !== row.id
    || captures.length > 1
  )) return res.status(409).json({ error: 'paypal_order_mismatch' })
  if (!captured.ok || captured.data?.status !== 'COMPLETED'
    || captures.length !== 1 || capture?.status !== 'COMPLETED' || !capture?.id) {
    return res.status(503).json({ error: 'paypal_capture_unconfirmed', retryable: true })
  }
  if (unit.reference_id !== `MEDIUMIA_EMAIL_${row.pack.toUpperCase()}`
    || capture.amount?.currency_code !== 'EUR'
    || capture.amount?.value !== (row.amount_cents / 100).toFixed(2)) {
    return res.status(409).json({ error: 'paypal_order_mismatch' })
  }

  const paidAt = capture.create_time || new Date().toISOString()
  const dueAt = addBusinessDays(new Date(paidAt), 3).toISOString()
  const { data: paid, error: paidError } = await db.from('mediumia_email_questions')
    .update({
      paypal_capture_id: capture.id,
      status: 'paid',
      paid_at: paidAt,
      due_at: dueAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id).eq('status', 'payment_pending')
    .select('*').maybeSingle()

  if (paidError) return res.status(503).json({ error: 'payment_record_failed', retryable: true })
  if (!paid) {
    const { data: replay, error: replayError } = await db.from('mediumia_email_questions').select('*').eq('id', row.id).maybeSingle()
    if (replayError) return res.status(503).json({ error: 'payment_record_unavailable', retryable: true })
    if (replay?.paypal_capture_id === capture.id && ['paid','in_progress','answered'].includes(replay.status)) {
      return res.status(200).json({ ok: true, id: replay.id, due_at: replay.due_at, idempotent: true })
    }
    return res.status(409).json({ error: 'payment_state_conflict' })
  }

  const emailStatus = await sendPurchase(db, paid)
  await db.from('mediumia_email_questions').update({
    confirmation_email_status: emailStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', paid.id)

  return res.status(200).json({ ok: true, id: paid.id, due_at: paid.due_at })
}

function requestHeader(req, name) {
  const headers = req.headers || {}
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
  return Array.isArray(value) ? value[0] : String(value || '').trim()
}

async function verifyPayPalWebhook(req, env) {
  const fields = {
    auth_algo: requestHeader(req, 'paypal-auth-algo'),
    cert_url: requestHeader(req, 'paypal-cert-url'),
    transmission_id: requestHeader(req, 'paypal-transmission-id'),
    transmission_sig: requestHeader(req, 'paypal-transmission-sig'),
    transmission_time: requestHeader(req, 'paypal-transmission-time'),
  }
  if (Object.values(fields).some((value) => !value)) {
    return { ok: false, status: 401, error: 'paypal_signature_headers_missing' }
  }

  const webhookId = String(process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID || '').trim()
  if (!webhookId) return { ok: false, status: 503, error: 'paypal_webhook_not_configured' }

  let access
  try {
    access = await paypalAccessToken(env)
  } catch {
    return { ok: false, status: 503, error: 'paypal_signature_verification_unavailable' }
  }
  const verification = await paypalRequest(
    env,
    access,
    'POST',
    '/v1/notifications/verify-webhook-signature',
    { ...fields, webhook_id: webhookId, webhook_event: req.body },
  )
  if (!verification.ok) {
    return verification.retryable
      ? { ok: false, status: 503, error: 'paypal_signature_verification_unavailable' }
      : { ok: false, status: 401, error: 'paypal_signature_invalid' }
  }
  if (verification.data?.verification_status !== 'SUCCESS') {
    return { ok: false, status: 401, error: 'paypal_signature_invalid' }
  }
  return { ok: true, access }
}

function rpcRow(data) {
  return Array.isArray(data) ? data[0] : data
}

async function claimWebhookEvent(db, { eventId, eventType, captureId, orderId, questionId }) {
  const { data, error } = await db.rpc('claim_email_question_paypal_event', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_capture_id: captureId,
    p_paypal_order_id: orderId,
    p_question_id: questionId,
  })
  if (error) return { ok: false, retryable: true }
  const claim = rpcRow(data)
  return {
    ok: Boolean(claim?.claimed),
    status: String(claim?.event_status || 'unknown'),
    retryable: ['processing', 'retryable', 'unknown'].includes(String(claim?.event_status || 'unknown')),
  }
}

async function finishWebhookEvent(db, eventId, status, errorCode = null) {
  const { data, error } = await db.rpc('finish_email_question_paypal_event', {
    p_event_id: eventId,
    p_status: status,
    p_error: errorCode,
  })
  return !error && data === true
}

// Webhook PayPal pour les Guidances : signature vérifiée, relecture provider et
// claim SQL atomique. Le payload sert à corréler l'ordre, jamais à confirmer le paiement.
export async function handleWebhook(req, res, db, env, { sendPurchase = sendPurchaseEmails } = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const signature = await verifyPayPalWebhook(req, env)
  if (!signature.ok) return res.status(signature.status).json({ error: signature.error })

  const eventType = String(req.body?.event_type || '')
  const eventId = String(req.body?.id || '').trim()
  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    return res.status(200).json({ ok: true, ignored: 'event_type_not_handled' })
  }
  if (!/^WH-[A-Za-z0-9-]{10,128}$/.test(eventId)) {
    return res.status(400).json({ error: 'invalid_event_id' })
  }

  const resource = req.body?.resource || {}
  const captureId = String(resource.id || '').trim()
  const orderId = String(resource.supplementary_data?.related_ids?.order_id || '').trim()
  if (!/^[A-Za-z0-9-]{8,128}$/.test(captureId) || !/^[A-Za-z0-9-]{8,128}$/.test(orderId)) {
    return res.status(400).json({ error: 'invalid_capture_reference' })
  }

  const { data: row, error: rowError } = await db.from('mediumia_email_questions')
    .select('*').eq('paypal_order_id', orderId).maybeSingle()
  if (rowError) return res.status(503).json({ error: 'guidance_order_lookup_unavailable', retryable: true })
  if (!row) {
    const hintedGuidanceId = String(resource.custom_id || '').trim()
    return /^[0-9a-f-]{36}$/i.test(hintedGuidanceId)
      ? res.status(503).json({ error: 'guidance_order_not_recorded', retryable: true })
      : res.status(200).json({ ok: true, ignored: 'not_a_guidance_order' })
  }
  if (row.paypal_env !== env) return res.status(400).json({ error: 'paypal_environment_mismatch' })

  const claim = await claimWebhookEvent(db, {
    eventId, eventType, captureId, orderId, questionId: row.id,
  })
  if (!claim.ok) {
    if (!claim.retryable) return res.status(200).json({ ok: true, idempotent: true })
    return res.status(503).json({ error: 'webhook_event_busy', retryable: true })
  }

  if (row.paypal_capture_id === captureId && ['paid', 'in_progress', 'answered'].includes(row.status)) {
    const finished = await finishWebhookEvent(db, eventId, 'completed')
    return finished
      ? res.status(200).json({ ok: true, idempotent: true })
      : res.status(503).json({ error: 'webhook_completion_unavailable', retryable: true })
  }
  if (row.status !== 'payment_pending') {
    await finishWebhookEvent(db, eventId, 'failed', 'order_not_pending')
    return res.status(200).json({ ok: true, ignored: 'order_not_pending' })
  }

  const orderCheck = await paypalRequest(
    env,
    signature.access,
    'GET',
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
  )
  if (!orderCheck.ok || orderCheck.data?.status !== 'COMPLETED' || orderCheck.data?.id !== orderId) {
    await finishWebhookEvent(db, eventId, 'retryable', 'order_not_yet_confirmed')
    return res.status(503).json({ error: 'paypal_order_not_yet_confirmed', retryable: true })
  }

  const units = Array.isArray(orderCheck.data.purchase_units) ? orderCheck.data.purchase_units : []
  const unit = units[0]
  const captures = Array.isArray(unit?.payments?.captures) ? unit.payments.captures : []
  const capture = captures[0]
  const meta = EMAIL_QUESTION_PACKS[row.pack]
  if (units.length !== 1 || unit.custom_id !== row.id || captures.length !== 1
    || capture?.status !== 'COMPLETED' || capture.id !== captureId || !meta
    || unit.reference_id !== `MEDIUMIA_EMAIL_${row.pack.toUpperCase()}`
    || capture.amount?.currency_code !== 'EUR'
    || capture.amount?.value !== (row.amount_cents / 100).toFixed(2)) {
    await finishWebhookEvent(db, eventId, 'failed', 'order_mismatch')
    return res.status(200).json({ ok: true, ignored: 'order_mismatch' })
  }

  const paidAt = capture.create_time || new Date().toISOString()
  const dueAt = addBusinessDays(new Date(paidAt), 3).toISOString()
  const { data: paid, error: paidError } = await db.from('mediumia_email_questions')
    .update({
      paypal_capture_id: capture.id,
      status: 'paid',
      paid_at: paidAt,
      due_at: dueAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id).eq('status', 'payment_pending')
    .select('*').maybeSingle()

  if (paidError) {
    await finishWebhookEvent(db, eventId, 'retryable', 'payment_record_failed')
    return res.status(503).json({ error: 'payment_record_failed', retryable: true })
  }
  if (!paid) {
    const { data: existing } = await db.from('mediumia_email_questions').select('*').eq('id', row.id).maybeSingle()
    if (existing?.paypal_capture_id !== captureId) {
      await finishWebhookEvent(db, eventId, 'retryable', 'payment_state_conflict')
      return res.status(503).json({ error: 'payment_state_conflict', retryable: true })
    }
  } else {
    const emailStatus = await sendPurchase(db, paid)
    await db.from('mediumia_email_questions').update({
      confirmation_email_status: emailStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', paid.id)
  }

  const finished = await finishWebhookEvent(db, eventId, 'completed')
  return finished
    ? res.status(200).json({ ok: true, captured: Boolean(paid), idempotent: !paid })
    : res.status(503).json({ error: 'webhook_completion_unavailable', retryable: true })
}

// Sandbox-only, read-only diagnostic for the isolated PR #156 staging project.
// It never retries the capture POST, updates a row, or sends a notification.
// The separate environment flag is intentionally absent from Production.
export async function inspectLatestSandboxGuidance(req, res, db, env) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  const configuredUrl = String(process.env.SUPABASE_URL || '')
  if (process.env.VERCEL_ENV !== 'preview'
    || env !== 'sandbox'
    || process.env.EMAIL_QUESTIONS_SANDBOX_DIAGNOSTIC_ENABLED !== 'true'
    || configuredUrl !== 'https://wnbwhnqiulsdjcvkuwos.supabase.co') {
    return res.status(404).json({ error: 'not_found' })
  }

  // No financial IDs from callers. Only two recent claimed Sandbox test orders.
  const orderIndex = req.query?.orderIndex ?? '0'
  if (orderIndex !== '0' && orderIndex !== '1') return res.status(400).json({ error: 'invalid_test_order_index' })
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const { data: row, error } = await db.from('mediumia_email_questions')
    .select('id, paypal_order_id, paypal_env, pack, amount_cents, currency, status, capture_started_at, created_at')
    .eq('paypal_env', 'sandbox')
    .eq('status', 'payment_pending')
    .not('capture_started_at', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .range(Number(orderIndex), Number(orderIndex))
    .maybeSingle()
  if (error) return res.status(503).json({ error: 'test_order_lookup_failed' })
  if (!row) return res.status(404).json({ error: 'no_recent_claimed_test_order' })

  const access = await paypalAccessToken('sandbox')
  const result = await paypalRequest('sandbox', access, 'GET',
    `/v2/checkout/orders/${encodeURIComponent(row.paypal_order_id)}`)
  if (!result.ok) {
    return res.status(503).json({
      error: 'paypal_read_only_lookup_unavailable', retryable: result.retryable === true,
    })
  }

  const order = result.data
  const units = Array.isArray(order.purchase_units) ? order.purchase_units : []
  const unit = units.length === 1 ? units[0] : null
  const captures = Array.isArray(unit?.payments?.captures) ? unit.payments.captures : []
  let captureDetail = null
  if (captures.length === 1 && /^[A-Za-z0-9-]{8,128}$/.test(String(captures[0]?.id || ''))) {
    const detail = await paypalRequest('sandbox', access, 'GET',
      `/v2/payments/captures/${encodeURIComponent(captures[0].id)}`)
    if (detail.ok) captureDetail = detail.data
  }
  const evidence = summarizeGuidancePayPalEvidence(row, order, captureDetail)
  const allowedStatus = new Set([
    'CREATED', 'SAVED', 'APPROVED', 'COMPLETED', 'VOIDED', 'PAYER_ACTION_REQUIRED',
    'PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DENIED', 'DECLINED',
  ])
  const safeStatus = (value) => allowedStatus.has(String(value)) ? String(value) : 'unknown'
  return res.status(200).json({
    sandbox_only: true, read_only: true, capture_post_retried: false,
    test_order_index: Number(orderIndex),
    database_status: row.status,
    capture_claimed: Boolean(row.capture_started_at),
    provider_order_status: safeStatus(order.status),
    provider_purchase_unit_count: units.length,
    provider_capture_count: captures.length,
    provider_capture_status: captures.length === 1 ? safeStatus(captures[0]?.status) : 'unknown',
    provider_capture_detail_status: safeStatus(captureDetail?.status),
    evidence_classification: evidence.classification,
    evidence_reason: evidence.reason,
  })
}

export async function handleEmailQuestions(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'service_unavailable' })

  let env
  try { env = emailQuestionEnv() } catch (error) {
    return res.status(503).json({ error: error?.message || 'paypal_unavailable' })
  }
  const db = getSupabaseAdmin()

  try {
    if (action === 'sandbox_inspect_latest') return await inspectLatestSandboxGuidance(req, res, db, env)
    if (action === 'config') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
      const paid = await paidLast24h(db, env)
      const suspended = emailQuestionPurchasesSuspended()
      return res.status(200).json({
        enabled: emailQuestionsOpen() && !suspended && Boolean(clientId) && paid < EMAIL_QUESTION_DAILY_CAP,
        clientId: emailQuestionsOpen() && !suspended ? clientId : '',
        env,
        dailyCap: EMAIL_QUESTION_DAILY_CAP,
        remaining: Math.max(0, EMAIL_QUESTION_DAILY_CAP - paid),
        suspended,
        suspensionMessage: suspended ? EMAIL_QUESTION_SUSPENDED_MESSAGE : '',
        packs: publicPacks(),
      })
    }
    if (action === 'create') return await createQuestionOrder(req, res, db, env)
    if (action === 'capture') return await captureQuestionOrder(req, res, db, env)
    if (action === 'webhook') return await handleWebhook(req, res, db, env)
    return res.status(400).json({ error: 'invalid_action' })
  } catch (error) {
    console.error(`[emailQuestions] ${error?.message || 'unknown_error'}`)
    return res.status(503).json({ error: 'question_service_unavailable' })
  }
}

async function ownerAllowed(db, userId) {
  const { data, error } = await db.from('booking_practitioners')
    .select('id').eq('owner_id', userId).eq('slug', 'sebastien-seguin').maybeSingle()
  return !error && Boolean(data?.id)
}

async function loadOwnedQuestion(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null
  const { data } = await db.from('mediumia_email_questions').select('*').eq('id', id).maybeSingle()
  return data || null
}


export function buildEmailGuidanceAnswer(row, answer) {
  const firstName = String(row?.first_name || '').trim() || 'vous'
  const questions = Array.isArray(row?.questions)
    ? row.questions.map((item) => String(item?.q || '').trim()).filter(Boolean)
    : []
  const questionText = questions.length
    ? questions.map((question, index) => `${questions.length > 1 ? `${index + 1}. ` : ''}${question}`).join('\n')
    : ''
  const questionHtml = questions.length
    ? `<div style="margin:24px 0;padding:20px;border:1px solid #e1d2aa;border-radius:16px;background:#faf6ea;">
        <p style="margin:0 0 14px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Votre demande</p>
        ${questions.map((question, index) => `<p style="margin:${index ? '12px' : '0'} 0 0;color:#1a1535;font-size:14px;line-height:1.7;"><strong>${questions.length > 1 ? `Question ${index + 1} · ` : ''}</strong>${escapeHtml(question)}</p>`).join('')}
      </div>`
    : ''

  const disclaimer = 'Cette guidance repose sur une interprétation intuitive : une erreur reste possible et aucune prédiction ne peut être considérée comme certaine ni garantie.'
  return {
    subject: 'Votre guidance par e-mail — MediumIA',
    text: `GUIDANCE PAR E-MAIL — MEDIUMIA

Bonjour ${firstName},

${questionText ? `VOTRE DEMANDE
${questionText}

` : ''}VOTRE GUIDANCE

${answer}

—
Cette réponse concerne la ou les questions commandées. Toute nouvelle question constitue une nouvelle demande.
${disclaimer}

Sébastien Seguin · MediumIA
${SITE}/question`,
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f3efe6;color:#1a1535;font-family:Georgia,serif;">
    <main style="max-width:640px;margin:0 auto;padding:24px 12px 40px;">
      <section style="overflow:hidden;border-radius:22px;background:#1a1535;box-shadow:0 14px 36px rgba(26,21,53,.14);">
        <div style="padding:34px 28px 30px;text-align:center;">
          <p style="margin:0 0 12px;color:#d4b469;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;">MediumIA présente</p>
          <h1 style="margin:0;color:#f8f5ee;font-size:29px;font-weight:normal;letter-spacing:.04em;">GUIDANCE PAR E-MAIL</h1>
          <p style="margin:12px 0 0;color:#d9d3c7;font-size:14px;font-style:italic;">Une réponse personnelle de Sébastien</p>
        </div>
        <div style="height:1px;background:linear-gradient(90deg,transparent,#d4b469,transparent);"></div>
        <div style="padding:28px;background:#fffdf8;">
          <p style="margin:0 0 10px;color:#1a1535;font-size:18px;line-height:1.55;">Bonjour ${escapeHtml(firstName)},</p>
          <p style="margin:0;color:#5f5870;font-size:15px;line-height:1.75;">Voici la guidance personnelle préparée par Sébastien à partir de votre demande.</p>
          ${questionHtml}
          <div style="margin:26px 0 0;padding:22px 20px;border-left:3px solid #d4b469;background:#f8f5ee;">
            <p style="margin:0 0 14px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Votre guidance</p>
            <div style="color:#2f2940;font-size:15px;line-height:1.9;white-space:pre-line;">${escapeHtml(answer)}</div>
          </div>
          <div style="margin-top:28px;padding:18px 20px;border-radius:14px;background:#1a1535;color:#f8f5ee;text-align:center;">
            <p style="margin:0;font-size:14px;line-height:1.7;">Prenez ce qui résonne pour vous et laissez le reste. Votre libre arbitre reste au centre de vos choix.</p>
          </div>
          <p style="margin:26px 0 0;color:#756d7e;font-size:13px;line-height:1.7;">Cette réponse concerne la ou les questions commandées. Toute nouvelle question constitue une nouvelle demande. ${disclaimer}</p>
          <p style="margin:24px 0 0;color:#1a1535;font-size:14px;line-height:1.7;"><strong>Sébastien Seguin</strong><br><span style="color:#a98536;">MediumIA</span></p>
        </div>
      </section>
      <p style="margin:20px 0 0;color:#756d7e;font-size:12px;line-height:1.6;text-align:center;">MediumIA · Guidance intuitive et personnelle · <a href="${SITE}/question" style="color:#a98536;text-decoration:none;">mediumia.fr</a></p>
    </main>
  </body>
</html>`,
  }
}

async function sendAnswer(db, row, answer) {
  const replyTo = String(process.env.EMAIL_QUESTIONS_REPLY_TO || '').trim() || undefined
  if (row.paypal_env !== 'live') {
    const { data, error } = await db.from('mediumia_email_questions').update({
      status: 'answered',
      answer_text: answer,
      answer_email_status: 'sandbox_skipped',
      answered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).in('status', ['paid','in_progress']).select('*').maybeSingle()
    return error || !data ? { status: 409, body: { error: 'answer_state_conflict' } } : { status: 200, body: { ok: true, question: data } }
  }

  const content = buildEmailGuidanceAnswer(row, answer)
  const result = await sendEmail({
    to: row.email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    idempotencyKey: `email-question-answer/${row.id}`,
    replyTo,
  }).catch(() => ({ status: 'error', uncertain: true }))

  if (result.status !== 'sent') {
    await db.from('mediumia_email_questions').update({
      status: result.uncertain ? 'manual_review' : row.status,
      answer_text: answer,
      answer_email_status: result.uncertain ? 'uncertain' : 'error',
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { status: 503, body: { error: result.uncertain ? 'answer_delivery_uncertain' : 'answer_email_failed' } }
  }

  const { data, error } = await db.from('mediumia_email_questions').update({
    status: 'answered',
    answer_text: answer,
    answer_email_status: 'sent',
    answered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).in('status', ['paid','in_progress']).select('*').maybeSingle()

  if (error || !data) return { status: 409, body: { error: 'answer_state_conflict' } }
  return { status: 200, body: { ok: true, question: data } }
}

async function fullRefund(db, row, reason) {
  if (!row.paypal_capture_id || !['paid','in_progress','manual_review'].includes(row.status)) {
    return { status: 409, body: { error: 'refund_not_allowed' } }
  }
  const env = row.paypal_env
  const access = await paypalAccessToken(env)

  const { data: claimed } = await db.from('mediumia_email_questions').update({
    status: 'refund_pending',
    refusal_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).in('status', ['paid','in_progress','manual_review']).select('*').maybeSingle()
  if (!claimed) return { status: 409, body: { error: 'refund_state_conflict' } }

  let refund = await paypalRequest(env, access, 'POST',
    `/v2/payments/captures/${encodeURIComponent(row.paypal_capture_id)}/refund`,
    null,
    `mediumia-email-question-refund-${row.id}`)

  if (!refund.ok || !refund.data?.id) {
    const captureState = await paypalRequest(env, access, 'GET', `/v2/payments/captures/${encodeURIComponent(row.paypal_capture_id)}`)
    if (captureState.ok && captureState.data?.status === 'REFUNDED') {
      refund = { ok: true, data: { id: `adopted:${row.paypal_capture_id}` } }
    }
  }

  if (!refund.ok || !refund.data?.id) {
    await db.from('mediumia_email_questions').update({
      status: 'manual_review',
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('status', 'refund_pending')
    return { status: 503, body: { error: 'refund_uncertain' } }
  }

  const refundedAt = new Date().toISOString()
  const { data, error } = await db.from('mediumia_email_questions').update({
    status: 'refunded',
    paypal_refund_id: refund.data.id,
    refusal_reason: reason,
    refunded_at: refundedAt,
    updated_at: refundedAt,
  }).eq('id', row.id).eq('status', 'refund_pending').select('*').maybeSingle()
  if (error || !data) return { status: 503, body: { error: 'refund_record_failed' } }

  if (env === 'live') {
    await sendEmail({
      to: row.email,
      subject: 'Votre demande MediumIA a été remboursée',
      text: `Bonjour ${row.first_name},\n\nSébastien ne peut pas répondre à cette demande dans le cadre prévu. Le paiement de ${money(row.amount_cents)} a donc été remboursé sur le moyen de paiement d’origine.\n\nSébastien · MediumIA`,
      html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><p>Bonjour ${escapeHtml(row.first_name)},</p><p>Sébastien ne peut pas répondre à cette demande dans le cadre prévu. Le paiement de <strong>${escapeHtml(money(row.amount_cents))}</strong> a donc été remboursé sur le moyen de paiement d’origine.</p></div>`,
      idempotencyKey: `email-question-refund-notice/${row.id}`,
      replyTo: String(process.env.EMAIL_QUESTIONS_REPLY_TO || '').trim() || undefined,
    }).catch(() => null)
  }
  return { status: 200, body: { ok: true, question: data } }
}

export async function handleEmailQuestionsAdmin({ db, userId, method, query = {}, input = {} }) {
  if (!(await ownerAllowed(db, userId))) return { status: 403, body: { error: 'forbidden' } }

  if (method === 'GET') {
    const status = String(query.status || '').trim()
    let q = db.from('mediumia_email_questions').select('*').order('created_at', { ascending: false }).limit(100)
    if (status && ['paid','in_progress','answered','refund_pending','refunded','manual_review'].includes(status)) q = q.eq('status', status)
    const { data, error } = await q
    return error ? { status: 503, body: { error: 'questions_read_failed' } } : { status: 200, body: { questions: data || [] } }
  }

  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }
  const row = await loadOwnedQuestion(db, input.id)
  if (!row) return { status: 404, body: { error: 'question_not_found' } }

  if (input.op === 'paypal_readonly_preview') {
    // Administrative diagnostic ONLY. OAuth token and GET reads are allowed;
    // never call /capture, /refund, insert, update, or send emails here.
    if (!['live', 'sandbox'].includes(row.paypal_env)) {
      return { status: 409, body: { error: 'paypal_env_invalid' } }
    }
    try {
      const access = await paypalAccessToken(row.paypal_env)
      const order = await paypalRequest(row.paypal_env, access, 'GET',
        `/v2/checkout/orders/${encodeURIComponent(row.paypal_order_id)}`)
      if (!order.ok) return { status: 502, body: { error: 'paypal_order_lookup_failed' } }
      const matchingUnits = (order.data?.purchase_units || []).filter((u) => u.custom_id === row.id)
      const captureList = matchingUnits.length === 1 ? (matchingUnits[0]?.payments?.captures || []) : []
      let detail = null
      if (captureList.length === 1 && /^[A-Za-z0-9-]{8,128}$/.test(String(captureList[0]?.id || ''))) {
        const checked = await paypalRequest(row.paypal_env, access, 'GET',
          `/v2/payments/captures/${encodeURIComponent(captureList[0].id)}`)
        if (checked.ok) detail = checked.data
      }
      const evidence = summarizeGuidancePayPalEvidence(row, order.data, detail)
      return { status: 200, body: {
        ok: true, readOnly: true, recordedStatus: row.status,
        paypalEnv: row.paypal_env, evidence,
        warning: 'Aucune action financière ou modification de commande exécutée. Vérification manuelle requise avant rapprochement.',
      } }
    } catch {
      // Do not log order contents, PayPal bodies, personal information or secrets.
      return { status: 503, body: { error: 'paypal_readonly_lookup_unavailable' } }
    }
  }

  if (input.op === 'start') {
    const { data, error } = await db.from('mediumia_email_questions').update({
      status: 'in_progress', updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('status', 'paid').select('*').maybeSingle()
    return error || !data ? { status: 409, body: { error: 'question_state_conflict' } } : { status: 200, body: { ok: true, question: data } }
  }

  if (input.op === 'answer') {
    const answer = cleanParagraph(input.answer, 12000)
    if (answer.length < 20) return { status: 400, body: { error: 'answer_too_short' } }
    if (!['paid','in_progress'].includes(row.status)) return { status: 409, body: { error: 'answer_not_allowed' } }
    return sendAnswer(db, row, answer)
  }

  if (input.op === 'refund') {
    const reason = cleanParagraph(input.reason, 500) || 'Demande hors cadre'
    return fullRefund(db, row, reason)
  }

  return { status: 400, body: { error: 'invalid_request' } }
}
