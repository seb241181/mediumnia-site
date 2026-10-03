/**
 * Un passage du bridge : nouveaux messages de chat.db → filtre local →
 *   dry-run : affichage local du payload qui SERAIT envoyé (rien n'est envoyé) ;
 *   live    : envoi à l'API Lumia existante, avec nouveaux essais contrôlés.
 * Le curseur avance toujours : jamais de réimport de l'historique.
 *
 * V2 (optionnelle, désactivée par défaut) : boîte de réception Lumia. Chaque
 * message entrant texte (pas seulement « probable ») est aussi déposé dans
 * l'Inbox, par un second pipeline totalement indépendant (jeton, endpoint, file
 * d'attente et nouveaux essais distincts) : une panne de l'Inbox ne retarde, ne
 * perd et ne double jamais un envoi RDV, et inversement.
 */
import { createHash } from 'node:crypto'
import { classify, isAutomatedSender } from './classify.js'
import { buildInboxPayload, buildPayload, describe, mask, normalizePhone, skipReason } from './payload.js'
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
  // Boîte de réception (V2) : null = désactivée (comportement V1 inchangé).
  // { endpoint, getToken } sinon.
  inbox = null,
  send = sendIntake,
  clock = () => new Date(),
  print = () => {},        // affichage détaillé (dry-run interactif seulement)
  log = () => {},          // journal technique : jamais de texte ni de numéro
  showFull = false,
}) {
  if (mode !== 'dry-run' && mode !== 'live') throw new Error('mode_invalid')

  function load(now) {
    let state = loadState(statePath)
    if (!state) {
      const cursor = chat.initialCursor(now, lookbackMinutes)
      log(`init mode=${mode} cursor=${cursor} lookback_min=${lookbackMinutes}`)
      state = newState(mode, cursor, now)
    }
    // Activation de l'Inbox : elle part du dernier message existant (même si le
    // curseur RDV a été reculé par --lookback-minutes) : jamais d'historique.
    if (inbox && !state.inbox) {
      const since = Math.max(state.cursor, chat.initialCursor(now, 0))
      state.inbox = { since_cursor: since, activated_at: now.toISOString(), processed: {}, pending: {} }
      log(`inbox_init since_cursor=${since}`)
    }
    return state
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

  // Inbox : messages texte entrants 1-à-1 d'un vrai correspondant. Jamais les
  // numéros courts (codes, banques…) ni les expéditeurs exclus.
  const inboxEligible = (msg) => Boolean(msg.inbox_channel) && !skipReason(msg)
    && !isAutomatedSender(msg.handle) && !ignoreHandles.includes(msg.handle)

  // Envoi d'une file (RDV ou Inbox) : chaque file a son jeton, son endpoint et
  // son état ; un message relu dans chat.db par son ROWID.
  async function deliver({ queue, target, prefix, counts, stillValid, payloadFor }) {
    const due = Object.entries(queue.pending).filter(([, p]) => Date.parse(p.next_at) <= clock().getTime())
    if (!due.length) return
    const now = clock()
    const token = await target.getToken()
    if (!token) {
      counts[`${prefix}token_missing`] = due.length
      log(`${prefix}token_missing pending=${due.length} (aucune requête envoyée)`)
      return
    }
    for (const [guid, pending] of due) {
      const row = chat.messageByRowid(pending.rowid)
      const msg = row ? describe(row) : null
      if (!msg || msg.guid !== guid || !stillValid(msg)) {
        delete queue.pending[guid]
        queue.processed[guid] = { s: 'vanished', t: now.toISOString() }
        continue
      }
      const cls = classify(msg.text, { handle: msg.handle, ignoreHandles })
      const result = await send({ endpoint: target.endpoint, token, payload: payloadFor(msg, cls, now) })
      if (result.result === 'ok') {
        delete queue.pending[guid]
        queue.processed[guid] = { s: result.outcome === 'duplicate' ? 'duplicate' : 'sent', t: now.toISOString() }
        counts[`${prefix}sent`] += 1
        log(`${prefix}sent id=${shortId(guid)} status=${result.status} outcome=${result.outcome}`)
      } else if (result.result === 'retry') {
        pending.attempts += 1
        if (pending.attempts >= RETRY_MINUTES.length) {
          delete queue.pending[guid]
          queue.processed[guid] = { s: 'failed', t: now.toISOString() }
          log(`${prefix}failed id=${shortId(guid)} status=${result.status} reason=${result.reason}`)
        } else {
          pending.next_at = new Date(now.getTime() + RETRY_MINUTES[pending.attempts - 1] * 60_000).toISOString()
          counts[`${prefix}retry`] += 1
          log(`${prefix}retry id=${shortId(guid)} status=${result.status} reason=${result.reason} attempt=${pending.attempts}`)
        }
      } else if (result.result === 'auth') {
        counts[`${prefix}auth_failed`] = 1
        log(`${prefix}auth_failed status=${result.status} (envois suspendus pour ce passage)`)
        return
      } else {
        delete queue.pending[guid]
        queue.processed[guid] = { s: 'rejected', t: now.toISOString() }
        log(`${prefix}rejected id=${shortId(guid)} status=${result.status} reason=${result.reason}`)
      }
    }
  }

  async function tick() {
    const now = clock()
    const state = load(now)
    const counts = { read: 0, probable: 0, incertain: 0, ignored: 0, skipped: 0, already: 0, queued: 0, sent: 0, retry: 0 }
    if (inbox) Object.assign(counts, { inbox_queued: 0, inbox_sent: 0, inbox_retry: 0 })

    for (let batch = 0; batch < 20; batch += 1) {
      const rows = chat.newMessages(state.cursor, 200)
      if (!rows.length) break
      for (const row of rows) {
        state.cursor = Math.max(state.cursor, row.rowid)
        counts.read += 1
        const msg = describe(row)

        // Pipeline Inbox (indépendant) : avant tout filtre RDV.
        if (inbox && row.rowid > state.inbox.since_cursor && inboxEligible(msg)
          && !state.inbox.processed[msg.guid] && !state.inbox.pending[msg.guid]) {
          if (mode === 'dry-run') {
            state.inbox.processed[msg.guid] = { s: 'dry_run', t: now.toISOString() }
            counts.inbox_queued += 1
          } else if (!allowed(msg.handle)) {
            state.inbox.processed[msg.guid] = { s: 'outside_test_allowlist', t: now.toISOString() }
          } else {
            state.inbox.pending[msg.guid] = { rowid: row.rowid, attempts: 0, next_at: now.toISOString() }
            counts.inbox_queued += 1
          }
        }

        // Pipeline RDV (inchangé).
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

    if (mode === 'live') {
      // RDV d'abord, puis Inbox : une erreur de l'une n'empêche jamais l'autre.
      try {
        await deliver({
          queue: state, target: { endpoint, getToken }, prefix: '', counts,
          stillValid: (msg) => !skipReason(msg) && allowed(msg.handle),
          payloadFor: (msg, cls, at) => buildPayload(msg, cls, at),
        })
      } catch (error) {
        log(`deliver_error ${error.code || error.name}`)
      }
      if (inbox) {
        try {
          await deliver({
            queue: state.inbox, target: inbox, prefix: 'inbox_', counts,
            stillValid: (msg) => inboxEligible(msg) && allowed(msg.handle),
            payloadFor: (msg, cls) => buildInboxPayload(msg, cls),
          })
        } catch (error) {
          log(`inbox_deliver_error ${error.code || error.name}`)
        }
      }
    }
    saveState(statePath, state, now)
    counts.pending = Object.keys(state.pending).length
    if (inbox) counts.inbox_pending = Object.keys(state.inbox.pending).length
    log(`tick mode=${mode} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')} cursor=${state.cursor}`)
    return counts
  }

  return { tick }
}
