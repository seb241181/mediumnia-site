/* global process */
/**
 * Lumia Intake — entrée générique des demandes de rendez-vous détectées dans
 * des messages (SMS, iMessage, WhatsApp, Dots, ChatGPT, e-mail…).
 *
 *   Canal → agent (Lumia aujourd'hui, un autre demain) → cette API → MediumIA
 *
 * MediumIA est la source de vérité : une demande devient une ligne
 * booking_requests en statut « pending ». Ce module ne crée JAMAIS de booking
 * et n'appelle JAMAIS Google (ni Calendar, ni aucune autre API Google). La
 * confirmation se fait ensuite par le flux existant de l'espace RDV
 * (action=requests status=scheduled → confirm_booking_request →
 * syncBookingToGoogleCalendar).
 *
 * Authentification : jeton dédié LUMIA_INTAKE_TOKEN (variable d'environnement,
 * jamais dans Git), envoyé en « Authorization: Bearer … ». Il ne donne accès
 * qu'à deux opérations (importer une demande, lister les prestations) et
 * qu'au praticien fixé côté serveur (LUMIA_INTAKE_PRACTITIONER_SLUG). Aucune
 * clé Supabase, PayPal, Google ou Resend n'est jamais transmise à l'agent.
 *
 * Phase 1 : aucune confirmation automatique. AUTO_CONFIRM_ENABLED reste false ;
 * une phase ultérieure pourra s'appuyer sur proposed_starts_at + service_id
 * pour appeler le même flux de confirmation que l'espace RDV.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

export const AUTO_CONFIRM_ENABLED = false
export const LUMIA_CHANNELS = ['sms', 'imessage', 'whatsapp', 'dots', 'chatgpt', 'email', 'form', 'other']
export const LUMIA_MODALITIES = ['video', 'in-person', 'phone', 'unknown']
const DEFAULT_PRACTITIONER_SLUG = 'sebastien-seguin'
const MESSAGE_ID_RE = /^[A-Za-z0-9._:@+/=-]{1,200}$/
const AGENT_RE = /^[a-z0-9_-]{1,32}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_TEXT = 2000
const MAX_HORIZON_MS = 400 * 86_400_000

// ── Authentification dédiée ─────────────────────────────────────────────────

const digest = (value) => createHash('sha256').update(String(value)).digest()

export function authenticateLumia(req, env = process.env) {
  const expected = String(env.LUMIA_INTAKE_TOKEN || '')
  if (expected.length < 32) return { ok: false, status: 503, error: 'lumia_not_configured' }
  const header = String(req.headers?.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return { ok: false, status: 401, error: 'unauthorized' }
  // Comparaison à temps constant sur les empreintes (longueurs égales).
  if (!timingSafeEqual(digest(match[1].trim()), digest(expected))) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true }
}

// ── Normalisations (identiques à la fonction SQL lumia_normalize_phone) ──────

export function normalizePhone(phone) {
  const d = String(phone || '').replace(/[^0-9+]/g, '')
  if (/^0[1-9]\d{8}$/.test(d)) return `+33${d.slice(1)}`
  if (/^0033[1-9]\d{8}$/.test(d)) return `+33${d.slice(4)}`
  if (/^\+33[1-9]\d{8}$/.test(d)) return d
  if (/^\+[1-9]\d{6,14}$/.test(d)) return d
  return null
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const clean = (value, max) => {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return text ? text.slice(0, max) : null
}

// Date + heure locales à Paris → instant UTC (gère heure d'été / d'hiver).
function parisOffsetMinutes(date) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT+0'
  const m = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0))
}

export function parisLocalToUtc(dateStr, timeStr) {
  if (!DATE_RE.test(dateStr || '') || !TIME_RE.test(timeStr || '')) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  if (new Date(naive).getUTCDate() !== d) return null // date impossible (31/02…)
  let utc = naive - parisOffsetMinutes(new Date(naive)) * 60_000
  utc = naive - parisOffsetMinutes(new Date(utc)) * 60_000
  return new Date(utc)
}

// ── Prestation : jamais inventée ────────────────────────────────────────────
//
// 1. un identifiant envoyé par l'agent n'est retenu que s'il correspond à une
//    prestation active de ce praticien ;
// 2. sinon, l'indice texte (« guidance », « désenvoûtement »…) n'est retenu que
//    s'il désigne une seule prestation (après filtre éventuel par modalité) ;
// 3. sinon : aucune prestation, demande à vérifier.

export function resolveService({ services = [], serviceId = null, hint = null, modality = 'unknown' }) {
  const active = services.filter((s) => s && s.is_active !== false)
  if (serviceId) {
    const found = active.find((s) => s.id === serviceId)
    if (found) return { service: found, resolution: 'id' }
    if (!hint) return { service: null, resolution: 'unknown_id' }
  }
  const needle = normalizeText(hint)
  if (needle.length < 3) return { service: null, resolution: serviceId ? 'unknown_id' : 'none' }
  let candidates = active.filter((s) => {
    const title = normalizeText(s.title)
    const slug = normalizeText(s.slug)
    return title.includes(needle) || slug.includes(needle) || (title.length >= 3 && needle.includes(title))
  })
  if (candidates.length > 1 && modality && modality !== 'unknown') {
    const byModality = candidates.filter((s) => Array.isArray(s.modality) && s.modality.includes(modality))
    if (byModality.length) candidates = byModality
  }
  if (candidates.length === 1) return { service: candidates[0], resolution: 'hint' }
  return { service: null, resolution: candidates.length > 1 ? 'ambiguous' : 'none' }
}

// ── Validation de la charge utile ───────────────────────────────────────────

function isoOrNull(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function validateIntake(body = {}, now = new Date()) {
  const errors = []
  const channel = String(body.source_channel || '').toLowerCase()
  if (!LUMIA_CHANNELS.includes(channel)) errors.push('source_channel')
  const messageId = String(body.source_message_id || '')
  if (!MESSAGE_ID_RE.test(messageId)) errors.push('source_message_id')
  const conversationId = body.source_conversation_id == null || body.source_conversation_id === '' ? null : String(body.source_conversation_id)
  if (conversationId && !MESSAGE_ID_RE.test(conversationId)) errors.push('source_conversation_id')
  const agent = String(body.agent || 'lumia').toLowerCase()
  if (!AGENT_RE.test(agent)) errors.push('agent')
  const messageAt = isoOrNull(body.message_sent_at)
  if (messageAt === undefined) errors.push('message_sent_at')
  const detectedAt = isoOrNull(body.detected_at)
  if (detectedAt === undefined) errors.push('detected_at')

  const modality = String(body.modality || 'unknown').toLowerCase()
  if (!LUMIA_MODALITIES.includes(modality)) errors.push('modality')

  const email = clean(body.email, 254)?.toLowerCase() || null
  if (email && !EMAIL_RE.test(email)) errors.push('email')
  const rawPhone = clean(body.phone, 40)
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) errors.push('phone')

  const serviceId = body.service_id ? String(body.service_id) : null
  if (serviceId && !UUID_RE.test(serviceId)) errors.push('service_id')

  if (body.requested_date && !DATE_RE.test(String(body.requested_date))) errors.push('requested_date')
  if (body.requested_time && !TIME_RE.test(String(body.requested_time))) errors.push('requested_time')

  let confidence = null
  if (body.confidence != null && body.confidence !== '') {
    confidence = Number(body.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push('confidence')
  }

  if (errors.length) return { errors }

  // Créneau précis : seulement date + heure valides, dans le futur, horizon raisonnable.
  let proposedStartsAt = null
  if (body.requested_date && body.requested_time) {
    const at = parisLocalToUtc(String(body.requested_date), String(body.requested_time))
    if (at && at.getTime() > now.getTime() && at.getTime() < now.getTime() + MAX_HORIZON_MS) proposedStartsAt = at.toISOString()
  }
  // Souhait lisible : période indiquée, sinon la date (et l'heure) demandées.
  let period = clean(body.requested_period, 200)
  if (!period && body.requested_date) {
    const at = parisLocalToUtc(String(body.requested_date), String(body.requested_time || '12:00'))
    if (at) {
      const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(at)
      period = body.requested_time ? `${day} à ${String(body.requested_time).replace(':', ' h ')}` : `${day} (heure à définir)`
    }
  }

  return {
    payload: {
      agent,
      channel,
      message_id: messageId,
      conversation_id: conversationId,
      message_at: messageAt,
      detected_at: detectedAt || now.toISOString(),
      first_name: clean(body.first_name, 80),
      last_name: clean(body.last_name, 80),
      phone,
      email,
      message_text: clean(body.message_text, MAX_TEXT),
      service_id: serviceId,
      service_hint: clean(body.service_hint, 120),
      modality,
      preferred_period: period,
      proposed_starts_at: proposedStartsAt,
      confidence,
    },
  }
}

function missingFields(payload, service) {
  const missing = []
  if (!service) missing.push('service')
  if (!payload.first_name) missing.push('first_name')
  if (!payload.last_name) missing.push('last_name')
  if (!payload.email) missing.push('email')
  if (!payload.phone) missing.push('phone')
  if (!payload.proposed_starts_at && !payload.preferred_period) missing.push('wish')
  return missing
}

// ── Opérations ──────────────────────────────────────────────────────────────

async function loadPractitioner(supabase, env) {
  const slug = String(env.LUMIA_INTAKE_PRACTITIONER_SLUG || DEFAULT_PRACTITIONER_SLUG).trim()
  const { data } = await supabase.from('booking_practitioners').select('id, slug').eq('slug', slug).maybeSingle()
  return data || null
}

async function loadServices(supabase, practitionerId) {
  const { data, error } = await supabase
    .from('booking_services')
    .select('id, slug, title, modality, duration_min, price_cents, is_active')
    .eq('practitioner_id', practitionerId)
    .eq('is_active', true)
  if (error) throw new Error('services_lookup_failed')
  return data || []
}

export async function lumiaListServices({ supabase, env = process.env }) {
  const practitioner = await loadPractitioner(supabase, env)
  if (!practitioner) return { status: 503, body: { error: 'practitioner_not_found' } }
  const services = await loadServices(supabase, practitioner.id)
  return {
    status: 200,
    body: {
      services: services.map(({ id, slug, title, modality, duration_min, price_cents }) => ({ id, slug, title, modality, duration_min, price_cents })),
    },
  }
}

export async function lumiaIntake({ supabase, body = {}, env = process.env, now = new Date() }) {
  const { errors, payload } = validateIntake(body, now)
  if (errors) return { status: 400, body: { error: 'invalid_intake', fields: errors } }

  const practitioner = await loadPractitioner(supabase, env)
  if (!practitioner) return { status: 503, body: { error: 'practitioner_not_found' } }

  let services
  try {
    services = await loadServices(supabase, practitioner.id)
  } catch {
    return { status: 503, body: { error: 'services_lookup_failed' } }
  }
  const { service, resolution } = resolveService({ services, serviceId: payload.service_id, hint: payload.service_hint, modality: payload.modality })
  // Un identifiant inconnu n'est jamais enregistré : on garde l'indice texte.
  const stored = { ...payload, service_id: service?.id || null, missing: missingFields(payload, service) }

  const { data, error } = await supabase.rpc('lumia_upsert_booking_request', {
    p_practitioner_id: practitioner.id,
    p_payload: stored,
  })
  if (error?.code === 'PGRST202' || error?.code === '42883') return { status: 503, body: { error: 'migration_pending' } }
  if (error || !data) return { status: 500, body: { error: 'intake_failed' } }
  if (!data.ok) return { status: 400, body: { error: data.error || 'invalid_intake' } }

  return {
    status: data.outcome === 'created' ? 201 : 200,
    body: {
      request_id: data.request_id,
      outcome: data.outcome, // created | updated | duplicate
      status: 'pending',
      service: service ? { id: service.id, title: service.title } : null,
      service_resolution: resolution, // id | hint | ambiguous | unknown_id | none
      customer_match: data.customer_match ?? null,
      needs_review: data.needs_review ?? null,
      proposed_starts_at: payload.proposed_starts_at,
      // Garanties du flux : rien d'autre n'est créé à l'import.
      booking_created: false,
      calendar_written: false,
    },
  }
}

// Point d'entrée appelé par api/rdv-admin.js avant toute authentification
// Supabase (l'agent n'a pas de compte utilisateur).
export async function handleLumiaApi({ req, action, env = process.env, supabase = null, now = new Date() }) {
  const auth = authenticateLumia(req, env)
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } }
  if (!supabase && !isSupabaseConfigured()) return { status: 503, body: { error: 'supabase_not_configured' } }
  const db = supabase || getSupabaseAdmin()
  if (action === 'lumia-services') {
    if (req.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } }
    return lumiaListServices({ supabase: db, env })
  }
  if (action === 'lumia-rdv-intake') {
    if (req.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }
    return lumiaIntake({ supabase: db, body: req.body || {}, env, now })
  }
  return { status: 400, body: { error: 'invalid_action' } }
}
