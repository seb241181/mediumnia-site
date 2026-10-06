import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'

// Clé factice, uniquement pour chiffrer un faux jeton Google dans ces tests.
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = '0'.repeat(64)

const { encrypt, parisUTCOffsetMs } = await import('../lib/googleOAuth.js')
const {
  LUMIA_AVAILABILITY_MARKER, LUMIA_AVAILABILITY_UNAVAILABLE, isAvailabilityQuestion, loadLumiaAvailabilityContext,
  lumiaAvailabilityLogDetail, parseAvailabilityQuestion, resolveQuestionService,
} = await import('../lib/lumiaAvailabilityContext.js')
const { extendIntervals, generateSlots, googleBusyInterval } = await import('../lib/rdvAvailability.js')
const { blockingEvents, checkNoBookingOverlap, checkOfferCalendar } = await import('../lib/rdvSlotOffers.js')
const { validateServerAvailability } = await import('../lib/rdvDepositApiHandler.js')
const { LUMIA_ALLOWED_ACTIONS, LUMIA_POLICY_VERSION, buildLumiaPolicyInstructions } = await import('../lib/lumiaPolicy.js')

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const iso = (s) => new Date(s).toISOString()
const OWNER_A = 'owner-a'
const OWNER_B = 'owner-b'
// Lundi 12 octobre 2026, 08:00 à Paris (UTC+2).
const NOW = new Date('2026-10-12T06:00:00Z')

// ── Faux Supabase en mémoire (lecture ; toute écriture est journalisée) ─────

