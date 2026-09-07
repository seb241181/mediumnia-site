import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  buildOracleEmailSequence,
  createOracleEmailSequenceProof,
  verifyOracleEmailSequenceProof,
} from '../lib/oracleEmailSequence.js'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('email sequence consent ledger is service-role-only and stores no raw email column', () => {
  const migration = read('supabase/migrations/20260907050000_oracle_email_sequence_subscriptions.sql')
  assert.match(migration, /email_hash text not null/)
  assert.doesNotMatch(migration, /\n\s*email\s+text/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all .* from public, anon, authenticated/i)
  assert.match(migration, /grant select, insert, update, delete .* to service_role/i)
  assert.match(migration, /unsubscribe_token_hash text not null/)
  assert.match(migration, /resend_email_ids text\[\]/)
})

test('sequence uses exactly three scheduled emails with the Formation CTA only at the end', () => {
  const now = Date.parse('2026-09-07T06:00:00.000Z')
  const token = 'a'.repeat(43)
  const sequence = buildOracleEmailSequence({ unsubscribeToken: token, nowMs: now })
  assert.equal(sequence.length, 3)
  assert.equal(Date.parse(sequence[0].scheduledAt), now + 5 * 60 * 1000)
  assert.equal(Date.parse(sequence[1].scheduledAt), now + 2 * 24 * 60 * 60 * 1000)
  assert.equal(Date.parse(sequence[2].scheduledAt), now + 4 * 24 * 60 * 60 * 1000)
  assert.doesNotMatch(sequence[0].html, /mediumia\.fr\/formation/)
  assert.doesNotMatch(sequence[1].html, /mediumia\.fr\/formation/)
  assert.match(sequence[2].html, /https:\/\/mediumia\.fr\/formation/)
})

test('every sequence email contains a dedicated unsubscribe link', () => {
  const token = 'b'.repeat(43)
  const sequence = buildOracleEmailSequence({ unsubscribeToken: token })
  for (const email of sequence) {
    assert.match(email.html, /mediumia\.fr\/oracle#desinscription=/)
    assert.match(email.text, /Se désinscrire : https:\/\/mediumia\.fr\/oracle#desinscription=/)
    assert.match(email.text, /uniquement trois e-mails/)
  }
})

test('Oracle opt-in proof is email-bound and expires', () => {
  const previousSecret = process.env.ORACLE_RATE_LIMIT_SECRET
  process.env.ORACLE_RATE_LIMIT_SECRET = 'mediumia-test-only-secret'
  try {
    const now = Date.parse('2026-09-07T06:00:00.000Z')
    const proof = createOracleEmailSequenceProof('Personne@Example.com', now)
    assert.ok(proof)
    assert.equal(verifyOracleEmailSequenceProof('personne@example.com', proof, now + 60_000), true)
    assert.equal(verifyOracleEmailSequenceProof('autre@example.com', proof, now + 60_000), false)
    assert.equal(verifyOracleEmailSequenceProof('personne@example.com', proof, now + 2 * 60 * 60 * 1000 + 1), false)
  } finally {
    if (previousSecret === undefined) delete process.env.ORACLE_RATE_LIMIT_SECRET
    else process.env.ORACLE_RATE_LIMIT_SECRET = previousSecret
  }
})

test('active build patch reuses the existing Oracle endpoint without adding a Lambda', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  const packageJson = read('package.json')
  assert.match(patch, /mode=email-sequence/)
  assert.match(patch, /handleOracleEmailSequence/)
  assert.doesNotMatch(patch, /api\/oracle-email-sequence\.js/)
  assert.match(packageJson, /apply-oracle-email-sequence-v2\.mjs/)
})

test('Resend helper supports scheduled sends and cancellation with a separate management key', () => {
  const helper = read('lib/transactionalEmail.js')
  assert.match(helper, /scheduledAt/)
  assert.match(helper, /payload\.scheduled_at/)
  assert.match(helper, /export async function cancelScheduledEmail/)
  assert.match(helper, /RESEND_MANAGEMENT_API_KEY \|\| process\.env\.RESEND_API_KEY/)
  assert.match(helper, /emails\/\$\{encodeURIComponent\(normalizedId\)\}\/cancel/)
})

test('opt-in UI requires a positive action and promises only three emails', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  assert.match(patch, /const \[emailOptIn, setEmailOptIn\] = useState\(false\)/)
  assert.match(patch, /disabled=\{!emailOptIn \|\| sequenceLoading \|\| sequenceDone\}/)
  assert.match(patch, /3 e-mails seulement/)
  assert.match(patch, /ne vous inscrit pas automatiquement à une newsletter générale/)
  assert.match(patch, /consent: true/)
})

test('privacy copy documents separate consent and data minimisation', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  assert.match(patch, /Cette demande est distincte du tirage gratuit/)
  assert.match(patch, /case dédiée non pré-cochée/)
  assert.match(patch, /ne conserve pas cette adresse en clair dans Supabase/)
  assert.match(patch, /annulation des envois encore programmés/)
})

test('aggregate metrics cover opt-in and unsubscribe without visitor identifiers', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  for (const event of [
    'oracle_email_optin_view',
    'oracle_email_optin_completed',
    'oracle_email_unsubscribed',
  ]) {
    assert.match(patch, new RegExp(event))
  }
  assert.doesNotMatch(patch, /visitor_id|session_id|user_id/)
})