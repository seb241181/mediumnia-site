/**
 * Message Apple → contrat EXISTANT de POST /api/rdv-admin?action=lumia-rdv-intake
 * (lib/lumiaRdvIntake.js, docs/lumia-rdv-intake.md). Aucun champ inventé :
 * pas de nom (chat.db n'en contient pas, et les Contacts ne sont pas lus),
 * pas de créneau (jamais déduit d'un « mardi »), pas de prestation précise.
 */
import { createHash } from 'node:crypto'
import { appleMsToIso, decodeAttributedBody } from './chatdb.js'
import { hints } from './classify.js'

// Même règle que le serveur (MESSAGE_ID_RE).
export const MESSAGE_ID_RE = /^[A-Za-z0-9._:@+/=-]{1,200}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Contrat RDV : 2000 caractères ; boîte de réception : 4000.
const MAX_TEXT = 2000
const MAX_INBOX_TEXT = 4000

// Service Apple → canal Lumia. iMessage et SMS sont distingués par Apple dans
// message.service. RCS n'a pas de canal Lumia dédié : « other », documenté.
export function channelOf(service) {
  if (service === 'iMessage') return 'imessage'
  if (service === 'SMS') return 'sms'
  if (service === 'RCS') return 'other'
  return null
}

// Boîte de réception Lumia (V2) : RCS y garde son propre canal.
export function inboxChannelOf(service) {
  if (service === 'iMessage') return 'imessage'
  if (service === 'SMS') return 'sms'
  if (service === 'RCS') return 'rcs'
  return null
}

// Identifiant de fil stable, sans le numéro en clair (chat.guid contient le
// numéro et des « ; » refusés par le serveur).
export function conversationId(chatGuid, handle) {
  const source = chatGuid || `handle:${handle || ''}`
  return `conv-${createHash('sha256').update(source).digest('hex').slice(0, 40)}`
}

export function messageText(row) {
  const raw = row.text != null && String(row.text).trim() !== '' ? String(row.text) : decodeAttributedBody(row.attributed_body)
  if (raw == null) return null
  // Caractère de pièce jointe (U+FFFC) et caractères de contrôle retirés.
  const text = raw.replace(/￼/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim()
  return text ? text.slice(0, MAX_INBOX_TEXT) : ''
}

// Ce que le bridge sait du message, avant classement.
export function describe(row) {
  return {
    rowid: row.rowid,
    guid: row.guid,
    channel: channelOf(row.service),
    inbox_channel: inboxChannelOf(row.service),
    incoming: Number(row.is_from_me) === 0,
    reaction: Number(row.associated_message_type || 0) !== 0,
    system: Number(row.item_type || 0) !== 0,
    group: Number(row.chat_style) === 43,
    has_attachments: Number(row.has_attachments || 0) === 1,
    handle: row.handle || null,
    sent_at: appleMsToIso(row.date_ms),
    text: messageText(row),
    conversation_id: conversationId(row.chat_guid, row.handle),
  }
}

// Seuls les messages entrants, texte, 1-à-1, iMessage/SMS/RCS sont candidats.
export function skipReason(msg) {
  if (!msg.incoming) return 'sortant'
  if (msg.reaction) return 'réaction'
  if (msg.system) return 'événement système'
  if (msg.group) return 'groupe'
  if (!msg.channel) return 'service inconnu'
  if (!MESSAGE_ID_RE.test(String(msg.guid || ''))) return 'identifiant invalide'
  if (msg.text == null) return 'texte illisible'
  if (msg.text === '') return msg.has_attachments ? 'pièce jointe sans texte' : 'sans texte'
  return null
}

export function buildPayload(msg, classification, now = new Date()) {
  const payload = {
    agent: 'lumia',
    source_channel: msg.channel,
    source_message_id: msg.guid,
    source_conversation_id: msg.conversation_id,
    message_sent_at: msg.sent_at,
    detected_at: now.toISOString(),
    message_text: msg.text.slice(0, MAX_TEXT),
    modality: 'unknown',
    confidence: classification.label === 'probable' ? 0.7 : 0.4,
    ...hints(msg.text),
  }
  const handle = String(msg.handle || '').trim()
  if (EMAIL_RE.test(handle)) payload.email = handle.toLowerCase()
  else if (normalizePhone(handle)) payload.phone = normalizePhone(handle)
  return payload
}

// Boîte de réception : le message tel qu'il a été reçu, sans pièce jointe.
// Expéditeur normalisé (téléphone ou e-mail), jamais de nom (Contacts non lus).
export function buildInboxPayload(msg, classification) {
  const handle = String(msg.handle || '').trim()
  const sender = EMAIL_RE.test(handle) ? handle.toLowerCase() : normalizePhone(handle)
  return {
    source_channel: msg.inbox_channel,
    source_message_id: msg.guid,
    source_conversation_id: msg.conversation_id,
    message_sent_at: msg.sent_at,
    message_text: msg.text,
    is_from_me: false,
    classification: classification.label,
    ...(sender ? { sender } : {}),
  }
}

// Même normalisation que le serveur (lib/lumiaRdvIntake.js) : un numéro qu'il
// refuserait n'est pas envoyé, pour ne pas faire échouer toute la demande.
export function normalizePhone(phone) {
  const d = String(phone || '').replace(/[^0-9+]/g, '')
  if (/^0[1-9]\d{8}$/.test(d)) return `+33${d.slice(1)}`
  if (/^0033[1-9]\d{8}$/.test(d)) return `+33${d.slice(4)}`
  if (/^\+[1-9]\d{6,14}$/.test(d)) return d
  return null
}

// Affichage local : numéro / adresse partiellement masqués.
export function mask(value) {
  const v = String(value || '')
  if (!v) return ''
  if (v.includes('@')) return v.replace(/^(.).*(@.*)$/, '$1•••$2')
  return v.length <= 4 ? '••••' : `${v.slice(0, 3)}${'•'.repeat(Math.max(0, v.length - 5))}${v.slice(-2)}`
}