function fakeDb(tables, { errors = {} } = {}) {
  const log = { tables: [], writes: [] }
  return {
    log,
    from(table) {
      log.tables.push(table)
      const preds = []
      let write = null
      let limit = null
      const rows = () => {
        const r = (tables[table] || []).filter((row) => preds.every((p) => p(row)))
        return limit == null ? r : r.slice(0, limit)
      }
      const cmp = (k, v, f) => { preds.push((row) => row[k] != null && f(String(row[k]), String(v))); return q }
      const q = {
        select() { return q },
        eq(k, v) { preds.push((row) => row[k] === v); return q },
        in(k, v) { preds.push((row) => v.includes(row[k])); return q },
        gte(k, v) { return cmp(k, v, (a, b) => a >= b) },
        lte(k, v) { return cmp(k, v, (a, b) => a <= b) },
        gt(k, v) { return cmp(k, v, (a, b) => a > b) },
        lt(k, v) { return cmp(k, v, (a, b) => a < b) },
        order() { return q },
        limit(n) { limit = n; return q },
        update(values) { write = 'update'; log.writes.push({ table, op: 'update', values }); return q },
        insert(values) { write = 'insert'; log.writes.push({ table, op: 'insert', values }); return q },
        upsert(values) { write = 'upsert'; log.writes.push({ table, op: 'upsert', values }); return q },
        delete() { write = 'delete'; log.writes.push({ table, op: 'delete' }); return q },
        single() {
          const r = rows()
          return Promise.resolve(r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116' } })
        },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }) },
        then(resolve, reject) {
          if (errors[table]) return Promise.resolve({ data: null, error: errors[table] }).then(resolve, reject)
          return Promise.resolve({ data: write ? null : rows(), error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
}

// ── Faux Google Agenda : renvoie volontairement titres, descriptions, lieux et
// participants pour prouver qu'ils ne sortent jamais du moteur. ────────────

function fakeGoogle(events, { fail = null } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers })
    if (fail === 'throw') throw new Error('network down')
    if (fail) return new Response('{}', { status: fail })
    const u = new URL(url)
    const timeMin = u.searchParams.get('timeMin')
    const timeMax = u.searchParams.get('timeMax')
    const items = events
      .filter((e) => (e.start.dateTime || e.start.date) < timeMax && (e.end.dateTime || e.end.date) > timeMin)
      .map((e) => ({
        description: 'Notes privées : code porte 1234',
        location: '12 rue Secrète',
        attendees: [{ email: 'invite.prive@example.com' }],
        ...e,
      }))
    return new Response(JSON.stringify({ items }), { status: 200 })
  }
  return { fetchImpl, calls }
}

const ev = (startIso, endIso, extra = {}) => ({ status: 'confirmed', summary: 'Dentiste Dr Secret', start: { dateTime: iso(startIso) }, end: { dateTime: iso(endIso) }, ...extra })

// ── Données de base ─────────────────────────────────────────────────────────

function baseTables(overrides = {}) {
  const pA = {
    id: 'pA', owner_id: OWNER_A, slug: 'sebastien-seguin', timezone: 'Europe/Paris', is_active: true, booking_enabled: true,
    booking_horizon_days: 60, buffer_before_min: 0, buffer_after_min: 0, min_advance_hours: 0, max_per_day: null,
    ...(overrides.practitioner || {}),
  }
  const pB = {
    id: 'pB', owner_id: OWNER_B, slug: 'autre-praticien', timezone: 'Europe/Paris', is_active: true, booking_enabled: true,
    booking_horizon_days: 60, buffer_before_min: 0, buffer_after_min: 0, min_advance_hours: 0, max_per_day: null,
  }
  return {
    booking_practitioners: [pA, pB],
    booking_services: overrides.services || [
      { id: 'svc-guidance', practitioner_id: 'pA', slug: 'guidance', title: 'Guidance', duration_min: 60, booking_mode: 'instant', modality: ['video'], is_active: true },
      { id: 'svc-soin', practitioner_id: 'pA', slug: 'soin-energetique', title: 'Soin énergétique', duration_min: 90, booking_mode: 'instant', modality: ['in-person'], is_active: true },
      { id: 'svc-b', practitioner_id: 'pB', slug: 'tarot', title: 'Tarot', duration_min: 30, booking_mode: 'instant', modality: ['video'], is_active: true },
    ],
    // Lundi → vendredi 09:00-12:00 et 14:00-18:00 (0 = lundi).
    booking_availability_rules: [
      ...[0, 1, 2, 3, 4].flatMap((d) => [
        { practitioner_id: 'pA', day_of_week: d, start_time: '09:00:00', end_time: '12:00:00' },
        { practitioner_id: 'pA', day_of_week: d, start_time: '14:00:00', end_time: '18:00:00' },
      ]),
      // Owner B : ouvert le samedi (ne doit jamais apparaître pour A).
      { practitioner_id: 'pB', day_of_week: 5, start_time: '08:00:00', end_time: '20:00:00' },
      { practitioner_id: 'pB', day_of_week: 1, start_time: '07:00:00', end_time: '08:00:00' },
    ],
    booking_exceptions: overrides.exceptions || [],
    bookings: overrides.bookings || [],
    rdv_booking_holds: overrides.holds || [],
    booking_slot_offers: overrides.offers || [],
    booking_calendar_connections: [
      { practitioner_id: 'pA', is_active: true, google_calendar_id: 'cal-a@group.calendar.google.com', access_token_enc: encrypt('tok-a'), refresh_token_enc: 'x', token_expiry: '2099-01-01T00:00:00Z', ...(overrides.connection || {}) },
      { practitioner_id: 'pB', is_active: true, google_calendar_id: 'cal-b@group.calendar.google.com', access_token_enc: encrypt('tok-b'), refresh_token_enc: 'x', token_expiry: '2099-01-01T00:00:00Z' },
    ],
  }
}

async function ask(question, { tables = baseTables(), events = [], fail = null, now = NOW, owner = OWNER_A, errors } = {}) {
  const db = fakeDb(tables, { errors })
  const google = fakeGoogle(events, { fail })
  const text = await loadLumiaAvailabilityContext({ db, userId: owner, question, now, fetchImpl: google.fetchImpl })
  const payload = text ? JSON.parse(text.split('\n')[2]) : null
  return { text, payload, db, google }
}

const times = (payload, date) => payload.slots.filter((s) => s.local_date === date).map((s) => s.local_time)

// ── 1. Disponibilité normale ────────────────────────────────────────────────

test('1. disponibilité normale selon booking_availability_rules (grille de la page publique)', async () => {
  const { payload, text, db, google } = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?')
  assert.ok(text.startsWith(LUMIA_AVAILABILITY_MARKER))
  assert.equal(payload.status, 'ok')
  assert.deepEqual(payload.requested_period.from, '2026-10-13')
  assert.deepEqual(payload.service, { id: 'svc-guidance', title: 'Guidance', duration_min: 60, booking_mode: 'instant' })
  assert.equal(payload.calendar_connected, true)
  assert.equal(payload.timezone, 'Europe/Paris')
  assert.deepEqual(times(payload, '2026-10-13'), ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'])
  assert.deepEqual(payload.slots[0], {
    starts_at: '2026-10-13T07:00:00.000Z', ends_at: '2026-10-13T08:00:00.000Z',
    local_date: '2026-10-13', local_weekday: 'mardi', local_time: '09:00', local_end_time: '10:00',
  })
  assert.equal(google.calls.length, 1)
  assert.ok(db.log.tables.includes('booking_availability_rules'))
  assert.ok(db.log.tables.includes('booking_calendar_connections'))
  assert.deepEqual(db.log.writes, [])
  assert.equal(google.calls[0].method, 'GET')
  const busy = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', {
    events: [ev('2026-10-13T08:00:00Z', '2026-10-13T09:00:00Z')],
  })
  assert.equal(busy.google.calls.length, 1)
  assert.deepEqual(times(busy.payload, '2026-10-13'), ['09:00', '11:00', '14:00', '15:00', '16:00', '17:00'])
})

// ── 2. Jour fermé ───────────────────────────────────────────────────────────

test('2. jour sans règle : aucun créneau, aucun appel Google', async () => {
  const { payload, google } = await ask('Je suis libre samedi pour une guidance ?')
  assert.equal(payload.requested_period.from, '2026-10-17')
  assert.deepEqual(payload.slots, [])
  assert.deepEqual(payload.days_without_slot, [{ local_date: '2026-10-17', status: 'outside_availability' }])
  assert.equal(google.calls.length, 0, 'jour fermé : inutile de lire Google')
})

// ── 3. Réservation confirmée ────────────────────────────────────────────────

test('3. une réservation confirmée bloque ; une annulée non', async () => {
  const tables = baseTables({ bookings: [
    { practitioner_id: 'pA', status: 'confirmed', starts_at: iso('2026-10-13T08:00:00Z'), ends_at: iso('2026-10-13T09:00:00Z') },
    { practitioner_id: 'pA', status: 'cancelled', starts_at: iso('2026-10-13T12:00:00Z'), ends_at: iso('2026-10-13T13:00:00Z') },
  ] })
  const { payload } = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables })
  assert.deepEqual(times(payload, '2026-10-13'), ['09:00', '11:00', '14:00', '15:00', '16:00', '17:00'])
})

