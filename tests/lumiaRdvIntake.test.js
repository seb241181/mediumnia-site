import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeReservioExport, mapReservioCustomer, nameKey, RESERVIO_DROPPED_COLUMNS } from '../lib/reservioCustomers.js'
import { requestCalendarSync, videoChannelLabel } from '../lib/requestCalendarEvent.js'
import { syncBookingToGoogleCalendar } from '../lib/googleCalendarEvents.js'
import { encrypt } from '../lib/googleOAuth.js'
import {
  AUTO_CONFIRM_ENABLED,
  authenticateLumia,
  explicitVideoChannel,
  resolveVideoChannel,
  handleLumiaApi,
  normalizePhone,
  parisLocalToUtc,
  resolveService,
  validateIntake,
} from '../lib/lumiaRdvIntake.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Aucune base, aucun réseau réels : Supabase est simulé, fetch interdit.
const TOKEN = 'test-token-lumia-0123456789abcdef0123456789'
const ENV = { LUMIA_INTAKE_TOKEN: TOKEN, LUMIA_INTAKE_PRACTITIONER_SLUG: 'sebastien-seguin' }
const PRACT = 'aaaaaaaa-0000-4000-8000-000000000001'
const NOW = new Date('2026-10-02T08:00:00Z')
const SERVICES = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000001', slug: 'guidance-visio', title: 'Guidance — Visio', modality: ['video'], is_active: true },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', slug: 'guidance-presence', title: 'Guidance — En présence', modality: ['in-person'], is_active: true },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', slug: 'desenvoutement', title: 'Désenvoûtement', modality: ['in-person'], is_active: true },
  { id: 'bbbbbbbb-0000-4000-8000-000000000004', slug: 'degagement-maison', title: 'Dégagement de maison', modality: ['in-person'], is_active: true },
]

// Base simulée : la fonction SQL est émulée avec la même règle d'idempotence
// (canal + identifiant de message) ; toute écriture hors de cette fonction est notée.
function fakeDb() {
  const calls = { rpc: [], tables: [], writes: [] }
  const byMessage = new Map()
  // Demandes stockées, avec la même règle que la fonction SQL pour un message de
  // suivi : coalesce(nouveau, ancien) sur le créneau et le souhait.
  const rows = new Map()
  const byConversation = new Map()
  let seq = 0
  const db = {
    calls,
    rows,
    from(table) {
      calls.tables.push(table)
      const filters = {}
      const q = {
        select() { return q }, eq(k, v) { filters[k] = v; return q }, in() { return q }, order() { return q }, limit() { return q },
        insert() { calls.writes.push(table); return q }, update() { calls.writes.push(table); return q },
        upsert() { calls.writes.push(table); return q }, delete() { calls.writes.push(table); return q },
        maybeSingle() {
          if (table === 'booking_practitioners') return Promise.resolve({ data: { id: PRACT, slug: 'sebastien-seguin' } })
          if (table === 'booking_requests') return Promise.resolve({ data: rows.get(filters.id) || null })
          return Promise.resolve({ data: null })
        },
        single() { return q.maybeSingle() },
        then(ok, ko) { return Promise.resolve(table === 'booking_services' ? { data: SERVICES, error: null } : { data: [] }).then(ok, ko) },
      }
      return q
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (name !== 'lumia_upsert_booking_request') return { data: null, error: { message: 'unexpected rpc' } }
      await new Promise((r) => setTimeout(r, 5))
      const p = args.p_payload
      const key = `${p.channel}:${p.message_id}`
      if (byMessage.has(key)) return { data: { ok: true, outcome: 'duplicate', request_id: byMessage.get(key) } }
      const convKey = p.conversation_id ? `${p.channel}:${p.conversation_id}` : null
      if (convKey && byConversation.has(convKey)) {
        const id = byConversation.get(convKey)
        const row = rows.get(id)
        rows.set(id, { proposed_starts_at: p.proposed_starts_at ?? row.proposed_starts_at, preferred_period: p.preferred_period ?? row.preferred_period })
        byMessage.set(key, id)
        return { data: { ok: true, outcome: 'updated', request_id: id, customer_match: 'none', needs_review: true } }
      }
      const id = `req-${++seq}`
      byMessage.set(key, id)
      if (convKey) byConversation.set(convKey, id)
      // Postgres renvoie un timestamptz au format « +00:00 ».
      rows.set(id, { proposed_starts_at: p.proposed_starts_at ? p.proposed_starts_at.replace('.000Z', '+00:00') : null, preferred_period: p.preferred_period })
      return { data: { ok: true, outcome: 'created', request_id: id, customer_match: 'none', needs_review: !p.service_id } }
    },
  }
  return db
}

const req = (body, { token = TOKEN, method = 'POST' } = {}) => ({ method, headers: { authorization: `Bearer ${token}` }, body })
const sms = (over = {}) => ({ source_channel: 'sms', source_message_id: 'SMS-1', message_text: 'Bonjour, je voudrais reprendre un rendez-vous avec Sébastien.', first_name: 'Inconnue', phone: '06 00 00 00 01', ...over })
const intake = (db, body, opts) => handleLumiaApi({ req: req(body, opts), action: 'lumia-rdv-intake', env: ENV, supabase: db, now: NOW })

