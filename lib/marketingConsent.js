/* global process */
/**
 * Consentement marketing MediumIA (e-mails d'actualités), séparé des e-mails
 * de rendez-vous qui, eux, partent toujours.
 *
 * - Réservation : la case est facultative et décochée. Cochée, l'inscription
 *   reste « à confirmer » jusqu'au clic dans l'e-mail (double confirmation).
 *   Une personne désinscrite n'est jamais réabonnée par une réservation.
 * - Espace personnel : adresse prouvée, donc abonnement immédiat possible.
 * - Tout est journalisé en base (record_mediumia_marketing_consent).
 *
 * Côté réservation tout est « au mieux » : une erreur ici ne bloque jamais
 * un paiement, un créneau ni un e-mail de rendez-vous.
 *
 * API (via /api/rdv-config?marketingAction=…) :
 *   POST confirm      { token }   lien de l'e-mail de confirmation
 *   POST unsubscribe  { token }   lien de désinscription
 *   GET  preferences              (connecté) statut de l'adresse du compte
 *   POST subscribe / withdraw     (connecté)
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { requireVerifiedAccount } from './accountApiHandler.js'
import { sendEmail } from './transactionalEmail.js'
import { MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION } from './marketingConsentText.js'

export const CONFIRM_TOKEN_DAYS = 7
// Nouvelle demande alors qu'un e-mail de confirmation vient de partir : on
// n'en renvoie pas un autre avant ce délai.
export const CONFIRM_RESEND_MINUTES = 60

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const TOKEN = /^[0-9a-f]{64}$/

export const MARKETING_CONSENT_SHA256 = sha256(MARKETING_CONSENT_TEXT)

function publicBase() {
  const previewHost = process.env.VERCEL_ENV === 'preview' ? (process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL) : null
  const base = previewHost ? `https://${previewHost}` : (process.env.BOOKING_PUBLIC_URL?.trim() || 'https://mediumia.fr')
  return base.replace(/\/+$/, '')
}

// Le jeton voyage dans le fragment (#…) : il n'apparaît dans aucun journal serveur.
export const marketingConfirmUrl = (token) => `${publicBase()}/preferences-email#confirmer=${token}`
export const marketingUnsubscribeUrl = (token) => `${publicBase()}/preferences-email#desinscription=${token}`

// Jeton de désinscription stable par adresse : recalculable pour chaque
// e-mail envoyé, seul son hachage est stocké.
export function unsubscribeTokenFor(email) {
  const secret = process.env.MARKETING_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  const address = normalizeEmail(email)
  if (!secret || !address) return null
  return createHmac('sha256', secret).update(`mediumia-marketing-unsubscribe:v1:${address}`).digest('hex')
}

export function buildMarketingConfirmationEmail({ confirmUrl }) {
  const safe = String(confirmUrl).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return {
    subject: 'Confirmez votre inscription aux actualités MediumIA',
    html: `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1535;line-height:1.65;">
<p>Bonjour,</p>
<p>Vous avez demandé à recevoir par e-mail les actualités, conseils et offres de MediumIA.</p>
<p>Pour confirmer, cliquez sur ce bouton :</p>
<p style="margin:26px 0;"><a href="${safe}" style="background:#1A1535;color:#C9A84C;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:bold;">Confirmer mon inscription</a></p>
<p style="font-size:13px;color:#4A3F6B;">Ce lien est valable ${CONFIRM_TOKEN_DAYS} jours. Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail : vous ne serez pas inscrit(e).</p>
<p style="font-size:13px;color:#4A3F6B;">Vos e-mails de rendez-vous ne dépendent pas de cette inscription.</p>
<p>Sébastien — MediumIA</p>
</div>`,
    text: [
      'Bonjour,',
      '',
      'Vous avez demandé à recevoir par e-mail les actualités, conseils et offres de MediumIA.',
      'Pour confirmer, ouvrez ce lien :',
      confirmUrl,
      '',
      `Ce lien est valable ${CONFIRM_TOKEN_DAYS} jours. Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail : vous ne serez pas inscrit(e).`,
      'Vos e-mails de rendez-vous ne dépendent pas de cette inscription.',
      '',
      'Sébastien — MediumIA',
    ].join('\n'),
  }
}

async function record(supabase, params) {
  const { data, error } = await supabase.rpc('record_mediumia_marketing_consent', params)
  if (error || !data?.ok) return null
  return data
}

/**
 * Choix fait dans le formulaire de réservation.
 * `optIn` doit être un booléen : absent, la case n'a pas été présentée et
 * rien n'est enregistré. Ne lève jamais d'exception.
 */