// ── 4-6. Événements Google ──────────────────────────────────────────────────

test('4. un événement Google bloque', async () => {
  const { payload } = await ask('Qu’est-ce que j’ai de libre mercredi pour une guidance ?', { events: [ev('2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z')] })
  assert.deepEqual(times(payload, '2026-10-14'), ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'])
})

test('5. un événement Google « disponible » (transparent) ne bloque pas', async () => {
  const { payload } = await ask('Qu’est-ce que j’ai de libre mercredi pour une guidance ?', {
    events: [
      ev('2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z', { transparency: 'transparent' }),
      { status: 'confirmed', transparency: 'transparent', summary: 'Anniversaire', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } },
    ],
  })
  assert.equal(times(payload, '2026-10-14').length, 7)
})

test('6. un événement annulé ne bloque pas ; une journée entière occupée bloque tout', async () => {
  const cancelled = await ask('Qu’est-ce que j’ai de libre mercredi pour une guidance ?', { events: [ev('2026-10-14T07:00:00Z', '2026-10-14T16:00:00Z', { status: 'cancelled' })] })
  assert.equal(times(cancelled.payload, '2026-10-14').length, 7)
  const allDay = await ask('Qu’est-ce que j’ai de libre mercredi pour une guidance ?', {
    events: [{ status: 'confirmed', summary: 'Congés', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } }],
  })
  assert.deepEqual(allDay.payload.slots, [])
  assert.deepEqual(allDay.payload.days_without_slot, [{ local_date: '2026-10-14', status: 'no_free_slot' }])
})

// ── 7. Convention « Urgence » ───────────────────────────────────────────────

test('7. convention « Urgence » : bloque en mode normal, réservée aux urgences en mode urgence (comme les liens personnels)', async () => {
  const events = [
    ev('2026-10-15T07:00:00Z', '2026-10-15T10:00:00Z', { summary: 'Urgence' }), // jeudi 09:00-12:00
    ev('2026-10-17T08:00:00Z', '2026-10-17T10:00:00Z', { summary: '  urgence — garde' }), // samedi 10:00-12:00
    ev('2026-10-15T12:00:00Z', '2026-10-15T13:00:00Z', { summary: 'Mon urgence perso' }), // ne commence pas par Urgence
  ]
  const normal = await ask('Qu’est-ce que j’ai de libre jeudi pour une guidance ?', { events })
  assert.deepEqual(times(normal.payload, '2026-10-15'), ['15:00', '16:00', '17:00'])
  assert.equal(normal.payload.query.urgent, false)

  const urgent = await ask('Mathilde veut une guidance urgente, qu’est-ce que j’ai de libre jeudi ?', { events })
  assert.equal(urgent.payload.query.urgent, true)
  assert.deepEqual(times(urgent.payload, '2026-10-15'), ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'])

  const saturday = await ask('Urgent : j’ai quoi de libre samedi pour une guidance ?', { events })
  assert.deepEqual(times(saturday.payload, '2026-10-17'), ['10:00', '11:00'], 'plage Urgence = créneaux d’urgence')

  // Même règle que lib/rdvSlotOffers.js#blockingEvents.
  for (const e of events) {
    assert.equal(googleBusyInterval(e).urgence, blockingEvents([e]).length === 0, e.summary)
  }
})

// ── 8. Buffers ──────────────────────────────────────────────────────────────

test('8. buffers avant/après autour des réservations et des événements Google', async () => {
  const bookings = [{ practitioner_id: 'pA', status: 'confirmed', starts_at: iso('2026-10-13T08:00:00Z'), ends_at: iso('2026-10-13T09:00:00Z') }]
  const events = [ev('2026-10-13T13:00:00Z', '2026-10-13T14:00:00Z')] // 15:00-16:00
  const noBuf = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ bookings }), events })
  assert.deepEqual(times(noBuf.payload, '2026-10-13'), ['09:00', '11:00', '14:00', '16:00', '17:00'])
  const withBuf = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', {
    tables: baseTables({ bookings, practitioner: { buffer_before_min: 15, buffer_after_min: 15 } }), events,
  })
  assert.deepEqual(times(withBuf.payload, '2026-10-13'), ['17:00'])
})

// ── 9-10. Exceptions ────────────────────────────────────────────────────────

test('9. exception « closed »', async () => {
  const tables = baseTables({ exceptions: [{ practitioner_id: 'pA', exception_date: '2026-10-15', exception_type: 'closed', slots: null }] })
  const { payload } = await ask('Qu’est-ce que j’ai de libre jeudi pour une guidance ?', { tables })
  assert.deepEqual(payload.slots, [])
  assert.deepEqual(payload.days_without_slot, [{ local_date: '2026-10-15', status: 'exception_closed' }])
})

test('10. exception « modified » remplace les plages du jour', async () => {
  const tables = baseTables({ exceptions: [{ practitioner_id: 'pA', exception_date: '2026-10-16', exception_type: 'modified', slots: [{ start_time: '10:00', end_time: '12:30' }] }] })
  const { payload } = await ask('Qu’est-ce que j’ai de libre vendredi pour une guidance ?', { tables })
  assert.deepEqual(times(payload, '2026-10-16'), ['10:00', '11:00'])
})

// ── 11. Délai minimum ───────────────────────────────────────────────────────

