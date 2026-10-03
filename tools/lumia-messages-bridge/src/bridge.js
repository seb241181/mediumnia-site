/**
 * Un passage du bridge : nouveaux messages de chat.db → filtre local →
 *   dry-run : affichage local du payload qui SERAIT envoyé (rien n'est envoyé) ;
 *   live    : envoi à l'API Lumia existante, avec nouveaux essais contrôlés.
 * Le curseur avance toujours : jamais de réimport de l'historique.
 */
import { createHash } from 'node:crypto'
import { classify } from './classify.js'
import { buildPayload, describe, mask, normalizePhone, skipReason } from './payload.js'
import { loadState, newState, saveState } from './state.js'
import { sendIntake } from './sender.js'

// Délais entre essais (minutes) ; au-delà, le message est marqué « failed ».
export const RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 720]

// Verrou de test : en mode live, si la liste n'est pas vide, seuls ces
// expéditeurs (numéro normalisé ou e-mail) peuvent être envoyés.
export function sameHandle(a, b) {
  const x = String(a || '').trim().toLowerCase()
  const y = String(b || '').trim().toLowerCase()
  if (!x || !y) return false
  if (x.includes('@') || y.includes('@')) return x === y
  const px = normalizePhone(x)
  return Boolean(px) && px === normalizePhone(y)
}

export const shortId = (guid) => createHash('sha256').update(String(guid)).digest('hex').slice(0, 10)

export function createBridge({
  chat,
  statePath,
  mode = 'dry-run',
  lookbackMinutes = 0,
  ignoreHandles = [],
  sendUncertain = false,
  liveOnlyHandles = [],
  endpoint,
  getToken = async () => null,
  send = sendIntake,
  clock = () => new Date(),
  print = () => {},        // affichage détaillé (dry-run interactif seulement)
  log = () => {},          // journal technique : jamais de texte ni de numéro
  showFull = false,
}) {
  if (mode !== 'dry-run' && mode !== 'live') throw new Error('mode_invalid')

  function load(now) {
    const existing = loadState(statePath)
    if (existing) return existing
    const cursor = chat.initialCursor(now, lookbackMinutes)
    log(`init mode=${mode} cursor=${cursor} lookback_min=${lookbackMinutes}`)
    return newState(mode, cursor, now)
  }

  function show(msg, cls, payload) {
    const shown = showFull ? payload : { ...payload, ...(payload.phone ? { phone: mask(payload.phone) } : {}), ...(payload.email ? { email: mask(payload.email) } : {}) }
    print([
      `[dry-run] ${msg.sent_at} ${msg.channel} ${cls.label.toUpperCase()} (score ${cls.score} : ${cls.reasons.join(', ')})`,
      `  message_id      : ${msg.guid}`,
      `  conversation_id : ${msg.conversation_id}`,
      `  expéditeur      : ${showFull ? msg.handle : mask(msg.handle)}`,
      `  payload         : ${JSON.stringify(shown)}`,
    ].join('\n'))
  }

  const allowed = (handle) => !liveOnlyHandles.length || liveOnlyHandles.some((h) => sameHandle(h, handle))

  async function sendDue(state, now, counts) {
    const due = Object.entries(state.pending).filter(([, p]) => Date.parse(p.next_at) <= now.getTime())
    if (!due.length) return
    const token = await getToken()
    if (!token) {
      counts.token_missing = due.length
      log(`token_missing pending=${due.length} (aucune requête envoyée)`)
      return
    }
    for (const [guid, pending] of due) {
      const row = chat.messageByRowid(pending.rowid)
      const msg = row ? describe(row) : null
      if (!msg || msg.guid !== guid || skipReason(msg) || !allowed(msg.handle)) {
        delete state.pending[guid]
        state.processed[guid] = { s: 'vanished', t: now.toISOString() }
        continue
      }
      const cls = classify(msg.text, { handle: msg.handle, ignoreHandles })
      const result = await send({ endpoint, token, payload: buildPayload(msg, cls, now) })
      if (result.result === 'ok') {
        delete state.pending[guid]
        state.processed[guid] = { s: result.outcome === 'duplicate' ? 'duplicate' : 'sent', t: now.toISOString() }
        counts.sent += 1
        log(`sent id=${shortId(guid)} status=${result.status} outcome=${result.outcome}`)
      } else if (result.result === 'retry') {
        pending.attempts += 1
        if (pending.attempts >= RETRY_MINUTES.length) {
          delete state.pending[guid]
          state.processed[guid] = { s: 'failed', t: now.toISOString() }
          log(`failed id=${shortId(guid)} status=${result.status} reason=${result.reason}`)
        } else {
          pending.next_at = new Date(now.getTime() + RETRY_MINUTES[pending.attempts - 1] * 60_000).toISOString()
          counts.retry += 1
          log(`retry id=${shortId(guid)} status=${result.status} reason=${result.reason} attempt=${pending.attempts}`)
        }
      } else if (result.result === 'auth') {
        counts.auth_failed = 1
        log(`auth_failed status=${result.status} (envois suspendus pour ce passage)`)
        return
      } else {
        delete state.pending[guid]
        state.processed[guid] = { s: 'rejected', t: now.toISOString() }
        log(`rejected id=${shortId(guid)} status=${result.status} reason=${result.reason}`)
      }
    }
  }

  async function tick() {
    const now = clock()
    const state = load(now)
    const counts = { read: 0, probable: 0, incertain: 0, ignored: 0, skipped: 0, already: 0, queued: 0, sent: 0, retry: 0 }

    for (let batch = 0; batch < 20; batch += 1) {
      const rows = chat.newMessages(state.cursor, 200)
      if (!rows.length) break
      for (const row of rows) {
        state.cursor = Math.max(state.cursor, row.rowid)
        counts.read += 1
        const msg = describe(row)
        if (skipReason(msg)) { counts.skipped += 1; continue }
        if (state.processed[msg.guid] || state.pending[msg.guid]) { counts.already += 1; continue }
        const cls = classify(msg.text, { handle: msg.handle, ignoreHandles })
        if (cls.label === 'ignorer') { counts.ignored += 1; continue }
        counts[cls.label] += 1
        if (mode === 'dry-run') {
          show(msg, cls, buildPayload(msg, cls, now))
          state.processed[msg.guid] = { s: `dry_run_${cls.label}`, t: now.toISOString() }
        } else if (!allowed(msg.handle)) {
          state.processed[msg.guid] = { s: 'outside_test_allowlist', t: now.toISOString() }
          counts.outside_allowlist = (counts.outside_allowlist || 0) + 1
        } else if (cls.label === 'probable' || sendUncertain) {
          state.pending[msg.guid] = { rowid: row.rowid, attempts: 0, next_at: now.toISOString() }
          counts.queued += 1
        } else {
          state.processed[msg.guid] = { s: 'kept_uncertain', t: now.toISOString() }
        }
      }
    }

    if (mode === 'live') await sendDue(state, now, counts)
    saveState(statePath, state, now)
    counts.pending = Object.keys(state.pending).length
    log(`tick mode=${mode} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')} cursor=${state.cursor}`)
    return counts
  }

  return { tick }
}