function forbidNetwork() {
  const real = globalThis.fetch
  const hits = []
  globalThis.fetch = async (url) => { hits.push(String(url)); throw new Error('réseau interdit dans ce test') }
  return { hits, restore: () => { globalThis.fetch = real } }
}

test('dedicated token: missing configuration, wrong token and right token', async () => {
  assert.deepEqual(authenticateLumia(req({}), {}), { ok: false, status: 503, error: 'lumia_not_configured' })
  assert.equal(authenticateLumia(req({}), { LUMIA_INTAKE_TOKEN: 'court' }).status, 503) // jeton trop court refusé
  assert.equal(authenticateLumia(req({}, { token: 'mauvais' }), ENV).status, 401)
  assert.equal(authenticateLumia({ headers: {} }, ENV).status, 401)
  assert.deepEqual(authenticateLumia(req({}), ENV), { ok: true })
  const db = fakeDb()
  const res = await intake(db, sms(), { token: 'mauvais' })
  assert.equal(res.status, 401)
  assert.equal(db.calls.rpc.length + db.calls.tables.length, 0) // rien n'est lu ni écrit
})

test('only two operations are reachable with the token', async () => {
  const db = fakeDb()
  assert.equal((await handleLumiaApi({ req: req({}, { method: 'GET' }), action: 'requests', env: ENV, supabase: db })).status, 400)
  assert.equal((await handleLumiaApi({ req: req({}, { method: 'GET' }), action: 'lumia-rdv-intake', env: ENV, supabase: db })).status, 405)
  const list = await handleLumiaApi({ req: req({}, { method: 'GET' }), action: 'lumia-services', env: ENV, supabase: db })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.services.map((s) => s.title), SERVICES.map((s) => s.title))
  assert.equal(db.calls.writes.length, 0)
})

test('1. new SMS request → one MediumIA request (pending), never a booking', async () => {
  const db = fakeDb()
  const net = forbidNetwork()
  try {
    const res = await intake(db, sms())
    assert.equal(res.status, 201)
    assert.equal(res.body.outcome, 'created')
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.booking_created, false)
    assert.equal(res.body.calendar_written, false)
    const [{ name, args }] = db.calls.rpc
    assert.equal(name, 'lumia_upsert_booking_request')
    assert.equal(args.p_practitioner_id, PRACT) // praticien fixé côté serveur
    assert.equal(args.p_payload.phone, '+33600000001')
    assert.equal(args.p_payload.agent, 'lumia')
    assert.deepEqual(args.p_payload.missing, ['service', 'last_name', 'email', 'wish'])
    assert.deepEqual(db.calls.writes, []) // aucune écriture directe : tout passe par la fonction SQL
    assert.ok(!db.calls.tables.includes('bookings'))
    assert.deepEqual(net.hits, [])
  } finally { net.restore() }
})

test('2. same message received twice → the same request', async () => {
  const db = fakeDb()
  const a = await intake(db, sms())
  const b = await intake(db, sms({ message_text: 'texte relu autrement' }))
  assert.equal(b.status, 200)
  assert.equal(b.body.outcome, 'duplicate')
  assert.equal(b.body.request_id, a.body.request_id)
  // L'identifiant du message, pas son texte, fait foi : même texte, autre message = autre demande.
  const c = await intake(db, sms({ source_message_id: 'SMS-2' }))
  assert.notEqual(c.body.request_id, a.body.request_id)
})

test('3. two simultaneous calls with the same message → one request', async () => {
  const db = fakeDb()
  const results = await Promise.all([intake(db, sms({ source_message_id: 'RACE' })), intake(db, sms({ source_message_id: 'RACE' }))])
  assert.deepEqual(results.map((r) => r.body.outcome).sort(), ['created', 'duplicate'])
  assert.equal(new Set(results.map((r) => r.body.request_id)).size, 1)
  // La vraie garantie (verrou + clé unique) est vérifiée sur PostgreSQL : supabase/tests/lumia_rdv_intake.
  const sql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('lumia-msg:'/)
  assert.match(sql, /UNIQUE \(source_channel, source_message_id\)/)
})

test('4-6. client matching: phone and email exact only, never by name; doubt = to identify', () => {
  // Même normalisation que la fonction SQL lumia_normalize_phone.
  for (const [input, expected] of [
    ['06 11 22 33 44', '+33611223344'], ['+33 6 11 22 33 44', '+33611223344'], ['0033611223344', '+33611223344'],
    ['06.11.22.33.44', '+33611223344'], ['+32 470 12 34 56', '+32470123456'], ['12', null], ['', null],
  ]) assert.equal(normalizePhone(input), expected, input)
  const sql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  // Sources fiables : référentiel clients, rendez-vous, formulaire du site (normalisés).
  const known = sql.slice(sql.indexOf('FUNCTION public.lumia_known_customers'), sql.indexOf('REVOKE ALL ON FUNCTION public.lumia_known_customers'))
  assert.match(known, /FROM public\.mediumia_customers c/)
  assert.match(known, /public\.lumia_normalize_phone\(b\.customer_phone\)/)
  // Les demandes d'agent (données non vérifiées) ne servent jamais de référence.
  assert.match(known, /r\.intake_agent IS NULL/)
  assert.match(sql, /FROM public\.lumia_known_customers\(p_practitioner_id\) k\s+WHERE k\.phone = v_phone/)
  assert.match(sql, /v_match := 'ambiguous';\s+-- téléphone connu sous une autre adresse/)
  assert.match(sql, /v_match := 'ambiguous';\s+-- numéro partagé par plusieurs clients/)
  assert.match(sql, /Même téléphone mais prénom différent/)
  // Le nom ne relie jamais : il ne peut produire qu'une suggestion.
  assert.doesNotMatch(sql, /customer_id = v_suggestion|v_customer := v_suggestion/)
})