test('11. min_advance_hours', async () => {
  const tables = baseTables({ practitioner: { min_advance_hours: 26 } }) // au plus tôt mardi 10:00
  const { payload } = await ask('Qu’est-ce que j’ai de libre demain pour une guidance ?', { tables })
  assert.deepEqual(times(payload, '2026-10-13'), ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'])
  const today = await ask('Je suis dispo aujourd’hui pour une guidance ?', { tables })
  assert.deepEqual(today.payload.slots, [])
  assert.deepEqual(today.payload.days_without_slot, [{ local_date: '2026-10-12', status: 'no_free_slot' }])
})

// ── 12. Maximum par jour (réservations + paiements en cours) ────────────────

test('12. max_per_day compte les réservations confirmées et les paiements en cours', async () => {
  const bookings = [
    { practitioner_id: 'pA', status: 'confirmed', starts_at: iso('2026-10-13T07:00:00Z'), ends_at: iso('2026-10-13T08:00:00Z') },
  ]
  const holds = [{ practitioner_id: 'pA', status: 'payment_pending', expires_at: iso('2026-10-12T07:00:00Z'), starts_at: iso('2026-10-13T12:00:00Z'), ends_at: iso('2026-10-13T13:00:00Z') }]
  const full = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ bookings, holds, practitioner: { max_per_day: 2 } }) })
  assert.deepEqual(full.payload.slots, [])
  assert.deepEqual(full.payload.days_without_slot, [{ local_date: '2026-10-13', status: 'max_per_day' }])
  const room = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ bookings, holds, practitioner: { max_per_day: 3 } }) })
  assert.deepEqual(times(room.payload, '2026-10-13'), ['10:00', '11:00', '15:00', '16:00', '17:00'], 'paiement en cours = créneau bloqué')
})

test('paiements en cours et liens personnels ouverts bloquent ; expirés non', async () => {
  const holds = [
    { practitioner_id: 'pA', status: 'payment_pending', expires_at: iso('2026-10-12T05:00:00Z'), starts_at: iso('2026-10-13T07:00:00Z'), ends_at: iso('2026-10-13T08:00:00Z') },
    { practitioner_id: 'pA', status: 'payment_captured', expires_at: null, starts_at: iso('2026-10-13T08:00:00Z'), ends_at: iso('2026-10-13T09:00:00Z') },
  ]
  const offers = [
    { practitioner_id: 'pA', status: 'open', expires_at: iso('2026-10-13T06:00:00Z'), starts_at: iso('2026-10-13T12:00:00Z'), ends_at: iso('2026-10-13T13:00:00Z') },
    { practitioner_id: 'pA', status: 'open', expires_at: iso('2026-10-12T05:00:00Z'), starts_at: iso('2026-10-13T13:00:00Z'), ends_at: iso('2026-10-13T14:00:00Z') },
    { practitioner_id: 'pA', status: 'cancelled', expires_at: iso('2026-10-13T06:00:00Z'), starts_at: iso('2026-10-13T14:00:00Z'), ends_at: iso('2026-10-13T15:00:00Z') },
  ]
  const { payload } = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ holds, offers }) })
  assert.deepEqual(times(payload, '2026-10-13'), ['09:00', '11:00', '15:00', '16:00', '17:00'])
})

// ── 13. Durée réelle de la prestation ───────────────────────────────────────

test('13. service de 60 min vs 90 min : durée réelle de booking_services', async () => {
  const g = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?')
  const s = await ask('Qu’est-ce que j’ai de libre mardi pour un soin énergétique ?')
  assert.equal(s.payload.service.duration_min, 90)
  assert.deepEqual(times(s.payload, '2026-10-13'), ['09:00', '10:30', '14:00', '15:30'])
  assert.equal(times(g.payload, '2026-10-13').length, 7)
  assert.equal(s.payload.slots[1].local_end_time, '12:00')
})

test('prestation inconnue ou ambiguë : jamais inventée, aucun appel Google', async () => {
  const none = await ask('Qu’est-ce que j’ai de libre mardi ?')
  assert.equal(none.payload.status, 'service_required')
  assert.deepEqual(none.payload.slots, [])
  assert.deepEqual(none.payload.available_services.map((s) => s.title), ['Guidance', 'Soin énergétique'], 'uniquement les prestations du compte')
  assert.equal(none.google.calls.length, 0)

  const services = [
    { id: 'g1', practitioner_id: 'pA', slug: 'guidance-visio', title: 'Guidance visio', duration_min: 60, booking_mode: 'instant', is_active: true },
    { id: 'g2', practitioner_id: 'pA', slug: 'guidance-longue', title: 'Guidance longue', duration_min: 90, booking_mode: 'instant', is_active: true },
  ]
  const amb = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ services }) })
  assert.equal(amb.payload.status, 'service_ambiguous')
  assert.deepEqual(amb.payload.service_candidates.map((s) => s.id), ['g1', 'g2'])
  assert.equal(amb.google.calls.length, 0)
  assert.equal(resolveQuestionService('une guidance visio mardi', services).service.id, 'g1')
})

// ── 14. Aucune fuite Google ─────────────────────────────────────────────────

