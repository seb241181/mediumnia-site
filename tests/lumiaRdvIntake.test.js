import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AUTO_CONFIRM_ENABLED,
  authenticateLumia,
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
  let seq = 0
  const db = {
    calls,
    from(table) {
      calls.tables.push(table)
      const q = {
        select() { return q }, eq() { return q }, in() { return q }, order() { return q }, limit() { return q },
        insert() { calls.writes.push(table); return q }, update() { calls.writes.push(table); return q },
        upsert() { calls.writes.push(table); return q }, delete() { calls.writes.push(table); return q },
        maybeSingle() { return Promise.resolve(table === 'booking_practitioners' ? { data: { id: PRACT, slug: 'sebastien-seguin' } } : { data: null }) },
        single() { return q.maybeSingle() },
        then(ok, ko) { return Promise.resolve(table === 'booking_services' ? { data: SERVICES, error: null } : { data: [] }).then(ok, ko) },
      }
      return q
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (name !== 'lumia_upsert_booking_request') return { data: null, error: { message: 'unexpected rpc' } }
      await new Promise((r) => setTimeout(r, 5))
      const key = `${args.p_payload.channel}:${args.p_payload.message_id}`
      if (byMessage.has(key)) return { data: { ok: true, outcome: 'duplicate', request_id: byMessage.get(key) } }
      const id = `req-${++seq}`
      byMessage.set(key, id)
      return { data: { ok: true, outcome: 'created', request_id: id, customer_match: 'none', needs_review: !args.p_payload.service_id } }
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

test('customer referential (future Reservio import): phone, then email, name only as a suggestion', () => {
  const sql = read('supabase/migrations/20261002085000_mediumia_customers.sql')
  const intakeSql = read('supabase/migrations/20261002090000_lumia_rdv_intake.sql')
  // Table distincte, provenance, identifiant externe, dates d'import / de mise à jour.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mediumia_customers/)
  assert.match(sql, /source TEXT NOT NULL CHECK \(source IN \('mediumia', 'reservio', 'manual'\)\)/)
  assert.match(sql, /external_id TEXT,\s+imported_at TIMESTAMPTZ,\s+source_updated_at TIMESTAMPTZ/)
  assert.match(sql, /uq_mediumia_customers_external[\s\S]*\(practitioner_id, source, external_id\)/)
  // Jamais écrasée par des données plus anciennes, jamais vidée.
  assert.match(sql, /p_source_updated_at <= v_existing\.source_updated_at[\s\S]*'stale'/)
  assert.match(sql, /first_name = coalesce\(nullif\(btrim\(p_first_name\), ''\), first_name\)/)
  // Données de gestion uniquement : aucun consentement marketing mélangé.
  const columns = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');', sql.indexOf('CREATE TABLE')))
  assert.doesNotMatch(columns, /marketing|consent|newsletter|optin|opt_in/i)
  // Lumia : fiche reliée seulement par téléphone ou e-mail exacts, nom = suggestion.
  assert.match(intakeSql, /ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public\.mediumia_customers\(id\)/)
  assert.match(intakeSql, /ADD COLUMN IF NOT EXISTS customer_suggestion_id UUID REFERENCES public\.mediumia_customers\(id\)/)
  assert.match(intakeSql, /\(v_match = 'phone' AND c\.phone_e164 = v_phone\) OR \(v_match = 'email' AND c\.email = v_email\)/)
  assert.match(intakeSql, /ELSIF v_match = 'none' AND v_first IS NOT NULL AND v_last IS NOT NULL THEN\s+SELECT CASE WHEN count\(\*\) = 1 THEN min\(c\.id::TEXT\)::UUID END INTO v_suggestion/)
  assert.match(sql, /REVOKE ALL ON public\.mediumia_customers FROM PUBLIC, anon, authenticated/)
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
