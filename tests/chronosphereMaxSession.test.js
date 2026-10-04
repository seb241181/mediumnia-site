import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { clearChronosphereMaxOtherUserState, clearChronosphereMaxUserState, createAccountScope, maxAttemptKey, readMaxAttempt, writeMaxAttempt } from '../src/lib/chronosphereMaxSession.js'

function storage() {
  const entries = new Map(), reads = []
  return {
    getItem(key) { reads.push(key); return entries.get(key) ?? null },
    setItem(key, value) { entries.set(key, value) },
    removeItem(key) { entries.delete(key) },
    key(index) { return [...entries.keys()][index] ?? null },
    get length() { return entries.size },
    reads, entries,
  }
}

test('A -> B physically removes all MAX state from both browser storages', () => {
  const local = storage()
  const session = storage()
  writeMaxAttempt(local, 'A', {
    nonce: 'a-nonce-1234', id: 'a-attempt', email: 'private-a@example.invalid',
    fullName: 'Private A', result: { reading: 'A result' }, token: 'private-token',
  })
  assert.deepEqual(JSON.parse(local.entries.get(maxAttemptKey('A'))), { nonce: 'a-nonce-1234', id: 'a-attempt' })
  for (const store of [local, session]) {
    store.setItem('chronosphere_max_pending:A', 'pending-A')
    store.setItem('chronosphere_max_packToken:A', 'token-A')
    store.setItem('unrelated:A', 'keep')
  }
  session.setItem(maxAttemptKey('A'), 'session-attempt-A')
  clearChronosphereMaxUserState('A', local, session)
  clearChronosphereMaxOtherUserState('B', local, session)
  for (const store of [local, session]) {
    assert.equal([...store.entries.keys()].some((key) => key.startsWith('chronosphere_max_') && key.endsWith(':A')), false)
    assert.equal(store.getItem('unrelated:A'), 'keep')
  }
  assert.equal(readMaxAttempt(local, 'B'), null)
  writeMaxAttempt(local, 'B', { nonce: 'b-nonce-1234', id: 'b-attempt' })
  assert.deepEqual(readMaxAttempt(local, 'B'), { nonce: 'b-nonce-1234', id: 'b-attempt' })
  clearChronosphereMaxUserState('B', local, session)
  assert.equal(readMaxAttempt(local, 'B'), null)
  assert.equal(readMaxAttempt(local, 'A'), null)
})

test('a fresh B session cleans legacy A keys even without knowing previous user', () => {
  const local = storage(), session = storage()
  local.setItem('chronosphere_max_pending:A', 'pending-A')
  session.setItem('chronosphere_max_attempt:A', 'attempt-A')
  clearChronosphereMaxOtherUserState('B', local, session)
  assert.equal(local.length, 0)
  assert.equal(session.length, 0)
})

test('an old account scope rejects a late response after account change', async () => {
  const a = createAccountScope()
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  let visible = 'B'
  const work = pending.then((value) => { if (a.current()) visible = value })
  a.close()
  const b = createAccountScope()
  finish('PRIVATE RESULT A')
  await work
  assert.equal(visible, 'B')
  assert.equal(a.current(), false)
  assert.equal(b.current(), true)
})

test('MAX page keys the entire state tree by user and guards responses before state writes', async () => {
  const page = await readFile(new URL('../src/components/ChronosphereMaxPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /<ChronosphereMaxSessionPage key=\{auth\.user\?\.id \|\| 'signed-out'\}/)
  assert.match(page, /return \(\) => scope\.close\(\)/)
  assert.match(page, /if \(!scope\.current\(\)\) return/)
  assert.match(page, /readMaxAttempt\(localStorage, accountId\)/)
  assert.match(page, /writeMaxAttempt\(localStorage, user\.id, data\.attempt\)/)
})

test('auth lifecycle clears former and legacy MAX keys before publishing a new session', async () => {
  const source = await readFile(new URL('../src/lib/useAuth.js', import.meta.url), 'utf8')
  assert.match(source, /if \(currentUserId && currentUserId !== nextUserId\) clearChronosphereMaxUserState\(currentUserId\)/)
  assert.match(source, /clearChronosphereMaxOtherUserState\(nextUserId\)[\s\S]*setSession\(nextSession \?\? null\)/)
  assert.match(source, /authEventSeen = true[\s\S]*applySession\(nextSession\)/)
})
