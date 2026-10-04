/**
 * Fausse base Messages : même structure (sous-ensemble) que chat.db, en mode
 * WAL comme sur un Mac, avec des données entièrement fictives.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isoToAppleDate } from '../src/chatdb.js'

export function makeChatDb() {
  const dir = mkdtempSync(join(tmpdir(), 'lumia-bridge-'))
  const path = join(dir, 'chat.db')
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT NOT NULL);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, chat_identifier TEXT, service_name TEXT, style INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, PRIMARY KEY (chat_id, message_id));
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, attributedBody BLOB,
      handle_id INTEGER DEFAULT 0, service TEXT, date INTEGER, is_from_me INTEGER DEFAULT 0,
      cache_has_attachments INTEGER DEFAULT 0, associated_message_type INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0
    );
  `)
  let n = 0
  const handles = new Map()
  function handleId(id, service) {
    const key = `${service}:${id}`
    if (!handles.has(key)) {
      const h = db.prepare('INSERT INTO handle (id, service) VALUES (?, ?)').run(id, service).lastInsertRowid
      const c = db.prepare('INSERT INTO chat (guid, chat_identifier, service_name, style) VALUES (?, ?, ?, 45)')
        .run(`${service};-;${id}`, id, service).lastInsertRowid
      handles.set(key, { h: Number(h), c: Number(c) })
    }
    return handles.get(key)
  }
  function add({ from = '+33600000001', service = 'iMessage', text = null, attributedBody = null, fromMe = false,
    at = new Date().toISOString(), attachments = 0, reaction = 0, itemType = 0, groupGuid = null, noHandle = false } = {}) {
    n += 1
    const guid = `FAKE-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`
    const { h, c } = handleId(from, service)
    let chatId = c
    if (groupGuid) {
      const existing = db.prepare('SELECT ROWID AS id FROM chat WHERE guid = ?').get(groupGuid)
      chatId = existing ? Number(existing.id)
        : Number(db.prepare('INSERT INTO chat (guid, style) VALUES (?, 43)').run(groupGuid).lastInsertRowid)
    }
    const rowid = Number(db.prepare(`INSERT INTO message (guid, text, attributedBody, handle_id, service, date, is_from_me,
      cache_has_attachments, associated_message_type, item_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(guid, text, attributedBody, noHandle ? 0 : h, service, isoToAppleDate(at), fromMe ? 1 : 0, attachments, reaction, itemType).lastInsertRowid)
    db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(chatId, rowid)
    return { guid, rowid }
  }
  return { path, dir, add, close: () => db.close() }
}

// attributedBody minimal au format typedstream (NSString + longueur + UTF-8).
export function attributedBody(text) {
  const bytes = Buffer.from(text, 'utf8')
  const len = bytes.length < 0x80 ? Buffer.from([bytes.length])
    : Buffer.concat([Buffer.from([0x81]), Buffer.from([bytes.length & 0xff, bytes.length >> 8])])
  return Buffer.concat([Buffer.from([0x04, 0x0b]), Buffer.from('streamtyped'), Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84]),
    Buffer.from('NSMutableAttributedString'), Buffer.from([0x00, 0x84, 0x84]), Buffer.from('NSAttributedString'),
    Buffer.from([0x00, 0x84, 0x84]), Buffer.from('NSObject'), Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84]),
    Buffer.from('NSString'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), len, bytes, Buffer.from([0x86, 0x84])])
}
