import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LUMIA_ALLOWED_ACTIONS } from '../lib/lumiaPolicy.js'

const migration = readFileSync(new URL('../supabase/migrations/20261005110000_lumia_action_foundation.sql', import.meta.url), 'utf8')

test('Phase 3A : socle actionnel durable, sans action métier activée', () => {
  assert.match(migration, /create table if not exists public\.lumia_action_intents/i)
  assert.match(migration, /create table if not exists public\.lumia_action_attempts/i)
  assert.match(migration, /canonical_payload jsonb not null/i)
  assert.match(migration, /payload_hash text not null/i)
  assert.match(migration, /extensions\.digest\(/i)
  assert.match(migration, /preview_expires_at timestamptz not null/i)
  assert.match(migration, /expected_target_updated_at timestamptz/i)
  assert.match(migration, /target_google_etag text/i)
  assert.match(migration, /unique \(owner_id, idempotency_key\)/i)
  assert.deepEqual(LUMIA_ALLOWED_ACTIONS, ['mediumia.booking.cancel'])
})

test('Phase 3A : RPC étroits, verrouillés service_role et sans écriture MediumIA/Google/Messages', () => {
  for (const rpc of [
    'lumia_create_action_intent',
    'lumia_approve_action_intent',
    'lumia_claim_action_execution',
    'lumia_finish_action_execution',
    'lumia_expire_action_intents',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(`, 'i'))
  }
  assert.match(migration, /auth\.role\(\).*service_role/is)
  assert.match(migration, /revoke all on table public\.lumia_action_intents from public, anon, authenticated/i)
  assert.match(migration, /revoke all on function public\.lumia_create_action_intent[\s\S]*from public, anon, authenticated/i)
  assert.doesNotMatch(migration, /\bupdate\s+public\.bookings\b/i)
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.bookings\b/i)
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ''), /google_calendar|messages\.app|chat\.db/i)
})

test('Phase 3A : approval liée au propriétaire, à la conversation, au hash et à une claim unique', () => {
  assert.match(migration, /conversation_id = p_conversation_id/i)
  assert.match(migration, /v_intent\.payload_hash <> v_hash/i)
  assert.match(migration, /v_intent\.practitioner_id is distinct from p_practitioner_id/i)
  assert.match(migration, /v_intent\.target_source is distinct from coalesce\(p_target_source, 'none'\)/i)
  assert.match(migration, /v_intent\.expected_target_updated_at is distinct from p_expected_target_updated_at/i)
  assert.match(migration, /lumia_idempotency_key_reused_with_different_action/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /status = 'executing'/i)
  assert.match(migration, /reason', 'already_claimed'/i)
  assert.match(migration, /clock_timestamp\(\)/i)
  assert.match(migration, /status IN \('succeeded', 'failed', 'compensation_required'\)/i)
})

test('Phase 3A : expiration durable, sans rollback par exception', () => {
  assert.match(migration, /status = 'expired', expired_at = clock_timestamp\(\)/i)
  assert.match(migration, /'expired', 'server', null, '\{\}'::jsonb/i)
  assert.match(migration, /'status', 'expired', 'approved', false, 'reason', 'preview_expired'/i)
  assert.match(migration, /'status', 'expired', 'claimed', false, 'reason', 'preview_expired'/i)
  assert.match(migration, /v_intent\.status = 'expired'/i)
  assert.doesNotMatch(migration, /lumia_preview_expired/)
})

test('Phase 3A : praticien du propriétaire et couple action/cible strictement validés', () => {
  assert.match(migration, /from public\.booking_practitioners p[\s\S]*p\.id = p_practitioner_id and p\.owner_id = p_owner_id/i)
  assert.match(migration, /lumia_practitioner_not_owned/i)
  assert.match(migration, /constraint lumia_action_intents_action_target_check check/i)
  assert.match(migration, /'mediumia\.booking\.create', 'google\.event\.create'/i)
  assert.match(migration, /'mediumia\.booking\.update', 'mediumia\.booking\.cancel'/i)
  assert.match(migration, /'google\.event\.update', 'google\.event\.cancel'/i)
  assert.match(migration, /action_type = 'message\.send'/i)
  assert.match(migration, /lumia_action_target_incoherent/i)
})
