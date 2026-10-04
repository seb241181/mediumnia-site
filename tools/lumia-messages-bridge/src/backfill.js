/**
 * Rattrapage documentaire de la boîte de réception Lumia sur une période passée
 * (ex. septembre 2026). STRICTEMENT Inbox :
 *   - jamais l'intake RDV, jamais booking_requests / bookings, aucun agenda,
 *     e-mail, message sortant ni paiement (le seul endpoint appelé est l'Inbox) ;
 *   - n'utilise ni ne modifie le curseur live ni state/live.json : état séparé
 *     (state/backfill-inbox.json), le LaunchAgent continue sans interruption ;
 *   - mêmes règles d'éligibilité que le pipeline Inbox live (entrants texte
 *     1-à-1, pas de groupe, réaction, pièce jointe seule, numéro court…) ;
 *   - dry-run par défaut ; l'écriture exige une confirmation explicite ;
 *   - idempotent : le serveur déduplique (propriétaire + canal + identifiant),
 *     et l'état local évite de renvoyer un message déjà accepté.
 * Le message garde sa vraie date (message_sent_at) ; le serveur fixe owner_id.
 */
import { classify, isAutomatedSender } from './classify.js'
import { buildInboxPayload, describe, skipReason } from './payload.js'
import { sendIntake } from './sender.js'
import { loadBackfillState, saveBackfillState } from './state.js'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// Décalage de Paris (minutes) à un instant donné (heure d'été / d'hiver).
function parisOffsetMinutes(date) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT+0'
  const m = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0
}

// Minuit (heure de Paris) du jour donné, en ISO UTC.
export function parisMidnightIso(day) {
  if (!DAY_RE.test(day)) throw new Error('date_invalide')
  const [y, mo, d] = day.split('-').map(Number)
  const naive = Date.UTC(y, mo - 1, d)
  if (new Date(naive).getUTCDate() !== d) throw new Error('date_invalide')
  let utc = naive - parisOffsetMinutes(new Date(naive)) * 60_000
  utc = naive - parisOffsetMinutes(new Date(utc)) * 60_000
  return new Date(utc).toISOString()
}

// [from 00:00, lendemain de to 00:00[ en heure de Paris ; 92 jours au plus.
export function backfillRange(fromDay, toDay) {
  const fromIso = parisMidnightIso(fromDay)
  const next = new Date(`${toDay}T12:00:00Z`)
  if (!DAY_RE.test(toDay) || !Number.isFinite(next.getTime())) throw new Error('date_invalide')
  next.setUTCDate(next.getUTCDate() + 1)
  const toIso = parisMidnightIso(next.toISOString().slice(0, 10))
  if (toIso <= fromIso) throw new Error('periode_invalide')
  if (Date.parse(toIso) - Date.parse(fromIso) > 92 * 86_400_000) throw new Error('periode_trop_longue')
  return { fromIso, toIso }
}

// Phrase de confirmation exigée pour écrire : période + nombre exact d'éligibles.
export const confirmationFor = (fromDay, toDay, eligible) => `${fromDay}..${toDay}:${eligible}`

export function createInboxBackfill({
  chat,
  fromIso,
  toIso,
  mode = 'dry-run',
  target = null,          // { endpoint, getToken } — Inbox seulement
  statePath,
  ignoreHandles = [],
  send = sendIntake,
  log = () => {},         // compteurs seulement, jamais de texte ni de numéro
  pauseMs = 150,
  retryDelaysMs = [2_000, 10_000],
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock = () => new Date(),
}) {
  if (mode !== 'dry-run' && mode !== 'live') throw new Error('mode_invalid')
  if (mode === 'live' && !target?.endpoint) throw new Error('inbox_target_required')

  // Même éligibilité que le pipeline Inbox live (bridge.js).
  function exclusion(msg) {
    const skip = skipReason(msg)
    if (skip) return skip
    if (!msg.inbox_channel) return 'service inconnu'
    if (isAutomatedSender(msg.handle)) return 'numéro court'
    if (ignoreHandles.includes(msg.handle)) return 'expéditeur exclu'
    return null
  }

  async function run() {
    const stats = {
      mode, from: fromIso, to: toIso, read: 0, eligible: 0,
      by_class: { probable: 0, incertain: 0, ignorer: 0 },
      by_channel: { imessage: 0, sms: 0, rcs: 0 },
      exclusions: {},
      already: 0, sent: 0, duplicate: 0, failed: 0, rejected: 0, aborted: null,
    }
    const state = mode === 'live' ? (loadBackfillState(statePath) || { version: 1, processed: {} }) : null
    let token = null
    if (mode === 'live') {
      token = await target.getToken()
      if (!token) { stats.aborted = 'token_missing'; log('backfill_aborted token_missing (aucune requête envoyée)'); return stats }
    }

    let after = 0
    for (;;) {
      const rows = chat.messagesBetween(fromIso, toIso, after, 200)
      if (!rows.length) break
      for (const row of rows) {
        after = Math.max(after, row.rowid)
        stats.read += 1
        const msg = describe(row)
        const reason = exclusion(msg)
        if (reason) { stats.exclusions[reason] = (stats.exclusions[reason] || 0) + 1; continue }
        const cls = classify(msg.text, { handle: msg.handle, ignoreHandles })
        stats.eligible += 1
        stats.by_class[cls.label] += 1
        stats.by_channel[msg.inbox_channel] += 1
        if (mode === 'dry-run') continue
        if (state.processed[msg.guid]) { stats.already += 1; continue }

        let result = null
        for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
          result = await send({ endpoint: target.endpoint, token, payload: buildInboxPayload(msg, cls) })
          if (result.result !== 'retry') break
          if (attempt < retryDelaysMs.length) await sleep(retryDelaysMs[attempt])
        }
        if (result.result === 'ok') {
          state.processed[msg.guid] = { s: result.outcome, t: clock().toISOString() }
          if (result.outcome === 'duplicate') stats.duplicate += 1
          else stats.sent += 1
        } else if (result.result === 'auth') {
          stats.aborted = `auth_${result.status}`
          log(`backfill_aborted auth status=${result.status}`)
          saveBackfillState(statePath, state)
          return stats
        } else if (result.result === 'reject') {
          stats.rejected += 1
          log(`backfill_rejected status=${result.status} reason=${result.reason}`)
        } else {
          stats.failed += 1
          log(`backfill_failed status=${result.status} reason=${result.reason}`)
        }
        if ((stats.sent + stats.duplicate) % 25 === 0) saveBackfillState(statePath, state)
        if (pauseMs) await sleep(pauseMs)
      }
    }
    if (state) saveBackfillState(statePath, state)
    log(`backfill mode=${mode} read=${stats.read} eligible=${stats.eligible} sent=${stats.sent} duplicate=${stats.duplicate} already=${stats.already} failed=${stats.failed} rejected=${stats.rejected}`)
    return stats
  }

  return { run }
}
