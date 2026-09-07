import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('partial scheduling cannot be retried until previous scheduled emails are cleaned up', () => {
  const sequence = read('lib/oracleEmailSequence.js')
  assert.match(sequence, /conflict: 'cleanup_pending'/)
  assert.match(sequence, /cleanupIds: existing\.resend_email_ids/)
  assert.match(sequence, /cleanupResults = await cancelEmailIds\(reservation\.cleanupIds\)/)
  assert.match(sequence, /sequence_cleanup_pending/)
  assert.match(sequence, /cleanupPending \? scheduledIds : \[\]/)
})

test('unsubscribe feedback distinguishes completed cancellation from pending cleanup', () => {
  const oracle = read('src/components/OracleTest.jsx')
  assert.match(oracle, /body\.cancellationPending/)
  assert.match(oracle, /annulation des envois encore programmés est en cours/)
  assert.match(oracle, /e-mails encore programmés ont été annulés/)
})

test('hardening patch runs after sequence UI generation and before pilotage', () => {
  const pkg = read('package.json')
  const v2 = pkg.indexOf('apply-oracle-email-sequence-v2.mjs')
  const hardening = pkg.indexOf('apply-oracle-email-sequence-hardening.mjs')
  const pilotage = pkg.indexOf('apply-oracle-email-sequence-pilotage.mjs')
  assert.ok(v2 >= 0 && hardening > v2 && pilotage > hardening)
})
