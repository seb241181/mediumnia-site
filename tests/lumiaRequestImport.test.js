import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LUMIA_REQUEST_IMPORT_ACTION, buildImportItem, classifyImportCandidates, formatExecutionReply, formatScanReply,
  guessModality, guessServiceHint, importCriteria, maybeHandleLumiaRequestImportChat, parseRequestImportCommand, requestImportEnabled,
} from '../lib/lumiaRequestImport.js'
import { LUMIA_ALLOWED_ACTIONS } from '../lib/lumiaPolicy.js'
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
  assert.match(text, /1\. \+33600000001 · SMS · probable/)
  assert.match(text, /GO #ABC123/)
  assert.match(text, /GO #ABC123 1,3/)
  assert.match(text, /aucun rendez-vous confirmé, aucun message envoyé/)
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
  assert.match(src, /import \{ maybeHandleLumiaRequestImportChat \} from '\.\.\/lib\/lumiaRequestImport\.js'/)
  const i = src.indexOf('maybeHandleLumiaRequestImportChat({')
  assert.ok(i > src.indexOf("agent.metadata?.purpose === 'lumia_rdv_assistant' && !auth.rehearsal"))
  assert.ok(i < src.indexOf('maybeHandleLumiaBookingCancelChat({'))
  const lib = read('lib/lumiaRequestImport.js')
  assert.doesNotMatch(lib, /\.from\('booking_requests'\)\s*\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(lib, /\.from\('bookings'\)\s*\.(insert|update|upsert|delete)/)
  assert.doesNotMatch(lib, /sendEmail|sendSms|googleapis|syncBookingToGoogleCalendar/)
})
