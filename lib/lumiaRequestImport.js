/* global process */
/**
 * Lumia — ajouter à « Demandes de RDV à traiter » les demandes détectées dans
 * les messages professionnels (SMS, iMessage, RCS), après validation de Sébastien.
 *
 *   « Ajoute à ma liste à traiter les demandes de mes messages depuis le 1er novembre »
 *     → analyse serveur (sans IA) de lumia_message_inbox : messages REÇUS classés
 *       « probable » / « incertain » uniquement (un message personnel « ignorer »
 *       n'est jamais lu) ;
 *     → rapprochement avec MediumIA (demandes existantes, même conversation,
 *       même message, même numéro, rendez-vous à venir) ;
 *     → proposition numérotée + preview immuable (lumia_action_intents) ;
 *   « GO #CODE » ou « GO #CODE 1,3 »
 *     → approve → claim → lumia_execute_booking_request_import (SQL) : crée des
 *       demandes « pending », ne modifie jamais une demande existante.
 *
 * Jamais : booking, confirmation, Google Agenda, envoi de message, paiement.
 * Verrous : liste blanche LUMIA_ALLOWED_ACTIONS + LUMIA_REQUEST_IMPORT_ENABLED=true.
 */
import { randomUUID } from 'node:crypto'
import { LUMIA_ALLOWED_ACTIONS, authorizeLumiaAction } from './lumiaPolicy.js'
import { LUMIA_RDV_AGENT_ID } from './lumiaBookingCancelApi.js'
import { explicitVideoChannel, normalizePhone, normalizeText } from './lumiaRdvIntake.js'
import { computeReplies, counterpartNames, loadThreads, parseInboxQuestion, parisLabel, searchLumiaInbox } from './lumiaMessageInbox.js'
import { intents as messageIntents } from '../tools/lumia-messages-bridge/src/classify.js'

export const LUMIA_REQUEST_IMPORT_ACTION = 'mediumia.booking_request.import'
export const LUMIA_REQUEST_IMPORT_EXECUTOR = 'lumia.booking_request.import'
export const MAX_IMPORT_ITEMS = 25
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE_ID_RE = /^[A-Za-z0-9._:@+/=-]{1,200}$/ // même règle que l'écriture de l'Inbox
const IMPORT_CHANNELS = ['sms', 'imessage', 'rcs']

// Un message n'est importable (et dédoublonnable) qu'avec un identifiant source valide.
export function hasValidSource(row) {
  return Boolean(row && UUID_RE.test(String(row.id || '')) && IMPORT_CHANNELS.includes(row.source_channel)
    && SOURCE_ID_RE.test(String(row.source_message_id || '')))
}

// Contrôle final d'un élément du preview, avant toute création d'intention.
export function isValidImportItem(item) {
  return Boolean(item && Number.isInteger(item.n) && item.n >= 1
    && IMPORT_CHANNELS.includes(item.channel)
    && SOURCE_ID_RE.test(String(item.source_message_id || ''))
    && Array.isArray(item.message_ids) && item.message_ids.length >= 1
    && item.message_ids.every((id) => UUID_RE.test(String(id)))
    && (item.kind === undefined || ['new', 'reschedule', 'cancel', 'followup'].includes(item.kind))
    && (item.related_booking_id == null || (UUID_RE.test(String(item.related_booking_id)) && item.related_booking_match === 'found')))
}
const PREVIEW_TTL_MS = 30 * 60 * 1000
const DEFAULT_DAYS = 14
const MESSAGE_IDS_PER_ITEM = 5
const EXCERPT_CHARS = 140
const DEFAULT_PRACTITIONER_SLUG = 'sebastien-seguin'
const OPEN_STATUSES = ['pending', 'contacted']
const CHANNEL_LABELS = { sms: 'SMS', imessage: 'iMessage', rcs: 'RCS' }
const INTENT_LABELS = { reserver: 'réservation', deplacer: 'déplacement', annuler: 'annulation', urgence: 'urgence' }
const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
// « depuis le 2026-11-01 » → « depuis le 1er novembre 2026 » (affichage seulement).
export function humanPeriod(label) {
  return String(label || '').replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => `${Number(d) === 1 ? '1er' : Number(d)} ${MONTH_LABELS[Number(m) - 1]} ${y}`)
}
const STATUS_LABELS = {
  pending: 'déjà dans « Demandes de RDV à traiter »',
  contacted: 'déjà dans « À suivre »',
  scheduled: 'dossier déjà planifié',
  handled: 'dossier déjà traité (archivé)',
  rejected: 'dossier déjà refusé',
  cancelled: 'dossier déjà annulé',
}

// Réponse de Lumia quand aucun fournisseur IA n'est configuré : les commandes
// serveur (sans IA) restent utilisables.
export const LUMIA_NO_PROVIDER_REPLY = [
  'Je ne peux pas répondre librement pour le moment : aucun fournisseur IA n’est configuré sur ce site.',
  'Ces commandes fonctionnent sans IA :',
  '- « Ajoute à ma liste à traiter les demandes de mes messages depuis le 1er novembre »',
  '- « Analyse à nouveau mes messages depuis le 1er novembre et vérifie les doublons »',
  '- « GO #CODE » (ou « GO #CODE 1,3 ») pour valider une proposition',
  'Rien n’a été modifié.',
].join('\n')

