import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { buildFormationEmailSequence } from '../lib/formationEmailLead.js'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('Formation reuses the same three exercises with Formation-specific context', () => {
  const now = Date.parse('2026-09-07T06:00:00.000Z')
  const sequence = buildFormationEmailSequence({ unsubscribeToken: 'c'.repeat(43), nowMs: now })
  assert.equal(sequence.length, 3)
  assert.equal(Date.parse(sequence[0].scheduledAt), now + 5 * 60 * 1000)
  assert.equal(Date.parse(sequence[1].scheduledAt), now + 2 * 24 * 60 * 60 * 1000)
  assert.equal(Date.parse(sequence[2].scheduledAt), now + 4 * 24 * 60 * 60 * 1000)
  assert.match(sequence[0].html, /depuis la page Formation MediumIA/)
  assert.doesNotMatch(sequence[0].html, /après votre tirage Oracle/)
  assert.match(sequence[2].html, /https:\/\/mediumia\.fr\/formation/)
})

test('Formation source is allowed without adding a raw email column', () => {
  const migration = read('supabase/migrations/20260907061000_allow_formation_email_sequence_source.sql')
  assert.match(migration, /formation_page/)
  assert.match(migration, /oracle_free_result/)
  assert.doesNotMatch(migration, /\bemail\s+text\b/i)
})

test('Formation lead requires explicit consent and has IP anti-abuse', () => {
  const helper = read('lib/formationEmailLead.js')
  assert.match(helper, /req\.body\?\.consent !== true/)
  assert.match(helper, /consume_api_rate_limit/)
  assert.match(helper, /formation_email_sequence/)
  assert.match(helper, /p_hourly_limit: HOURLY_LIMIT/)
  assert.match(helper, /p_daily_limit: DAILY_LIMIT/)
  assert.match(helper, /email_hash/)
  assert.doesNotMatch(helper, /\.insert\(\{[^}]*\bemail\s*:/s)
})

test('Formation page lead reuses the existing Oracle Lambda route', () => {
  const patch = read('scripts/apply-formation-email-lead.mjs')
  assert.match(patch, /mode=formation-email-sequence/)
  assert.match(patch, /handleFormationEmailLead/)
  assert.doesNotMatch(patch, /api\/formation-email/i)
})

test('Formation lead UI is optional, non-prechecked and placed before the paid offer', () => {
  const patch = read('scripts/apply-formation-email-lead.mjs')
  assert.match(patch, /const \[consent, setConsent\] = useState\(false\)/)
  assert.match(patch, /disabled=\{!consent \|\| loading \|\| done\}/)
  assert.match(patch, /3 e-mails seulement/)
  assert.match(patch, /ne vous inscrit pas automatiquement à une newsletter générale/)
  assert.match(patch, /<FormationExerciseLead \/>\\n\\n        <section id="offre"/)
})

test('Formation lead measures view and completed opt-in separately', () => {
  const patch = read('scripts/apply-formation-email-lead.mjs')
  assert.match(patch, /formation_email_optin_view/)
  assert.match(patch, /formation_email_optin_completed/)
  assert.match(patch, /trackMediumiaMetric\('formation_email_optin_view', 'formation'\)/)
  assert.match(patch, /trackMediumiaMetric\('formation_email_optin_completed', 'formation'\)/)
})

test('privacy copy covers both Oracle and Formation entry points while retaining explicit-consent wording from the base sequence patch', () => {
  const formationPatch = read('scripts/apply-formation-email-lead.mjs')
  const oraclePatch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  assert.match(formationPatch, /Après votre tirage Oracle gratuit ou directement depuis la page Formation/)
  assert.match(oraclePatch, /consentement explicite/)
  assert.match(oraclePatch, /case dédiée non pré-cochée/)
})
