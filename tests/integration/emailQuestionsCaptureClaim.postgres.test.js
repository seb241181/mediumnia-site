import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import test from 'node:test'

// Explicit opt-in, loopback PostgreSQL only. Never consume application credentials.
const connectionString = process.env.EMAIL_QUESTION_LOCAL_POSTGRES_URL

test('capture claim: real local PostgreSQL transactions', { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'local database only')
  assert.equal(url.search, '', 'connection overrides forbidden')
  const { Client } = createRequire(import.meta.url)('pg')
  const admin = new Client({ connectionString })
  await admin.connect()
  const database = `capture_claim_test_${process.pid}_${Date.now()}`
  const clients = []
  await admin.query(`CREATE DATABASE "${database}"`)
  t.after(async () => {
    await Promise.all(clients.map((client) => client.end()))
    await admin.query(`DROP DATABASE "${database}"`)
    await admin.end()
  })
  const isolated = new URL(url)
  isolated.pathname = `/${database}`
  for (let i = 0; i < 8; i++) {
    const client = new Client({ connectionString: isolated.href })
    await client.connect()
    clients.push(client)
  }
  const db = clients[0]
  await db.query(`CREATE TABLE public.mediumia_email_questions (
    id text PRIMARY KEY, status text NOT NULL DEFAULT 'payment_pending'
  )`)
  const sql = readFileSync(new URL('../../supabase/migrations/20261015173755_email_question_capture_claim.sql', import.meta.url), 'utf8')
  await db.query(sql)
  await db.query(sql)
  const claim = (client, id) => client.query(`UPDATE public.mediumia_email_questions
    SET capture_started_at = clock_timestamp()
    WHERE id = $1 AND status = 'payment_pending' AND capture_started_at IS NULL
    RETURNING id`, [id])

  await t.test('eight connections: exactly one durable claim', async () => {
    await db.query("INSERT INTO public.mediumia_email_questions(id) VALUES ('concurrent')")
    const results = await Promise.all(clients.map(async (client) => {
      await client.query('BEGIN')
      const result = await claim(client, 'concurrent')
      await client.query('COMMIT')
      return result.rowCount
    }))
    assert.equal(results.filter((count) => count === 1).length, 1)
    assert.equal(results.filter((count) => count === 0).length, 7)
  })
  await t.test('committed claim is visible to another connection, no recapture', async () => {
    assert.equal((await claim(clients[7], 'concurrent')).rowCount, 0)
  })
  await t.test('rollback before POST allows one safe claimant', async () => {
    await db.query("INSERT INTO public.mediumia_email_questions(id) VALUES ('rollback')")
    await db.query('BEGIN')
    assert.equal((await claim(db, 'rollback')).rowCount, 1)
    await db.query('ROLLBACK')
    assert.equal((await claim(clients[1], 'rollback')).rowCount, 1)
    assert.equal((await claim(clients[2], 'rollback')).rowCount, 0)
  })
  await t.test('paid transition has one winner; new intentional order remains possible', async () => {
    const results = await Promise.all(clients.map((client) => client.query(`
      UPDATE public.mediumia_email_questions SET status = 'paid'
      WHERE id = 'concurrent' AND status = 'payment_pending' RETURNING id`)))
    assert.equal(results.filter((result) => result.rowCount === 1).length, 1)
    assert.equal((await claim(db, 'concurrent')).rowCount, 0)
    await db.query("INSERT INTO public.mediumia_email_questions(id) VALUES ('new-order')")
    assert.equal((await claim(clients[3], 'new-order')).rowCount, 1)
  })
})