test('7-8. service: a real MediumIA service or nothing, never invented', () => {
  assert.equal(resolveService({ services: SERVICES, serviceId: SERVICES[0].id }).service.id, SERVICES[0].id)
  assert.deepEqual(resolveService({ services: SERVICES, serviceId: 'cccccccc-0000-4000-8000-000000000009' }), { service: null, resolution: 'unknown_id' })
  assert.equal(resolveService({ services: SERVICES, hint: 'guidance', modality: 'video' }).service.id, SERVICES[0].id)
  assert.equal(resolveService({ services: SERVICES, hint: 'Guidance chemin de vie', modality: 'unknown' }).service, null)
  assert.equal(resolveService({ services: SERVICES, hint: 'guidance' }).resolution, 'ambiguous')
  assert.equal(resolveService({ services: SERVICES, hint: 'désenvoûtement' }).service.id, SERVICES[2].id)
  assert.equal(resolveService({ services: SERVICES, hint: 'Dégagement de maison' }).service.id, SERVICES[3].id)
  assert.deepEqual(resolveService({ services: SERVICES, hint: 'tirage de tarot' }), { service: null, resolution: 'none' })
  assert.equal(resolveService({ services: SERVICES.map((s) => ({ ...s, is_active: false })), serviceId: SERVICES[0].id }).service, null)
})

test('8b. unknown service id sent by the agent is never stored', async () => {
  const db = fakeDb()
  const res = await intake(db, sms({ service_id: 'cccccccc-0000-4000-8000-000000000009', service_hint: 'tarot' }))
  assert.equal(res.body.service, null)
  assert.equal(res.body.service_resolution, 'none')
  assert.equal(db.calls.rpc[0].args.p_payload.service_id, null)
  assert.equal(db.calls.rpc[0].args.p_payload.service_hint, 'tarot')
})

test('9. precise date requested → proposal only, no automatic booking', async () => {
  assert.equal(AUTO_CONFIRM_ENABLED, false)
  // 13 octobre 2026, 14 h à Paris (heure d'été) = 12 h UTC ; 1er décembre 14 h = 13 h UTC.
  assert.equal(parisLocalToUtc('2026-10-13', '14:00').toISOString(), '2026-10-13T12:00:00.000Z')
  assert.equal(parisLocalToUtc('2026-12-01', '14:00').toISOString(), '2026-12-01T13:00:00.000Z')
  assert.equal(parisLocalToUtc('2026-02-31', '14:00'), null)
  const db = fakeDb()
  const res = await intake(db, sms({ source_message_id: 'SMS-C', message_text: 'Je voudrais mardi 13 octobre à 14h en visio.', requested_date: '2026-10-13', requested_time: '14:00', modality: 'video', service_hint: 'guidance' }))
  assert.equal(res.body.proposed_starts_at, '2026-10-13T12:00:00.000Z')
  assert.equal(res.body.service.title, 'Guidance — Visio')
  assert.equal(res.body.booking_created, false)
  assert.equal(db.calls.rpc[0].args.p_payload.preferred_period, 'mardi 13 octobre à 14 h 00')
  assert.ok(!db.calls.tables.includes('bookings'))
  // Une date passée n'est jamais proposée comme créneau.
  const past = validateIntake(sms({ requested_date: '2026-09-01', requested_time: '10:00' }), NOW)
  assert.equal(past.payload.proposed_starts_at, null)
  // Période vague (cas B) : conservée telle quelle.
  assert.equal(validateIntake(sms({ requested_period: 'lundi matin' }), NOW).payload.preferred_period, 'lundi matin')
})

test('invalid payloads are refused without touching the database', async () => {
  const db = fakeDb()
  const res = await intake(db, { source_channel: 'pigeon', source_message_id: '', email: 'pas-un-email', phone: '12', modality: 'telepathie', confidence: 3 })
  assert.equal(res.status, 400)
  assert.deepEqual(res.body.fields.sort(), ['confidence', 'email', 'modality', 'phone', 'source_channel', 'source_message_id'])
  assert.equal(db.calls.rpc.length, 0)
})

test('10. no Google write at intake: the module never touches Google', async () => {
  // Le code exécutable, sans les commentaires (qui décrivent le flux complet).
  const src = read('lib/lumiaRdvIntake.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of ['googleapis', 'googleCalendarEvents', 'syncBookingToGoogleCalendar', 'googleOAuth', 'events.insert', '/calendar/']) {
    assert.ok(!src.includes(forbidden), `aucune référence à ${forbidden}`)
  }
  const net = forbidNetwork()
  try {
    await intake(fakeDb(), sms({ requested_date: '2026-10-13', requested_time: '14:00' }))
    assert.deepEqual(net.hits, [])
  } finally { net.restore() }
  const sql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  assert.doesNotMatch(sql, /INSERT INTO public\.bookings|UPDATE public\.bookings/)
})

