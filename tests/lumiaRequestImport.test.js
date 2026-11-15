import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LUMIA_REQUEST_IMPORT_ACTION, detectRequestKind, matchRelatedBooking, buildImportItem, classifyImportCandidates, formatExecutionReply, formatScanReply,
  guessModality, guessServiceHint, importCriteria, maybeHandleLumiaRequestImportChat, parseRequestImportCommand, requestImportEnabled,
} from '../lib/lumiaRequestImport.js'
import { LUMIA_ALLOWED_ACTIONS } from '../lib/lumiaPolicy.js'
import { LUMIA_NO_PROVIDER_REPLY } from '../lib/lumiaRequestImport.js'
import { parseInboxQuestion } from '../lib/lumiaMessageInbox.js'

const NOW = new Date('2026-11-15T10:00:00Z')
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

const row = (id, conv, at, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  source_channel: 'sms', source_conversation_id: conv, source_message_id: `guid-${id}`,
  counterpart: '+33600000001', sender: '+33600000001', message_text: 'Bonjour, je voudrais un rendez-vous de guidance en visio',
  message_sent_at: at, classification: 'probable', is_from_me: false, ...extra,
})
const conv = (key, rows, extra = {}) => ({ key, channel: 'sms', conversation_id: key, counterpart: rows[0].counterpart, rows, ...extra })

test('commande : la demande de Sébastien lance une analyse ; GO avec code et sélection', () => {
  assert.equal(parseRequestImportCommand('Analyse mes SMS, iMessages et RCS depuis le 1er novembre 2026, puis intègre les demandes détectées dans ma liste « Demandes de RDV à traiter »').kind, 'scan')
  assert.equal(parseRequestImportCommand('Ajoute à ma liste à traiter les demandes de mes messages de la semaine').kind, 'scan')
  assert.equal(parseRequestImportCommand('Quelles demandes de mes messages ne sont pas encore dans ma liste ?').kind, 'scan')
  // Questions de lecture : jamais une action.
  for (const q of ['Qui m’a écrit hier ?', 'Résume mes SMS de la semaine', 'Quelles demandes de rendez-vous ai-je reçues ?', 'Ajoute une note']) {
    assert.equal(parseRequestImportCommand(q).kind, 'none', q)
  }
  assert.deepEqual(parseRequestImportCommand('GO #A1B2C3'), { kind: 'approve', shortCode: '#A1B2C3', selection: { all: true, numbers: [] } })
  assert.deepEqual(parseRequestImportCommand('go #a1b2c3 1, 3 et 4').selection, { all: false, numbers: [1, 3, 4] })
  assert.deepEqual(parseRequestImportCommand('GO #A1B2C3 2-4').selection.numbers, [2, 3, 4])
  assert.deepEqual(parseRequestImportCommand('GO 2').selection.numbers, [2])
  assert.equal(parseRequestImportCommand('go pour la guidance de demain').kind, 'none')
})

test('période : « depuis le 1er novembre 2026 » va jusqu’à maintenant, trois canaux = aucun filtre', () => {
  const c = parseInboxQuestion('Analyse mes SMS, iMessages et RCS depuis le 1er novembre 2026', NOW)
  assert.equal(c.from, '2026-10-31T23:00:00.000Z')
  assert.equal(c.to, NOW.toISOString())
  assert.equal(c.channel, null)
  assert.equal(parseInboxQuestion('mes sms depuis le 03/11', NOW).from, '2026-11-02T23:00:00.000Z')
  assert.equal(parseInboxQuestion('mes SMS de la semaine', NOW).channel, 'sms')
  // Inchangé : « le 1er novembre » reste ce seul jour.
  assert.equal(parseInboxQuestion('messages reçus le 1er novembre', NOW).to, '2026-11-01T23:00:00.000Z')
  const d = importCriteria('ajoute les demandes de mes messages à ma liste', NOW)
  assert.equal(d.defaulted, true)
  assert.equal(d.from, '2026-11-01T10:00:00.000Z')
})