test('14. aucun titre, description, lieu, participant, jeton ni identifiant d’agenda vers Lumia', async () => {
  const events = [ev('2026-10-13T12:00:00Z', '2026-10-13T13:00:00Z', { summary: 'Rendez-vous médical Dr Secret' })]
  const { text, google } = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { events })
  for (const leaked of ['Secret', 'médical', 'Notes privées', '1234', 'rue Secrète', 'invite.prive', 'cal-a@', 'tok-a', 'Bearer', 'access_token', 'refresh']) {
    assert.ok(!text.includes(leaked), leaked)
  }
  // Ni l'horaire de l'événement : seulement des créneaux libres.
  assert.ok(!text.includes('2026-10-13T12:00:00.000Z'))
  const url = new URL(google.calls[0].url)
  assert.equal(google.calls[0].method, 'GET')
  assert.equal(url.searchParams.get('fields'), 'items(status,transparency,summary,start,end),nextPageToken')
  assert.ok(!/description|attendees|location/.test(url.searchParams.get('fields')))
})

// ── 15. Panne Google ────────────────────────────────────────────────────────

test('15. panne Google : aucune disponibilité déclarée certaine', async () => {
  for (const fail of [500, 401, 'throw']) {
    const { payload, text } = await ask('Est-ce que mercredi à 14h est libre pour une guidance ?', { fail })
    assert.equal(payload.status, 'calendar_unavailable', String(fail))
    assert.deepEqual(payload.slots, [])
    assert.equal(payload.check.free, null)
    assert.match(text, /ne confirme AUCUN créneau comme libre/)
  }
  const search = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { fail: 503 })
  assert.deepEqual([search.payload.status, search.payload.slots], ['calendar_unavailable', []])
  // Jeton expiré et renouvellement impossible.
  const expired = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: baseTables({ connection: { token_expiry: '2020-01-01T00:00:00Z', refresh_token_enc: 'invalide' } }) })
  assert.deepEqual([expired.payload.status, expired.payload.calendar_connected, expired.payload.slots], ['calendar_unavailable', false, []])
  // Agenda non connecté.
  const t = baseTables()
  t.booking_calendar_connections = t.booking_calendar_connections.filter((c) => c.practitioner_id !== 'pA')
  const none = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables: t })
  assert.deepEqual([none.payload.status, none.payload.calendar_connected], ['calendar_unavailable', false])
  // Panne de la base : erreur levée, agent-chat bascule sur le bloc « indisponible ».
  await assert.rejects(ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { errors: { bookings: { code: '57014' } } }),
    (e) => lumiaAvailabilityLogDetail(e) === 'lumia_availability_unavailable step=bookings code=57014')
  assert.match(LUMIA_AVAILABILITY_UNAVAILABLE, /ne confirme aucun créneau libre/)
})

test('trop d’événements pour tout lire : aucune disponibilité déclarée', async () => {
  const db = fakeDb(baseTables())
  const fetchImpl = async () => new Response(JSON.stringify({ items: [], nextPageToken: 'encore' }), { status: 200 })
  const text = await loadLumiaAvailabilityContext({ db, userId: OWNER_A, question: 'libre mardi pour une guidance ?', now: NOW, fetchImpl })
  const payload = JSON.parse(text.split('\n')[2])
  assert.deepEqual([payload.status, payload.reason, payload.slots], ['calendar_unavailable', 'calendar_too_many_events', []])
})

// ── 16. Isolation des comptes ───────────────────────────────────────────────

test('16. isolation owner A / B : praticien, prestations, règles et agenda du seul compte connecté', async () => {
  const tables = baseTables({ bookings: [{ practitioner_id: 'pB', status: 'confirmed', starts_at: iso('2026-10-13T07:00:00Z'), ends_at: iso('2026-10-13T08:00:00Z') }] })
  const a = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables })
  assert.equal(times(a.payload, '2026-10-13')[0], '09:00', 'la réservation de B ne bloque pas A')
  assert.ok(!times(a.payload, '2026-10-13').includes('07:00'), 'les règles de B ne s’appliquent pas à A')
  assert.ok(a.google.calls.every((c) => c.url.includes(encodeURIComponent('cal-a@group.calendar.google.com'))))
  assert.ok(!a.text.includes('Tarot'))

  // Owner A ne peut pas viser la prestation de B.
  const tarot = await ask('Qu’est-ce que j’ai de libre samedi pour un tarot ?', { tables })
  assert.equal(tarot.payload.status, 'service_required')
  assert.equal(tarot.google.calls.length, 0)

  // Owner B voit ses propres données, avec son agenda.
  const b = await ask('Qu’est-ce que j’ai de libre samedi pour un tarot ?', { tables, owner: OWNER_B })
  assert.equal(b.payload.service.id, 'svc-b')
  assert.ok(b.google.calls.every((c) => c.url.includes(encodeURIComponent('cal-b@group.calendar.google.com'))))

  // Compte sans praticien : rien.
  const c = await ask('Qu’est-ce que j’ai de libre mardi pour une guidance ?', { tables, owner: 'owner-c' })
  assert.deepEqual([c.payload.status, c.payload.slots, c.google.calls.length], ['no_practitioner', [], 0])
})

// ── 17. Question hors disponibilités ────────────────────────────────────────

test('capacité Google : « As-tu accès à mon agenda Google ? » ne consulte ni Google ni la DB disponibilité', async () => {
  for (const question of [
    'As-tu accès à mon agenda Google ?',
    'Est-ce que tu as accès à mon agenda Google ?',
    'Peux-tu accéder à Google Agenda ?',
  ]) {
    assert.equal(isAvailabilityQuestion(question), false, question)
    assert.equal(parseAvailabilityQuestion(question, NOW), null, question)
    const { text, payload, db, google } = await ask(question)
    assert.equal(text, '', question)
    assert.equal(payload, null, question)
    assert.deepEqual(db.log.tables, [], question)
    assert.deepEqual(db.log.writes, [], question)
    assert.equal(google.calls.length, 0, question)
  }
})

