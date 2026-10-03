/**
 * Lecture STRICTEMENT SEULE de la base Messages d'Apple (~/Library/Messages/chat.db).
 *
 * - Ouverture en lecture seule (node:sqlite, readOnly) : toute écriture est
 *   refusée par SQLite. Pas de mode « immutable » : il ignorerait le journal WAL
 *   et donc les messages les plus récents.
 * - Le schéma n'est pas documenté par Apple et peut évoluer : les colonnes sont
 *   vérifiées au démarrage. Si une colonne indispensable manque, le bridge
 *   s'arrête au lieu de deviner.
 * - Seules les colonnes utiles sont lues : jamais les pièces jointes, jamais
 *   l'historique complet d'une conversation.
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_CHAT_DB = join(homedir(), 'Library', 'Messages', 'chat.db')

const REQUIRED = ['ROWID', 'guid', 'text', 'handle_id', 'service', 'date', 'is_from_me']
const OPTIONAL = ['attributedBody', 'cache_has_attachments', 'associated_message_type', 'item_type']

// Les dates Apple comptent depuis le 1er janvier 2001 (UTC), en nanosecondes
// depuis macOS 10.13, en secondes avant. En nanosecondes, la valeur dépasse la
// précision d'un nombre JavaScript : elle est convertie en millisecondes dans
// la requête SQL (date_ms), et comparée en BigInt.
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)
const DATE_MS_SQL = 'CASE WHEN m.date > 100000000000000 THEN m.date / 1000000 ELSE m.date * 1000 END'
export function appleMsToIso(ms) {
  const n = Number(ms)
  if (ms == null || !Number.isFinite(n) || n <= 0) return null
  return new Date(APPLE_EPOCH_MS + n).toISOString()
}
export function isoToAppleDate(iso) {
  return BigInt(Math.round(Date.parse(iso) - APPLE_EPOCH_MS)) * 1_000_000n
}

/**
 * Texte d'un message dont la colonne `text` est vide (fréquent depuis macOS 13) :
 * il est alors archivé dans `attributedBody` (NSAttributedString, format
 * « typedstream »). On extrait uniquement la chaîne NSString qui suit le
 * marqueur « NSString » : longueur sur 1 octet, ou 0x81 + 2 octets, ou
 * 0x82 + 4 octets (petit-boutiste). Si le format ne correspond pas : null,
 * jamais de texte deviné.
 */
const NSSTRING = Buffer.from('NSString')
export function decodeAttributedBody(blob) {
  if (!blob || !blob.length) return null
  const buf = Buffer.from(blob)
  const at = buf.indexOf(NSSTRING)
  if (at < 0) return null
  const plus = buf.indexOf(0x2b, at + NSSTRING.length)
  if (plus < 0 || plus > at + NSSTRING.length + 8) return null
  let pos = plus + 1
  let length = buf[pos]
  if (length === 0x81) { length = buf.readUInt16LE(pos + 1); pos += 3 }
  else if (length === 0x82) { length = buf.readUInt32LE(pos + 1); pos += 5 }
  else pos += 1
  if (!Number.isFinite(length) || length <= 0 || pos + length > buf.length) return null
  const text = buf.subarray(pos, pos + length).toString('utf8')
  return text.includes('�') ? null : text
}

export function openChatDb(path = DEFAULT_CHAT_DB) {
  let db
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch (error) {
    const err = new Error(`chat_db_unreadable: ${error.code || error.message}`)
    err.code = 'CHAT_DB_UNREADABLE'
    throw err
  }
  const columns = new Set(db.prepare('PRAGMA table_info(message)').all().map((c) => c.name))
  const missing = REQUIRED.filter((c) => !columns.has(c))
  for (const table of ['handle', 'chat', 'chat_message_join']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) missing.push(`table:${table}`)
  }
  if (missing.length) {
    db.close()
    const err = new Error(`chat_db_schema_changed: ${missing.join(', ')}`)
    err.code = 'CHAT_DB_SCHEMA_CHANGED'
    throw err
  }
  const opt = (name, fallback = 'NULL') => (columns.has(name) ? `m.${name}` : fallback)
  const select = `
    SELECT m.ROWID AS rowid, m.guid AS guid, m.text AS text, ${opt('attributedBody')} AS attributed_body,
           m.service AS service, ${DATE_MS_SQL} AS date_ms, m.is_from_me AS is_from_me,
           ${opt('cache_has_attachments', '0')} AS has_attachments,
           ${opt('associated_message_type', '0')} AS associated_message_type,
           ${opt('item_type', '0')} AS item_type,
           h.id AS handle, c.guid AS chat_guid, c.style AS chat_style
    FROM message m
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id`
  const after = db.prepare(`${select} WHERE m.ROWID > ? ORDER BY m.ROWID LIMIT ?`)
  const byRowid = db.prepare(`${select} WHERE m.ROWID = ?`)
  const maxRowid = db.prepare('SELECT COALESCE(MAX(ROWID), 0) AS id FROM message')
  const maxRowidBefore = db.prepare('SELECT COALESCE(MAX(ROWID), 0) AS id FROM message WHERE date <= ?')

  // Une même ligne peut apparaître dans deux fils (rare) : on garde la première.
  const unique = (rows) => {
    const seen = new Set()
    return rows.filter((r) => (seen.has(r.guid) ? false : seen.add(r.guid)))
  }

  return {
    columns,
    newMessages: (afterRowid, limit = 200) => unique(after.all(afterRowid, limit)),
    messageByRowid: (rowid) => byRowid.get(rowid) || null,
    // Curseur initial : dernier message déjà présent (ou antérieur à « maintenant − lookback »).
    initialCursor: (now, lookbackMinutes = 0) => (lookbackMinutes > 0
      ? maxRowidBefore.get(isoToAppleDate(new Date(now.getTime() - lookbackMinutes * 60_000).toISOString())).id
      : maxRowid.get().id),
    all: (sql, ...params) => db.prepare(sql).all(...params),
    close: () => db.close(),
  }
}
