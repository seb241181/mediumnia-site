import { createHash, createHmac, randomBytes } from 'node:crypto'
import { buildOracleEmailSequence } from './oracleEmailSequence.js'
import { cancelScheduledEmail, sendEmail } from './transactionalEmail.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

export const FORMATION_EMAIL_SOURCE = 'formation_page'
export const FORMATION_EMAIL_SEQUENCE_VERSION = 'mediumia-3-exercises-v1'
export const FORMATION_EMAIL_CONSENT_VERSION = 'formation-3-exercises-v1-2026-09-07'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PENDING_TTL_MS = 15 * 60 * 1000
const HOURLY_LIMIT = 10
const DAILY_LIMIT = 30

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeFormationLeadEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return ''
  return email
}

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (!xff) return null
  return String(xff).split(',')[0].trim().toLowerCase()
}

function hashIp(ip) {
  const secret = process.env.ORACLE_RATE_LIMIT_SECRET || ''
  if (!secret || !ip) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}

async function consumeRateLimit(supabase, req) {
  const ipHash = hashIp(extractClientIp(req))
  if (!ipHash) return { allowed: true }
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: ipHash,
    p_endpoint: 'formation_email_sequence',
    p_hourly_limit: HOURLY_LIMIT,
    p_daily_limit: DAILY_LIMIT,
  })
  if (error) throw new Error('Formation email rate limit failed')
  return data || { allowed: false }
}

function formationContextCopy(value) {
  return String(value || '')
    .replaceAll('après votre tirage Oracle', 'depuis la page Formation MediumIA')
    .replaceAll('après votre tirage Oracle.', 'depuis la page Formation MediumIA.')
}

export function buildFormationEmailSequence({ unsubscribeToken, nowMs = Date.now() }) {
  return buildOracleEmailSequence({ unsubscribeToken, nowMs }).map((item) => ({
    ...item,
    html: formationContextCopy(item.html),
    text: formationContextCopy(item.text),
  }))
}

async function findSubscription(supabase, emailHash) {
  const { data, error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .select('id, status, updated_at, resend_email_ids')
    .eq('email_hash', emailHash)
    .maybeSingle()
  if (error) throw new Error('Formation email subscription lookup failed')
  return data
}

async function reserveSubscription(supabase, emailHash, tokenHash, now = new Date()) {
  const payload = {
    email_hash: emailHash,
    status: 'pending',
    source: FORMATION_EMAIL_SOURCE,
    consent_version: FORMATION_EMAIL_CONSENT_VERSION,
    sequence_version: FORMATION_EMAIL_SEQUENCE_VERSION,
    consented_at: now.toISOString(),
    unsubscribe_token_hash: tokenHash,
    resend_email_ids: [],
    unsubscribed_at: null,
    updated_at: now.toISOString(),
  }

  const { data, error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .insert(payload)
    .select('id, status')
    .single()

  if (!error) return { subscription: data }
  if (error.code !== '23505') throw new Error('Formation email subscription reservation failed')

  const existing = await findSubscription(supabase, emailHash)
  if (!existing) return { conflict: 'in_progress' }
  if (existing.status === 'active') return { conflict: 'active' }
  if (existing.status === 'pending') {
    const ageMs = now.getTime() - new Date(existing.updated_at).getTime()
    if (Number.isFinite(ageMs) && ageMs < PENDING_TTL_MS) return { conflict: 'in_progress' }
  }

  const { data: reclaimed, error: reclaimError } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .update(payload)
    .eq('id', existing.id)
    .eq('updated_at', existing.updated_at)
    .select('id, status')
    .maybeSingle()

  if (reclaimError) throw new Error('Formation email subscription reclaim failed')
  if (!reclaimed) return { conflict: 'in_progress' }
  return { subscription: reclaimed }
}

async function setSubscriptionState(supabase, id, status, resendEmailIds = []) {
  const patch = {
    status,
    resend_email_ids: resendEmailIds,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .update(patch)
    .eq('id', id)
  if (error) throw new Error('Formation email subscription update failed')
}

async function cancelScheduled(ids) {
  for (const id of Array.isArray(ids) ? ids : []) {
    await cancelScheduledEmail(id)
  }
}

export async function handleFormationEmailLead(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const normalizedEmail = normalizeFormationLeadEmail(req.body?.email)
  if (!normalizedEmail) return res.status(400).json({ error: 'invalid_email' })
  if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' })

  const supabase = getSupabaseAdmin()

  try {
    const limit = await consumeRateLimit(supabase, req)
    if (!limit?.allowed) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Trop de demandes ont été effectuées depuis cette connexion. Merci de réessayer plus tard.',
      })
    }

    const emailHash = sha256Hex(normalizedEmail)
    const unsubscribeToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(unsubscribeToken)
    const reservation = await reserveSubscription(supabase, emailHash, tokenHash)

    if (reservation.conflict === 'active') {
      return res.status(200).json({ status: 'already_subscribed' })
    }
    if (reservation.conflict) {
      return res.status(409).json({ error: 'sequence_subscription_in_progress' })
    }

    const subscriptionId = reservation.subscription.id
    const scheduledIds = []

    try {
      const sequence = buildFormationEmailSequence({ unsubscribeToken })
      for (let index = 0; index < sequence.length; index += 1) {
        const item = sequence[index]
        const result = await sendEmail({
          to: normalizedEmail,
          subject: item.subject,
          html: item.html,
          text: item.text,
          scheduledAt: item.scheduledAt,
          idempotencyKey: `formation-seq-${subscriptionId}-${tokenHash.slice(0, 16)}-${index + 1}`,
        })
        if (result.status !== 'sent' || !result.id) throw new Error('Formation sequence schedule failed')
        scheduledIds.push(result.id)
      }

      await setSubscriptionState(supabase, subscriptionId, 'active', scheduledIds)
      return res.status(200).json({ status: 'subscribed', scheduled: 3 })
    } catch (error) {
      console.error('[formation-email-sequence] Scheduling failed:', error?.name || 'Error')
      await cancelScheduled(scheduledIds)
      try {
        await setSubscriptionState(supabase, subscriptionId, 'failed', scheduledIds)
      } catch {
        console.error('[formation-email-sequence] Failed-state persistence failed')
      }
      return res.status(503).json({ error: 'sequence_unavailable' })
    }
  } catch (error) {
    console.error('[formation-email-sequence] Handler error:', error?.name || 'Error')
    return res.status(503).json({ error: 'sequence_unavailable' })
  }
}