test('17. question hors disponibilités : aucune requête, aucun appel Google', async () => {
  for (const q of [
    'Résume mes messages d’hier', 'Qui attend encore une réponse ?', 'Quels messages parlent de créneaux ?',
    'Qui m’a demandé un créneau cette semaine ?', 'Combien de rendez-vous ai-je eu en septembre ?', 'Montre-moi uniquement les annulations',
    buildLumiaPolicyInstructions(),
  ]) {
    const { text, db, google } = await ask(q)
    assert.equal(text, '', q.slice(0, 40))
    assert.equal(db.log.tables.length, 0, q.slice(0, 40))
    assert.equal(google.calls.length, 0, q.slice(0, 40))
  }
  for (const q of ['Qu’est-ce que j’ai de libre mardi ?', 'J’ai quoi comme disponibilités entre lundi et vendredi ?', 'Trouve-moi 3 créneaux pour une guidance', 'Est-ce que mercredi à 14h est libre ?', 'Mathilde veut un rendez-vous urgent, qu’est-ce que j’ai de libre ?']) {
    assert.equal(isAvailabilityQuestion(q), true, q)
  }
})

// ── 18. Créneau précis ──────────────────────────────────────────────────────

test('18. « mercredi 14h est-il libre ? »', async () => {
  const free = await ask('Est-ce que mercredi à 14h est libre pour une guidance ?')
  assert.equal(free.payload.query.kind, 'check')
  assert.deepEqual(free.payload.check, {
    local_date: '2026-10-14', local_time: '14:00', duration_min: 60,
    starts_at: '2026-10-14T12:00:00.000Z', ends_at: '2026-10-14T13:00:00.000Z',
    free: true, reason: null, within_availability: true,
  })
  const busy = await ask('Mercredi 14h est-il libre pour une guidance ?', { events: [ev('2026-10-14T12:30:00Z', '2026-10-14T13:30:00Z')] })
  assert.deepEqual([busy.payload.check.free, busy.payload.check.reason], [false, 'google_busy'])
  assert.deepEqual(busy.payload.slots.map((s) => s.local_time), ['09:00', '10:00', '11:00'], 'alternatives du même jour')
  const outside = await ask('Est-ce que mercredi à 12h30 est libre pour une guidance ?')
  assert.deepEqual([outside.payload.check.free, outside.payload.check.reason], [false, 'outside_availability'])
  // Sans prestation : durée explicite exigée, sinon aucun appel Google.
  const noService = await ask('Est-ce que mercredi à 14h est libre ?')
  assert.deepEqual([noService.payload.status, noService.google.calls.length], ['service_required', 0])
  const explicit = await ask('Est-ce que mercredi à 14h est libre pour 45 min ?')
  assert.deepEqual([explicit.payload.duration_source, explicit.payload.check.duration_min, explicit.payload.check.free], ['explicit', 45, true])
})

// ── 19. Recherche de N créneaux ─────────────────────────────────────────────

test('19. « donne-moi 3 créneaux pour une guidance la semaine prochaine »', async () => {
  const { payload } = await ask('Donne-moi 3 créneaux pour une guidance la semaine prochaine')
  assert.deepEqual([payload.requested_period.from, payload.requested_period.to], ['2026-10-19', '2026-10-25'])
  assert.equal(payload.query.requested_count, 3)
  assert.equal(payload.slots.length, 6, 'assez de candidats pour choisir, contexte compact')
  assert.equal(payload.total_free_slots, 35)
  assert.equal(payload.truncated, true)
  assert.ok(new Set(payload.slots.map((s) => s.local_date)).size >= 3, 'répartis sur plusieurs jours')
  assert.ok(payload.slots.every((s) => s.local_date >= '2026-10-19' && s.local_date <= '2026-10-23'))
  assert.deepEqual(payload.slots.map((s) => s.starts_at), [...payload.slots.map((s) => s.starts_at)].sort())
  assert.ok(payload.days_without_slot.some((d) => d.local_date === '2026-10-24' && d.status === 'outside_availability'))
})

// ── 20. Europe/Paris, heure d'été / d'hiver ─────────────────────────────────

test('20. Europe/Paris et passage à l’heure d’hiver (25 octobre 2026)', async () => {
  const now = new Date('2026-10-18T08:00:00Z') // dimanche
  const parsed = parseAvailabilityQuestion('dispo semaine prochaine pour une guidance ?', now)
  assert.deepEqual([parsed.from, parsed.to], ['2026-10-19', '2026-10-25'])
  const before = await ask('Qu’est-ce que j’ai de libre vendredi pour une guidance ?', { now })
  assert.equal(before.payload.slots[0].starts_at, '2026-10-23T07:00:00.000Z') // 09:00 UTC+2
  assert.equal(before.payload.slots[0].local_time, '09:00')
  const after = await ask('Qu’est-ce que j’ai de libre lundi 26 octobre pour une guidance ?', { now, events: [ev('2026-10-26T09:00:00Z', '2026-10-26T10:00:00Z')] })
  assert.equal(after.payload.slots[0].starts_at, '2026-10-26T08:00:00.000Z') // 09:00 UTC+1
  assert.deepEqual(times(after.payload, '2026-10-26'), ['09:00', '11:00', '14:00', '15:00', '16:00', '17:00'], '10:00 Paris = 09:00Z occupé')
  // Heure d'été (mars).
  const spring = await ask('Est-ce que le 30 mars à 9h est libre pour une guidance ?', { now: new Date('2027-03-20T10:00:00Z') })
  assert.equal(spring.payload.check.starts_at, '2027-03-30T07:00:00.000Z')
})