// Activation : explicite (LUMIA_REQUEST_IMPORT_ENABLED=true), ou automatique sur
// une préversion branchée à la base TEST (même règle que rdvManualPaymentsAdmin).
// Jamais automatique en Production.
const TEST_SUPABASE_REF = 'wnbwhnqiulsdjcvkuwos'
export function requestImportEnabled(env = process.env) {
  const flag = String(env.LUMIA_REQUEST_IMPORT_ENABLED || '').trim()
  if (flag === 'true') return true
  if (flag === 'false' || env.VERCEL_ENV === 'production') return false
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''
  return url.includes(TEST_SUPABASE_REF)
}

// ── Commandes (uniquement le message écrit par Sébastien) ───────────────────

function parseSelection(raw) {
  const text = String(raw || '').trim()
  if (!text || /^(tout|tous|toutes|all)$/.test(text)) return { all: true, numbers: [] }
  const numbers = []
  for (const part of text.split(/\s*(?:,|;|\bet\b|\s)\s*/).filter(Boolean)) {
    const span = part.match(/^(\d{1,2})-(\d{1,2})$/)
    if (span) {
      const [a, b] = [Number(span[1]), Number(span[2])].sort((x, y) => x - y)
      for (let i = a; i <= b; i += 1) numbers.push(i)
    } else if (/^\d{1,2}$/.test(part)) numbers.push(Number(part))
    else return null
  }
  return numbers.length ? { all: false, numbers: [...new Set(numbers)].sort((a, b) => a - b) } : null
}

export function parseRequestImportCommand(message) {
  const raw = String(message || '').trim()
  const n = normalizeText(raw)
  // « GO #A1B2C3 », « GO #A1B2C3 1,3 », « GO #A1B2C3 tout », « GO 1 et 3 ».
  const go = raw.match(/^go\b\s*(#[a-z0-9]{6}\b)?(.{0,80})$/i)
  if (go) {
    const code = go[1] ? go[1].toUpperCase() : null
    const rest = go[2].replace(/[.!]+\s*$/, '').trim().toLowerCase()
    const selection = parseSelection(rest)
    if (!selection) return { kind: 'none' }
    return { kind: 'approve', shortCode: code, selection }
  }

  // Commande d'ajout ou de contrôle, en langage naturel. Jamais une simple question
  // de lecture (« Quelles demandes ai-je reçues ? » reste pour le modèle).
  const aboutMessages = /\b(messages?|sms|imessages?|rcs|textos?|conversations?)\b/.test(n)
  const aboutList = /\b(a traiter|liste|demandes?|rdv|rendez vous|mediumia)\b/.test(n)
  // « reporter » est exclu : en RDV, il veut dire « déplacer un rendez-vous ».
  const importVerb = /\b(ajout\w*|rajout\w*|integr\w*|import\w*|enregistr\w*|inscri\w*|complet\w*|mets?|mettre|transfer\w*|verse\w*)\b/.test(n)
  const missing = /\bpas encore (dans|enregistr\w*|ajout\w*|import\w*)\b/.test(n) && /\b(liste|mediumia|demandes?)\b/.test(n)
  const reanalysis = /\b(re ?analys\w*|analys\w* (a|de) nouveau|analys\w* encore|nouvelle analyse|relanc\w* (l |une )?analyse|refai\w* (l |une )?analyse|re ?verifi\w*|re ?scann?\w*)\b/.test(n)
  const duplicates = /\b(doublons?|deux fois|en double|plusieurs fois|dedoublonn\w*|dupliqu\w*|duplicata)\b/.test(n)
  const check = duplicates || reanalysis
  if (duplicates && (aboutMessages || aboutList)) return { kind: 'scan', check: true }
  if (aboutMessages && reanalysis && aboutList) return { kind: 'scan', check: true }
  if (aboutMessages && ((importVerb && aboutList) || missing)) return { kind: 'scan', check }
  return { kind: 'none' }
}

// Période demandée : celle de la question, sinon les 14 derniers jours.
export function importCriteria(message, now = new Date()) {
  const criteria = parseInboxQuestion(message, now)
  if (criteria.period) return { from: criteria.from, to: criteria.to, label: criteria.period, explicit: criteria.explicit, channel: criteria.channel, defaulted: false }
  const from = new Date(now.getTime() - DEFAULT_DAYS * 86_400_000).toISOString()
  return { from, to: now.toISOString(), label: `${DEFAULT_DAYS} derniers jours`, explicit: false, channel: criteria.channel, defaulted: true }
}

// ── Indices tirés du texte (sans IA, jamais inventés) ───────────────────────

export function guessModality(text) {
  const t = normalizeText(text)
  if (/\bvisio\w*\b|\bfacetime\b|\bwhatsapp\b|\ben ligne\b|\ba distance\b/.test(t)) return 'video'
  if (/\bpar telephone\b|\bau telephone\b|\bappel telephonique\b|\bpar tel\b/.test(t)) return 'phone'
  if (/\ben presentiel\b|\bau cabinet\b|\bsur place\b|\ben personne\b/.test(t)) return 'in-person'
  return 'unknown'
}

const SERVICE_HINTS = [
  [/\bdesenvout\w*/, 'désenvoûtement'],
  [/\bdegagements?\b/, 'dégagement'],
  [/\bnettoyage energetique\b|\bsoins? energetiques?\b/, 'soin énergétique'],
  [/\bguidances?\b/, 'guidance'],
  [/\bvoyance\b|\btirage\b/, 'voyance'],
]
export function guessServiceHint(text) {
  const t = normalizeText(text)
  return SERVICE_HINTS.find(([re]) => re.test(t))?.[1] || null
}

// ── Type d'action (sans IA, jamais une décision : toujours « À vérifier ») ───

export const REQUEST_KINDS = ['new', 'reschedule', 'cancel', 'followup']
export const REQUEST_KIND_LABELS = { new: 'Nouvelle demande', reschedule: 'Déplacement / modification', cancel: 'Annulation', followup: 'Relance / suivi' }
const FOLLOWUP_RE = /\b(relanc\w*|je me permets de (vous )?relancer|toujours pas (eu )?de (reponse|nouvelles|retour)|pas (eu|recu) de (reponse|retour|nouvelles)|sans (reponse|nouvelles)|avez vous (bien )?(eu|recu|vu) mon (message|sms)|je reviens vers vous|suite a (mon|ma|notre|nos|votre)|des nouvelles|un petit retour)\b/

// Priorité : annulation > déplacement > relance explicite > nouvelle demande > suivi.
export function detectRequestKind(texts, { hasHistory = false } = {}) {
  const all = [].concat(texts).filter(Boolean)
  const intents = new Set(all.flatMap((t) => messageIntents(t)))
  const n = all.map(normalizeText).join(' ')
  if (intents.has('annuler')) return 'cancel'
  if (intents.has('deplacer')) return 'reschedule'
  if (FOLLOWUP_RE.test(n)) return 'followup'
  if (intents.has('reserver') || intents.has('rendez_vous')) return 'new'
  return hasHistory ? 'followup' : 'new'
}

const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const MONTHS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
function parisDay(iso) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: '2-digit' }).formatToParts(new Date(iso))
  const get = (t) => parts.find((x) => x.type === t)?.value || ''
  return { weekday: normalizeText(get('weekday')), day: Number(get('day')), month: Number(get('month')) }
}

