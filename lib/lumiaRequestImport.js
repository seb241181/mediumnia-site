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
const PREVIEW_TTL_MS = 30 * 60 * 1000
const DEFAULT_DAYS = 14
const MESSAGE_IDS_PER_ITEM = 5
const EXCERPT_CHARS = 140
const DEFAULT_PRACTITIONER_SLUG = 'sebastien-seguin'
const OPEN_STATUSES = ['pending', 'contacted']
const CHANNEL_LABELS = { sms: 'SMS', imessage: 'iMessage', rcs: 'RCS' }
const STATUS_LABELS = {
  pending: 'déjà dans « Demandes de RDV à traiter »',
  contacted: 'déjà dans « À suivre »',
  scheduled: 'dossier déjà planifié',
  handled: 'dossier déjà traité (archivé)',
  rejected: 'dossier déjà refusé',
  cancelled: 'dossier déjà annulé',
}

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

  const aboutMessages = /\b(messages?|sms|imessages?|rcs|textos?|conversations?)\b/.test(n)
  const importVerb = /\b(ajout\w*|integr\w*|import\w*|enregistr\w*|inscri\w*|complet\w*|mets?|mettre|met|report\w*|transfer\w*|rajout\w*|verse\w*)\b/.test(n)
  const target = /\b(a traiter|liste|demandes? de (rdv|rendez vous))\b/.test(n)
  const missing = /\bpas encore (dans|enregistr\w*)\b/.test(n) && /\b(liste|mediumia|demandes?)\b/.test(n)
  if (aboutMessages && ((importVerb && target) || missing)) return { kind: 'scan' }
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

// ── Rapprochement avec MediumIA (fonction pure, testée) ─────────────────────
//
// conversations : [{ key, channel, conversation_id, counterpart, rows (RDV, période) }]
// requests      : demandes d'agent de ces conversations (tous statuts)
// events        : booking_request_intake_events des messages concernés
// phoneRequests : demandes ouvertes (tous canaux) indexées par téléphone normalisé
// upcoming      : rendez-vous confirmés à venir indexés par téléphone normalisé

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
    const base = { ...c, rows, latest_request: latest, upcoming_booking: (phone && upcoming.get(phone)) || null }

    if (latest && OPEN_STATUSES.includes(latest.status) && !latest.confirmed_booking_id) {
      out.existing.push({ ...base, reason: latest.status, request_id: latest.id })
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
    out.proposed.push({ ...base, fresh, previous_request: latest })
  }
  // Probables d'abord, puis les plus récents.
  const levelRank = (c) => (c.fresh.some((r) => r.classification === 'probable') ? 0 : 1)
  out.proposed.sort((a, b) => (levelRank(a) - levelRank(b)) || String(b.fresh.at(-1).message_sent_at).localeCompare(String(a.fresh.at(-1).message_sent_at)))
  return out
}

// Élément immuable du preview : références serveur, aucun texte client.
export function buildImportItem(candidate, n) {
  const fresh = candidate.fresh.slice(-MESSAGE_IDS_PER_ITEM)
  const anchor = fresh.at(-1)
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
  return `- ${whoLabel(c, names)} · ${CHANNEL_LABELS[c.channel] || c.channel} — ${reason}`
}

function proposedLines(c, n, names) {
  const last = c.fresh.at(-1)
  const level = c.fresh.some((r) => r.classification === 'probable') ? 'probable' : 'à vérifier (incertain)'
  const intents = [...new Set(c.fresh.flatMap((r) => messageIntents(r.message_text)))]
  const flags = []
  if (c.previous_request) flags.push(`nouveau message après un ${STATUS_LABELS[c.previous_request.status] || 'dossier précédent'}`)
  if (c.upcoming_booking) flags.push(`rendez-vous déjà prévu ${parisLabel(c.upcoming_booking.starts_at)}`)
  if (c.rdv_status === 'repondu') flags.push('réponse visible de Sébastien')
  const head = `${n}. ${whoLabel(c, names)} · ${CHANNEL_LABELS[c.channel] || c.channel} · ${level}`
    + `${intents.length ? ` · ${intents.join(', ')}` : ''} · ${parisLabel(last.message_sent_at)}`
  return [head, `   « ${shortText(last.message_text, EXCERPT_CHARS)} »`, ...(flags.length ? [`   ⚠︎ ${flags.join(' ; ')}`] : [])]
}