test('parseur : périodes à venir, en heure de Paris', () => {
  const now = new Date('2026-10-04T21:30:00Z') // dimanche 4 octobre 23:30 à Paris (UTC 21:30)
  const p = (q) => parseAvailabilityQuestion(q, now)
  assert.equal(p('libre aujourd’hui pour 60 min ?').from, '2026-10-04', 'date de Paris, pas UTC')
  assert.equal(p('libre demain ?').from, '2026-10-05')
  assert.equal(p('libre mardi ?').from, '2026-10-06')
  assert.equal(p('libre dimanche ?').from, '2026-10-04')
  assert.equal(p('libre dimanche prochain ?').from, '2026-10-11')
  assert.deepEqual([p('dispo cette semaine ?').from, p('dispo cette semaine ?').to], ['2026-10-04', '2026-10-04'])
  assert.deepEqual([p('dispo semaine prochaine ?').from, p('dispo semaine prochaine ?').to], ['2026-10-05', '2026-10-11'])
  assert.deepEqual([p('disponibilités entre lundi et vendredi ?').from, p('disponibilités entre lundi et vendredi ?').to], ['2026-10-05', '2026-10-09'])
  assert.deepEqual([p('disponibilités du 3 au 5 janvier ?').from, p('disponibilités du 3 au 5 janvier ?').to], ['2027-01-03', '2027-01-05'])
  assert.equal(p('libre le 2 octobre ?').from, '2027-10-02', 'date passée sans année : l’an prochain')
  assert.equal(p('libre le 12/10 à 14h30 ?').time, '14:30')
  assert.equal(p('libre le 12/10 ?').time, null, 'une date numérique n’est pas une heure')
  assert.equal(p('dispo ?').defaulted, true)
  assert.equal(p('dispo du 1er au 31 décembre ?').truncated, true)
  assert.equal(p('libre mardi après-midi ?').partOfDay, 'apres_midi')
  assert.equal(p('trouve-moi trois créneaux').count, 3)
})

// ── Cohérence avec les contrôles de réservation / de lien personnel ─────────

test('cohérence : tout créneau LIBRE pour Lumia est accepté par les contrôles de réservation et de la page publique', async () => {
  const bookings = [{ practitioner_id: 'pA', status: 'confirmed', starts_at: iso('2026-10-13T08:00:00Z'), ends_at: iso('2026-10-13T09:00:00Z') }]
  const events = [
    ev('2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z'),
    ev('2026-10-15T07:00:00Z', '2026-10-15T10:00:00Z', { summary: 'Urgence' }),
    ev('2026-10-16T13:30:00Z', '2026-10-16T14:00:00Z', { transparency: 'transparent' }),
  ]
  const exceptions = [{ practitioner_id: 'pA', exception_date: '2026-10-16', exception_type: 'modified', slots: [{ start_time: '10:00', end_time: '17:00' }] }]
  const practitioner = { buffer_before_min: 15, buffer_after_min: 10, min_advance_hours: 30, max_per_day: 6, booking_horizon_days: 30 }
  const tables = baseTables({ bookings, exceptions, practitioner })
  const { payload } = await ask('J’ai quoi comme disponibilités entre lundi et vendredi pour une guidance ?', { tables, events })
  assert.ok(payload.slots.length > 0)

  // FreeBusy de Google pour les contrôles existants (rdv-book / arrhes) :
  // tout événement opaque non annulé est occupé, « Urgence » compris.
  const busy = events.filter((e) => e.status !== 'cancelled' && e.transparency !== 'transparent').map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }))
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const { timeMin, timeMax } = JSON.parse(init.body)
    return new Response(JSON.stringify({ calendars: { 'cal-a@group.calendar.google.com': { busy: busy.filter((b) => b.start < timeMax && b.end > timeMin) } } }), { status: 200 })
  }
  const realNow = Date.now
  Date.now = () => NOW.getTime()
  try {
    const db = fakeDb(tables)
    const p = tables.booking_practitioners[0]
    const service = { id: 'svc-guidance', duration_min: 60 }
    // Tous les créneaux libres de la période, jour par jour (pas seulement les 12 affichés).
    const all = { payload: { slots: [] } }
    for (const day of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) {
      all.payload.slots.push(...(await ask(`Qu’est-ce que j’ai de libre ${day} pour une guidance ?`, { tables, events })).payload.slots)
    }
    assert.ok(all.payload.slots.length > payload.slots.length)
    for (const slot of all.payload.slots) {
      await validateServerAvailability({ supabase: db, practitioner: p, service, date: slot.local_date, time: slot.local_time })
    }
    // Un créneau refusé par Lumia l'est aussi par le contrôle existant.
    await assert.rejects(validateServerAvailability({ supabase: db, practitioner: p, service, date: '2026-10-14', time: '14:00' }), /slot_unavailable/)
    await assert.rejects(validateServerAvailability({ supabase: db, practitioner: p, service, date: '2026-10-12', time: '14:00' }), /slot_too_soon/)

    // Grille publique (api/rdv-availability.js) : chaque créneau libre y est disponible.
    for (const date of new Set(all.payload.slots.map((s) => s.local_date))) {
      const exc = exceptions.find((e) => e.exception_date === date)
      const rules = exc ? exc.slots : tables.booking_availability_rules.filter((r) => r.practitioner_id === 'pA' && r.day_of_week === (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)
      const publicSlots = generateSlots(date, rules, busy, extendIntervals(bookings, 15 * 60_000, 10 * 60_000), parisUTCOffsetMs(date), 60, 15 * 60_000, 10 * 60_000)
      const open = new Set(publicSlots.filter((s) => s.available).map((s) => s.time))
      for (const s of all.payload.slots.filter((x) => x.local_date === date)) assert.ok(open.has(s.local_time), `${date} ${s.local_time}`)
    }
  } finally {
    globalThis.fetch = realFetch
    Date.now = realNow
  }
})

