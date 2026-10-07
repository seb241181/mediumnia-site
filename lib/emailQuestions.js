/* global Buffer, process */
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'

export const EMAIL_QUESTION_TERMS_VERSION = 'email-question-2026-10-06-v2'
export const EMAIL_QUESTION_DAILY_CAP = 5
export const EMAIL_QUESTION_PACKS = Object.freeze({
  q1: { count: 1, amountCents: 1990, label: 'Une question' },
  q2: { count: 2, amountCents: 2990, label: 'Deux questions' },
})

const PAYPAL = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}
const SITE = 'https://mediumia.fr'

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
  return rows.every((row) => row.q.length >= 10) ? rows : null
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

async function paypalAccessToken(env) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !secret) throw new Error('paypal_not_configured')
  const res = await fetch(`${PAYPAL[env]}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function paypalRequest(env, access, method, path, body = null, requestId = null) {
  const res = await fetch(`${PAYPAL[env]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
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

async function sendPurchaseEmails(db, row) {
  if (row.paypal_env !== 'live') return 'sandbox_skipped'
  const replyTo = String(process.env.EMAIL_QUESTIONS_REPLY_TO || '').trim() || undefined
  const ownerEmail = String(process.env.EMAIL_QUESTIONS_OWNER_EMAIL || '').trim()
  const due = row.due_at
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(new Date(row.due_at))
    : null
  const client = await sendEmail({
    to: row.email,
    subject: 'Votre question à Sébastien est bien enregistrée ✦',
    text: `Bonjour ${row.first_name},\n\nVotre demande est bien enregistrée. Sébastien prendra personnellement connaissance de ${row.question_count === 1 ? 'votre question' : 'vos deux questions'} et vous répondra par e-mail${due ? ` avant le ${due}` : ' sous 72 heures ouvrées'}.\n\nRéférence : ${row.paypal_order_id}\nMontant : ${money(row.amount_cents)}\n\nSébastien · MediumIA\n${SITE}/question`,
    html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Votre demande est enregistrée ✦</h2><p>Bonjour ${escapeHtml(row.first_name)},</p><p>Sébastien prendra personnellement connaissance de ${row.question_count === 1 ? 'votre question' : 'vos deux questions'} et vous répondra par e-mail${due ? ` avant le <strong>${escapeHtml(due)}</strong>` : ' sous 72 heures ouvrées'}.</p><p style="font-size:13px;color:#716b7c">Référence : ${escapeHtml(row.paypal_order_id)} · ${escapeHtml(money(row.amount_cents))}</p></div>`,
    idempotencyKey: `email-question-confirm/${row.id}`,
    replyTo,
  }).catch(() => ({ status: 'error', uncertain: true }))

  if (ownerEmail) await sendEmail({
    to: ownerEmail,
    subject: `[MediumIA] Nouvelle demande e-mail — ${row.question_count} question${row.question_count > 1 ? 's' : ''}`,
    text: `Nouvelle demande payée de ${row.first_name}.\nMontant : ${money(row.amount_cents)}\nÉchéance : ${due || '72 h ouvrées'}\n\nOuvrir MediumIA Rendez-vous pour répondre.`,
    html: `<p><strong>Nouvelle demande e-mail payée</strong></p><p>${escapeHtml(row.first_name)} · ${row.question_count} question${row.question_count > 1 ? 's' : ''} · ${escapeHtml(money(row.amount_cents))}</p><p>Échéance : ${escapeHtml(due || '72 h ouvrées')}</p>`,
    idempotencyKey: `email-question-owner/${row.id}`,
  }).catch(() => null)

  return client.status === 'sent' ? 'sent' : client.uncertain ? 'uncertain' : client.status
}

async function createQuestionOrder(req, res, db, env) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!emailQuestionsOpen()) return res.status(404).json({ error: 'service_closed' })

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

async function captureQuestionOrder(req, res, db, env) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const orderId = cleanText(req.body?.orderId, 128)
  if (!/^[A-Z0-9-]{8,128}$/i.test(orderId)) return res.status(400).json({ error: 'invalid_order' })

  const { data: row, error } = await db.from('mediumia_email_questions').select('*').eq('paypal_order_id', orderId).maybeSingle()
  if (error || !row || row.paypal_env !== env) return res.status(404).json({ error: 'order_not_found' })
  if (['paid','in_progress','answered'].includes(row.status) && row.paypal_capture_id) {
    return res.status(200).json({ ok: true, id: row.id, due_at: row.due_at, idempotent: true })
  }
  if (row.status !== 'payment_pending') return res.status(409).json({ error: 'order_not_payable' })

  const meta = EMAIL_QUESTION_PACKS[row.pack]
  if (!meta || row.amount_cents !== meta.amountCents || row.question_count !== meta.count) return res.status(409).json({ error: 'stored_order_invalid' })

  const access = await paypalAccessToken(env)
  let captured = await paypalRequest(env, access, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, null, `mediumia-email-question-capture-${orderId}`)
  if (!captured.ok || captured.data?.status !== 'COMPLETED') {
    captured = await paypalRequest(env, access, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)
  }
  const unit = (captured.data?.purchase_units || []).find((u) => u.custom_id === row.id)
  const capture = unit?.payments?.captures?.find((x) => x.status === 'COMPLETED')
  if (!captured.ok || captured.data?.id !== orderId || captured.data?.status !== 'COMPLETED' || !unit || !capture?.id) {
    return res.status(409).json({ error: 'paypal_capture_unconfirmed' })
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

  if (paidError) return res.status(503).json({ error: 'payment_record_failed' })
  if (!paid) {
    const { data: replay } = await db.from('mediumia_email_questions').select('*').eq('id', row.id).maybeSingle()
    if (replay?.paypal_capture_id === capture.id && ['paid','in_progress','answered'].includes(replay.status)) {
      return res.status(200).json({ ok: true, id: replay.id, due_at: replay.due_at, idempotent: true })
    }
    return res.status(409).json({ error: 'payment_state_conflict' })
  }

  const emailStatus = await sendPurchaseEmails(db, paid)
  await db.from('mediumia_email_questions').update({
    confirmation_email_status: emailStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', paid.id)

  return res.status(200).json({ ok: true, id: paid.id, due_at: paid.due_at })
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
    if (action === 'config') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
      const paid = await paidLast24h(db, env)
      return res.status(200).json({
        enabled: emailQuestionsOpen() && Boolean(clientId) && paid < EMAIL_QUESTION_DAILY_CAP,
        clientId: emailQuestionsOpen() ? clientId : '',
        env,
        dailyCap: EMAIL_QUESTION_DAILY_CAP,
        remaining: Math.max(0, EMAIL_QUESTION_DAILY_CAP - paid),
        packs: publicPacks(),
      })
    }
    if (action === 'create') return await createQuestionOrder(req, res, db, env)
    if (action === 'capture') return await captureQuestionOrder(req, res, db, env)
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
