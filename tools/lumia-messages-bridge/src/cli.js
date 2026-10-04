#!/usr/bin/env node
/**
 * Lumia Messages Bridge — commandes :
 *   doctor                       diagnostic du Mac (compteurs uniquement, aucun contenu)
 *   run [--once] [--show]        dry-run par défaut : rien n'est envoyé
 *   run --live                   envoi réel, seulement si config.local.json contient "live": true
 *   backfill-inbox --from AAAA-MM-JJ --to AAAA-MM-JJ
 *                                rattrapage documentaire de l'Inbox (dry-run par défaut ;
 *                                écriture : --live --confirm <phrase affichée par le dry-run>)
 * Boîte de réception Lumia (V2) : seulement si config.local.json contient
 * "inbox_enabled": true (désactivée par défaut ; jeton Trousseau « inbox-token »).
 * Options : --show-full (numéros non masqués à l'écran), --lookback-minutes N,
 *           --db CHEMIN, --state-dir DOSSIER, --config FICHIER, --interval SECONDES
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillRange, confirmationFor, createInboxBackfill } from './backfill.js'
import { createBridge } from './bridge.js'
import { DEFAULT_CHAT_DB, openChatDb } from './chatdb.js'
import { assertSafeEndpoint, DEFAULT_ENDPOINT } from './sender.js'
import { INBOX_KEYCHAIN_ACCOUNT, keychainHasToken, readInboxToken, readToken } from './token.js'

export const DEFAULT_INBOX_ENDPOINT = 'https://mediumia.fr/api/rdv-admin?action=lumia-message-intake'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) { args._.push(a); continue }
    const key = a.slice(2)
    if (['once', 'show', 'show-full', 'live'].includes(key)) args[key] = true
    else args[key] = argv[++i]
  }
  return args
}

function loadConfig(path) {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

const stamp = () => new Date().toISOString()
const log = (line) => console.log(`${stamp()} ${line}`)

function explain(error) {
  if (error.code === 'CHAT_DB_UNREADABLE') {
    return 'chat.db illisible. Donnez « Accès complet au disque » au programme qui lance le bridge '
      + '(Terminal pour un essai, ou le binaire node pour le LaunchAgent) : Réglages Système → '
      + 'Confidentialité et sécurité → Accès complet au disque. Rien n\'est contourné.'
  }
  if (error.code === 'CHAT_DB_SCHEMA_CHANGED') {
    return `Le schéma de Messages a changé (${error.message}). Le bridge s'arrête au lieu de deviner : à adapter.`
  }
  return error.message
}

async function doctor(args) {
  const dbPath = args.db || DEFAULT_CHAT_DB
  const lines = []
  let macos = 'inconnu'
  try { macos = execFileSync('/usr/bin/sw_vers', ['-productVersion']).toString().trim() } catch { /* hors macOS */ }
  lines.push(`macOS            : ${macos}`, `Node             : ${process.version}`)
  lines.push(`chat.db          : ${dbPath} ${existsSync(dbPath) ? '(présent)' : '(absent)'}`)
  let chat
  try { chat = openChatDb(dbPath) } catch (error) {
    lines.push(`lecture          : NON — ${explain(error)}`)
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }
  lines.push('lecture          : OK (lecture seule)')
  const optional = ['attributedBody', 'cache_has_attachments', 'associated_message_type', 'item_type']
  lines.push(`colonnes option. : ${optional.map((c) => `${c}=${chat.columns.has(c) ? 'oui' : 'NON'}`).join(' ')}`)
  // 30 derniers jours : compteurs seulement (aucun texte, aucun numéro).
  const since = (BigInt(Date.now() - Date.UTC(2001, 0, 1) - 30 * 86_400_000) * 1_000_000n)
  const rows = chat.all(`SELECT m.service AS service, m.is_from_me AS me,
      CASE WHEN m.text IS NOT NULL AND trim(m.text) <> '' THEN 'text' ELSE 'other' END AS kind,
      COUNT(*) AS n FROM message m WHERE m.date >= ? GROUP BY 1, 2, 3`, since)
  for (const r of rows) lines.push(`30 j             : service=${r.service} ${r.me ? 'sortants' : 'entrants'} ${r.kind === 'text' ? 'texte' : 'sans colonne text'} → ${r.n}`)
  if (chat.columns.has('attributedBody')) {
    const { decodeAttributedBody } = await import('./chatdb.js')
    const blobs = chat.all(`SELECT attributedBody AS b FROM message
      WHERE date >= ? AND (text IS NULL OR trim(text) = '') AND attributedBody IS NOT NULL LIMIT 500`, since)
    const decoded = blobs.filter((r) => decodeAttributedBody(r.b) != null).length
    lines.push(`attributedBody   : ${decoded}/${blobs.length} décodés (échantillon, contenu non affiché)`)
  }
  chat.close()
  lines.push(`jeton Trousseau  : ${(await keychainHasToken()) ? 'présent (valeur non affichée)' : 'absent'}`)
  lines.push(`jeton Inbox      : ${(await keychainHasToken(INBOX_KEYCHAIN_ACCOUNT)) ? 'présent (valeur non affichée)' : 'absent'}`)
  console.log(lines.join('\n'))
}

