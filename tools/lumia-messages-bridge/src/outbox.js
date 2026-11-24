/**
 * Mac uniquement. Un message validé par GO SMS #CODE est retiré UNE fois depuis
 * MediumIA puis transmis à Messages.app. Jamais de retry automatique d'envoi.
 * Un statut "accepted" exige que le message sortant apparaisse dans chat.db ;
 * cela ne prouve PAS la livraison au téléphone du destinataire.
 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openChatDb, decodeAttributedBody, DEFAULT_CHAT_DB } from './chatdb.js'
import { assertSafeEndpoint } from './sender.js'

// Aucun endpoint de secours : une URL explicitement choisie est obligatoire.
export function assertApprovedOutboxEndpoint(endpoint) {
  if (!endpoint) throw new Error('outbox_endpoint_required')
  const url = assertSafeEndpoint(endpoint)
  const host = url.hostname
  const production = host === 'mediumia.fr' || host === 'www.mediumia.fr'
  const preview = /^mediumia-site-[a-z0-9-]+\.vercel\.app$/i.test(host)
  const local = host === 'localhost' || host === '127.0.0.1'
  if (!production && !preview && !local) throw new Error('outbox_host_not_allowed')
  if (url.pathname !== '/api/rdv-admin' || url.searchParams.get('action') !== 'lumia-sms-outbox'
      || [...url.searchParams.keys()].some((key) => key !== 'action')) {
    throw new Error('outbox_path_not_allowed')
  }
  return url
}
const SCRIPT = fileURLToPath(new URL('../scripts/send-approved.applescript', import.meta.url))
const E164_RE = /^\+[1-9][0-9]{6,14}$/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function validateApprovedSms(job, { allowedHandles = [], allowAll = false } = {}) {
  if (!job || typeof job !== 'object') return 'invalid_job'
  if (!/^[a-f0-9-]{36}$/i.test(job.id || '')) return 'invalid_job'
  if (!E164_RE.test(job.recipient || '')) return 'invalid_recipient'
  if (!['sms', 'imessage'].includes(job.channel)) return 'unsupported_channel'
  if (typeof job.body !== 'string' || !job.body.trim() || job.body.length > 1000
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(job.body)) return 'invalid_body'
  if (!allowAll && (!allowedHandles.length || !allowedHandles.includes(job.recipient))) return 'recipient_not_allowed'
  return null
}

export function outgoingFound(rows, job) {
  return rows.some((row) => {
    const text = row.text || decodeAttributedBody(row.attributed_body)
    // Messages peut créer un enregistrement hors fil sur certains macOS.
    // On exige le destinataire exact ET le texte, jamais seulement un osascript exit=0.
    const sameRecipient = [row.handle, row.chat_identifier].includes(job.recipient)
    return Boolean(row.is_from_me && sameRecipient && text === job.body)
  })
}

export function sendThroughMessages({ channel, recipient, body }, { exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    // Les valeurs sont des ARGUMENTS d'un fichier AppleScript statique :
    // aucun code, aucune échappement shell, aucune interpolation AppleScript.
    exec('/usr/bin/osascript', [SCRIPT, channel, recipient, body],
      { timeout: 25_000, maxBuffer: 1024 }, (error) => error ? reject(error) : resolve())
  })
}

async function callOutbox({ endpoint, token, method = 'GET', payload = null, fetchImpl = fetch }) {
  assertApprovedOutboxEndpoint(endpoint)
  const res = await fetchImpl(endpoint, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`outbox_http_${res.status}`)
  return res.json()
}

export async function processApprovedSmsOnce({
  endpoint,
  getToken,
  allowedHandles = [],
  allowAll = false,
  dbPath = DEFAULT_CHAT_DB,
  openDb = openChatDb,
  send = sendThroughMessages,
  request = callOutbox,
  log = () => {},
}) {
  assertApprovedOutboxEndpoint(endpoint)
  if (process.platform !== 'darwin' && send === sendThroughMessages) throw new Error('macos_required')
  const token = await getToken()
  if (!token || token.length < 32) throw new Error('outbox_token_missing')
  // On vérifie la présence de la base avant de réclamer un travail, sinon
  // le serveur le marquerait "dispatching" sans possibilité de vérifier l'envoi.
  const chat = openDb(dbPath)
  let job
  try {
    const result = await request({ endpoint, token })
    job = result.job
    if (!job) return { status: 'empty' }
    const reason = validateApprovedSms(job, { allowedHandles, allowAll })
    if (reason) {
      await request({ endpoint, token, method: 'POST', payload: { id: job.id, status: 'failed', error_code: reason } })
      return { status: 'failed', reason }
    }
    const before = chat.initialCursor(new Date())
    let status = 'uncertain'
    let code = 'not_verified'
    try {
      await send(job)
      // L'app Messages peut rendre la main avant la création dans chat.db.
      for (let n = 0; n < 6; n++) {
        await sleep(1000)
        if (outgoingFound(chat.newMessages(before, 300), job)) {
          status = 'accepted'
          code = null
          break
        }
      }
    } catch (error) {
      // osascript peut échouer APRES un envoi : ne jamais réessayer à l'aveugle.
      status = 'uncertain'
      code = error?.killed ? 'osascript_timeout' : 'osascript_error'
    }
    try {
      await request({ endpoint, token, method: 'POST', payload: { id: job.id, status, error_code: code } })
    } catch {
      log('sms_ack_unknown_reconcile_manually')
      return { status: 'uncertain', reason: 'ack_unknown' }
    }
    log(`sms_outbox_${status}`)
    return { status }
  } finally {
    chat.close()
  }
}