// Rendez-vous concerné par une annulation / un déplacement : rendez-vous confirmés
// à venir du même client, affinés par le jour ou la date cités dans le message.
// Ne fait que signaler : found (un seul), multiple, not_found.
export function matchRelatedBooking(texts, bookings = []) {
  if (!bookings.length) return { match: 'not_found', booking: null, candidates: [] }
  const n = [].concat(texts).map(normalizeText).join(' ')
  const weekday = WEEKDAYS_FR.find((d) => new RegExp(`\\b${d}\\b`).test(n)) || null
  const numeric = n.match(/\b([0-3]?\d) ([01]?\d)(?: (20\d{2}))?\b/)
  const named = n.match(new RegExp(`\\b([0-3]?\\d)(?: ?er)? (${MONTHS_FR.join('|')})\\b`))
  const day = named ? { day: Number(named[1]), month: MONTHS_FR.indexOf(named[2]) + 1 } : null
  let pool = bookings
  if (day) pool = bookings.filter((b) => { const p = parisDay(b.starts_at); return p.day === day.day && p.month === day.month })
  else if (weekday) pool = bookings.filter((b) => parisDay(b.starts_at).weekday === weekday)
  else if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12) {
    const filtered = bookings.filter((b) => { const p = parisDay(b.starts_at); return p.day === Number(numeric[1]) && p.month === Number(numeric[2]) })
    if (filtered.length) pool = filtered
  }
  if (pool.length === 1) return { match: 'found', booking: pool[0], candidates: pool }
  if (pool.length > 1) return { match: 'multiple', booking: null, candidates: pool }
  // Le jour cité ne correspond à aucun rendez-vous : on le dit, sans deviner.
  return { match: 'not_found', booking: null, candidates: [] }
}

// ── Rapprochement avec MediumIA (fonction pure, testée) ─────────────────────
//
// conversations : [{ key, channel, conversation_id, counterpart, rows (RDV, période) }]
// requests      : demandes d'agent de ces conversations (tous statuts)
// events        : booking_request_intake_events des messages concernés
// phoneRequests : demandes ouvertes (tous canaux) indexées par téléphone normalisé
// upcoming      : rendez-vous confirmés à venir (liste) indexés par téléphone normalisé

