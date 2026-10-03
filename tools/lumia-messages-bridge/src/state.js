/**
 * État local minimal du bridge (un fichier par mode : dry-run.json, live.json).
 * Contient UNIQUEMENT :
 *   - cursor : dernier ROWID de chat.db déjà examiné ;
 *   - processed : identifiant Apple du message (guid) → statut + date ;
 *   - pending : guid → ROWID, nombre d'essais, prochain essai.
 * Jamais de texte, de numéro ni de nom : en cas de nouvel essai, le message est
 * relu dans chat.db par son ROWID.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const KEEP_DAYS = 60
const MAX_PROCESSED = 5000

export function loadState(path) {
  if (!existsSync(path)) return null
  const state = JSON.parse(readFileSync(path, 'utf8'))
  if (state?.version !== 1 || !Number.isInteger(state.cursor)) throw new Error('state_invalid')
  state.processed ||= {}
  state.pending ||= {}
  return state
}

export function newState(mode, cursor, now = new Date()) {
  return { version: 1, mode, cursor, created_at: now.toISOString(), processed: {}, pending: {} }
}

export function prune(state, now = new Date()) {
  const limit = now.getTime() - KEEP_DAYS * 86_400_000
  const entries = Object.entries(state.processed).filter(([, v]) => Date.parse(v.t) >= limit)
  entries.sort((a, b) => Date.parse(b[1].t) - Date.parse(a[1].t))
  state.processed = Object.fromEntries(entries.slice(0, MAX_PROCESSED))
  return state
}

// Écriture atomique (fichier temporaire puis renommage), lisible par vous seul.
export function saveState(path, state, now = new Date()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(prune(state, now), null, 1)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
  chmodSync(path, 0o600)
}
