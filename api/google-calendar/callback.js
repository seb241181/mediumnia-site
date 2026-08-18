/**
 * GET /api/google-calendar/callback?code=...&state=...
 *
 * Point de retour après consentement Google OAuth.
 *
 * Sécurité (double couche) :
 *   1. Validation HMAC-SHA256 du state (intégrité + expiry)
 *   2. SELECT + DELETE dans oauth_states (consommation unique — rejeu refusé)
 *
 * Suite : échange code → tokens, chiffrement AES-256-GCM, upsert DB.
 *
 * Aucun token ne doit apparaître dans les logs, réponses ou URLs.
 */
import { validateState, encrypt, decrypt } from '../../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../../lib/supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, state, error: oauthError } = req.query

  // Erreur retournée par Google (ex : accès refusé par l'utilisateur)
  if (oauthError) {
    return res.redirect(302, `/rdv?oauth_error=${encodeURIComponent(oauthError)}`)
  }

  // ── Couche 1 : validation HMAC (intégrité + expiry) ──────────────────────────
  let practitionerSlug
  try {
    practitionerSlug = validateState(state)
  } catch {
    return res.redirect(302, '/rdv?oauth_error=state_invalid')
  }

  if (!code) {
    return res.redirect(302, `/rdv?oauth_error=no_code&practitioner=${practitionerSlug}`)
  }

  // Vérification des variables requises
  const missing = []
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI')
  if (!process.env.CALENDAR_TOKEN_ENCRYPTION_KEY) missing.push('CALENDAR_TOKEN_ENCRYPTION_KEY')
  if (missing.length) {
    return res.redirect(302, `/rdv?oauth_error=server_config&practitioner=${practitionerSlug}`)
  }

  if (!isSupabaseConfigured()) {
    return res.redirect(302, `/rdv?oauth_error=supabase_not_configured&practitioner=${practitionerSlug}`)
  }

  const supabase = getSupabaseAdmin()

  // ── Couche 2 : consommation unique du state en DB ────────────────────────────
  // Opération SELECT → vérification → DELETE séquentielle.
  // (Sans transaction native JS client : fenêtre de concurrence négligeable en Preview.
  //  En Production, utiliser un RPC Supabase avec DELETE … RETURNING pour atomicité réelle.)
  const { data: stateRecord, error: stateErr } = await supabase
    .from('oauth_states')
    .select('practitioner_slug, expires_at')
    .eq('state', state)
    .single()

  if (stateErr || !stateRecord) {
    // State déjà consommé ou inexistant → rejeu ou expiration DB
    return res.redirect(302, `/rdv?oauth_error=state_consumed&practitioner=${practitionerSlug}`)
  }

  // Supprimer immédiatement pour garantir la consommation unique
  await supabase.from('oauth_states').delete().eq('state', state)

  // Double vérification de l'expiry en DB (le HMAC l'a déjà vérifiée, mais belt-and-suspenders)
  if (new Date() > new Date(stateRecord.expires_at)) {
    return res.redirect(302, `/rdv?oauth_error=state_expired&practitioner=${practitionerSlug}`)
  }

  // Cohérence praticien entre HMAC payload et DB record
  if (stateRecord.practitioner_slug !== practitionerSlug) {
    return res.redirect(302, '/rdv?oauth_error=state_mismatch')
  }

  // ── Échange du code contre des tokens Google ─────────────────────────────────
  let tokenData
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) {
      // Ne pas loguer la réponse brute — peut contenir des données sensibles
      return res.redirect(302, `/rdv?oauth_error=token_exchange_failed&practitioner=${practitionerSlug}`)
    }
    tokenData = await tokenRes.json()
  } catch {
    return res.redirect(302, `/rdv?oauth_error=token_fetch_error&practitioner=${practitionerSlug}`)
  }

  if (!tokenData.access_token) {
    return res.redirect(302, `/rdv?oauth_error=no_access_token&practitioner=${practitionerSlug}`)
  }

  // ── Récupération de l'email Google via userinfo ───────────────────────────────
  let googleEmail
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!infoRes.ok) {
      return res.redirect(302, `/rdv?oauth_error=userinfo_failed&practitioner=${practitionerSlug}`)
    }
    const info = await infoRes.json()
    googleEmail = info.email
  } catch {
    return res.redirect(302, `/rdv?oauth_error=userinfo_fetch_error&practitioner=${practitionerSlug}`)
  }

  if (!googleEmail) {
    return res.redirect(302, `/rdv?oauth_error=no_email&practitioner=${practitionerSlug}`)
  }

  // ── Chiffrement des tokens — jamais en clair en DB ou dans les logs ───────────
  const accessTokenEnc = encrypt(tokenData.access_token)
  const tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

  // ── Résolution de l'ID praticien depuis le slug ───────────────────────────────
  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', practitionerSlug)
    .single()

  if (practErr || !practitioner) {
    return res.redirect(302, `/rdv?oauth_error=practitioner_not_found&practitioner=${practitionerSlug}`)
  }

  // ── Conservation du refresh_token si Google n'en renvoie pas ─────────────────
  let refreshTokenEnc
  if (tokenData.refresh_token) {
    refreshTokenEnc = encrypt(tokenData.refresh_token)
  } else {
    const { data: existing } = await supabase
      .from('booking_calendar_connections')
      .select('refresh_token_enc')
      .eq('practitioner_id', practitioner.id)
      .single()
    refreshTokenEnc = existing?.refresh_token_enc
    if (!refreshTokenEnc) {
      return res.redirect(302, `/rdv?oauth_error=no_refresh_token&practitioner=${practitionerSlug}`)
    }
  }

  // ── Upsert dans booking_calendar_connections ──────────────────────────────────
  const { error: upsertErr } = await supabase
    .from('booking_calendar_connections')
    .upsert({
      practitioner_id: practitioner.id,
      google_email: googleEmail,
      google_calendar_id: 'primary',
      access_token_enc: accessTokenEnc,
      refresh_token_enc: refreshTokenEnc,
      token_expiry: tokenExpiry,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'practitioner_id',
    })

  if (upsertErr) {
    return res.redirect(302, `/rdv?oauth_error=db_error&practitioner=${practitionerSlug}`)
  }

  return res.redirect(302, `/rdv?oauth_success=1&practitioner=${practitionerSlug}`)
}