test('rapprochement : nouveau, déjà ouvert, déjà importé, traité puis relancé, même numéro', () => {
  const conversations = [
    conv('c-new', [row(1, 'c-new', '2026-11-03T09:00:00Z')]),
    conv('c-open', [row(2, 'c-open', '2026-11-04T09:00:00Z', { counterpart: '+33600000002' })]),
    conv('c-imported', [row(3, 'c-imported', '2026-11-05T09:00:00Z', { counterpart: '+33600000003' })]),
    conv('c-handled-again', [
      row(4, 'c-handled-again', '2026-11-02T09:00:00Z', { counterpart: '+33600000004' }),
      row(5, 'c-handled-again', '2026-11-10T09:00:00Z', { counterpart: '+33600000004' }),
    ]),
    conv('c-handled', [row(6, 'c-handled', '2026-11-02T09:00:00Z', { counterpart: '+33600000005' })]),
    conv('c-phone', [row(7, 'c-phone', '2026-11-06T09:00:00Z', { counterpart: '+33600000006' })]),
  ]
  const requests = [
    { id: 'r-open', status: 'pending', source_channel: 'sms', source_conversation_id: 'c-open', created_at: '2026-11-04T10:00:00Z', source_message_at: '2026-11-04T09:00:00Z' },
    { id: 'r-handled1', status: 'handled', source_channel: 'sms', source_conversation_id: 'c-handled-again', created_at: '2026-11-02T10:00:00Z', source_message_at: '2026-11-02T09:00:00Z' },
    { id: 'r-handled2', status: 'scheduled', confirmed_booking_id: 'b1', source_channel: 'sms', source_conversation_id: 'c-handled', created_at: '2026-11-02T10:00:00Z', source_message_at: '2026-11-02T09:00:00Z' },
  ]
  const events = [
    { request_id: 'r-x', source_channel: 'sms', source_message_id: 'guid-3' },
    { request_id: 'r-handled1', source_channel: 'sms', source_message_id: 'guid-4' },
    { request_id: 'r-handled2', source_channel: 'sms', source_message_id: 'guid-6' },
  ]
  const phoneRequests = new Map([['+33600000006', { id: 'r-site', status: 'pending' }]])
  const upcoming = new Map([['+33600000001', { id: 'b-up', starts_at: '2026-11-20T09:00:00Z' }]])
  const r = classifyImportCandidates({ conversations, requests, events, phoneRequests, upcoming })
  assert.deepEqual(r.proposed.map((c) => c.key), ['c-handled-again', 'c-new'])
  assert.deepEqual(r.proposed[0].fresh.map((m) => m.source_message_id), ['guid-5'], 'seul le message postérieur au dossier traité')
  assert.equal(r.proposed[0].previous_request.status, 'handled')
  assert.equal(r.proposed[1].upcoming_booking.id, 'b-up')
  const reasons = Object.fromEntries(r.existing.map((c) => [c.key, c.reason]))
  assert.deepEqual(reasons, { 'c-open': 'pending', 'c-imported': 'already_imported', 'c-handled': 'scheduled', 'c-phone': 'same_phone' })
})

test('deuxième analyse après ajout : plus aucune proposition (pas de doublon)', () => {
  const conversations = [conv('c-new', [row(1, 'c-new', '2026-11-03T09:00:00Z')])]
  const after = classifyImportCandidates({
    conversations,
    requests: [{ id: 'r1', status: 'pending', source_channel: 'sms', source_conversation_id: 'c-new', created_at: '2026-11-15T10:00:00Z', source_message_at: '2026-11-03T09:00:00Z' }],
    events: [{ request_id: 'r1', source_channel: 'sms', source_message_id: 'guid-1' }],
  })
  assert.equal(after.proposed.length, 0)
  assert.equal(after.existing[0].reason, 'pending')
  // Même si Sébastien l'archive ensuite : toujours rien à reproposer.
  const archived = classifyImportCandidates({
    conversations,
    requests: [{ id: 'r1', status: 'handled', source_channel: 'sms', source_conversation_id: 'c-new', created_at: '2026-11-15T10:00:00Z', source_message_at: '2026-11-03T09:00:00Z' }],
    events: [{ request_id: 'r1', source_channel: 'sms', source_message_id: 'guid-1' }],
  })
  assert.equal(archived.proposed.length, 0)
})

test('élément du preview : références seulement, jamais de texte ; indices sans invention', () => {
  const c = { fresh: [row(1, 'c', '2026-11-03T09:00:00Z', { message_text: 'Une guidance en visio par FaceTime svp' })] }
  const item = buildImportItem(c, 1)
  assert.equal(item.modality, 'video')
  assert.equal(item.video_channel, 'facetime')
  assert.equal(item.service_hint, 'guidance')
  assert.equal(item.preferred_period, null)
  assert.ok(!JSON.stringify(item).includes('FaceTime svp'))
  assert.equal(guessModality('Je peux passer au cabinet ?'), 'in-person')
  assert.equal(guessModality('Bonjour, dispo jeudi ?'), 'unknown')
  assert.equal(guessServiceHint('Bonjour'), null)
})

