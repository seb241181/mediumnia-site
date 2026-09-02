/* global process */
/**
 * POST /api/reseau-apply
 *
 * Enregistre une candidature au réseau de praticiens.
 * Endpoint public (pas d'auth) — toute validation est server-side.
 *
 * Body JSON : voir REQUIRED_FIELDS / OPTIONAL_FIELDS ci-dessous.
 *
 * Sécurité :
 *   - membership_type, founder_number, billing_plan, status ne sont JAMAIS lus
 *     depuis le body client. Ils sont forcés côté serveur.
 *   - Aucune donnée personnelle n'est loguée (email, phone, SIRET…).
 *   - Honeypot `_hp` : si rempli → réponse 200 silencieuse (pas d'INSERT).
 */
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE   = /^https?:\/\//

const MAX_PAYLOAD = 50_000

// { field: maxLength }
const REQUIRED_FIELDS = {
  first_name:            100,
  last_name:             100,
  email:                 254,
  city:                  100,
  department:            10,
  main_activity:         200,
  specialties:           2000,
  years_practice:        50,
  practice_description:  5000,
  approach_description:  5000,
  target_audience:       3000,
  motivation:            5000,
}

const OPTIONAL_FIELDS = {
  professional_name: 100,
  phone:             30,
  website:           500,
  social_link:       500,
  siret:             30,
  source_page:       200,
}

function fail(res, field) {
  return res.status(400).json({ error: 'validation_failed', field })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  const body = req.body || {}

  // ── Payload size guard ──────────────────────────────────────────────────────
  if (JSON.stringify(body).length > MAX_PAYLOAD) {
    return res.status(400).json({ error: 'validation_failed', field: '_payload_too_large' })
  }

  // ── Honeypot ────────────────────────────────────────────────────────────────
  if (body._hp) {
    return res.status(200).json({ status: 'received' })
  }

  // ── Validate required string fields ─────────────────────────────────────────
  for (const [field, max] of Object.entries(REQUIRED_FIELDS)) {
    const val = body[field]
    if (typeof val !== 'string' || !val.trim() || val.trim().length > max) {
      return fail(res, field)
    }
  }

  // ── Email format ────────────────────────────────────────────────────────────
  const emailNormalized = body.email.trim().toLowerCase()
  if (!EMAIL_RE.test(emailNormalized)) {
    return fail(res, 'email')
  }

  // ── remote_sessions must be exactly "yes" or "no" ──────────────────────────
  if (body.remote_sessions !== 'yes' && body.remote_sessions !== 'no') {
    return fail(res, 'remote_sessions')
  }

  // ── Consent booleans must be true ──────────────────────────────────────────
  if (body.consent_accuracy !== true) {
    return fail(res, 'consent_accuracy')
  }
  if (body.consent_processing !== true) {
    return fail(res, 'consent_processing')
  }

  // ── Validate optional string fields ─────────────────────────────────────────
  for (const [field, max] of Object.entries(OPTIONAL_FIELDS)) {
    const val = body[field]
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val !== 'string' || val.trim().length > max) {
        return fail(res, field)
      }
    }
  }

  // ── Website URL format (if provided) ────────────────────────────────────────
  if (body.website && body.website.trim() && !URL_RE.test(body.website.trim())) {
    return fail(res, 'website')
  }

  // ── Build insert row ────────────────────────────────────────────────────────
  const row = {
    first_name:           body.first_name.trim(),
    last_name:            body.last_name.trim(),
    email:                body.email.trim(),
    email_normalized:     emailNormalized,
    city:                 body.city.trim(),
    department:           body.department.trim(),
    remote_sessions:      body.remote_sessions,
    main_activity:        body.main_activity.trim(),
    specialties:          body.specialties.trim(),
    years_practice:       body.years_practice.trim(),
    practice_description: body.practice_description.trim(),
    approach_description: body.approach_description.trim(),
    target_audience:      body.target_audience.trim(),
    motivation:           body.motivation.trim(),
    consent_accuracy:     true,
    consent_processing:   true,
    status:               'pending',
    membership_type:      null,
    founder_number:       null,
    billing_plan:         null,
    // Optional fields
    professional_name:    body.professional_name?.trim() || null,
    phone:                body.phone?.trim() || null,
    website:              body.website?.trim() || null,
    social_link:          body.social_link?.trim() || null,
    siret:                body.siret?.trim() || null,
    source_page:          body.source_page?.trim() || null,
  }

  const supabase = getSupabaseAdmin()

  try {
    // ── Deduplicate: check for existing pending application ─────────────────
    const { data: existing, error: checkErr } = await supabase
      .from('reseau_applications')
      .select('id')
      .eq('email_normalized', emailNormalized)
      .eq('status', 'pending')
      .maybeSingle()

    if (checkErr) {
      console.error('[reseau-apply] Deduplicate check failed:', checkErr.code)
      return res.status(502).json({ error: 'submission_failed' })
    }

    if (existing) {
      return res.status(200).json({
        status: 'received',
        message: 'Votre candidature a déjà été enregistrée.',
      })
    }

    // ── INSERT ──────────────────────────────────────────────────────────────
    const { error: insertErr } = await supabase
      .from('reseau_applications')
      .insert(row)

    if (insertErr) {
      console.error('[reseau-apply] Insert failed:', insertErr.code)
      return res.status(502).json({ error: 'submission_failed' })
    }

    return res.status(200).json({ status: 'received' })
  } catch {
    console.error('[reseau-apply] Unexpected error')
    return res.status(502).json({ error: 'submission_failed' })
  }
}
