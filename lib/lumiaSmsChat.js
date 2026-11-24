/* Lumia SMS : seul le propriétaire, dans la conversation privée Lumia,
 * prépare un brouillon. Aucun texte de client ne déclenche d'action.
 * "SMS à +336... : message" → preview / "GO SMS #ABC123" → file Mac.
 * Le serveur ne contacte jamais Apple Messages lui-même.
 */
import { randomUUID } from 'node:crypto'
import { normalizePhone } from './lumiaRdvIntake.js'
import { LUMIA_RDV_AGENT_ID } from './lumiaBookingCancelApi.js'

const TTL_MS = 10 * 60 * 1000
const CODE_RE = /^GO\s+SMS\s+(#[A-Z0-9]{6})\s*[.!]?$/i
const DRAFT_RE = /^SMS\s+(?:à\s+)?([+0-9(). -]{10,25})\s*:\s*([\s\S]+)$/i
export const LUMIA_SMS_ACTION = 'message.send'

export function parseLumiaSmsCommand(input) {
  const text = String(input || '').trim()
  const go = text.match(CODE_RE)
  if (go) return { kind: 'approve', code: go[1].toUpperCase() }
  const draft = text.match(DRAFT_RE)
  if (!draft) return { kind: 'none' }
  const recipient = normalizePhone(draft[1])
  const body = draft[2].trim()
  if (!recipient || !body || body.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) {
    return { kind: 'invalid' }
  }
  return { kind: 'draft', recipient, body }
}

function enabled(env) {
  return String(env.LUMIA_SMS_SEND_ENABLED || '') === 'true'
}

async function lastIncoming(db, ownerId, recipient) {
  const { data, error } = await db.from('lumia_message_inbox')
    .select('id,source_conversation_id,source_channel,message_sent_at')
    .eq('owner_id', ownerId).eq('counterpart', recipient).eq('is_from_me', false)
    .in('source_channel', ['sms', 'imessage'])
    .order('message_sent_at', { ascending: false }).limit(1)
  if (error) throw new Error('sms_source_unavailable')
  return data?.[0] || null
}

async function previewSms({ db, userId, conversationId, recipient, body, now }) {
  const source = await lastIncoming(db, userId, recipient)
  const fresh = source && Date.parse(source.message_sent_at) >= now.getTime() - 14 * 86_400_000
  if (!fresh || !source.source_conversation_id) {
    return { handled: true, reply: 'Je ne trouve pas de message récent (14 jours) de ce numéro dans ta boîte Lumia. Aucun SMS préparé.' }
  }
  const payload = {
    version: 1, recipient, body, channel: source.source_channel,
    source_inbox_id: source.id, source_conversation_id: source.source_conversation_id,
  }
  const { data, error } = await db.rpc('lumia_create_action_intent', {
    p_owner_id: userId, p_agent_id: LUMIA_RDV_AGENT_ID,
    p_conversation_id: conversationId, p_practitioner_id: null,
    p_action_type: LUMIA_SMS_ACTION, p_target_source: 'message_conversation',
    p_target_id: source.source_conversation_id,
    p_expected_version: null, p_expected_target_updated_at: null,
    p_target_google_etag: null,
    p_canonical_payload: payload,
    p_preview: { action: 'message_sms_pret', to: recipient, channel: source.source_channel, text: body },
    p_preview_expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
    p_idempotency_key: `sms:${randomUUID()}`,
  })
  if (error || !data?.short_code) {
    return { handled: true, reply: 'Impossible de préparer le SMS pour validation. Aucun envoi effectué.' }
  }
  return { handled: true, reply: [
    'Brouillon de réponse — RIEN N’EST ENVOYÉ.',
    `Destinataire : ${recipient} (${source.source_channel})`,
    'Texte exact :', body,
    `Pour mettre ce message en file d’envoi depuis ton Mac, réponds exactement : GO SMS ${data.short_code}`,
    'Le code expire dans 10 minutes. Le Mac doit être connecté et autorisé par macOS.',
  ].join('\n') }
}

async function approveSms({ db, userId, conversationId, code, now }) {
  const { data: intent, error } = await db.from('lumia_action_intents')
    .select('id,status,short_code,canonical_payload,preview_expires_at')
    .eq('owner_id', userId).eq('conversation_id', conversationId)
    .eq('action_type', LUMIA_SMS_ACTION).eq('short_code', code).maybeSingle()
  if (error || !intent) return { handled: true, reply: 'Code SMS introuvable dans cette conversation. Rien envoyé.' }
  const payload = intent.canonical_payload || {}
  if (!['preview', 'approved', 'executing', 'succeeded'].includes(intent.status)) {
    return { handled: true, reply: 'Ce brouillon n’est plus validable. Aucun envoi lancé.' }
  }
  if (intent.status === 'succeeded') {
    const { data } = await db.from('lumia_sms_outbox').select('status')
      .eq('intent_id', intent.id).eq('owner_id', userId).maybeSingle()
    return { handled: true, reply: `Cette demande a déjà été traitée (statut Mac : ${data?.status || 'à vérifier'}). Aucun second SMS créé.` }
  }
  if (Date.parse(intent.preview_expires_at) <= now.getTime()) {
    return { handled: true, reply: 'Code expiré. Prépare un nouveau SMS ; aucun envoi lancé.' }
  }
  if (!normalizePhone(payload.recipient) || !payload.body || payload.body.length > 1000
      || !['sms','imessage'].includes(payload.channel) || !payload.source_inbox_id) {
    return { handled: true, reply: 'Brouillon invalide. Aucun envoi lancé.' }
  }
  // Ne pas envoyer une réponse à une demande devenue obsolète pendant l'attente.
  const newest = await lastIncoming(db, userId, payload.recipient)
  if (!newest || newest.id !== payload.source_inbox_id
      || newest.source_conversation_id !== payload.source_conversation_id
      || newest.source_channel !== payload.channel) {
    return { handled: true, reply: 'Un nouveau message est arrivé ou le fil a changé. Reprépare la réponse avant de confirmer. Rien envoyé.' }
  }
  if (intent.status === 'preview') {
    const a = await db.rpc('lumia_approve_action_intent', {
      p_owner_id: userId, p_conversation_id: conversationId, p_intent_id: intent.id,
    })
    if (a.error || a.data?.status !== 'approved') return { handled: true, reply: 'Approbation refusée. Aucun envoi lancé.' }
  }
  if (intent.status !== 'executing') {
    const claimed = await db.rpc('lumia_claim_action_execution', {
      p_owner_id: userId, p_conversation_id: conversationId,
      p_intent_id: intent.id, p_executor_name: 'lumia.sms.queue',
    })
    if (claimed.error || (claimed.data?.status !== 'executing' && claimed.data?.status !== 'succeeded')) {
      return { handled: true, reply: 'Action déjà réclamée ou indisponible. Aucun nouveau SMS créé.' }
    }
  }
  const { error: insertError } = await db.from('lumia_sms_outbox').insert({
    intent_id: intent.id, owner_id: userId,
    source_inbox_id: payload.source_inbox_id,
    source_conversation_id: payload.source_conversation_id,
    recipient: payload.recipient, channel: payload.channel, body: payload.body,
    expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
  })
  if (insertError && insertError.code !== '23505') {
    return { handled: true, reply: 'L’enregistrement en file a échoué. Aucun SMS envoyé ; vérification nécessaire avant toute nouvelle tentative.' }
  }
  const finish = await db.rpc('lumia_finish_action_execution', {
    p_owner_id: userId, p_intent_id: intent.id,
    p_final_status: 'succeeded',
    p_execution_result: { queued: true, sender: 'mac', delivery_proven: false },
  })
  if (finish.error) return { handled: true, reply: 'Le brouillon est peut-être en attente sur le Mac. Ne relance pas : vérification nécessaire.' }
  return { handled: true, reply: [
    'Ton GO a bien été enregistré : le message est en file d’envoi.',
    'ATTENTION : cela ne prouve pas qu’il est parti, ni qu’il a été livré.',
    'Le Mac doit traiter la file et nous confirmer l’acceptation par Messages.app.',
    'Aucun rendez-vous ou événement Google n’a été modifié.',
  ].join('\n') }
}

export async function maybeHandleLumiaSmsChat({
  db, userId, conversationId, message, env = process.env, now = new Date(),
}) {
  const parsed = parseLumiaSmsCommand(message)
  if (parsed.kind === 'none') return null
  if (!enabled(env)) return { handled: true, reply: 'Envoi de SMS désactivé dans MediumIA Production. Aucun brouillon ni envoi créé.' }
  if (parsed.kind === 'invalid') return { handled: true, reply: 'Numéro ou message invalide (1 000 caractères maximum). Rien envoyé.' }
  try {
    if (parsed.kind === 'draft') return await previewSms({ db, userId, conversationId, ...parsed, now })
    return await approveSms({ db, userId, conversationId, code: parsed.code, now })
  } catch {
    return { handled: true, reply: 'Le service de réponse SMS est indisponible. Aucun nouvel envoi demandé ; vérifier l’état avant de réessayer.' }
  }
}