test('11-12. confirmation stays the existing MediumIA flow, which keeps syncing Google', () => {
  const admin = read('api/rdv-admin.js')
  const router = admin.slice(admin.indexOf('export default async function handler'))
  // L'entrée Lumia est traitée avant l'authentification Supabase, et seulement elle.
  assert.ok(router.indexOf("'lumia-rdv-intake'") < router.indexOf('requireAuth(req)'))
  const requests = admin.slice(admin.indexOf('async function handleRequests'), admin.indexOf('// ── Router principal'))
  assert.match(requests, /supabase\.rpc\('confirm_booking_request'/)
  assert.match(requests, /const googleSync = await syncBookingToGoogleCalendar\(/)
  // Demande incomplète (souvent venue d'un message) : à compléter avant confirmation.
  assert.match(requests, /Choisissez d’abord la prestation de cette demande\./)
  assert.match(requests, /Complétez le prénom, le nom et l’e-mail du client avant de confirmer\./)
  assert.ok(requests.indexOf('Choisissez d’abord la prestation') < requests.indexOf("rpc('confirm_booking_request'"))
  // La prestation choisie à la main doit appartenir au praticien.
  assert.match(requests, /from\('booking_services'\)\s*\.select\('id'\)\.eq\('id', body\.service_id\)\.eq\('practitioner_id', pid\)\.eq\('is_active', true\)/)
})

test('13-14. no deposit, refund, payment or ChronoSphère code involved', () => {
  const src = read('lib/lumiaRdvIntake.js') + read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  for (const forbidden of ['rdv_paypal_payments', 'rdv_payment_refunds', 'rdv_financial_entries', 'rdv_deposit', 'paypal', 'chronosphere', 'Chronosphere']) {
    assert.ok(!src.includes(forbidden), `aucune référence à ${forbidden}`)
  }
})

test('site form keeps every required field; migration is service_role only', () => {
  const sql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  assert.match(sql, /booking_requests_site_form_required_check[\s\S]*intake_agent IS NOT NULL\s+OR \(service_id IS NOT NULL AND customer_first_name IS NOT NULL/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.lumia_upsert_booking_request\(UUID, JSONB\) FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /REVOKE ALL ON public\.booking_request_intake_events FROM PUBLIC, anon, authenticated/)
})

test('customer referential (future Reservio import): distinct from requests, provenance, no overwrite, consents apart', () => {
  const sql = read('supabase/migrations/20261002085000_mediumia_customers.sql')
  const intakeSql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  // Table distincte (client ≠ demande), provenance, identifiant externe éventuel, dates.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mediumia_customers/)
  assert.match(sql, /source TEXT NOT NULL CHECK \(source IN \('mediumia', 'reservio', 'manual'\)\)/)
  assert.match(sql, /field_sources JSONB NOT NULL DEFAULT/)
  assert.match(sql, /identity_status TEXT NOT NULL DEFAULT 'ok' CHECK \(identity_status IN \('ok', 'ambiguous'\)\)/)
  assert.match(sql, /imported_at TIMESTAMPTZ,\s+source_updated_at TIMESTAMPTZ/)
  // Jamais plus ancien, jamais sans date, jamais vidé ; jamais de fusion sur le nom seul.
  assert.match(sql, /IF v_old IS NULL OR \(p_source_updated_at IS NOT NULL AND v_old_at IS NOT NULL AND p_source_updated_at > v_old_at\) THEN/)
  assert.match(sql, /CONTINUE WHEN v_new IS NULL OR v_new = v_old;/)
  assert.match(sql, /v_conflict := true;   -- même téléphone, autre nom/)
  assert.doesNotMatch(sql, /WHERE[^;]*mediumia_names_compatible[^;]*AND phone_e164 IS NULL AND email IS NULL/)
  // Données de gestion uniquement, consentements à part, note/adresse/naissance absentes.
  const customers = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.mediumia_customers'), sql.indexOf('CREATE UNIQUE INDEX'))
  assert.doesNotMatch(customers, /marketing|consent|address|note|birthday/i)
  assert.match(sql, /kind TEXT NOT NULL CHECK \(kind IN \('privacy_policy', 'marketing'\)\)/)
  // Lumia : fiche reliée seulement par téléphone / e-mail exacts et non ambiguë ; nom = suggestion.
  assert.match(intakeSql, /ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public\.mediumia_customers\(id\)/)
  assert.match(intakeSql, /ADD COLUMN IF NOT EXISTS customer_suggestion_id UUID REFERENCES public\.mediumia_customers\(id\)/)
  assert.match(intakeSql, /c\.identity_status = 'ok'\s+AND \(\(v_match = 'phone' AND c\.phone_e164 = v_phone\) OR \(v_match = 'email' AND c\.email = v_email\)\)/)
  assert.match(intakeSql, /IF v_phone_ambiguous THEN\s+v_match := 'ambiguous';/)
  assert.match(sql + intakeSql, /REVOKE ALL ON public\.mediumia_customers FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /REVOKE ALL ON public\.mediumia_customer_consents FROM PUBLIC, anon, authenticated/)
})

test('Reservio export mapping: useful fields only, consents kept apart, privacy ≠ marketing', () => {
  const mapped = mapReservioCustomer({
    firstname: ' Hélène ', lastname: 'Fictive', email: ' Helene@Example.TEST ', phone: '06 12 34 56 78',
    address: '1 rue Exemple', note: 'note', birthday: '1980-01-01',
    privacyPolicyAcceptedAt: '2024-03-01T10:00:00Z', marketingNotificationsAcceptedAt: '',
  })
  assert.deepEqual(mapped.customer, { source: 'reservio', external_id: null, first_name: 'Hélène', last_name: 'Fictive', email: 'helene@example.test', phone_e164: '+33612345678' })
  for (const dropped of RESERVIO_DROPPED_COLUMNS) assert.ok(!(dropped in mapped.customer))
  // La politique de confidentialité n'est jamais un consentement marketing.
  assert.deepEqual(mapped.consents, [{ kind: 'privacy_policy', source: 'reservio', accepted_at: '2024-03-01T10:00:00.000Z' }])
  const marketing = mapReservioCustomer({ phone: '0612345678', marketingNotificationsAcceptedAt: '2023-05-02T08:00:00Z' })
  assert.deepEqual(marketing.consents.map((c) => c.kind), ['marketing'])
  assert.deepEqual(mapReservioCustomer({ firstname: 'Sans', lastname: 'Contact' }), { customer: null, consents: [], issues: ['no_contact'] })
  assert.deepEqual(mapReservioCustomer({ email: 'pas-un-email', phone: '12' }).issues, ['email_invalid', 'phone_invalid', 'no_contact'])
  assert.equal(nameKey('Réservio'), nameKey('RESERVIO'))
})

test('Reservio dry-run analysis: duplicates, shared phones, counts only (no personal data)', () => {
  const rows = [
    { firstname: 'Anne', lastname: 'Un', phone: '0611111111', email: 'anne@example.test', privacyPolicyAcceptedAt: '2024-01-01' },
    { firstname: 'anne', lastname: 'UN', phone: '+33 6 11 11 11 11', email: 'anne@example.test' }, // même personne
    { firstname: 'Paul', lastname: 'Deux', phone: '0622222222', marketingNotificationsAcceptedAt: '2024-01-01' },
    { firstname: 'Julie', lastname: 'Deux', phone: '06 22 22 22 22' }, // même téléphone, autre personne
    { firstname: 'Rien', lastname: 'Du tout', note: 'x', address: 'y' },
  ]
  const report = analyzeReservioExport(rows)
  assert.deepEqual(report, {
    total: 5, importable: 4, without_contact: 1, invalid_phone: 0, invalid_email: 0,
    same_person_duplicates: 1, ambiguous_phones: 1, ambiguous_emails: 0,
    privacy_policy_consents: 1, marketing_consents: 1,
    dropped_columns_filled: { address: 1, note: 1, birthday: 0 },
  })
  assert.doesNotMatch(JSON.stringify(report), /Anne|Paul|example\.test|06/)
})

test('RDV screen shows « Demande détectée par Lumia » in the existing requests table', () => {
  const ui = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(ui, /Demande détectée par \{agentLabel\(req\.intake_agent\)\}/)
  assert.match(ui, /Prestation détectée : /)
  assert.match(ui, /Créneau demandé : /)
  assert.match(ui, /\(à valider, rien n’est réservé\)/)
  assert.match(ui, /Compléter la demande/)
  // Toujours le même tableau et le même bouton de confirmation.
  assert.match(ui, /Créer le rendez-vous et confirmer →/)
})

// ── Visio : WhatsApp ou FaceTime, jamais Google Meet ────────────────────────

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('video channel: only what the client says explicitly, never invented', () => {
  assert.equal(resolveVideoChannel({ modality: 'video', text: 'Je voudrais une visio par WhatsApp' }), 'whatsapp')
  assert.equal(resolveVideoChannel({ modality: 'video', text: 'On peut faire en Face Time ?' }), 'facetime')
  assert.equal(resolveVideoChannel({ modality: 'video', text: 'en visio svp' }), 'a_preciser')
  assert.equal(resolveVideoChannel({ modality: 'video', text: 'WhatsApp ou FaceTime, comme vous voulez' }), 'a_preciser')
  assert.equal(resolveVideoChannel({ modality: 'video', declared: 'facetime', text: 'visio' }), 'facetime')
  assert.equal(resolveVideoChannel({ modality: 'video', declared: 'zoom', text: 'visio' }), 'a_preciser') // jamais un autre outil
  assert.equal(resolveVideoChannel({ modality: 'video', declared: 'meet', text: 'Google Meet' }), 'a_preciser')
  assert.equal(resolveVideoChannel({ modality: 'in-person', text: 'WhatsApp' }), null)
  assert.equal(explicitVideoChannel({ text: 'plutôt par whatsapp' }), 'whatsapp')
  assert.equal(explicitVideoChannel({ text: 'en visio' }), null)
})

test('intake: the explicit channel is sent, nothing else, and the database keeps it only for a video request', async () => {
  const db = fakeDb()
  await intake(db, sms({ source_message_id: 'V-1', modality: 'video', message_text: 'Une guidance en visio sur WhatsApp mardi ?' }))
  await intake(db, sms({ source_message_id: 'V-2', modality: 'video', message_text: 'Une guidance en visio mardi ?' }))
  assert.equal(db.calls.rpc[0].args.p_payload.video_channel, 'whatsapp')
  assert.equal(db.calls.rpc[1].args.p_payload.video_channel, null)
  for (const call of db.calls.rpc) assert.doesNotMatch(JSON.stringify(call.args), /conference|meet/i)
  const sql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  assert.match(sql, /CHECK \(\s+\(video_channel IS NULL OR video_channel IN \('whatsapp', 'facetime', 'a_preciser'\)\)\s+AND \(video_channel IS NULL OR requested_modality = 'video'\)/)
  assert.match(sql, /v_modality, CASE WHEN v_modality = 'video' THEN coalesce\(v_video, 'a_preciser'\) END,/)
})

test('calendar event of a confirmed request: « Visio — canal », never a Google Meet request', () => {
  const booking = { id: 'bk-1', customer_first_name: 'Claire', customer_last_name: 'Exemple', customer_email: 'c@example.test', customer_phone: '+33611223344', starts_at: '2026-10-13T12:00:00Z', ends_at: '2026-10-13T13:00:00Z', timezone: 'Europe/Paris', google_event_id: null }
  const cases = [
    [{ requested_modality: 'video', video_channel: 'whatsapp' }, 'Visio — WhatsApp'],
    [{ requested_modality: 'video', video_channel: 'facetime' }, 'Visio — FaceTime'],
    [{ requested_modality: 'video', video_channel: 'a_preciser' }, 'Visio — canal à confirmer'],
    [{ requested_modality: 'video', video_channel: null }, 'Visio — canal à confirmer'],
  ]
  for (const [request, line] of cases) {
    assert.equal(videoChannelLabel(request), line)
    const opts = requestCalendarSync({ supabase: {}, practitionerId: 'p1', booking, request, serviceTitle: 'Guidance — Visio' })
    assert.ok(opts.event.description.split('\n').includes(line))
    assert.ok(!('createConference' in opts), 'aucune demande de visioconférence Google')
    assert.doesNotMatch(JSON.stringify(opts.event), /meet\.google|hangout|conference/i)
  }
  // Demande de déplacement (formulaire du site) : description inchangée, sans ligne Visio.
  const site = requestCalendarSync({ supabase: {}, practitionerId: 'p1', booking, request: { address_line1: '1 rue Exemple', postal_code: '59000', city: 'Lille' }, serviceTitle: 'Dégagement de maison', finalPrice: 25000 })
  assert.deepEqual(site.event.description.split('\n'), [
    'MediumIA Rendez-vous', '', 'Client : Claire Exemple', 'Téléphone : +33611223344', 'Email : c@example.test',
    'Prestation : Dégagement de maison', 'Montant : 250.00 € TTC', 'Identifiant MediumIA : bk-1',
  ])
  assert.equal(site.event.location, '1 rue Exemple, 59000 Lille')
})

test('a Lumia video request synced to Google never asks for a Meet (real sync code, Google simulated)', async () => {
  const prevKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
  const realFetch = globalThis.fetch
  const sent = []
  const updates = []
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
    return new Response(JSON.stringify({ id: 'evt1' }), { status: 200 })
  }
  const supabase = {
    from(table) {
      const q = {
        select() { return q }, eq() { return q },
        single() { return Promise.resolve({ data: table === 'booking_calendar_connections' ? { access_token_enc: encrypt('jeton-test'), refresh_token_enc: null, token_expiry: '2099-01-01T00:00:00Z', google_calendar_id: 'test@group.calendar.google.com' } : null }) },
        update(values) { updates.push({ table, values }); return q },
        then(ok, ko) { return Promise.resolve({ data: null, error: null }).then(ok, ko) },
      }
      return q
    },
  }
  try {
    const booking = { id: '11111111-0000-4000-8000-000000000001', customer_first_name: 'Claire', customer_last_name: 'Exemple', customer_email: 'c@example.test', starts_at: '2026-10-13T12:00:00Z', ends_at: '2026-10-13T13:00:00Z', google_event_id: null }
    const result = await syncBookingToGoogleCalendar(requestCalendarSync({
      supabase, practitionerId: 'p1', booking, request: { intake_agent: 'lumia', requested_modality: 'video', video_channel: 'whatsapp' }, serviceTitle: 'Guidance — Visio',
    }))
    assert.equal(result.status, 'synced')
    assert.equal(sent.length, 1) // un seul appel : création de l'événement agenda
    assert.doesNotMatch(sent[0].url, /conferenceDataVersion/)
    assert.equal('conferenceData' in sent[0].body, false)
    assert.match(sent[0].body.description, /Visio — WhatsApp/)
    assert.equal(updates.find((u) => u.table === 'bookings').values.google_meet_link, null)
  } finally {
    globalThis.fetch = realFetch
    if (prevKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = prevKey
  }
})

test('no path of the requests flow or of Lumia can create a Google Meet', () => {
  const admin = read('api/rdv-admin.js')
  const requests = admin.slice(admin.indexOf('async function handleRequests'), admin.indexOf('// ── Router principal'))
  assert.doesNotMatch(requests, /createConference|conferenceData|hangoutsMeet/)
  const syncCalls = requests.match(/syncBookingToGoogleCalendar\(/g) || []
  assert.equal(syncCalls.length, 2)
  assert.equal((requests.match(/syncBookingToGoogleCalendar\(requestCalendarSync\(\{/g) || []).length, 2)
  for (const file of ['lib/lumiaRdvIntake.js', 'lib/requestCalendarEvent.js', 'supabase/migrations/20261002090000_lumia_rdv_intake.sql']) {
    assert.doesNotMatch(stripComments(read(file)), /createConference|conferenceData|hangoutsMeet|meet\.google/i, file)
  }
  const ui = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(ui, /Canal visio/)
  assert.match(ui, /a_preciser: 'canal à confirmer'/)
})

// ── Préversion : le backend doit parler à Supabase TEST avec une vraie clé serveur ──

test('preview check: server key type only (never its value), publishable key refused, production untouched', async () => {
  const { checkPreviewServerKey, supabaseKeyKind, supabaseProjectRef } = await import('../lib/previewSupabaseCheck.js')
  const jwt = (role) => ['e30', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'sig'].join('.')
  assert.equal(supabaseKeyKind('sb_secret_abc123'), 'secret')
  assert.equal(supabaseKeyKind('sb_publishable_abc123'), 'publishable')
  assert.equal(supabaseKeyKind(jwt('service_role')), 'jwt_service_role')
  assert.equal(supabaseKeyKind(jwt('anon')), 'jwt_anon')
  assert.equal(supabaseKeyKind(''), 'missing')
  assert.equal(supabaseProjectRef('https://wnbwhnqiulsdjcvkuwos.supabase.co'), 'wnbwhnqiulsdjcvkuwos')
  const logs = []
  const realWarn = console.warn
  console.warn = (line) => logs.push(String(line))
  try {
    const secret = 'sb_secret_NE-JAMAIS-AFFICHER-0123456789'
    assert.deepEqual(checkPreviewServerKey({ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret }),
      { checked: true, project: 'wnbwhnqiulsdjcvkuwos', kind: 'secret' })
    assert.throws(() => checkPreviewServerKey({ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_xyz' }), /supabase_server_key_invalid/)
    assert.throws(() => checkPreviewServerKey({ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }), /supabase_server_key_invalid/)
    // Production et local : aucune vérification, aucun log, aucun refus.
    assert.deepEqual(checkPreviewServerKey({ VERCEL_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_xyz' }), { checked: false })
    assert.deepEqual(checkPreviewServerKey({ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_xyz' }), { checked: false })
    // Tests lancés par le build Vercel (VERCEL_ENV=preview) : jamais de refus.
    assert.deepEqual(checkPreviewServerKey({ VERCEL_ENV: 'preview', NODE_TEST_CONTEXT: 'child-v8', SUPABASE_SERVICE_ROLE_KEY: 'test-key' }), { checked: false })
    assert.deepEqual(logs, [
      '[preview-check] backend supabase=wnbwhnqiulsdjcvkuwos key=secret',
      '[preview-check] backend supabase=wnbwhnqiulsdjcvkuwos key=publishable',
      '[preview-check] backend supabase=x key=jwt_anon',
    ])
    assert.ok(!logs.join('\n').includes(secret.slice(10)), 'la valeur de la clé n’apparaît jamais')
  } finally { console.warn = realWarn }
  const admin = read('lib/supabaseAdmin.js')
  assert.ok(admin.indexOf('checkPreviewServerKey()') < admin.indexOf('createClient(url, key'))
  assert.match(read('vite.config.js'), /projet \$\{project\}/)
})

test('preview me diagnostic: slugs and counts only, never client data', async () => {
  const { logPreviewMe } = await import('../lib/previewSupabaseCheck.js')
  const env = { VERCEL_ENV: 'preview' }
  const line = logPreviewMe({
    practitioners: [{ id: 'p1', slug: 'sebastien-seguin', name: 'Sébastien' }, { id: 'p2', slug: 'autre' }],
    requests: [
      { practitioner_id: 'p1', status: 'pending', customer_first_name: 'Jean', customer_email: 'jean@example.test' },
      { practitioner_id: 'p1', status: 'scheduled', customer_first_name: 'Marie' },
    ],
    requestsError: null,
  }, env)
  assert.equal(line, '[preview-check] me practitioners=sebastien-seguin:1p/2,autre:0p/0 requests_total=2 requests_error=none')
  assert.doesNotMatch(line, /Jean|Marie|example\.test|Sébastien/)
  assert.match(logPreviewMe({ practitioners: [], requests: null, requestsError: { code: '42703' } }, env), /requests_total=null requests_error=42703/)
  assert.equal(logPreviewMe({ practitioners: [] }, { VERCEL_ENV: 'production' }), null)
  assert.equal(logPreviewMe({ practitioners: [] }, { VERCEL_ENV: 'preview', NODE_TEST_CONTEXT: 'child-v8' }), null)
})

test('manual confirmation of an agent request: booking « manual », payment guard untouched', () => {
  const sql = read('supabase/migrations/20261002093000_lumia_confirm_request_manual_source.sql')
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.confirm_booking_request\(/)
  assert.match(sql, /CASE WHEN v_request\.intake_agent IS NOT NULL THEN 'manual' ELSE 'mediumia' END/)
  // Le garde-fou des arrhes n'est ni modifié ni désactivé.
  assert.doesNotMatch(sql, /enforce_mediumia_booking_reservation_payment\s*\(\)\s*(RETURNS|$)|DROP TRIGGER|DISABLE TRIGGER|session_replication_role/i)
  assert.doesNotMatch(sql, /rdv_paypal_payments|rdv_financial_entries|reservation_payment_cents\s*=/)
  // Toujours service_role uniquement.
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.confirm_booking_request\(UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, TEXT\)\s+FROM anon, authenticated;/)
  assert.match(read('docs/rdv-confirm-request-migration.sql'), /Version plus récente : supabase\/migrations\/20261002093000_lumia_confirm_request_manual_source\.sql/)
})

// ── Créneau demandé : champs structurés envoyés par Lumia ───────────────────

test('preferred_date + preferred_time → Paris time as an ISO instant (Thomas, Alice)', async () => {
  const db = fakeDb()
  const thomas = await intake(db, sms({ source_message_id: 'T-1', first_name: 'Thomas', last_name: 'Bernard', preferred_date: '2026-10-13', preferred_time: '14:00', message_text: 'Mardi 13 octobre à 14h ?' }))
  const alice = await intake(db, sms({ source_message_id: 'A-1', first_name: 'Alice', last_name: 'Martin', preferred_date: '2026-10-14', preferred_time: '15:00' }))
  // Heure d'été à Paris (UTC+2).
  assert.equal(thomas.body.proposed_starts_at, '2026-10-13T12:00:00.000Z')
  assert.equal(alice.body.proposed_starts_at, '2026-10-14T13:00:00.000Z')
  assert.equal(db.calls.rpc[0].args.p_payload.proposed_starts_at, '2026-10-13T12:00:00.000Z')
  assert.equal(thomas.body.preferred_period, 'mardi 13 octobre à 14 h 00')
  // Heure d'hiver (UTC+1) : 1er décembre 14 h → 13 h UTC.
  assert.equal(validateIntake(sms({ preferred_date: '2026-12-01', preferred_time: '14:00' }), NOW).payload.proposed_starts_at, '2026-12-01T13:00:00.000Z')
  // Format invalide refusé, sans rien écrire.
  const bad = await intake(fakeDb(), sms({ preferred_date: '13/10/2026', preferred_time: '14h' }))
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.body.fields.sort(), ['preferred_date', 'preferred_time'])
})

test('a given proposed_starts_at is kept as is (and wins over date + time)', async () => {
  const db = fakeDb()
  const res = await intake(db, sms({ source_message_id: 'P-1', proposed_starts_at: '2026-10-15T16:30:00+02:00', preferred_date: '2026-10-13', preferred_time: '14:00' }))
  assert.equal(res.body.proposed_starts_at, '2026-10-15T14:30:00.000Z')
  assert.equal(db.calls.rpc[0].args.p_payload.proposed_starts_at, '2026-10-15T14:30:00.000Z')
  // Sans fuseau explicite, l'heure serait ambiguë : refusée.
  const ambiguous = await intake(fakeDb(), sms({ source_message_id: 'P-2', proposed_starts_at: '2026-10-15T16:30:00' }))
  assert.equal(ambiguous.status, 400)
  assert.deepEqual(ambiguous.body.fields, ['proposed_starts_at'])
  // Un créneau passé n'est jamais proposé.
  assert.equal(validateIntake(sms({ proposed_starts_at: '2026-09-01T10:00:00Z' }), NOW).payload.proposed_starts_at, null)
})

test('never invent a slot when the date or the time is missing', () => {
  const dateOnly = validateIntake(sms({ preferred_date: '2026-10-13' }), NOW).payload
  assert.equal(dateOnly.proposed_starts_at, null)
  assert.equal(dateOnly.preferred_period, 'mardi 13 octobre (heure à définir)')
  const timeOnly = validateIntake(sms({ preferred_time: '14:00' }), NOW).payload
  assert.equal(timeOnly.proposed_starts_at, null)
  assert.equal(timeOnly.preferred_period, null)
  assert.equal(validateIntake(sms({}), NOW).payload.proposed_starts_at, null)
})

test('a follow-up without a slot keeps the stored one, and the API returns the stored value', async () => {
  const db = fakeDb()
  const first = await intake(db, sms({ source_message_id: 'F-1', source_conversation_id: 'CONV-F', preferred_date: '2026-10-13', preferred_time: '14:00' }))
  const follow = await intake(db, sms({ source_message_id: 'F-2', source_conversation_id: 'CONV-F', message_text: 'Merci, à bientôt' }))
  assert.equal(follow.body.outcome, 'updated')
  assert.equal(follow.body.request_id, first.body.request_id)
  assert.equal(db.calls.rpc[1].args.p_payload.proposed_starts_at, null) // le nouveau message n'en redonne pas
  assert.equal(follow.body.proposed_starts_at, '2026-10-13T12:00:00.000Z') // valeur réellement stockée
  assert.equal(follow.body.preferred_period, 'mardi 13 octobre à 14 h 00')
  // Doublon : l'état stocké, pas le contenu du message relu.
  const replay = await intake(db, sms({ source_message_id: 'F-1', source_conversation_id: 'CONV-F', preferred_date: '2026-10-20', preferred_time: '09:00' }))
  assert.equal(replay.body.outcome, 'duplicate')
  assert.equal(replay.body.proposed_starts_at, '2026-10-13T12:00:00.000Z')
  // Côté base, la même règle : coalesce(nouveau, ancien).
  assert.match(read('supabase/migrations/20261002090000_lumia_rdv_intake.sql'), /proposed_starts_at = coalesce\(v_proposed, proposed_starts_at\)/)
})
