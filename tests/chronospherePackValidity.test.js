import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isPackExpired, packExpiresAt, PACK_VALIDITY_START } from '../lib/chronospherePackValidity.js'

test('packs bought from the CGV start date are valid 6 months; older packs never expire', () => {
  assert.equal(PACK_VALIDITY_START, '2026-09-24T00:00:00.000Z')
  const recent = { created_at: '2026-10-01T09:00:00Z', captured_at: '2026-10-01T09:05:00Z' }
  assert.equal(packExpiresAt(recent), '2027-04-01T09:05:00.000Z')
  assert.equal(isPackExpired(recent, new Date('2027-04-01T09:04:59Z')), false)
  assert.equal(isPackExpired(recent, new Date('2027-04-01T09:05:00Z')), true)
  const legacy = { created_at: '2026-09-10T09:00:00Z', captured_at: '2026-09-10T09:01:00Z' }
  assert.equal(packExpiresAt(legacy), null)
  assert.equal(isPackExpired(legacy, new Date('2030-01-01T00:00:00Z')), false)
  assert.equal(packExpiresAt({}), null)
})

test('the server refuses a draw from an expired pack and resume shows it as used up', () => {
  const timeline = fs.readFileSync(new URL('../lib/oracleTimeline.js', import.meta.url), 'utf8')
  assert.match(timeline, /if \(packMeta && isPackExpired\(packMeta\)\)/)
  assert.match(timeline, /error: 'draw_token_expired'/)
  // The check happens before any credit is consumed.
  assert.ok(timeline.indexOf('isPackExpired(packMeta)') < timeline.indexOf("'consume_chronosphere_pack_credit'"))
  const paypal = fs.readFileSync(new URL('../lib/chronospherePayPal.js', import.meta.url), 'utf8')
  assert.match(paypal, /creditsRemaining: expired \? 0 : pack\.credits_remaining/)
})

test('final CGV: no draft markers, owner decisions written, linked from both checkouts', () => {
  const legal = fs.readFileSync(new URL('../src/components/LegalPages.jsx', import.meta.url), 'utf8')
  const cgv = legal.slice(legal.indexOf('export function CgvChronosphere'), legal.indexOf('RÉTRACTATION (page fonctionnelle)'))
  assert.doesNotMatch(legal, /ToValidate|À valider/)
  assert.match(cgv, /6 mois/)
  assert.match(cgv, /72 heures ouvrées/)
  assert.match(cgv, /personnes majeures/)
  assert.match(cgv, /ne donnent pas lieu\s+à remboursement/)
  assert.match(cgv, /au plus 3 ans après sa dernière\s+utilisation/)
  assert.match(cgv, /mailto:contact@mediumia\.fr/)
  for (const page of ['ChronospherePage', 'ChronosphereMaxPage']) {
    assert.match(fs.readFileSync(new URL(`../src/components/${page}.jsx`, import.meta.url), 'utf8'), /href="\/cgv-chronosphere"/)
  }
})

test('confirmation e-mail restates the consent and the pack deadline', () => {
  const email = fs.readFileSync(new URL('../lib/chronosphereEmail.js', import.meta.url), 'utf8')
  assert.match(email, /art\. L\. 221-28, 13°/)
  assert.match(email, /À utiliser avant le/)
})