export function classifyImportCandidates({ conversations, requests = [], events = [], phoneRequests = new Map(), upcoming = new Map() }) {
  const eventByMessage = new Map(events.map((e) => [`${e.source_channel}:${e.source_message_id}`, e]))
  const requestsByConv = new Map()
  for (const r of requests) {
    const key = `${r.source_channel}:${r.source_conversation_id}`
    if (!requestsByConv.has(key)) requestsByConv.set(key, [])
    requestsByConv.get(key).push(r)
  }
  const out = { proposed: [], existing: [] }
  for (const c of conversations) {
    const rows = [...c.rows].sort((a, b) => String(a.message_sent_at).localeCompare(String(b.message_sent_at)))
    const convRequests = (c.conversation_id ? requestsByConv.get(`${c.channel}:${c.conversation_id}`) || [] : [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const latest = convRequests[0] || null
    const imported = rows.filter((r) => eventByMessage.has(`${r.source_channel}:${r.source_message_id}`))
    const lastImportedAt = imported.at(-1)?.message_sent_at || null
    const coveredUntil = [lastImportedAt, latest?.source_message_at].filter(Boolean).sort().at(-1) || null
    const fresh = rows.filter((r) => !eventByMessage.has(`${r.source_channel}:${r.source_message_id}`)
      && (!coveredUntil || r.message_sent_at > coveredUntil))
    const phone = c.counterpart?.startsWith('+') ? c.counterpart : null
    const clientBookings = (phone && [].concat(upcoming.get(phone) || [])) || []
    const base = { ...c, rows, latest_request: latest, upcoming_booking: clientBookings[0] || null, client_bookings: clientBookings }

    if (latest && OPEN_STATUSES.includes(latest.status) && !latest.confirmed_booking_id) {
      // Demande déjà ouverte : jamais une seconde demande ni une modification ;
      // un nouveau message (relance, annulation…) est seulement signalé.
      const newer = fresh.length ? detectRequestKind(fresh.map((r) => r.message_text), { hasHistory: true }) : null
      out.existing.push({ ...base, reason: latest.status, request_id: latest.id, new_message_kind: newer })
      continue
    }
    if (!fresh.length) {
      out.existing.push({ ...base, reason: latest?.status || 'already_imported', request_id: latest?.id || eventByMessage.get(`${rows.at(-1).source_channel}:${rows.at(-1).source_message_id}`)?.request_id || null })
      continue
    }
    const samePhone = phone ? phoneRequests.get(phone) : null
    if (samePhone) {
      out.existing.push({ ...base, reason: 'same_phone', request_id: samePhone.id, request_status: samePhone.status })
      continue
    }
    const texts = fresh.map((r) => r.message_text)
    const kind = detectRequestKind(texts, { hasHistory: Boolean(latest || clientBookings.length) })
    const related = ['cancel', 'reschedule'].includes(kind) ? matchRelatedBooking(texts, clientBookings) : null
    out.proposed.push({ ...base, fresh, previous_request: latest, kind, related })
  }
  // Probables d'abord, puis les plus récents.
  const levelRank = (c) => (c.fresh.some((r) => r.classification === 'probable') ? 0 : 1)
  out.proposed.sort((a, b) => (levelRank(a) - levelRank(b)) || String(b.fresh.at(-1).message_sent_at).localeCompare(String(a.fresh.at(-1).message_sent_at)))
  // Un même client (même numéro) sur plusieurs canaux : un seul dossier proposé,
  // les autres conversations sont signalées (elles seront reconnues ensuite par
  // le contrôle « même numéro »).
  const byClient = new Map()
  const kept = []
  for (const c of out.proposed) {
    const phone = c.counterpart?.startsWith('+') ? c.counterpart : null
    if (phone && byClient.has(phone)) {
      byClient.get(phone).merged.push({ channel: c.channel, conversation_id: c.conversation_id, messages: c.fresh.length })
      continue
    }
    const entry = { ...c, merged: [] }
    if (phone) byClient.set(phone, entry)
    kept.push(entry)
  }
  out.proposed = kept
  return out
}

// Contrôle des doublons (sans IA) sur les demandes d'agent des conversations analysées :
// plus d'une demande OUVERTE pour une même conversation, ou pour un même numéro.
// Le journal d'import garantit déjà « un message = une demande » (clé unique).
export function auditDuplicates({ conversations, requests = [], events = [] }) {
  const open = requests.filter((r) => OPEN_STATUSES.includes(r.status) && !r.confirmed_booking_id)
  const group = (key) => [...open.reduce((m, r) => {
    const k = key(r)
    if (k) m.set(k, [...(m.get(k) || []), r])
    return m
  }, new Map())].filter(([, rs]) => rs.length > 1).map(([k, rs]) => ({ key: k, count: rs.length, request_ids: rs.map((r) => r.id) }))
  const messageKeys = new Set(conversations.flatMap((c) => c.rows.map((r) => `${r.source_channel}:${r.source_message_id}`)))
  const importedMessages = events.filter((e) => messageKeys.has(`${e.source_channel}:${e.source_message_id}`)).length
  const requestIds = new Set(events.filter((e) => messageKeys.has(`${e.source_channel}:${e.source_message_id}`)).map((e) => e.request_id))
  return {
    imported_messages: importedMessages,
    requests: requestIds.size,
    by_conversation: group((r) => (r.source_conversation_id ? `${CHANNEL_LABELS[r.source_channel] || r.source_channel} · ${r.source_conversation_id}` : null)),
    by_phone: group((r) => normalizePhone(r.customer_phone)),
  }
}

function auditLines(audit) {
  const dups = [...audit.by_conversation, ...audit.by_phone]
  const lines = ['', 'Contrôle des doublons (base MediumIA, sans IA) :',
    `- ${audit.imported_messages} message${audit.imported_messages > 1 ? 's' : ''} de la période déjà importé${audit.imported_messages > 1 ? 's' : ''}, chacun une seule fois (${audit.requests} demande${audit.requests > 1 ? 's' : ''}).`]
  if (!dups.length) lines.push('- Aucune demande en double : une seule demande ouverte par conversation et par numéro.')
  else {
    for (const d of audit.by_conversation) lines.push(`- ⚠︎ ${d.count} demandes ouvertes pour la conversation ${d.key}`)
    for (const d of audit.by_phone) lines.push(`- ⚠︎ ${d.count} demandes ouvertes pour le numéro ${d.key}`)
    lines.push('- Rien n’a été modifié ni supprimé : à vérifier dans « Demandes de RDV à traiter ».')
  }
  return lines
}

// Élément immuable du preview : références serveur, aucun texte client.
export function buildImportItem(candidate, n) {
  const fresh = candidate.fresh.slice(-MESSAGE_IDS_PER_ITEM)
  const anchor = fresh.at(-1)
  if (!hasValidSource(anchor)) throw new Error('import_item_without_source_id')
  const text = fresh.map((r) => r.message_text).join('\n')
  const modality = guessModality(text)
  const probable = fresh.some((r) => r.classification === 'probable')
  return {
    n,
    channel: anchor.source_channel,
    conversation_id: anchor.source_conversation_id || null,
    source_message_id: anchor.source_message_id,
    message_ids: fresh.map((r) => r.id),
    modality,
    video_channel: modality === 'video' ? explicitVideoChannel({ text }) : null,
    service_hint: guessServiceHint(text),
    preferred_period: null,
    confidence: probable ? 0.8 : 0.5,
    kind: REQUEST_KINDS.includes(candidate.kind) ? candidate.kind : 'new',
    related_booking_id: candidate.related?.match === 'found' ? candidate.related.booking.id : null,
    related_booking_match: candidate.related?.match || null,
  }
}

// ── Affichage ───────────────────────────────────────────────────────────────

const shortText = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function whoLabel(c, names) {
  const name = (c.counterpart && names.get(c.counterpart)) || null
  return name ? `${name} (${c.counterpart})` : (c.counterpart || 'expéditeur inconnu')
}

function existingLine(c, names) {
  const reason = c.reason === 'same_phone'
    ? `même numéro qu’une demande ${c.request_status === 'contacted' ? '« À suivre »' : 'déjà « à traiter »'}`
    : STATUS_LABELS[c.reason] || 'message déjà importé'
  const newer = c.new_message_kind ? ` · ⚠︎ nouveau message (${REQUEST_KIND_LABELS[c.new_message_kind].toLowerCase()}) : à lire dans la demande existante, rien n’est créé en double` : ''
  return `- ${whoLabel(c, names)} · ${CHANNEL_LABELS[c.channel] || c.channel} — ${reason}${newer}`
}

function relatedLine(c) {
  if (!c.related) return null
  if (c.related.match === 'found') return `   Rendez-vous concerné : ${parisLabel(c.related.booking.starts_at)} — il ne sera pas modifié`
  if (c.related.match === 'multiple') return `   ${c.related.candidates.length} rendez-vous à venir pour ce client — à identifier, aucun ne sera modifié`
  return '   Aucun rendez-vous à venir trouvé pour ce client — à vérifier'
}

function proposedLines(c, n, names) {
  const last = c.fresh.at(-1)
  const level = c.fresh.some((r) => r.classification === 'probable') ? 'probable' : 'à vérifier (incertain)'
  const intents = [...new Set(c.fresh.flatMap((r) => messageIntents(r.message_text)).map((i) => INTENT_LABELS[i]).filter(Boolean))]
  const flags = []
  if (c.previous_request) flags.push(`nouveau message après un ${STATUS_LABELS[c.previous_request.status] || 'dossier précédent'}`)
  // Pour une annulation / un déplacement, la ligne « Rendez-vous concerné » suffit.
  if (c.upcoming_booking && !c.related) flags.push(`rendez-vous déjà prévu ${parisLabel(c.upcoming_booking.starts_at)}`)
  if (c.rdv_status === 'repondu') flags.push('réponse visible de Sébastien')
  if (c.merged?.length) flags.push(`même client aussi sur ${c.merged.map((m) => CHANNEL_LABELS[m.channel] || m.channel).join(', ')} : un seul dossier`)
  const kindLabel = REQUEST_KIND_LABELS[c.kind] || REQUEST_KIND_LABELS.new
  const head = `${n}. ${kindLabel} · À vérifier · ${whoLabel(c, names)} · ${CHANNEL_LABELS[c.channel] || c.channel} · ${level}`
    + `${intents.length ? ` · ${intents.join(', ')}` : ''} · ${parisLabel(last.message_sent_at)}`
  const related = relatedLine(c)
  return [head, `   « ${shortText(last.message_text, EXCERPT_CHARS)} »`, ...(related ? [related] : []), ...(flags.length ? [`   ⚠︎ ${flags.join(' ; ')}`] : [])]
}

export function formatScanReply({ criteria, scanned, conversations, result, intent, names, truncated, audit = null }) {
  const lines = [`Analyse des messages professionnels — ${criteria.defaulted ? `${criteria.label} (aucune période précisée)` : humanPeriod(criteria.label)}`
    + `${criteria.channel ? ` · ${CHANNEL_LABELS[criteria.channel]}` : ' · SMS, iMessage, RCS'}`]
  lines.push(`${scanned} message${scanned > 1 ? 's' : ''} de demande de rendez-vous (probable ou incertain) dans ${conversations} conversation${conversations > 1 ? 's' : ''}. Les messages personnels ne sont pas lus.`)
  if (result.existing.length) {
    lines.push('', `Déjà dans MediumIA (${result.existing.length}, rien à faire) :`)
    for (const c of result.existing.slice(0, 15)) lines.push(existingLine(c, names))
    if (result.existing.length > 15) lines.push(`- … et ${result.existing.length - 15} autre(s).`)
  }
  if (audit) lines.push(...auditLines(audit))
  if (!result.proposed.length) {
    lines.push('', 'Aucun nouveau dossier à ajouter : tout est déjà dans MediumIA. Rien n’a été modifié.')
    return lines.join('\n')
  }
  lines.push('', `Nouveaux dossiers proposés (${result.proposed.length}) — rien n’est encore enregistré :`)
  result.proposed.forEach((c, i) => lines.push(...proposedLines(c, i + 1, names)))
  if (truncated) lines.push(`(Seuls les ${MAX_IMPORT_ITEMS} premiers sont proposés ; relance l’analyse ensuite pour les suivants.)`)
  lines.push(
    '',
    `Pour tout ajouter à « Demandes de RDV à traiter », réponds : GO ${intent.short_code}`,
    ...(result.proposed.length > 1 ? [`Pour n’en ajouter que certains : GO ${intent.short_code} 1,3`] : []),
    'Les demandes seront créées « à vérifier » : aucun rendez-vous confirmé, modifié ou annulé, aucun message envoyé, aucun agenda modifié. Proposition valable 30 minutes.',
  )
  return lines.join('\n')
}

const OUTCOME_LABELS = {
  already_imported: 'message déjà importé',
  already_open: 'une demande ouverte existe déjà',
  source_unavailable: 'message introuvable ou plus classé RDV',
}

export function formatExecutionReply(body) {
  if (!body || body.status !== 'succeeded') {
    const reason = body?.reason || body?.error || 'refus_de_securite'
    const human = reason === 'preview_expired' ? 'la proposition a expiré, relance l’analyse' : reason === 'invalid_selection' ? 'numéros invalides' : reason
    return `Ajout non effectué (${human}). Aucune demande n’a été créée ni modifiée.`
  }
  const items = Array.isArray(body.items) ? body.items : []
  const lines = [body.created
    ? `C’est fait : ${body.created} demande${body.created > 1 ? 's' : ''} ajoutée${body.created > 1 ? 's' : ''} à « Demandes de RDV à traiter » (à vérifier avant confirmation).`
    : 'Aucune nouvelle demande créée.']
  const created = items.filter((i) => i.outcome === 'created')
  const byKind = REQUEST_KINDS.map((k) => [k, created.filter((i) => (i.kind || 'new') === k).length]).filter(([, count]) => count)
  if (byKind.length) lines.push(`Types : ${byKind.map(([k, count]) => `${REQUEST_KIND_LABELS[k]} × ${count}`).join(', ')} — tous « À vérifier ».`)
  const skipped = items.filter((i) => i.outcome !== 'created')
  if (skipped.length) lines.push(`Non ajouté${skipped.length > 1 ? 's' : ''} : ${skipped.map((i) => `n°${i.n} (${OUTCOME_LABELS[i.outcome] || i.outcome})`).join(', ')}.`)
  lines.push('Aucun rendez-vous n’a été confirmé, modifié ou annulé, aucun message envoyé, aucun agenda modifié.')
  return lines.join('\n')
}

// ── Accès base ──────────────────────────────────────────────────────────────

async function resolvePractitioner(db, userId, env) {
  const { data, error } = await db.from('booking_practitioners').select('id, slug').eq('owner_id', userId)
  if (error) throw new Error('practitioner_lookup_failed')
  const rows = data || []
  const slug = String(env.LUMIA_INTAKE_PRACTITIONER_SLUG || DEFAULT_PRACTITIONER_SLUG).trim()
  const chosen = rows.find((p) => p.slug === slug) || (rows.length === 1 ? rows[0] : null)
  return chosen ? { ...chosen, owner_practitioner_ids: rows.map((p) => p.id) } : null
}

async function loadExisting(db, practitionerId, conversations, rows, now, ownerPractitionerIds = [practitionerId]) {
  const convIds = [...new Set(conversations.map((c) => c.conversation_id).filter(Boolean))]
  const requests = []
  for (let i = 0; i < convIds.length; i += 100) {
    const { data, error } = await db.from('booking_requests')
      .select('id, status, source_channel, source_conversation_id, source_message_at, created_at, confirmed_booking_id, customer_phone')
      .eq('practitioner_id', practitionerId).not('intake_agent', 'is', null)
      .in('source_conversation_id', convIds.slice(i, i + 100))
    if (error) throw new Error('requests_lookup_failed')
    requests.push(...(data || []))
  }
  const messageIds = [...new Set(rows.map((r) => r.source_message_id))]
  const events = []
  for (let i = 0; i < messageIds.length; i += 100) {
    const { data, error } = await db.from('booking_request_intake_events')
      .select('request_id, source_channel, source_message_id')
      .in('source_message_id', messageIds.slice(i, i + 100))
    if (error) throw new Error('events_lookup_failed')
    events.push(...(data || []))
  }
  const phones = new Set(conversations.map((c) => c.counterpart).filter((h) => h?.startsWith('+')))
  const phoneRequests = new Map()
  const upcoming = new Map()
  if (phones.size) {
    const { data: open, error: openError } = await db.from('booking_requests')
      .select('id, status, customer_phone, confirmed_booking_id')
      .eq('practitioner_id', practitionerId).in('status', OPEN_STATUSES).is('confirmed_booking_id', null)
      .not('customer_phone', 'is', null).limit(1000)
    if (openError) throw new Error('open_requests_lookup_failed')
    for (const r of open || []) {
      const phone = normalizePhone(r.customer_phone)
      if (phone && phones.has(phone) && !phoneRequests.has(phone)) phoneRequests.set(phone, r)
    }
    // Lecture seule : tous les praticiens du propriétaire (un rendez-vous à annuler
    // peut être sur un autre profil). Aucun rendez-vous n'est jamais modifié ici.
    const { data: bookings, error: bookingError } = await db.from('bookings')
      .select('id, practitioner_id, starts_at, customer_phone')
      .in('practitioner_id', ownerPractitionerIds).eq('status', 'confirmed').gte('starts_at', now.toISOString())
      .not('customer_phone', 'is', null).order('starts_at', { ascending: true }).limit(1000)
    if (bookingError) throw new Error('bookings_lookup_failed')
    for (const b of [...(bookings || [])].sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at)))) {
      const phone = normalizePhone(b.customer_phone)
      if (phone && phones.has(phone)) upcoming.set(phone, [...(upcoming.get(phone) || []), b])
    }
  }
  return { requests, events, phoneRequests, upcoming }
}