export async function recordBookingConsent(supabase, { email, optIn, holdId = null, bookingId = null, now = new Date(), send = sendEmail } = {}) {
  const address = normalizeEmail(email)
  if (typeof optIn !== 'boolean' || !address) return { outcome: 'skipped' }
  try {
    const base = {
      p_email: address,
      p_user_id: null,
      p_source: 'booking',
      p_identity_verified: false,
      p_text_version: MARKETING_CONSENT_VERSION,
      p_text_sha256: MARKETING_CONSENT_SHA256,
      p_booking_id: bookingId,
      p_hold_id: holdId,
    }
    if (!optIn) {
      const result = await record(supabase, { ...base, p_event: 'presented_not_given' })
      return { outcome: result?.outcome || 'error' }
    }

    // Une demande toute récente attend déjà sa confirmation : pas de second e-mail.
    const { data: current } = await supabase.from('mediumia_marketing_subscriptions')
      .select('status, requested_at').eq('email', address).maybeSingle()
    if (current?.status === 'pending' && current.requested_at
      && now.getTime() - new Date(current.requested_at).getTime() < CONFIRM_RESEND_MINUTES * 60_000) {
      return { outcome: 'pending_recent' }
    }

    const confirmToken = randomBytes(32).toString('hex')
    const unsubscribeToken = unsubscribeTokenFor(address)
    const result = await record(supabase, {
      ...base,
      p_event: 'opt_in',
      p_confirm_token_hash: sha256(confirmToken),
      p_confirm_token_expires_at: new Date(now.getTime() + CONFIRM_TOKEN_DAYS * 86_400_000).toISOString(),
      p_unsubscribe_token_hash: unsubscribeToken ? sha256(unsubscribeToken) : null,
    })
    if (!result) return { outcome: 'error' }
    // Déjà abonné, ou désinscrit (jamais réabonné par une réservation) : aucun e-mail.
    if (result.outcome !== 'pending') return { outcome: result.outcome }

    const message = buildMarketingConfirmationEmail({ confirmUrl: marketingConfirmUrl(confirmToken) })
    const sent = await send({ to: address, ...message, idempotencyKey: `marketing-confirm/${sha256(confirmToken).slice(0, 32)}` })
    return { outcome: 'pending', email: sent?.status || 'error' }
  } catch {
    return { outcome: 'error' }
  }
}

// ── API ─────────────────────────────────────────────────────────────────────

const fail = (res, status, error) => res.status(status).json({ error })

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

async function allow(supabase, key, endpoint, hourly, daily) {
  const limit = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: sha256(key), p_endpoint: endpoint, p_hourly_limit: hourly, p_daily_limit: daily,
  })
  if (limit.error) return 'unavailable'
  return limit.data?.allowed ? 'ok' : 'limited'
}

function clientKey(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return `marketing:${forwarded || req.socket?.remoteAddress || 'unknown'}`
}

// Liens reçus par e-mail : toujours un POST déclenché par un clic sur la page
// (l'ouverture automatique du lien par une messagerie ne change rien).
async function handleToken(req, res, supabase, rpcName, param) {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  const gate = await allow(supabase, clientKey(req), 'marketing_token', 30, 120)
  if (gate === 'unavailable') return fail(res, 503, 'marketing_unavailable')
  if (gate === 'limited') return fail(res, 429, 'too_many_requests')
  const token = String(body(req).token || '').trim().toLowerCase()
  if (!TOKEN.test(token)) return fail(res, 400, 'invalid_token')
  const { data, error } = await supabase.rpc(rpcName, { [param]: sha256(token) })
  if (error) return fail(res, 503, 'marketing_unavailable')
  if (!data?.ok) return fail(res, data?.error === 'token_expired' ? 410 : 400, data?.error || 'invalid_token')
  return res.status(200).json({ status: data.status })
}

async function handleAccount(req, res, supabase, action) {
  const auth = await requireVerifiedAccount(req, supabase)
  if (!auth.user) return fail(res, auth.status, auth.error)
  const { user } = auth
  const gate = await allow(supabase, `marketing-account:${user.id}`, 'marketing_account', 60, 300)
  if (gate === 'unavailable') return fail(res, 503, 'marketing_unavailable')
  if (gate === 'limited') return fail(res, 429, 'too_many_requests')

  if (action === 'preferences') {
    if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed')
    const { data, error } = await supabase.from('mediumia_marketing_subscriptions')
      .select('status').eq('email', user.email).maybeSingle()
    if (error) return fail(res, 503, 'marketing_unavailable')
    return res.status(200).json({ status: data?.status || 'none', consentVersion: MARKETING_CONSENT_VERSION })
  }

  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed')
  const unsubscribeToken = unsubscribeTokenFor(user.email)
  const result = await record(supabase, {
    p_email: user.email,
    p_user_id: user.id,
    p_event: action === 'subscribe' ? 'opt_in' : 'withdrawn',
    p_source: 'account',
    // Adresse prouvée par la connexion : pas de seconde confirmation.
    p_identity_verified: true,
    p_text_version: MARKETING_CONSENT_VERSION,
    p_text_sha256: MARKETING_CONSENT_SHA256,
    p_unsubscribe_token_hash: unsubscribeToken ? sha256(unsubscribeToken) : null,
  })
  if (!result) return fail(res, 503, 'marketing_unavailable')
  return res.status(200).json({ status: result.status })
}

export async function handleMarketingApi(req, res, action, { supabase } = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['confirm', 'unsubscribe', 'preferences', 'subscribe', 'withdraw'].includes(action)) return fail(res, 404, 'unknown_marketing_action')
  if (!supabase && !isSupabaseConfigured()) return fail(res, 503, 'marketing_unavailable')
  const db = supabase || getSupabaseAdmin()
  try {
    if (action === 'confirm') return await handleToken(req, res, db, 'confirm_mediumia_marketing_consent', 'p_confirm_token_hash')
    if (action === 'unsubscribe') return await handleToken(req, res, db, 'withdraw_mediumia_marketing_consent_by_token', 'p_unsubscribe_token_hash')
    return await handleAccount(req, res, db, action)
  } catch {
    console.error('[marketing] action failed')
    return fail(res, 503, 'marketing_unavailable')
  }
}
