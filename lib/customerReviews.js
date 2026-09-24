/**
 * Avis clients — appelé via api/rdv-config.js?reviewsAction=<action>
 *
 *   GET  list      avis publiés (status approved), plus récents d'abord. Public.
 *   POST submit    dépôt d'un avis (status pending). Public, honeypot + délai minimum
 *                  + 2 avis maximum par e-mail sur 24 h. Aucune IP stockée.
 *   GET  pending   avis à modérer + derniers traités. Propriétaire uniquement.
 *   POST moderate  { id, decision: 'approved' | 'rejected', reason? }. Propriétaire uniquement.
 *
 * Rien n'est publié sans validation. Aucune donnée personnelle (e-mail, texte de
 * l'avis) n'est écrite dans les logs.
 */
import { getSupabaseAdmin, isSupabaseConfigured, requirePractitionerOwner } from './supabaseAdmin.js'
import { handleGooglePlaceReviews } from './googlePlaceReviews.js'

// Le compte propriétaire du praticien « sebastien-seguin » modère les avis du site.
export const REVIEWS_OWNER_SLUG = 'sebastien-seguin'

export const REVIEW_OFFERINGS = ['consultation', 'oracle', 'chronosphere', 'formation', 'conference', 'autre']
export const REJECTION_REASONS = ['insulting', 'personal_data', 'off_topic', 'not_a_customer', 'duplicate', 'requested_by_author']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_FILL_MS = 4000
const MAX_PER_EMAIL_PER_DAY = 2
const PUBLIC_FIELDS = 'id, display_name, offering, rating, body, experience_month, created_at'

function tableMissing(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205')
}

export function validateReview(body, now = Date.now()) {
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().replace(/\s+/g, ' ') : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  const rating = Number(body.rating)
  const experienceMonth = body.experienceMonth ? String(body.experienceMonth) : null

  if (displayName.length < 2 || displayName.length > 60) return { field: 'displayName' }
  if (!EMAIL_RE.test(email) || email.length > 254) return { field: 'email' }
  if (!REVIEW_OFFERINGS.includes(body.offering)) return { field: 'offering' }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { field: 'rating' }
  if (text.length < 30 || text.length > 1500) return { field: 'body' }
  if (experienceMonth) {
    if (!MONTH_RE.test(experienceMonth)) return { field: 'experienceMonth' }
    const current = new Date(now).toISOString().slice(0, 7)
    if (experienceMonth > current) return { field: 'experienceMonth' }
  }
  if (body.consentPublication !== true) return { field: 'consentPublication' }

  return {
    review: {
      display_name: displayName,
      email,
      offering: body.offering,
      rating,
      body: text,
      experience_month: experienceMonth,
      consent_publication: true,
    },
  }
}

async function listApproved(res, supabase) {
  const { data, error } = await supabase
    .from('customer_reviews')
    .select(PUBLIC_FIELDS)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(60)
  if (tableMissing(error)) return res.status(200).json({ available: false, reviews: [] })
  if (error) return res.status(500).json({ error: 'reviews_unavailable' })
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).json({ available: true, reviews: data || [] })
}

async function submit(req, res, supabase) {
  const body = req.body || {}
  if (JSON.stringify(body).length > 10_000) return res.status(400).json({ error: 'validation_failed', field: '_payload' })

  // Robots : réponse identique à un succès, sans enregistrement.
  if (body._hp || !(Number(body._elapsedMs) >= MIN_FILL_MS)) return res.status(200).json({ status: 'received' })

  const { review, field } = validateReview(body)
  if (!review) return res.status(400).json({ error: 'validation_failed', field })

  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count, error: countError } = await supabase
    .from('customer_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('email', review.email)
    .gte('created_at', since)
  if (tableMissing(countError)) return res.status(503).json({ error: 'reviews_not_ready' })
  if (countError) return res.status(500).json({ error: 'reviews_unavailable' })
  if ((count || 0) >= MAX_PER_EMAIL_PER_DAY) return res.status(429).json({ error: 'too_many_reviews' })

  const { error } = await supabase.from('customer_reviews').insert(review)
  if (tableMissing(error)) return res.status(503).json({ error: 'reviews_not_ready' })
  if (error) return res.status(500).json({ error: 'reviews_unavailable' })
  return res.status(200).json({ status: 'received' })
}

async function listForModeration(res, supabase) {
  const fields = `${PUBLIC_FIELDS}, email, status, moderated_at, rejection_reason`
  const [pending, recent] = await Promise.all([
    supabase.from('customer_reviews').select(fields).eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
    supabase.from('customer_reviews').select(fields).neq('status', 'pending').order('moderated_at', { ascending: false }).limit(30),
  ])
  if (tableMissing(pending.error)) return res.status(200).json({ available: false, pending: [], recent: [] })
  if (pending.error || recent.error) return res.status(500).json({ error: 'reviews_unavailable' })
  return res.status(200).json({ available: true, pending: pending.data || [], recent: recent.data || [] })
}

async function moderate(req, res, supabase) {
  const { id, decision, reason } = req.body || {}
  if (!UUID_RE.test(String(id || ''))) return res.status(400).json({ error: 'validation_failed', field: 'id' })
  if (decision !== 'approved' && decision !== 'rejected') return res.status(400).json({ error: 'validation_failed', field: 'decision' })
  if (decision === 'rejected' && !REJECTION_REASONS.includes(reason)) return res.status(400).json({ error: 'validation_failed', field: 'reason' })

  const { data, error } = await supabase
    .from('customer_reviews')
    .update({
      status: decision,
      moderated_at: new Date().toISOString(),
      rejection_reason: decision === 'rejected' ? reason : null,
    })
    .eq('id', id)
    .select('id, status')
    .maybeSingle()
  if (error) return res.status(500).json({ error: 'reviews_unavailable' })
  if (!data) return res.status(404).json({ error: 'not_found' })
  return res.status(200).json({ review: data })
}

export async function handleCustomerReviews(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (action === 'google') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    return handleGooglePlaceReviews(req, res)
  }
  if (!isSupabaseConfigured()) {
    return action === 'list' ? res.status(200).json({ available: false, reviews: [] }) : res.status(503).json({ error: 'reviews_not_ready' })
  }
  const supabase = getSupabaseAdmin()

  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    return listApproved(res, supabase)
  }
  if (action === 'submit') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    return submit(req, res, supabase)
  }
  if (action === 'pending' || action === 'moderate') {
    const auth = await requirePractitionerOwner(req, REVIEWS_OWNER_SLUG)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    if (action === 'pending') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      return listForModeration(res, supabase)
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    return moderate(req, res, supabase)
  }
  return res.status(400).json({ error: 'unknown_action' })
}
