/**
 * Rattrapage Inbox (backfill-inbox) : données entièrement fictives, faux
 * MediumIA local. Aucune requête vers la PROD, aucun RDV.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillRange, confirmationFor, createInboxBackfill, parisMidnightIso } from '../src/backfill.js'
import { openChatDb } from '../src/chatdb.js'
import { makeChatDb } from './fixtures.js'

const TOKEN = 'inbox-token-0123456789abcdef0123456789abcd'
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const SEPT = backfillRange('2026-09-01', '2026-09-30')

async function fakeMediumia(inbox = () => [201, { outcome: 'created' }]) {
  const requests = { rdv: [], inbox: [] }
  const seen = new Set()
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      const route = req.url.includes('lumia-message-intake') ? 'inbox' : 'rdv'
      requests[route].push({ url: req.url, auth: req.headers.authorization, body })
      let answer = route === 'inbox' ? inbox(body, requests.inbox.length) : [201, { outcome: 'created' }]
      if (answer === 'drop') { req.socket.destroy(); return }
      const key = `${body.source_channel}:${body.source_message_id}`
      if (answer[0] < 300) { if (seen.has(key)) answer = [200, { outcome: 'duplicate' }]; seen.add(key) }
      res.writeHead(answer[0], { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer[1]))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/api/rdv-admin`
  return { requests, endpoint: `${base}?action=lumia-message-intake`, rdvEndpoint: `${base}?action=lumia-rdv-intake`, close: () => server.close() }
}

// Septembre fictif, avec ses pièges aux bornes et des messages à exclure.
function septemberDb() {
  const fx = makeChatDb()
  const ids = {}
  ids.august = fx.add({ text: 'Fin août : je voudrais un rendez-vous', at: '2026-08-31T21:30:00Z' }).guid       // 23:30 Paris le 31/08
  ids.first = fx.add({ text: 'Bonjour, je voudrais réserver une guidance', at: '2026-08-31T22:30:00Z' }).guid  // 00:30 Paris le 01/09
  ids.sms = fx.add({ service: 'SMS', from: '06 11 22 33 44', text: 'Je dois annuler ma séance', at: '2026-09-10T08:00:00Z' }).guid
  ids.rcs = fx.add({ service: 'RCS', from: '+33622334455', text: 'Bisous, merci pour hier', at: '2026-09-15T18:00:00Z' }).guid
  ids.unsure = fx.add({ from: '+33633445566', text: 'On se voit mardi ?', at: '2026-09-20T10:00:00Z' }).guid
  ids.last = fx.add({ from: '+33644556677', text: 'Urgent, pouvez-vous déplacer mon rdv ?', at: '2026-09-30T21:30:00Z' }).guid // 23:30 Paris le 30/09
  ids.october = fx.add({ text: 'Début octobre : rendez-vous ?', at: '2026-09-30T22:30:00Z' }).guid               // 00:30 Paris le 01/10
  fx.add({ fromMe: true, text: 'Réponse envoyée par moi', at: '2026-09-11T08:00:00Z' })
  fx.add({ text: 'Message de groupe', groupGuid: 'iMessage;+;chat-groupe', at: '2026-09-12T08:00:00Z' })
  fx.add({ service: 'SMS', from: '38015', text: 'Votre code est 123456', at: '2026-09-13T08:00:00Z' })
  fx.add({ text: null, attachments: 1, at: '2026-09-14T08:00:00Z' })
  fx.add({ text: 'A aimé « ok »', reaction: 2000, at: '2026-09-16T08:00:00Z' })
  return { fx, ids, chat: openChatDb(fx.path) }
}

const backfill = (chat, fx, opts = {}) => createInboxBackfill({
  chat, ...SEPT, statePath: join(fx.dir, 'state', 'backfill-inbox.json'), pauseMs: 0, retryDelaysMs: [0, 0], sleep: async () => {}, ...opts,
})

test('B-1. période : septembre à l\'heure de Paris, bornes exactes, 92 jours au plus', () => {
  assert.deepEqual(SEPT, { fromIso: '2026-08-31T22:00:00.000Z', toIso: '2026-09-30T22:00:00.000Z' })
  assert.equal(parisMidnightIso('2026-12-01'), '2026-11-30T23:00:00.000Z', 'heure d\'hiver')
  assert.throws(() => backfillRange('2026-01-01', '2026-06-30'), /periode_trop_longue/)
  assert.throws(() => backfillRange('2026-09-31', '2026-10-01'), /date_invalide/)
  assert.throws(() => backfillRange('2026-09-30', '2026-09-01'), /periode_invalide/)
  assert.equal(confirmationFor('2026-09-01', '2026-09-30', 604), '2026-09-01..2026-09-30:604')
})

test('B-2. dry-run : compteurs exacts, exclusions, aucune requête', async () => {
  const server = await fakeMediumia()
  const { fx, chat } = septemberDb()
  const stats = await backfill(chat, fx, { target: { endpoint: server.endpoint, getToken: async () => TOKEN } }).run()
  server.close()
  assert.equal(stats.eligible, 5)
  assert.deepEqual(stats.by_class, { probable: 3, incertain: 1, ignorer: 1 })
  assert.deepEqual(stats.by_channel, { imessage: 3, sms: 1, rcs: 1 })
  assert.deepEqual(stats.exclusions, { sortant: 1, groupe: 1, 'numéro court': 1, 'texte illisible': 1, réaction: 1 })
  assert.equal(server.requests.inbox.length + server.requests.rdv.length, 0)
})

test('B-3. live : Inbox SEULEMENT, vraies dates, canal réel, classement, jamais d\'owner_id ni de RDV', async () => {
  const server = await fakeMediumia()
  const { fx, ids, chat } = septemberDb()
  const stats = await backfill(chat, fx, { mode: 'live', target: { endpoint: server.endpoint, getToken: async () => TOKEN } }).run()
  server.close()
  assert.equal(stats.sent, 5)
  assert.equal(server.requests.rdv.length, 0, 'aucun appel RDV')
  assert.ok(server.requests.inbox.every((r) => r.url.endsWith('action=lumia-message-intake') && r.auth === `Bearer ${TOKEN}`))
  const byId = Object.fromEntries(server.requests.inbox.map((r) => [r.body.source_message_id, r.body]))
  assert.deepEqual(Object.keys(byId).sort(), [ids.first, ids.sms, ids.rcs, ids.unsure, ids.last].sort())
  assert.ok(!(ids.august in byId) && !(ids.october in byId), 'jamais hors de septembre')
  assert.equal(byId[ids.first].message_sent_at, '2026-08-31T22:30:00.000Z')
  assert.equal(byId[ids.last].message_sent_at, '2026-09-30T21:30:00.000Z')
  assert.equal(byId[ids.sms].source_channel, 'sms')
  assert.equal(byId[ids.sms].sender, '+33611223344')
  assert.equal(byId[ids.rcs].source_channel, 'rcs')
  assert.equal(byId[ids.rcs].classification, 'ignorer')
  assert.equal(byId[ids.unsure].classification, 'incertain')
  assert.equal(byId[ids.first].classification, 'probable')
  assert.match(byId[ids.first].source_conversation_id, /^conv-[0-9a-f]{40}$/)
  for (const body of Object.values(byId)) {
    assert.ok(!('owner_id' in body) && !('phone' in body) && !('agent' in body), 'contrat Inbox, pas le contrat RDV')
    assert.equal(body.is_from_me, false)
  }
})

test('B-4. idempotence : relance → rien de renvoyé ; nouvel état → « duplicate » serveur, jamais de doublon', async () => {
  const server = await fakeMediumia()
  const { fx, chat } = septemberDb()
  const target = { endpoint: server.endpoint, getToken: async () => TOKEN }
  await backfill(chat, fx, { mode: 'live', target }).run()
  const again = await backfill(chat, fx, { mode: 'live', target }).run()
  assert.equal(again.already, 5)
  assert.equal(server.requests.inbox.length, 5)
  const fresh = await backfill(chat, fx, { mode: 'live', target, statePath: join(fx.dir, 'state-2', 'backfill-inbox.json') }).run()
  server.close()
  assert.equal(fresh.duplicate, 5)
  assert.equal(fresh.sent, 0)
})

test('B-5. l\'état live (curseur, files RDV/Inbox) n\'est jamais lu ni modifié', async () => {
  const server = await fakeMediumia()
  const { fx, chat } = septemberDb()
  const livePath = join(fx.dir, 'state', 'live.json')
  const live = `${JSON.stringify({ version: 1, mode: 'live', cursor: 999999, processed: {}, pending: {}, inbox: { since_cursor: 999999, processed: {}, pending: {} } })}\n`
  await backfill(chat, fx, { mode: 'dry-run' }).run()
  mkdirSync(join(fx.dir, 'state'), { recursive: true })
  writeFileSync(livePath, live)
  await backfill(chat, fx, { mode: 'live', target: { endpoint: server.endpoint, getToken: async () => TOKEN } }).run()
  server.close()
  assert.equal(readFileSync(livePath, 'utf8'), live)
  const state = readFileSync(join(fx.dir, 'state', 'backfill-inbox.json'), 'utf8')
  for (const secret of ['annuler', 'guidance', '+336', '611223344', TOKEN]) assert.ok(!state.includes(secret), 'état sans texte, numéro ni jeton')
})

test('B-6. erreur réseau → nouvel essai ; jeton refusé → arrêt net, rien d\'autre envoyé', async () => {
  const flaky = await fakeMediumia((_, n) => (n === 1 ? 'drop' : [201, { outcome: 'created' }]))
  const a = septemberDb()
  const ok = await backfill(a.chat, a.fx, { mode: 'live', target: { endpoint: flaky.endpoint, getToken: async () => TOKEN } }).run()
  flaky.close()
  assert.equal(ok.sent, 5)
  assert.equal(ok.failed, 0)

  const denied = await fakeMediumia(() => [401, { error: 'unauthorized' }])
  const b = septemberDb()
  const stop = await backfill(b.chat, b.fx, { mode: 'live', target: { endpoint: denied.endpoint, getToken: async () => TOKEN } }).run()
  denied.close()
  assert.equal(stop.aborted, 'auth_401')
  assert.equal(denied.requests.inbox.length, 1)

  const c = septemberDb()
  const none = await backfill(c.chat, c.fx, { mode: 'live', target: { endpoint: 'http://127.0.0.1:9/x', getToken: async () => null } }).run()
  assert.equal(none.aborted, 'token_missing')
})

function cli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { ...process.env, LUMIA_INBOX_TOKEN: '' } },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }))
  })
}

test('B-7. CLI : dry-run par défaut ; écriture refusée sans inbox_enabled ou sans la confirmation exacte', async () => {
  const { fx } = septemberDb()
  const config = join(fx.dir, 'config.json')
  const base = ['backfill-inbox', '--from', '2026-09-01', '--to', '2026-09-30', '--db', fx.path, '--state-dir', join(fx.dir, 'state'), '--config', config]
  writeFileSync(config, JSON.stringify({ live: true, inbox_enabled: false, inbox_endpoint: 'http://127.0.0.1:9/api/rdv-admin?action=lumia-message-intake' }))
  const dry = await cli(base)
  assert.equal(dry.code, 0)
  assert.match(dry.stdout, /"eligible": 5/)
  assert.match(dry.stdout, /--live --confirm 2026-09-01\.\.2026-09-30:5/)
  assert.ok(!/guidance|annuler|\+336/.test(dry.stdout), 'compteurs seulement')
  const disabled = await cli([...base, '--live', '--confirm', '2026-09-01..2026-09-30:5'])
  assert.equal(disabled.code, 2)
  assert.match(disabled.stderr, /inbox_enabled/)
  writeFileSync(config, JSON.stringify({ live: true, inbox_enabled: true, inbox_endpoint: 'http://127.0.0.1:9/api/rdv-admin?action=lumia-message-intake' }))
  const wrong = await cli([...base, '--live', '--confirm', '2026-09-01..2026-09-30:4'])
  assert.equal(wrong.code, 2)
  assert.match(wrong.stderr, /confirmation attendue/)
  const tooLong = await cli(['backfill-inbox', '--from', '2026-01-01', '--to', '2026-09-30', '--db', fx.path])
  assert.equal(tooLong.code, 64)
})

test('B-8. rattrapage SORTANTS : comptage, Inbox seulement, jamais de classement ; verrou serveur fermé → arrêt net', async () => {
  const fx = makeChatDb()
  fx.add({ from: '+33611111111', text: 'Je voudrais un rendez-vous', at: '2026-09-03T08:00:00Z' })
  const reply = fx.add({ fromMe: true, from: '+33611111111', text: 'Avec plaisir, mardi ?', at: '2026-09-03T08:10:00Z' }).guid
  fx.add({ fromMe: true, from: '+33622222222', text: 'Bonne journée', at: '2026-09-15T09:00:00Z', noHandle: true })
  fx.add({ fromMe: true, text: 'A aimé', reaction: 2000, at: '2026-09-16T09:00:00Z' })
  fx.add({ fromMe: true, text: 'Groupe', groupGuid: 'iMessage;+;g', at: '2026-09-17T09:00:00Z' })
  fx.add({ fromMe: true, from: '+33633333333', text: 'Octobre', at: '2026-09-30T22:30:00Z' })
  const chat = openChatDb(fx.path)
  const dry = await backfill(chat, fx, { direction: 'outgoing' }).run()
  assert.deepEqual([dry.eligible, dry.conversations, dry.by_class], [2, 2, undefined])
  assert.deepEqual(dry.exclusions, { entrant: 1, réaction: 1, groupe: 1 })
  assert.equal(confirmationFor('2026-09-01', '2026-09-30', 2, 'outgoing'), 'sortants:2026-09-01..2026-09-30:2')

  const server = await fakeMediumia()
  const live = await backfill(chat, fx, { mode: 'live', direction: 'outgoing', statePath: join(fx.dir, 'state', 'backfill-inbox-outgoing.json'), target: { endpoint: server.endpoint, getToken: async () => TOKEN } }).run()
  server.close()
  assert.equal(live.sent, 2)
  assert.equal(server.requests.rdv.length, 0)
  const bodies = server.requests.inbox.map((r) => r.body)
  assert.ok(bodies.every((b) => b.is_from_me === true && !('classification' in b) && b.counterpart))
  assert.equal(bodies.find((b) => b.source_message_id === reply).message_sent_at, '2026-09-03T08:10:00.000Z')

  const locked = await fakeMediumia(() => [422, { error: 'outgoing_not_enabled' }])
  const stop = await backfill(chat, fx, { mode: 'live', direction: 'outgoing', statePath: join(fx.dir, 'state-3', 'b.json'), target: { endpoint: locked.endpoint, getToken: async () => TOKEN } }).run()
  locked.close()
  assert.equal(stop.aborted, 'outgoing_not_enabled')
  assert.equal(locked.requests.inbox.length, 1, 'un seul essai puis arrêt')
})
