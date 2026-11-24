/**
 * API Mac → MediumIA pour retrait unique de messages préalablement approuvés.
 * Jeton différent de l'Inbox. Aucun accès utilisateur final, aucun envoi serveur.
 * Les opérations sont activées seulement par LUMIA_SMS_OUTBOX_ENABLED=true.
 */
import { authenticateBearer } from './lumiaRdvIntake.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const FINISH_STATUSES = new Set(['accepted', 'failed', 'uncertain'])

export async function handleLumiaSmsOutboxApi({ req, env = process.env, db = null }) {
  if (String(env.LUMIA_SMS_OUTBOX_ENABLED || '').trim() !== 'true') {
    return { status: 503, body: { error: 'lumia_sms_outbox_disabled' } }
  }
  const auth = authenticateBearer(req, env.LUMIA_SMS_OUTBOX_TOKEN, 'lumia_sms_outbox_not_configured')
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } }
  if (!['GET', 'POST'].includes(req.method)) return { status: 405, body: { error: 'method_not_allowed' } }

  const supabase = db || getSupabaseAdmin()
  const slug = String(env.LUMIA_INTAKE_PRACTITIONER_SLUG || 'sebastien-seguin').trim()
  const { data: practitioner, error: practitionerError } = await supabase
    .from('booking_practitioners').select('owner_id').eq('slug', slug).maybeSingle()
  if (practitionerError || !practitioner?.owner_id) return { status: 503, body: { error: 'lumia_owner_unavailable' } }

  if (req.method === 'GET') {
    const { data, error } = await supabase.rpc('lumia_claim_sms_outbox', { p_owner_id: practitioner.owner_id })
    if (error) return { status: 503, body: { error: 'outbox_unavailable' } }
    const job = (data || [])[0] || null
    // Ne jamais retourner de noms clients, historique ou secrets autres que le message exact approuvé.
    return { status: 200, body: { job: job && {
      id: job.id,
      recipient: job.recipient,
      channel: job.channel,
      body: job.body,
      source_conversation_id: job.source_conversation_id,
      claimed_at: job.claimed_at,
    } } }
  }

  const input = req.body || {}
  if (!UUID_RE.test(String(input.id || '')) || !FINISH_STATUSES.has(input.status)
      || (input.error_code != null && !/^[a-z_]{1,64}$/.test(input.error_code))) {
    return { status: 400, body: { error: 'invalid_result' } }
  }
  const { data, error } = await supabase.rpc('lumia_finish_sms_outbox', {
    p_owner_id: practitioner.owner_id,
    p_outbox_id: input.id,
    p_status: input.status,
    p_error_code: input.error_code || null,
  })
  if (error) return { status: 503, body: { error: 'outbox_finish_failed' } }
  return { status: 200, body: data || { status: 'unknown' } }
}