test('cohérence urgence : tout créneau d’urgence LIBRE passe les contrôles du lien personnel (sans créer d’offre)', async () => {
  const bookings = [{ practitioner_id: 'pA', status: 'confirmed', starts_at: iso('2026-10-15T12:00:00Z'), ends_at: iso('2026-10-15T13:00:00Z') }]
  const events = [
    ev('2026-10-15T07:00:00Z', '2026-10-15T10:00:00Z', { summary: 'Urgence' }),
    ev('2026-10-15T14:00:00Z', '2026-10-15T15:00:00Z', { summary: 'Perso' }),
    ev('2026-10-17T08:00:00Z', '2026-10-17T10:00:00Z', { summary: 'Urgence samedi' }),
  ]
  const tables = baseTables({ bookings, practitioner: { buffer_before_min: 10, buffer_after_min: 10 } })
  const { payload, db } = await ask('Urgence : qu’est-ce que j’ai de libre entre jeudi et samedi pour une guidance ?', { tables, events })
  assert.ok(payload.slots.length > 0)
  const google = fakeGoogle(events)
  const p = tables.booking_practitioners[0]
  for (const slot of payload.slots) {
    const startsAt = new Date(slot.starts_at)
    const endsAt = new Date(slot.ends_at)
    assert.ok(startsAt.getTime() > NOW.getTime() + 30 * 60_000)
    await checkOfferCalendar({ supabase: db, practitioner: p, startsAt, endsAt, fetchImpl: google.fetchImpl })
    await checkNoBookingOverlap({ supabase: db, practitionerId: 'pA', startsAt, endsAt })
  }
  assert.deepEqual(db.log.writes, [], 'aucune offre ni réservation créée')
})

// ── Lecture seule ───────────────────────────────────────────────────────────

test('lecture seule : aucune écriture en base ni dans Google ; seul le renouvellement technique du jeton est permis', async () => {
  const { db, google } = await ask('Trouve-moi 3 créneaux pour une guidance la semaine prochaine', { events: [ev('2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z')] })
  assert.deepEqual(db.log.writes, [])
  assert.ok(google.calls.every((c) => c.method === 'GET' && /\/calendar\/v3\/calendars\/[^/]+\/events\?/.test(c.url)))
  for (const file of ['lib/rdvAvailability.js', 'lib/lumiaAvailabilityContext.js']) {
    const src = read(file)
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete|rpc)\s*\(/, file)
    assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/, file)
    assert.doesNotMatch(src, /console\./, `${file} : aucun log de données`)
  }
  assert.deepEqual(LUMIA_ALLOWED_ACTIONS, ['mediumia.booking.cancel'])
})

test('politique : disponibilité déterministe, jamais inventée, Google indisponible, lecture seule', () => {
  const policy = buildLumiaPolicyInstructions()
  assert.equal(LUMIA_POLICY_VERSION, '2026-10-06.1')
  for (const re of [
    /résultat déterministe du moteur MediumIA \+ Google Agenda/,
    /N'invente jamais un créneau/,
    /« calendar_unavailable ».*ne confirme jamais qu'un créneau est libre/,
    /Une disponibilité proposée n'est pas une réservation/,
    /Une question de disponibilité ne déclenche aucune action/,
    /Tu ne connais ni le titre ni le contenu des événements Google/,
    /Action actuellement autorisée : annuler un rendez-vous MediumIA confirmé/,
    /ACTIONS AUTORISEES : mediumia\.booking\.cancel/,
  ]) assert.match(policy, re)
})

test('agent-chat : disponibilités chargées une fois, depuis le seul message de Sébastien, panne = bloc « indisponible »', () => {
  const src = read('api/agent-chat.js')
  assert.equal((src.match(/loadLumiaAvailabilityContext\(/g) || []).length, 1)
  assert.match(src, /loadLumiaAvailabilityContext\(\{ db, userId: auth\.userId, question: cleanMessage \}\)/)
  assert.match(src, /availabilityContext = LUMIA_AVAILABILITY_UNAVAILABLE/)
  assert.match(src, /lumiaAvailabilityLogDetail\(error\)/)
  assert.match(src, /\[knowledge\.text, liveRdvContext, inboxContext, availabilityContext\]/)
  // Logique métier hors d'agent-chat.
  assert.doesNotMatch(src, /googleapis|booking_availability_rules|computeAvailability|Urgence/)
})