export function formatScanReply({ criteria, scanned, conversations, result, intent, names, truncated }) {
  const lines = [`Analyse des messages professionnels — ${criteria.defaulted ? `${criteria.label} (aucune période précisée)` : criteria.label}`
    + `${criteria.channel ? ` · ${CHANNEL_LABELS[criteria.channel]}` : ' · SMS, iMessage, RCS'}`]
  lines.push(`${scanned} message${scanned > 1 ? 's' : ''} de demande de rendez-vous (probable ou incertain) dans ${conversations} conversation${conversations > 1 ? 's' : ''}. Les messages personnels ne sont pas lus.`)
  if (result.existing.length) {
    lines.push('', `Déjà dans MediumIA (${result.existing.length}, rien à faire) :`)
    for (const c of result.existing.slice(0, 15)) lines.push(existingLine(c, names))
    if (result.existing.length > 15) lines.push(`- … et ${result.existing.length - 15} autre(s).`)
  }
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
    `Pour n’en ajouter que certains : GO ${intent.short_code} 1,3`,
    'Les demandes seront créées « à vérifier » : aucun rendez-vous confirmé, aucun message envoyé, aucun agenda modifié. Proposition valable 30 minutes.',
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
  const skipped = items.filter((i) => i.outcome !== 'created')
  if (skipped.length) lines.push(`Non ajouté${skipped.length > 1 ? 's' : ''} : ${skipped.map((i) => `n°${i.n} (${OUTCOME_LABELS[i.outcome] || i.outcome})`).join(', ')}.`)
  lines.push('Aucun rendez-vous n’a été confirmé, aucun message envoyé, aucun agenda modifié.')
  return lines.join('\n')
}

// ── Accès base ──────────────────────────────────────────────────────────────

async function resolvePractitioner(db, userId, env) {
  const { data, error } = await db.from('booking_practitioners').select('id, slug').eq('owner_id', userId)
  if (error) throw new Error('practitioner_lookup_failed')
  const rows = data || []
  const slug = String(env.LUMIA_INTAKE_PRACTITIONER_SLUG || DEFAULT_PRACTITIONER_SLUG).trim()
  return rows.find((p) => p.slug === slug) || (rows.length === 1 ? rows[0] : null)
}

async function loadExisting(db, practitionerId, conversations, rows, now) {
  const convIds = [...new Set(conversations.map((c) => c.conversation_id).filter(Boolean))]
  const requests = []
  for (let i = 0; i < convIds.length; i += 100) {
    const { data, error } = await db.from('booking_requests')
      .select('id, status, source_channel, source_conversation_id, source_message_at, created_at, confirmed_booking_id')
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
    const { data: bookings, error: bookingError } = await db.from('bookings')
      .select('id, starts_at, customer_phone')
      .eq('practitioner_id', practitionerId).eq('status', 'confirmed').gte('starts_at', now.toISOString())
      .not('customer_phone', 'is', null).order('starts_at', { ascending: true }).limit(1000)
    if (bookingError) throw new Error('bookings_lookup_failed')
    for (const b of bookings || []) {
      const phone = normalizePhone(b.customer_phone)
      if (phone && phones.has(phone) && !upcoming.has(phone)) upcoming.set(phone, b)
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

export async function scanAndPreview({ db, userId, conversationId, message, env = process.env, now = new Date() }) {
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
  const conversations = groupByConversation(rows)
  if (!conversations.length) {
    return { reply: `Analyse des messages — ${criteria.label} : aucune demande de rendez-vous détectée (messages reçus classés probable ou incertain). Rien n’a été modifié.` }
  }
  // Suivi des réponses visibles (informatif seulement).
  const { data: outgoing } = await db.from('lumia_message_inbox').select('message_sent_at').eq('owner_id', userId).eq('is_from_me', true)
    .order('message_sent_at', { ascending: true }).limit(1)
  const threads = await loadThreads(db, userId, conversations.map((c) => c.conversation_id), criteria.from)
  const replies = computeReplies(threads.length ? threads : rows, { outgoingFrom: outgoing?.[0]?.message_sent_at || null })
  for (const c of conversations) c.rdv_status = replies.conversations.get(c.conversation_id)?.rdv?.rdv_status ?? null

  const existing = await loadExisting(db, practitioner.id, conversations, rows, now)
  const result = classifyImportCandidates({ conversations, ...existing })
  const names = await counterpartNames(db, userId, [...new Set(conversations.map((c) => c.counterpart).filter(Boolean))].slice(0, 300))
  const truncated = result.proposed.length > MAX_IMPORT_ITEMS
  result.proposed = result.proposed.slice(0, MAX_IMPORT_ITEMS)

  let intent = null
  if (result.proposed.length) {
    const items = result.proposed.map((c, i) => buildImportItem(c, i + 1))
    const payload = { version: 1, period: { from: criteria.from, to: criteria.to }, items }
    // Preview : compteurs et repères minimaux, aucun texte de message.
    const preview = {
      action: 'ajouter_demandes_a_traiter',
      period: criteria.label,
      proposed: items.length,
      existing: result.existing.length,
      items: result.proposed.map((c, i) => ({ n: i + 1, canal: c.channel, interlocuteur: c.counterpart, dernier_message: c.fresh.at(-1).message_sent_at })),
      effects: { booking_created: false, calendar_written: false, message_sent: false, existing_requests_modified: false },
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
    reply: formatScanReply({ criteria, scanned: rows.length, conversations: conversations.length, result, intent, names, truncated }),
    intent,
    counts: { proposed: result.proposed.length, existing: result.existing.length },
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
  const scanned = await scanAndPreview({ db, userId, conversationId, message, env, now })
  return { handled: true, ...scanned }
}
