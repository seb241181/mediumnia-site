import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(new URL('../supabase/migrations/20260924204500_conference_raffle_eligibility.sql', import.meta.url), 'utf8')

test('conference raffle eligibility can exclude household registrations without cancelling them', () => {
  assert.match(migration, /raffle_eligible boolean not null default true/)
  assert.match(migration, /raffle_exclusion_reason text/)
  assert.match(migration, /if not v_registration\.raffle_eligible/)
  assert.match(migration, /'raffle_not_eligible'/)
  assert.match(migration, /and r\.raffle_eligible/)
  assert.match(migration, /live_last_seen_at < now\(\) - interval '10 minutes'/)
})
