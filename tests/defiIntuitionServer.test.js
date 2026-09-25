import test from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
process.env.RDV_RATE_LIMIT_SECRET = 'b'.repeat(64)
process.env.VERCEL_ENV = 'production'
delete process.env.RESEND_API_KEY

const { unsubscribeToken, verifyUnsubscribeToken, sendDefiReminders, handleDefi, defiStats, DEFI_EVENTS, REMINDERS_PER_DAY } = await import('../lib/defiIntuitionServer.js')

const ID = '0b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b'

function fakeRes() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, end() { return this }, setHeader() {} }
}

// Minimal Supabase fake: records calls, answers from tables.
function fakeDb({ reminders = [], counts = [], owner = false } = {}) {
  const calls = { rpc: [], updates: [] }
  const from = (name) => {
    const filters = []
    let patch = null
    let upsertRow = null
    const api = {
      select() { return api }, order() { return api }, limit() { return api }, like() { return api }, gte() { return api },
      // Only the reminder query uses or(): "last_sent_on.is.null,last_sent_on.lt.<day>".
      or(expr) { const day = expr.split('.lt.')[1]; filters.push((r) => r.last_sent_on == null || r.last_sent_on < day); return api },
      eq(k, v) { filters.push((r) => r[k] === v); return api },
      is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api },
      update(p) { patch = p; calls.updates.push([name, p]); return api },
      upsert(row) { upsertRow = row; return api },
      single() {
        if (upsertRow) {
          let row = reminders.find((r) => r.email === upsertRow.email)
          if (row) Object.assign(row, upsertRow)
          else { row = { id: ID, ...upsertRow }; reminders.push(row) }
          return Promise.resolve({ data: { id: row.id }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle() {
        const rows = reminders.filter((r) => filters.every((f) => f(r)))
        if (patch) rows.forEach((r) => Object.assign(r, patch))
        return Promise.resolve({ data: rows[0] ? { id: rows[0].id } : null, error: null })
      },
      then(resolve) {
        if (name === 'mediumia_event_daily_counts') return resolve({ data: counts, error: null })
        if (name === 'booking_practitioners') return resolve({ data: owner ? [{ id: 'p1' }] : [], error: null })
        const rows = reminders.filter((r) => filters.every((f) => f(r)))
        if (patch) rows.forEach((r) => Object.assign(r, patch))
        return resolve({ data: rows, count: rows.length, error: null })
      },
    }
    return api
  }
  return {
    from, calls,
    rpc: async (fn, args) => { calls.rpc.push([fn, args]); return { data: { allowed: true }, error: null } },
    auth: { getUser: async (jwt) => (jwt === 'owner' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'no' } }) },
  }
}

test('unsubscribe links are signed and cannot be forged', () => {
  const token = unsubscribeToken(ID)
  assert.equal(verifyUnsubscribeToken(token), ID)
  assert.equal(verifyUnsubscribeToken(`${ID}.forged`), null)
  assert.equal(verifyUnsubscribeToken(token.replace(ID, '1b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b')), null)
  assert.equal(verifyUnsubscribeToken(token, 'c'.repeat(64)), null)
})

test('each subscriber gets one reminder a day at most, never after unsubscribing', async () => {
  const reminders = [
    { id: ID, email: 'a@example.com', last_sent_on: null, unsubscribed_at: null },
    { id: '1b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b', email: 'b@example.com', last_sent_on: null, unsubscribed_at: '2026-10-01T00:00:00Z' },
  ]
  const db = fakeDb({ reminders })
  const now = new Date('2026-10-22T07:00:00Z')
  await sendDefiReminders(db, now)
  assert.equal(reminders[0].last_sent_on, '2026-10-22', 'claimed before sending')
  assert.equal(reminders[1].last_sent_on, null, 'unsubscribed people are skipped')
  const claims = () => db.calls.updates.filter(([table, p]) => table === 'defi_reminders' && p.last_sent_on).length
  assert.equal(claims(), 1)
  await sendDefiReminders(db, now)
  assert.equal(claims(), 1, 'a second run the same day claims nothing new')
  await sendDefiReminders(db, new Date('2026-10-23T07:00:00Z'))
  assert.equal(reminders[0].last_sent_on, '2026-10-23', 'and the next day it goes again')
  assert.ok(REMINDERS_PER_DAY <= 100, 'stays under the free e-mail quota')
})

test('subscribing needs a valid e-mail and explicit consent', async () => {
  const reminders = []
  const db = fakeDb({ reminders })
  const { getSupabaseAdmin } = await import('../lib/supabaseAdmin.js')
  assert.ok(getSupabaseAdmin)
  const call = async (body) => {
    const res = fakeRes()
    // handleDefi builds its own client: exercise validation paths that stop before any database call.
    await handleDefi({ method: 'POST', headers: {}, body }, res, 'subscribe')
    return res
  }
  assert.equal((await call({ email: 'pas-un-email', consent: true })).body.error, 'invalid_email')
  assert.equal((await call({ email: 'a@example.com' })).body.error, 'consent_required')
  assert.equal(reminders.length, 0)
  assert.ok(db)
})

test('only whitelisted counters are accepted', async () => {
  assert.ok(DEFI_EVENTS.has('defi_played') && DEFI_EVENTS.has('defi_share_image') && DEFI_EVENTS.has('defi_new_player'))
  const res = fakeRes()
  await handleDefi({ method: 'POST', headers: {}, body: { event: 'purchase_completed' } }, res, 'event')
  assert.deepEqual([res.statusCode, res.body.error], [400, 'invalid_event'])
})

test('stats sum plays, new players and shares by network', async () => {
  const counts = [
    { event_date: '2026-10-21', event_name: 'defi_played', event_count: 4 },
    { event_date: '2026-10-22', event_name: 'defi_played', event_count: 6 },
    { event_date: '2026-10-22', event_name: 'defi_new_player', event_count: 5 },
    { event_date: '2026-10-22', event_name: 'defi_share_image', event_count: 2 },
    { event_date: '2026-10-22', event_name: 'defi_share_whatsapp', event_count: 1 },
  ]
  const stats = await defiStats(fakeDb({ counts, reminders: [{ id: ID, unsubscribed_at: null }] }), 30, new Date('2026-10-22T12:00:00Z'))
  assert.deepEqual([stats.plays, stats.newPlayers, stats.shareTotal, stats.shares.image, stats.shares.whatsapp, stats.subscribers], [10, 5, 3, 2, 1, 1])
  assert.equal(stats.series.length, 30)
  assert.equal(stats.series.at(-1).plays, 6)
})
