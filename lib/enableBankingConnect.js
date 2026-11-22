/* global process */
import { getSupabaseAdmin, requirePractitionerOwner } from './supabaseAdmin.js'
import {
  readBankConnectionConfig, enableBankingCallbackUrl, newBankState,
  bankStateHash, protectBankValue, enableBankingApi, safeBankAuthorizationUrl,
} from './enableBankingAuth.js'

const OWNER_SLUG = 'sebastien-seguin'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CALLBACK_RETURN = 'https://mediumia.fr/rdv'

function deny(res, status, error) {
  return res.status(status).json({ error })
}

function goBack(res, status) {
  // Never include a banking authorization code, JWT, session or state in the redirected URL.
  res.setHeader('Location', CALLBACK_RETURN + '?bank_connection=' + status)
  return res.status(303).end()
}

async function startConnection(req, res, config, db) {
  const auth = await requirePractitionerOwner(req, OWNER_SLUG)
  if (auth.status) return deny(res, auth.status, auth.error)

  const state = newBankState()
  const created = new Date()
  const { error } = await db.from('rdv_bank_connection_authorizations').insert({
    state_hash: bankStateHash(state),
    practitioner_id: auth.practitionerId,
    owner_id: auth.userId,
    expires_at: new Date(created.getTime() + 10 * 60_000).toISOString(),
    status: 'pending',
  })
  if (error) return deny(res, 503, 'bank_connection_store_unavailable')

  try {
    const started = await enableBankingApi(config, '/auth', {
      access: { valid_until: new Date(created.getTime() + 30 * 86400_000).toISOString() },
      aspsp: { name: config.aspsp, country: 'FR' },
      state,
      redirect_url: enableBankingCallbackUrl,
      psu_type: 'business',
      language: 'fr',
    })
    if (!safeBankAuthorizationUrl(started?.url)) {
      return deny(res, 503, 'bank_provider_invalid_redirect')
    }
    // Only return the Enable Banking authorization page, not the one-time state.
    return res.status(200).json({ authorization_url: started.url })
  } catch {
    return deny(res, 503, 'bank_provider_unavailable')
  }
}

async function connectionStatus(req, res, db) {
  const auth = await requirePractitionerOwner(req, OWNER_SLUG)
  if (auth.status) return deny(res, auth.status, auth.error)
  const { data, error } = await db.from('rdv_bank_connections')
    .select('status, valid_until, linked_at')
    .eq('practitioner_id', auth.practitionerId)
    .eq('owner_id', auth.userId)
    .maybeSingle()
  if (error) return deny(res, 503, 'bank_connection_store_unavailable')
  return res.status(200).json({
    connection: data ? { status: data.status, valid_until: data.valid_until, linked_at: data.linked_at } : null,
  })
}

async function callback(req, res, config, db) {
  const stateHash = bankStateHash(req.query?.state)
  if (!stateHash) return goBack(res, 'invalid_state')

  // Atomic one-shot claim: prevents replay and simultaneous callback processing.
  const { data: attempt, error: claimError } = await db.from('rdv_bank_connection_authorizations')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('state_hash', stateHash)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('practitioner_id, owner_id')
    .maybeSingle()
  if (claimError || !attempt) return goBack(res, 'invalid_state')

  if (req.query?.error) return goBack(res, 'not_authorized')
  const code = req.query?.code
  if (typeof code !== 'string' || code.length < 8 || code.length > 2048) return goBack(res, 'invalid_code')

  try {
    const session = await enableBankingApi(config, '/sessions', { code })
    if (session?.psu_type !== 'business'
      || session?.aspsp?.country !== 'FR' || session?.aspsp?.name !== config.aspsp
      || !UUID_RE.test(String(session?.session_id || ''))
      || !Array.isArray(session.accounts)) {
      return goBack(res, 'provider_mismatch')
    }
    // One approved account only. Multiple accounts require a separate manual
    // selection workflow; never silently choose the first or ingest them all.
    const account = session.accounts[0]
    const bankIban = String(account?.account_id?.iban || '').replace(/\s/g, '').toUpperCase()
    const expectedIban = String(process.env.BOOKING_BANK_IBAN || '').replace(/\s/g, '').toUpperCase()
    if (session.accounts.length !== 1 || !UUID_RE.test(String(account?.uid || ''))
      || !/^FR[0-9A-Z]{25}$/.test(expectedIban) || bankIban !== expectedIban
      || account?.usage === 'PRIV' || account?.currency !== 'EUR') {
      return goBack(res, 'account_selection_required')
    }
    const validUntil = new Date(session?.access?.valid_until || '')
    if (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date()) return goBack(res, 'expired_consent')

    const { error } = await db.from('rdv_bank_connections').upsert({
      practitioner_id: attempt.practitioner_id,
      owner_id: attempt.owner_id,
      provider: 'enable_banking',
      aspsp_name: config.aspsp,
      session_id_enc: protectBankValue(session.session_id, config),
      account_uid_enc: protectBankValue(account.uid, config),
      valid_until: validUntil.toISOString(),
      linked_at: new Date().toISOString(),
      status: 'review_required',
    }, { onConflict: 'practitioner_id' })
    if (error) return goBack(res, 'storage_unavailable')
    // Linked for manual review only; no transaction import, RDV write, or email.
    return goBack(res, 'review_required')
  } catch {
    return goBack(res, 'provider_unavailable')
  }
}


async function approveConnection(req, res, db) {
  const auth = await requirePractitionerOwner(req, OWNER_SLUG)
  if (auth.status) return deny(res, auth.status, auth.error)
  if (req.body?.confirm_read_only !== true) return deny(res, 400, 'explicit_consent_required')
  const { data: current, error: lookupError } = await db.from('rdv_bank_connections')
    .select('status,valid_until')
    .eq('owner_id', auth.userId)
    .eq('practitioner_id', auth.practitionerId)
    .maybeSingle()
  if (lookupError) return deny(res, 503, 'bank_connection_store_unavailable')
  if (current?.status !== 'review_required' || new Date(current.valid_until) <= new Date()) {
    return deny(res, 409, 'bank_connection_not_ready')
  }
  const { data: activated, error } = await db.from('rdv_bank_connections')
    .update({ status: 'active' })
    .eq('owner_id', auth.userId)
    .eq('practitioner_id', auth.practitionerId)
    .eq('status', 'review_required')
    .select('status').maybeSingle()
  if (error || !activated) return deny(res, 409, 'bank_connection_not_ready')
  // This enables bank reading only, never auto-confirmation of a booking.
  return res.status(200).json({ ok: true, status: 'active' })
}

export async function handleEnableBankingConnection(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const config = readBankConnectionConfig()
  if (!config) return deny(res, 503, 'bank_connection_disabled')
  let db
  try { db = getSupabaseAdmin() } catch { return deny(res, 503, 'bank_connection_disabled') }
  if (action === 'callback') {
    if (req.method !== 'GET') return deny(res, 405, 'method_not_allowed')
    return callback(req, res, config, db)
  }
  if (action === 'approve') {
    if (req.method !== 'POST') return deny(res, 405, 'method_not_allowed')
    return approveConnection(req, res, db)
  }
  if (action === 'start') {
    if (req.method !== 'POST') return deny(res, 405, 'method_not_allowed')
    return startConnection(req, res, config, db)
  }
  if (action === 'status') {
    if (req.method !== 'GET') return deny(res, 405, 'method_not_allowed')
    return connectionStatus(req, res, db)
  }
  return deny(res, 404, 'bank_connection_action_unknown')
}
