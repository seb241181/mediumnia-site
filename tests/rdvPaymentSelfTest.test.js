/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runRdvPaymentSelfTest } from '../lib/rdvPaymentSelfTest.js'

test('autotest serveur : refusé en Production, sans même lire la base', async () => {
  const saved = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'production'
  let touched = false
  const db = { from() { touched = true; throw new Error('jamais') } }
  const result = await runRdvPaymentSelfTest({ query: {}, headers: {} }, db, {})
  assert.deepEqual(result, { status: 404, body: { error: 'not_found' } })
  assert.equal(touched, false)
  process.env.VERCEL_ENV = saved
})

test('autotest serveur : seulement sur le praticien de test à agenda fictif', async () => {
  delete process.env.VERCEL_ENV
  const db = {
    from() {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'p', google_calendar_id: 'agenda@group.calendar.google.com' } }) }
      return q
    },
  }
  const result = await runRdvPaymentSelfTest({ query: {}, headers: {} }, db, {})
  assert.deepEqual(result, { status: 409, body: { error: 'test_practitioner_not_ready' } })
})
