/**
 * Handler candidature réseau.
 * Appelé via api/rdv-config.js?action=reseau-apply
 *
 * Sécurité :
 *   - membership_type, founder_number, billing_plan, status ne sont JAMAIS lus
 *     directement depuis le body client.
 *   - Les invitations fondatrices connues sont rattachées côté serveur par
 *     combinaison empreinte e-mail + numéro présent dans source_page.
 *   - Aucune donnée personnelle n'est loguée (email, phone, SIRET…).
 *   - Honeypot `_hp` : si rempli → réponse 200 silencieuse (pas d'INSERT).
 */
import { createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE   = /^https?:\/\//
const FOUNDER_SOURCE_RE = /^\/reseau\/fondateur\?invite=(\d{3})$/

const MAX_PAYLOAD = 50_000

// Empreintes SHA-256 des invitations dont la numérotation actuelle est confirmée.
// Plusieurs empreintes peuvent pointer vers le même numéro lorsqu'une fondatrice
// a confirmé l'invitation depuis plusieurs adresses qui lui appartiennent.
// Les autres candidatures restent sans statut fondateur jusqu'à validation manuelle.
const CONFIRMED_FOUNDER_INVITES = new Map([
  ['530d0f2eece6e960287bf69d1f70990365ca40391e667e453cc669243e724097', 1],
  ['d92ef76b7669420bd2a14b6fa923811c13f8170a952f97307da6e214af3a04fc', 2],
  ['0e6125f6d5af1b27a3cf7c3472b4c39c9e91e9a3162e541140e36226d2883bce', 3],
  ['36ae4bdd3ffc90317249aad9b04943314c95bf86edee28b080122c7ed1b6ef36', 4],
  ['3122d97ccce6adf9ed3746a2aa8b17aff1b6983931a43b7b68048dc3b84c4ab4', 4],
  ['df5d9b28e3d6c0bb2a10534782620fa4b46c782e6c46552b8540a5275a67334b', 6],
  ['ccbabde85224e09cee8e593557b889e3d5ad2de184187ff2041be13fc62605f6', 7],
])

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

function resolveFounderInvite(emailNormalized, sourcePage) {
  if (typeof sourcePage !== 'string') return null

  const match = sourcePage.trim().match(FOUNDER_SOURCE_RE)
  if (!match) return null

  const emailHash = createHash('sha256').update(emailNormalized).digest('hex')
  const expectedNumber = CONFIRMED_FOUNDER_INVITES.get(emailHash)
  if (!expectedNumber) return null

  const submittedNumber = Number(match[1])
  return submittedNumber === expectedNumber ? expectedNumber : null
}

export async function handleReseauApply(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  const body = req.body || {}

  if (JSON.stringify(body).length > MAX_PAYLOAD) {
    return res.status(400).json({ error: 'validation_failed', field: '_payload_too_large' })
  }

  if (body._hp) {
    return res.status(200).json({ status: 'received' })
  }

  for (const [field, max] of Object.entries(REQUIRED_FIELDS)) {
    const val = body[field]
    if (typeof val !== 'string' || !val.trim() || val.trim().length > max) {
      return fail(res, field)
    }
  }

  const emailNormalized = body.email.trim().toLowerCase()
  if (!EMAIL_RE.test(emailNormalized)) {
    return fail(res, 'email')
  }

  if (body.remote_sessions !== 'yes' && body.remote_sessions !== 'no') {
    return fail(res, 'remote_sessions')
  }

  if (body.consent_accuracy !== true) {
    return fail(res, 'consent_accuracy')
  }
  if (body.consent_processing !== true) {
    return fail(res, 'consent_processing')
  }

  for (const [field, max] of Object.entries(OPTIONAL_FIELDS)) {
    const val = body[field]
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val !== 'string' || val.trim().length > max) {
        return fail(res, field)
      }
    }
  }

  if (body.website && body.website.trim() && !URL_RE.test(body.website.trim())) {
    return fail(res, 'website')
  }

  const founderNumber = resolveFounderInvite(emailNormalized, body.source_page)

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
    membership_type:      founderNumber ? 'founder_invited' : null,
    founder_number:       founderNumber,
    billing_plan:         founderNumber ? 'invited_free' : null,
    professional_name:    body.professional_name?.trim() || null,
    phone:                body.phone?.trim() || null,
    website:              body.website?.trim() || null,
    social_link:          body.social_link?.trim() || null,
    siret:                body.siret?.trim() || null,
    source_page:          body.source_page?.trim() || null,
  }

  const supabase = getSupabaseAdmin()

  try {
    const { error: insertErr } = await supabase
      .from('reseau_applications')
      .insert(row)

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(200).json({ status: 'received' })
      }
      console.error('[reseau-apply] Insert failed:', insertErr.code)
      return res.status(502).json({ error: 'submission_failed' })
    }

    return res.status(200).json({ status: 'received' })
  } catch {
    console.error('[reseau-apply] Unexpected error')
    return res.status(502).json({ error: 'submission_failed' })
  }
}