async function run(args) {
  const config = loadConfig(args.config || join(ROOT, 'config.local.json'))
  if (args.live && config.live !== true) {
    console.error('Mode live refusé : config.local.json doit contenir "live": true. Rien n\'est envoyé.')
    process.exitCode = 2
    return
  }
  const mode = args.live ? 'live' : 'dry-run'
  const endpoint = config.endpoint || DEFAULT_ENDPOINT
  assertSafeEndpoint(endpoint)
  const inboxEnabled = config.inbox_enabled === true
  const inboxEndpoint = config.inbox_endpoint || DEFAULT_INBOX_ENDPOINT
  if (inboxEnabled) assertSafeEndpoint(inboxEndpoint)
  const stateDir = args['state-dir'] || join(ROOT, 'state')
  let chat
  try { chat = openChatDb(args.db || config.chat_db || DEFAULT_CHAT_DB) } catch (error) {
    console.error(explain(error))
    process.exitCode = 78
    return
  }
  const bridge = createBridge({
    chat,
    statePath: join(stateDir, `${mode}.json`),
    mode,
    lookbackMinutes: Number(args['lookback-minutes'] ?? config.lookback_minutes ?? 0),
    ignoreHandles: Array.isArray(config.ignore_handles) ? config.ignore_handles : [],
    sendUncertain: config.send_uncertain === true,
    liveOnlyHandles: Array.isArray(config.live_only_handles) ? config.live_only_handles : [],
    endpoint,
    getToken: () => readToken(),
    inbox: inboxEnabled ? { endpoint: inboxEndpoint, getToken: () => readInboxToken() } : null,
    showFull: Boolean(args['show-full']),
    print: args.show || args['show-full'] ? (text) => console.log(text) : () => {},
    log,
  })
  const interval = Math.max(5, Number(args.interval ?? config.poll_seconds ?? 15)) * 1000
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
  const allowlist = Array.isArray(config.live_only_handles) ? config.live_only_handles.length : 0
  log(`start mode=${mode} interval_s=${interval / 1000} send_uncertain=${config.send_uncertain === true} test_allowlist=${allowlist}${inboxEnabled ? ' inbox=on' : ''}`)
  do {
    try { await bridge.tick() } catch (error) { log(`tick_error ${error.code || error.name}`) }
    if (args.once) break
    await new Promise((r) => setTimeout(r, interval))
  } while (!stopping)
  chat.close()
  log('stop')
}

// Rattrapage Inbox d'une période passée : jamais le RDV, jamais live.json.
async function backfillInbox(args) {
  const config = loadConfig(args.config || join(ROOT, 'config.local.json'))
  let range
  try { range = backfillRange(String(args.from || ''), String(args.to || '')) } catch (error) {
    console.error(`Période invalide (${error.message}) : --from AAAA-MM-JJ --to AAAA-MM-JJ, 92 jours au plus.`)
    process.exitCode = 64
    return
  }
  let chat
  try { chat = openChatDb(args.db || config.chat_db || DEFAULT_CHAT_DB) } catch (error) {
    console.error(explain(error))
    process.exitCode = 78
    return
  }
  const ignoreHandles = Array.isArray(config.ignore_handles) ? config.ignore_handles : []
  const statePath = join(args['state-dir'] || join(ROOT, 'state'), 'backfill-inbox.json')
  // 1. Toujours un dry-run complet d'abord (compteurs seulement).
  const dry = await createInboxBackfill({ chat, ...range, mode: 'dry-run', statePath, ignoreHandles }).run()
  const expected = confirmationFor(args.from, args.to, dry.eligible)
  const summary = { ...dry, mode: undefined, aborted: undefined, already: undefined, sent: undefined, duplicate: undefined, failed: undefined, rejected: undefined }
  console.log(JSON.stringify(summary, null, 2))
  if (!args.live) {
    console.log(`Dry-run : rien n'a été envoyé. Pour écrire dans l'Inbox : --live --confirm ${expected}`)
    chat.close()
    return
  }
  // 2. Écriture : Inbox activée, mode réel, et confirmation exacte.
  if (config.live !== true || config.inbox_enabled !== true) {
    console.error('Écriture refusée : config.local.json doit contenir "live": true et "inbox_enabled": true. Rien n\'est envoyé.')
    process.exitCode = 2
    chat.close()
    return
  }
  if (args.confirm !== expected) {
    console.error(`Écriture refusée : confirmation attendue « ${expected} ». Rien n'est envoyé.`)
    process.exitCode = 2
    chat.close()
    return
  }
  const endpoint = config.inbox_endpoint || DEFAULT_INBOX_ENDPOINT
  assertSafeEndpoint(endpoint)
  const live = await createInboxBackfill({
    chat, ...range, mode: 'live', statePath, ignoreHandles,
    target: { endpoint, getToken: () => readInboxToken() },
    log,
  }).run()
  console.log(JSON.stringify({ sent: live.sent, duplicate: live.duplicate, already: live.already, failed: live.failed, rejected: live.rejected, aborted: live.aborted }, null, 2))
  if (live.aborted || live.failed || live.rejected) process.exitCode = 1
  chat.close()
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] || 'run'
if (command === 'doctor') await doctor(args)
else if (command === 'run') await run(args)
else if (command === 'backfill-inbox') await backfillInbox(args)
else {
  console.error('Commandes : doctor | run [--once] [--show] [--live] | backfill-inbox --from AAAA-MM-JJ --to AAAA-MM-JJ [--live --confirm …]')
  process.exitCode = 64
}