test('réponses : proposition numérotée avec code GO ; résultat sans promesse non tenue', () => {
  const candidate = { key: 'c', channel: 'sms', counterpart: '+33600000001', fresh: [row(1, 'c', '2026-11-03T09:00:00Z')], rows: [] }
  const text = formatScanReply({
    criteria: { label: 'depuis le 2026-11-01', channel: null, defaulted: false },
    scanned: 1, conversations: 1, result: { proposed: [candidate], existing: [] }, intent: { short_code: '#ABC123' }, names: new Map(), truncated: false,
  })
  assert.match(text, /— depuis le 1er novembre 2026 ·/)
  assert.match(text, /1\. Nouvelle demande · À vérifier · \+33600000001 · SMS · probable ·/)
  assert.doesNotMatch(text, /rendez_vous|reserver/)
  assert.match(text, /GO #ABC123/)
  assert.doesNotMatch(text, /GO #ABC123 1,3/, 'un seul dossier : pas d’exemple de sélection')
  const two = formatScanReply({
    criteria: { label: 'hier', channel: 'sms', defaulted: false },
    scanned: 2, conversations: 2, result: { proposed: [candidate, { ...candidate, key: 'd' }], existing: [] }, intent: { short_code: '#ABC123' }, names: new Map(), truncated: false,
  })
  assert.match(two, /GO #ABC123 1,3/)
  assert.match(text, /aucun rendez-vous confirmé, modifié ou annulé, aucun message envoyé/)
  assert.match(formatExecutionReply({ status: 'succeeded', created: 1, items: [{ n: 1, outcome: 'created' }, { n: 2, outcome: 'already_open' }] }), /1 demande ajoutée[\s\S]*n°2 \(une demande ouverte existe déjà\)/)
  assert.match(formatExecutionReply({ status: 'failed', reason: 'preview_expired' }), /Aucune demande n’a été créée/)
})

test('verrous : liste blanche + LUMIA_REQUEST_IMPORT_ENABLED ; désactivé = rien en base', async () => {
  assert.ok(LUMIA_ALLOWED_ACTIONS.includes(LUMIA_REQUEST_IMPORT_ACTION))
  const db = new Proxy({}, { get() { throw new Error('db must not be touched') } })
  const off = await maybeHandleLumiaRequestImportChat({ db, userId: 'u', conversationId: 'c', message: 'Ajoute les demandes de mes messages à ma liste à traiter', env: {} })
  assert.equal(off.handled, true)
  assert.match(off.reply, /pas encore activé/)
  assert.equal(await maybeHandleLumiaRequestImportChat({ db, userId: 'u', conversationId: 'c', message: 'GO #ABC123', env: {} }), null)
  assert.equal(await maybeHandleLumiaRequestImportChat({ db, userId: 'u', conversationId: 'c', message: 'Bonjour Lumia', env: { LUMIA_REQUEST_IMPORT_ENABLED: 'true' } }), null)
  // Base TEST : actif ; Production : éteint sans le drapeau explicite.
  const test = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
  assert.equal(requestImportEnabled({ SUPABASE_URL: test, VERCEL_ENV: 'preview' }), true)
  assert.equal(requestImportEnabled({ SUPABASE_URL: test, VERCEL_ENV: 'production' }), false)
  assert.equal(requestImportEnabled({ SUPABASE_URL: 'https://uotkpygeqqnekpolezts.supabase.co', VERCEL_ENV: 'preview' }), false)
  assert.equal(requestImportEnabled({ SUPABASE_URL: test, LUMIA_REQUEST_IMPORT_ENABLED: 'false' }), false)
  assert.equal(requestImportEnabled({ VERCEL_ENV: 'production', LUMIA_REQUEST_IMPORT_ENABLED: 'true' }), true)
})

test('SQL : l’exécuteur ne crée que des demandes, ne modifie rien d’existant, relit les textes RDV en base', () => {
  const sql = read('supabase/migrations/20261115090000_lumia_booking_request_import.sql')
  const body = sql.slice(sql.indexOf('FUNCTION public.lumia_execute_booking_request_import'))
  const fn = body.slice(0, body.indexOf('REVOKE ALL'))
  assert.match(fn, /lumia_require_service_role/)
  assert.match(fn, /m\.classification IN \('probable', 'incertain'\)/)
  assert.match(fn, /m\.is_from_me = false/)
  assert.match(fn, /'already_imported'/)
  assert.match(fn, /'already_open'/)
  assert.match(fn, /'booking_created', false, 'calendar_written', false, 'message_sent', false/)
  assert.doesNotMatch(fn, /UPDATE public\.booking_requests|INSERT INTO public\.bookings|DELETE FROM/)
  assert.doesNotMatch(fn, /confirm_booking_request|google_event|calendar_sync/i)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.lumia_execute_booking_request_import\(UUID, UUID, UUID, INTEGER\[\]\) FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /'sms', 'imessage', 'rcs', 'whatsapp'/)
})

test('agent-chat : import traité avant l’annulation, sur la seule conversation Lumia authentifiée', () => {
  const src = read('api/agent-chat.js')
  assert.match(src, /import \{ LUMIA_NO_PROVIDER_REPLY, maybeHandleLumiaRequestImportChat \} from '\.\.\/lib\/lumiaRequestImport\.js'/)
  const i = src.indexOf('maybeHandleLumiaRequestImportChat({')
  assert.ok(i > src.indexOf("agent.metadata?.purpose === 'lumia_rdv_assistant' && !auth.rehearsal"))
  assert.ok(i < src.indexOf('maybeHandleLumiaBookingCancelChat({'))
  const lib = read('lib/lumiaRequestImport.js')
  assert.doesNotMatch(lib, /\.from\('booking_requests'\)\s*\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(lib, /\.from\('bookings'\)\s*\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(lib, /sendEmail|sendSms|googleapis|syncBookingToGoogleCalendar/)
})

// ── Régression #46FC77 : la recherche Inbox ne sélectionnait pas source_message_id ──
// Base factice qui, comme PostgREST, ne renvoie QUE les colonnes demandées.
function projectingDb(tables, { dropColumns = [] } = {}) {
  const rpcs = []
  class Q {
    constructor(t) { this.t = t; this.f = []; this.cols = null; this.op = 'select' }
    select(c) { if (this.op === 'select') this.cols = c; return this }
    eq(c, v) { this.f.push((r) => r[c] === v); return this }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this }
    in(c, v) { this.f.push((r) => v.includes(r[c])); return this }
    gte(c, v) { this.f.push((r) => r[c] != null && r[c] >= v); return this }
    gt(c, v) { this.f.push((r) => r[c] != null && r[c] > v); return this }
    lt(c, v) { this.f.push((r) => r[c] != null && r[c] < v); return this }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this }
    not(c, _op, v) { this.f.push((r) => (r[c] ?? null) !== v); return this }
    order() { return this }
    limit() { return this }
    update() { this.op = 'update'; return this }
    insert() { this.op = 'insert'; return this }
    then(res) {
      if (this.op !== 'select') return res({ data: [], error: null })
      const keep = !this.cols || this.cols.trim() === '*' ? null : this.cols.split(',').map((c) => c.trim()).filter((c) => !dropColumns.includes(c))
      const rows = (tables[this.t] || []).filter((r) => this.f.every((fn) => fn(r)))
        .map((r) => (keep ? Object.fromEntries(keep.map((c) => [c, r[c]])) : r))
      return res({ data: rows, error: null })
    }
  }
  return {
    rpcs,
    from: (t) => new Q(t),
    rpc: async (name, args) => { rpcs.push({ name, args }); return { data: { short_code: '#46FC77', status: 'preview' }, error: null } },
  }
}

const OWNER = '2b6cdd7b-a552-49c6-b9b1-76be26b9c745'
const inboxTables = () => ({
  booking_practitioners: [{ id: '7dcf2820-edb2-412b-b418-2a67fbf824ea', slug: 'sebastien-seguin', owner_id: OWNER }],
  lumia_message_inbox: [
    // Le message réel de la proposition #46FC77.
    { id: 'b3bc5e5c-3c57-4d3f-91ec-376fc3696985', owner_id: OWNER, source_channel: 'rcs', source_message_id: 'demo-msg-e1', source_conversation_id: 'demo-conv-e',
      sender: '+33600000105', counterpart: '+33600000105', message_text: '[TEST] Bonjour, je dois annuler mon rendez-vous de mardi, désolée.',
      message_sent_at: '2026-11-08T07:40:00+00:00', received_at: '2026-11-15T08:50:48+00:00', is_from_me: false, classification: 'probable' },
    // Déjà importé dans un dossier archivé : ne doit jamais être reproposé.
    { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', owner_id: OWNER, source_channel: 'sms', source_message_id: 'demo-msg-z1', source_conversation_id: 'demo-conv-z',
      sender: '+33600000109', counterpart: '+33600000109', message_text: '[TEST] Je voudrais une guidance', message_sent_at: '2026-11-09T07:40:00+00:00',
      received_at: '2026-11-15T08:50:48+00:00', is_from_me: false, classification: 'probable' },
  ],
  booking_requests: [{ id: 'r-z', practitioner_id: '7dcf2820-edb2-412b-b418-2a67fbf824ea', intake_agent: 'lumia', status: 'handled', source_channel: 'sms',
    source_conversation_id: 'demo-conv-z', source_message_at: null, created_at: '2026-11-10T00:00:00+00:00', confirmed_booking_id: null, customer_phone: '+33600000109' }],
  booking_request_intake_events: [{ request_id: 'r-z', source_channel: 'sms', source_message_id: 'demo-msg-z1' }],
  bookings: [], mediumia_customers: [], lumia_action_intents: [], lumia_action_attempts: [],
})
const SCAN = 'Analyse mes SMS, iMessages et RCS depuis le 1er novembre 2026, puis intègre les demandes détectées dans ma liste « Demandes de RDV à traiter »'
const TEST_ENV = { SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co', VERCEL_ENV: 'preview' }

test('régression #46FC77 : la proposition porte le vrai source_message_id, retrouvable par l’exécuteur', async () => {
  const { COLUMNS } = await import('../lib/lumiaMessageInbox.js')
  assert.match(COLUMNS, /\bsource_message_id\b/)
  const tables = inboxTables()
  const db = projectingDb(tables)
  const out = await maybeHandleLumiaRequestImportChat({ db, userId: OWNER, conversationId: 'c', message: SCAN, env: TEST_ENV, now: NOW })
  const create = db.rpcs.find((c) => c.name === 'lumia_create_action_intent')
  assert.ok(create, out.reply)
  const items = create.args.p_canonical_payload.items
  // Un seul dossier : demo-msg-z1 est déjà importé (contrôle par identifiant, pas seulement par conversation).
  assert.deepEqual(items.map((i) => [i.channel, i.source_message_id]), [['rcs', 'demo-msg-e1']])
  // Même recherche que lumia_execute_booking_request_import : canal + identifiant, reçu, classé RDV.
  for (const item of items) {
    const anchor = tables.lumia_message_inbox.find((m) => m.owner_id === OWNER && m.source_channel === item.channel
      && m.source_message_id === item.source_message_id && m.is_from_me === false && ['probable', 'incertain'].includes(m.classification))
    assert.ok(anchor, `source_unavailable pour n°${item.n}`)
    assert.ok(item.message_ids.includes(anchor.id))
  }
})

test('régression #46FC77 : sans identifiant source, aucune proposition n’est créée (échec fermé)', async () => {
  const db = projectingDb(inboxTables(), { dropColumns: ['source_message_id'] })
  const out = await maybeHandleLumiaRequestImportChat({ db, userId: OWNER, conversationId: 'c', message: SCAN, env: TEST_ENV, now: NOW })
  assert.equal(db.rpcs.length, 0, 'aucune intention créée')
  assert.match(out.reply, /sans identifiant source fiable/)
  assert.throws(() => buildImportItem({ fresh: [{ id: 'b3bc5e5c-3c57-4d3f-91ec-376fc3696985', source_channel: 'rcs', message_text: 'x' }] }, 1), /import_item_without_source_id/)
})

test('source_message_id n’entre jamais dans le contexte transmis au modèle', async () => {
  const { buildLumiaInboxContext } = await import('../lib/lumiaMessageInbox.js')
  const row = { ...inboxTables().lumia_message_inbox[0], intents: [] }
  const text = buildLumiaInboxContext({ recent: [row], search: null, names: new Map(), nameLookup: null, coverageFrom: row.message_sent_at, outgoingCoverageFrom: null, generatedAt: NOW.toISOString() })
  assert.ok(text.includes('je dois annuler'))
  assert.ok(!text.includes('demo-msg-e1'))
})

// ── Régression 10 h 26 : contrôle des doublons non reconnu → modèle IA non configuré ──
const RECHECK = 'Analyse à nouveau mes messages depuis le 1er novembre 2026 et vérifie qu\'aucune demande n\'est ajoutée deux fois'

test('régression : la phrase exacte de contrôle des doublons est une commande serveur', () => {
  assert.deepEqual(parseRequestImportCommand(RECHECK), { kind: 'scan', check: true })
  for (const q of [
    'Vérifie qu’il n’y a pas de doublons dans ma liste à traiter',
    'Relance l’analyse de mes messages pour les demandes de rdv',
    'Réanalyse mes SMS depuis le 1er novembre et contrôle les doublons',
    'Peux-tu refaire l’analyse des SMS de la semaine et ajouter les nouvelles demandes ?',
    'Est-ce qu’une demande de mes messages a été ajoutée en double ?',
  ]) assert.equal(parseRequestImportCommand(q).kind, 'scan', q)
  // Lecture seule : restent des questions pour le modèle.
  for (const q of ['Quelles demandes de rendez-vous ai-je reçues ?', 'La cliente veut reporter son rdv, d’après ses messages', 'Résume mes SMS de la semaine', 'Qui m’a écrit hier ?']) {
    assert.equal(parseRequestImportCommand(q).kind, 'none', q)
  }
})

const recheckTables = () => {
  const t = inboxTables()
  // État TEST après #782629 : demo-msg-e1 importé dans une demande ouverte.
  t.lumia_message_inbox = t.lumia_message_inbox.filter((m) => m.source_message_id === 'demo-msg-e1')
  t.booking_requests = [{ id: '43637a28-0c52-48d3-a59b-96d8df7f2fc9', practitioner_id: '7dcf2820-edb2-412b-b418-2a67fbf824ea', intake_agent: 'lumia', status: 'pending',
    source_channel: 'rcs', source_conversation_id: 'demo-conv-e', source_message_at: '2026-11-08T07:40:00+00:00', created_at: '2026-11-15T09:24:48+00:00', confirmed_booking_id: null, customer_phone: '+33600000105' }]
  t.booking_request_intake_events = [{ request_id: '43637a28-0c52-48d3-a59b-96d8df7f2fc9', source_channel: 'rcs', source_message_id: 'demo-msg-e1' }]
  return t
}

test('régression : contrôle des doublons sans IA, aucune proposition ni écriture quand tout est déjà importé', async () => {
  const db = projectingDb(recheckTables())
  const out = await maybeHandleLumiaRequestImportChat({ db, userId: OWNER, conversationId: 'c', message: RECHECK, env: TEST_ENV, now: NOW })
  assert.equal(out.handled, true)
  assert.equal(db.rpcs.length, 0, 'aucune intention, aucune exécution')
  assert.match(out.reply, /Contrôle des doublons \(base MediumIA, sans IA\)/)
  assert.match(out.reply, /1 message de la période déjà importé, chacun une seule fois \(1 demande\)/)
  assert.match(out.reply, /Aucune demande en double/)
  assert.match(out.reply, /Aucun nouveau dossier à ajouter/)
})

test('contrôle des doublons : deux demandes ouvertes pour une conversation ou un numéro sont signalées, jamais modifiées', async () => {
  const t = recheckTables()
  t.booking_requests.push({ ...t.booking_requests[0], id: 'dup-2', created_at: '2026-11-15T09:30:00+00:00' })
  const db = projectingDb(t)
  const out = await maybeHandleLumiaRequestImportChat({ db, userId: OWNER, conversationId: 'c', message: RECHECK, env: TEST_ENV, now: NOW })
  assert.match(out.reply, /⚠︎ 2 demandes ouvertes pour la conversation RCS · demo-conv-e/)
  assert.match(out.reply, /⚠︎ 2 demandes ouvertes pour le numéro \+33600000105/)
  assert.match(out.reply, /Rien n’a été modifié ni supprimé/)
  assert.equal(db.rpcs.length, 0)
})

test('agent-chat : sans fournisseur IA, Lumia répond par les commandes sans IA au lieu d’une erreur', () => {
  const src = read('api/agent-chat.js')
  const fallback = src.indexOf('!lumiaProviderConfigured(provider)')
  assert.ok(fallback > src.indexOf('const providerHistory = buildProviderHistory'))
  assert.ok(fallback < src.indexOf("if (provider === 'anthropic') {"))
  assert.match(src, /isLumiaRdv && !auth\.rehearsal && !lumiaProviderConfigured\(provider\)/)
  // La ligne d'erreur générique, ancre d'un correctif de build, est conservée
  // (le test tourne avant ou après ce correctif : on vérifie la ligne seule).
  assert.match(src, /return res\.status\(502\)\.json\(\{ error: 'Le copilote est momentanément indisponible\.', requestId, messageSaved: true, conversationId \}\)/)
})

test('réponse sans IA : chaque commande citée est bien reconnue par le serveur', () => {
  const cited = [...LUMIA_NO_PROVIDER_REPLY.matchAll(/« ([^»]+) »/g)].map((m) => m[1].trim())
  assert.equal(cited.length, 4)
  assert.equal(parseRequestImportCommand(cited[0]).kind, 'scan')
  assert.deepEqual(parseRequestImportCommand(cited[1]), { kind: 'scan', check: true })
  for (const go of cited.slice(2)) assert.equal(parseRequestImportCommand(go.replace('#CODE', '#ABC123')).kind, 'approve', go)
})


// ── Types d'action : nouvelle demande, déplacement, annulation, relance ──
test('types : détection sans IA des quatre actions, priorité annulation > déplacement > relance > demande', () => {
  assert.equal(detectRequestKind('Bonjour, je souhaiterais prendre rendez-vous pour une guidance'), 'new')
  assert.equal(detectRequestKind('Pourrais-je déplacer mon rendez-vous de jeudi à vendredi ?'), 'reschedule')
  assert.equal(detectRequestKind('Je dois annuler mon rendez-vous de mardi, désolée'), 'cancel')
  assert.equal(detectRequestKind(['Je voudrais un rdv', 'Finalement je dois annuler']), 'cancel')
  assert.equal(detectRequestKind('Je me permets de vous relancer, je n’ai pas eu de réponse pour ma séance'), 'followup')
  assert.equal(detectRequestKind('Avez-vous bien reçu mon message ?'), 'followup')
  assert.equal(detectRequestKind('Avez-vous des disponibilités jeudi ?'), 'new')
  assert.equal(detectRequestKind('Avez-vous des disponibilités jeudi ?', { hasHistory: true }), 'new')
  assert.equal(detectRequestKind('C’est noté pour la suite', { hasHistory: true }), 'followup')
})

const bk = (id, starts) => ({ id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, starts_at: starts, customer_phone: '+33600000201' })
test('rendez-vous concerné : trouvé, plusieurs, aucun ; affiné par le jour ou la date cités', () => {
  const one = [bk(1, '2026-11-19T09:00:00Z')] // jeudi 19 novembre 10:00 Paris
  const many = [bk(1, '2026-11-19T09:00:00Z'), bk(2, '2026-11-24T09:00:00Z'), bk(3, '2026-11-26T09:00:00Z')] // jeudi, mardi, jeudi
  assert.equal(matchRelatedBooking('Je dois annuler mon rendez-vous', one).match, 'found')
  assert.equal(matchRelatedBooking('Je dois annuler mon rendez-vous', many).match, 'multiple')
  assert.equal(matchRelatedBooking('Je dois annuler mon rendez-vous de mardi', many).booking.id, bk(2).id)
  assert.equal(matchRelatedBooking('Je dois annuler mon rendez-vous de jeudi', many).match, 'multiple')
  assert.equal(matchRelatedBooking('Je dois déplacer le rdv du 26 novembre', many).booking.id, bk(3).id)
  assert.equal(matchRelatedBooking('Annulation du rdv du 26/11 svp', many).booking.id, bk(3).id)
  assert.equal(matchRelatedBooking('Je dois annuler mon rendez-vous de samedi', many).match, 'not_found')
  assert.equal(matchRelatedBooking('Je dois annuler', []).match, 'not_found')
})

test('rapprochement : types, rendez-vous lié, client sur deux canaux, relance sur demande ouverte', () => {
  const r = (id, conv, text, extra = {}) => row(id, conv, '2026-11-10T09:00:00Z', { message_text: text, counterpart: '+33600000201', sender: '+33600000201', ...extra })
  const result = classifyImportCandidates({
    conversations: [
      conv('c-cancel', [r(1, 'c-cancel', 'Je dois annuler mon rendez-vous de jeudi')]),
      conv('c-cancel-imsg', [r(2, 'c-cancel-imsg', 'Je confirme, je dois annuler jeudi', { source_channel: 'imessage' })], { channel: 'imessage' }),
      conv('c-follow-open', [r(3, 'c-follow-open', 'Je me permets de vous relancer pour mon rendez-vous', { counterpart: '+33600000101', sender: '+33600000101' })]),
    ],
    requests: [{ id: 'r-open', status: 'pending', source_channel: 'sms', source_conversation_id: 'c-follow-open', created_at: '2026-11-03T10:00:00Z', source_message_at: '2026-11-03T09:00:00Z' }],
    upcoming: new Map([['+33600000201', [bk(1, '2026-11-19T09:00:00Z')]]]),
  })
  assert.equal(result.proposed.length, 1, 'un seul dossier pour le même client sur SMS et iMessage')
  const [cancel] = result.proposed
  assert.equal(cancel.kind, 'cancel')
  assert.equal(cancel.related.match, 'found')
  assert.deepEqual(cancel.merged.map((m) => m.channel), ['imessage'])
  const item = buildImportItem(cancel, 1)
  assert.equal(item.kind, 'cancel')
  assert.equal(item.related_booking_id, bk(1).id)
  assert.equal(item.related_booking_match, 'found')
  // Relance sur une demande déjà ouverte : signalée, jamais une seconde demande.
  const follow = result.existing.find((c) => c.key === 'c-follow-open')
  assert.equal(follow.reason, 'pending')
  assert.equal(follow.new_message_kind, 'followup')
  const text = formatScanReply({ criteria: { label: 'hier', channel: null, defaulted: false }, scanned: 3, conversations: 3, result, intent: { short_code: '#ABC123' }, names: new Map(), truncated: false })
  assert.match(text, /1\. Annulation · À vérifier · \+33600000201/)
  assert.match(text, /Rendez-vous concerné : .* — il ne sera pas modifié/)
  assert.match(text, /même client aussi sur iMessage : un seul dossier/)
  assert.doesNotMatch(text, /rendez-vous déjà prévu/, 'pas de doublon d’information avec « Rendez-vous concerné »')
  assert.match(text, /nouveau message \(relance \/ suivi\) : à lire dans la demande existante, rien n’est créé en double/)
})

test('SQL types : seule la demande tout juste créée reçoit son type ; le rendez-vous lié est revérifié, jamais modifié', () => {
  const sql = read('supabase/migrations/20261115140000_lumia_request_kinds.sql')
  const fn = sql.slice(sql.indexOf('FUNCTION public.lumia_execute_booking_request_import'), sql.indexOf('REVOKE ALL ON FUNCTION'))
  assert.match(sql, /request_kind IN \('new', 'reschedule', 'cancel', 'followup'\)/)
  assert.match(sql, /related_booking_id UUID REFERENCES public\.bookings\(id\) ON DELETE SET NULL/)
  // Une seule mise à jour de demande : celle créée par cet appel (id + message + pending).
  assert.equal((fn.match(/UPDATE public\.booking_requests/g) || []).length, 1)
  assert.match(fn, /WHERE id = v_created_id AND status = 'pending' AND intake_agent = 'lumia'\n {10}AND source_channel = v_anchor\.source_channel AND source_message_id = v_anchor\.source_message_id/)
  // Aucun accès en écriture aux rendez-vous, à Google ou aux messages.
  assert.doesNotMatch(fn, /UPDATE public\.bookings|INSERT INTO public\.bookings|DELETE FROM|confirm_booking_request|calendar_sync|google_event/i)
  assert.match(fn, /b\.status = 'confirmed' AND b\.starts_at > clock_timestamp\(\)/)
  assert.match(fn, /public\.lumia_normalize_phone\(b\.customer_phone\) = v_phone/)
  assert.match(fn, /'booking_modified', false/)
})

test('tableau de bord : type « À vérifier » et rendez-vous concerné affichés par le patch de build, sans action', () => {
  const patch = read('scripts/apply-lumia-request-kinds.mjs')
  assert.match(patch, /Nouvelle demande[\s\S]*Déplacement \/ modification[\s\S]*Annulation[\s\S]*Relance \/ suivi/)
  assert.match(patch, /· À vérifier/)
  assert.match(patch, /Lumia ne l’a pas modifié/)
  assert.doesNotMatch(patch, /onClick|fetch\(|apiFetch|updateStatus/)
  const pkg = JSON.parse(read('package.json'))
  for (const script of ['predev', 'pretest', 'prebuild']) assert.match(pkg.scripts[script], /apply-home-growth-path\.mjs && node scripts\/apply-lumia-request-kinds\.mjs/, script)
  const dashboard = read('src/components/rdv/RdvDashboard.jsx')
  // Après npm test (pretest), le patch est appliqué une seule fois.
  if (dashboard.includes('LUMIA_REQUEST_KIND_LABELS')) assert.equal(dashboard.split('const LUMIA_REQUEST_KIND_LABELS').length, 2)
})

test('contexte Lumia : le type d’action et le rendez-vous signalé sont transmis, sans identifiant de rendez-vous', () => {
  const src = read('lib/lumiaAssistantContext.js')
  assert.match(src, /request_kind, related_booking_match, created_at'\)/)
  assert.match(src, /request_kind: cleanText\(request\.request_kind, 20\) \|\| null/)
  assert.doesNotMatch(src, /related_booking_id/)
})