function groupByConversation(rows) {
  const groups = new Map()
  for (const r of rows) {
    const key = r.source_conversation_id ? `${r.source_channel}:${r.source_conversation_id}` : `msg:${r.source_channel}:${r.source_message_id}`
    const g = groups.get(key) || { key, channel: r.source_channel, conversation_id: r.source_conversation_id || null, counterpart: r.counterpart || r.sender || null, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()]
}

async function expireActivePreviews(db, userId, conversationId) {
  const { data } = await db.from('lumia_action_intents').update({ status: 'expired', expired_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('owner_id', userId).eq('conversation_id', conversationId)
    .eq('action_type', LUMIA_REQUEST_IMPORT_ACTION).eq('status', 'preview')
    .select('id')
  if (data?.length) {
    await db.from('lumia_action_attempts').insert(data.map((row) => ({
      intent_id: row.id, owner_id: userId, event_type: 'expired', actor_type: 'server', actor_id: null, detail: { reason: 'superseded' },
    })))
  }
}

export async function scanAndPreview({ db, userId, conversationId, message, check = false, env = process.env, now = new Date() }) {
  const practitioner = await resolvePractitioner(db, userId, env)
  if (!practitioner) return { reply: 'Je ne trouve pas l’espace praticien auquel ajouter les demandes. Aucune action n’a été créée.' }
  const criteria = importCriteria(message, now)
  const rows = await searchLumiaInbox({
    db, ownerId: userId, from: criteria.from, to: criteria.to,
    floorIso: criteria.explicit ? null : undefined,
    channel: criteria.channel,
    classifications: ['probable', 'incertain'],
    now,
  })
  // Garde-fou : sans identifiant source, ni import ni dédoublonnage fiables → écarté.
  const unusable = rows.filter((r) => !hasValidSource(r)).length
  const conversations = groupByConversation(rows.filter(hasValidSource))
  if (unusable && !conversations.length) {
    return { reply: `Analyse impossible : ${unusable} message(s) sans identifiant source fiable. Aucune proposition n’a été créée et rien n’a été modifié.`, error: 'source_id_missing' }
  }
  if (!conversations.length) {
    return { reply: `Analyse des messages — ${criteria.label} : aucune demande de rendez-vous détectée (messages reçus classés probable ou incertain). Rien n’a été modifié.` }
  }
  // Suivi des réponses visibles (informatif seulement).
  const { data: outgoing } = await db.from('lumia_message_inbox').select('message_sent_at').eq('owner_id', userId).eq('is_from_me', true)
    .order('message_sent_at', { ascending: true }).limit(1)
  const threads = await loadThreads(db, userId, conversations.map((c) => c.conversation_id), criteria.from)
  const replies = computeReplies(threads.length ? threads : rows, { outgoingFrom: outgoing?.[0]?.message_sent_at || null })
  for (const c of conversations) c.rdv_status = replies.conversations.get(c.conversation_id)?.rdv?.rdv_status ?? null

  const existing = await loadExisting(db, practitioner.id, conversations, rows, now, practitioner.owner_practitioner_ids)
  const result = classifyImportCandidates({ conversations, ...existing })
  const audit = check ? auditDuplicates({ conversations, requests: existing.requests, events: existing.events }) : null
  const names = await counterpartNames(db, userId, [...new Set(conversations.map((c) => c.counterpart).filter(Boolean))].slice(0, 300))
  const truncated = result.proposed.length > MAX_IMPORT_ITEMS
  result.proposed = result.proposed.slice(0, MAX_IMPORT_ITEMS)

  let intent = null
  if (result.proposed.length) {
    const items = result.proposed.map((c, i) => buildImportItem(c, i + 1))
    if (!items.every(isValidImportItem)) {
      return { reply: 'Je n’ai pas pu préparer une liste fiable (identifiant de message manquant). Aucune demande n’a été créée.', error: 'invalid_import_item' }
    }
    const payload = { version: 1, period: { from: criteria.from, to: criteria.to }, items }
    // Preview : compteurs et repères minimaux, aucun texte de message.
    const preview = {
      action: 'ajouter_demandes_a_traiter',
      period: criteria.label,
      proposed: items.length,
      existing: result.existing.length,
      items: result.proposed.map((c, i) => ({ n: i + 1, type: c.kind || 'new', canal: c.channel, interlocuteur: c.counterpart, dernier_message: c.fresh.at(-1).message_sent_at, rendez_vous: c.related?.match || null })),
      effects: { booking_created: false, booking_modified: false, calendar_written: false, message_sent: false, existing_requests_modified: false },
    }
    await expireActivePreviews(db, userId, conversationId)
    const created = await db.rpc('lumia_create_action_intent', {
      p_owner_id: userId,
      p_agent_id: LUMIA_RDV_AGENT_ID,
      p_conversation_id: conversationId,
      p_practitioner_id: practitioner.id,
      p_action_type: LUMIA_REQUEST_IMPORT_ACTION,
      p_target_source: 'none',
      p_target_id: null,
      p_expected_version: null,
      p_expected_target_updated_at: null,
      p_target_google_etag: null,
      p_canonical_payload: payload,
      p_preview: preview,
      p_preview_expires_at: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
      p_idempotency_key: `import:${randomUUID()}`,
    })
    if (created.error) return { reply: 'Je n’ai pas pu préparer la liste à valider. Aucune demande n’a été créée.', error: 'preview_unavailable' }
    intent = created.data
  }
  return {
    reply: formatScanReply({ criteria, scanned: rows.length - unusable, conversations: conversations.length, result, intent, names, truncated, audit })
      + (unusable ? `\n(${unusable} message(s) écarté(s) : identifiant source manquant.)` : ''),
    intent,
    counts: { proposed: result.proposed.length, existing: result.existing.length },
    audit,
  }
}

async function activeImportIntents(db, userId, conversationId, shortCode) {
  let query = db.from('lumia_action_intents')
    .select('id, short_code, status, idempotency_key, canonical_payload, preview_expires_at, action_type')
    .eq('owner_id', userId).eq('conversation_id', conversationId)
    .eq('action_type', LUMIA_REQUEST_IMPORT_ACTION)
    .order('created_at', { ascending: false }).limit(3)
  if (shortCode) query = query.eq('short_code', shortCode)
  else query = query.in('status', ['preview', 'approved', 'executing']).gt('preview_expires_at', new Date().toISOString())
  const { data, error } = await query
  if (error) throw new Error('intent_lookup_failed')
  return data || []
}

async function otherActiveIntentCount(db, userId, conversationId) {
  const { data } = await db.from('lumia_action_intents').select('id')
    .eq('owner_id', userId).eq('conversation_id', conversationId)
    .neq('action_type', LUMIA_REQUEST_IMPORT_ACTION)
    .in('status', ['preview', 'approved']).gt('preview_expires_at', new Date().toISOString()).limit(2)
  return (data || []).length
}

export async function approveAndExecute({ db, userId, conversationId, parsed }) {
  const found = await activeImportIntents(db, userId, conversationId, parsed.shortCode)
  if (!found.length) return null // pas un GO d'import : l'annulation peut le traiter
  if (!parsed.shortCode && (found.length > 1 || await otherActiveIntentCount(db, userId, conversationId))) {
    return { reply: 'Plusieurs actions attendent ta validation. Donne-moi le code exact, par exemple « GO #A1B2C3 ».' }
  }
  const intent = found[0]
  const count = Array.isArray(intent.canonical_payload?.items) ? intent.canonical_payload.items.length : 0
  const selection = parsed.selection.all ? Array.from({ length: count }, (_, i) => i + 1) : parsed.selection.numbers
  if (!selection.length || selection.some((n) => n < 1 || n > count)) {
    return { reply: `Numéros invalides : choisis entre 1 et ${count} (par exemple « GO ${intent.short_code} 1,3 »). Rien n’a été modifié.` }
  }
  const gate = authorizeLumiaAction(LUMIA_REQUEST_IMPORT_ACTION, { idempotencyKey: intent.idempotency_key, maxPerRun: MAX_IMPORT_ITEMS, validatedBy: userId })
  if (!gate.allowed || selection.length > MAX_IMPORT_ITEMS) return { reply: `Ajout refusé (${gate.reason || 'trop de dossiers'}). Rien n’a été modifié.` }

  if (intent.status === 'preview') {
    const approved = await db.rpc('lumia_approve_action_intent', { p_owner_id: userId, p_conversation_id: conversationId, p_intent_id: intent.id })
    if (approved.error || approved.data?.status !== 'approved') {
      return { reply: formatExecutionReply({ status: 'failed', reason: approved.data?.reason || 'approval_refused' }) }
    }
  }
  if (['preview', 'approved'].includes(intent.status)) {
    const claimed = await db.rpc('lumia_claim_action_execution', {
      p_owner_id: userId, p_conversation_id: conversationId, p_intent_id: intent.id, p_executor_name: LUMIA_REQUEST_IMPORT_EXECUTOR,
    })
    if (claimed.error || !['executing', 'succeeded', 'failed'].includes(claimed.data?.status)) {
      return { reply: formatExecutionReply({ status: 'failed', reason: claimed.data?.reason || 'claim_refused' }) }
    }
  }
  const executed = await db.rpc('lumia_execute_booking_request_import', {
    p_owner_id: userId, p_conversation_id: conversationId, p_intent_id: intent.id, p_selection: selection,
  })
  if (executed.error) return { reply: 'L’ajout n’a pas pu être exécuté. Aucune demande n’a été créée.', error: 'execution_unavailable' }
  return { reply: formatExecutionReply(executed.data), result: executed.data }
}

// ── Point d'entrée du chat Lumia ────────────────────────────────────────────

export async function maybeHandleLumiaRequestImportChat({ db, userId, conversationId, message, env = process.env, now = new Date() }) {
  if (!LUMIA_ALLOWED_ACTIONS.includes(LUMIA_REQUEST_IMPORT_ACTION)) return null
  const parsed = parseRequestImportCommand(message)
  if (parsed.kind === 'none') return null
  if (!requestImportEnabled(env)) {
    if (parsed.kind === 'approve') return null
    return { handled: true, reply: 'L’ajout de demandes depuis les messages n’est pas encore activé sur ce site. Je peux seulement les lister ; rien n’a été modifié.' }
  }
  if (parsed.kind === 'approve') {
    const done = await approveAndExecute({ db, userId, conversationId, parsed })
    return done ? { handled: true, ...done } : null
  }
  const scanned = await scanAndPreview({ db, userId, conversationId, message, check: Boolean(parsed.check), env, now })
  return { handled: true, ...scanned }
}
