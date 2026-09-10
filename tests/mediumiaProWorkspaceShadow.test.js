import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = 'supabase/migrations/20260910140000_mediumia_pro_workspace_shadow.sql'
const migration = fs.readFileSync(path.join(root, migrationPath), 'utf8')

test('Phase 1A creates durable customer and platform workspaces without document shadow tables', () => {
  assert.match(migration, /create table public\.pro_workspaces/)
  assert.match(migration, /create table public\.pro_workspace_members/)
  assert.match(migration, /values \('platform', null, 'MediumIA Platform', 'active'\)/)
  assert.doesNotMatch(migration, /create table .*pro_documents/i)
  assert.doesNotMatch(migration, /create table .*pro_document_versions/i)
  assert.doesNotMatch(migration, /create table .*pro_document_agent_access/i)
  assert.doesNotMatch(migration, /document_version_id/i)
})

test('legacy workspace ids are backfilled, auto-derived for future writes and made NOT NULL', () => {
  for (const fn of [
    'pro_assign_membership_workspace',
    'pro_assign_agent_workspace',
    'pro_assign_document_workspace',
    'pro_assign_chunk_workspace',
  ]) {
    assert.match(migration, new RegExp(`create or replace function mediumia_private\\.${fn}`))
  }

  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /v_existing_workspace_id/)
  assert.match(migration, /membership_workspace_mismatch/)

  assert.match(migration, /alter table public\.pro_memberships[\s\S]*alter column workspace_id set not null/)
  assert.match(migration, /alter table public\.agents alter column workspace_id set not null/)
  assert.match(migration, /alter table public\.agent_documents alter column workspace_id set not null/)
  assert.match(migration, /alter table public\.agent_document_chunks alter column workspace_id set not null/)

  assert.match(migration, /agents_membership_workspace_owner_fkey/)
  assert.match(migration, /agent_documents_agent_workspace_owner_fkey/)
  assert.match(migration, /agent_document_chunks_legacy_workspace_fkey/)
})

test('multi-agent blocker is removed while legacy RAG and Storage remain untouched', () => {
  assert.match(migration, /drop index if exists public\.agents_one_live_copilot_per_membership_idx/)
  assert.match(migration, /agents_membership_status_idx/)
  assert.match(migration, /agents_workspace_status_idx/)
  assert.match(migration, /mediumia_phase1a_rag_guard/)
  assert.match(migration, /legacy_rag_function_changed/)
  assert.doesNotMatch(migration, /\)\s+on commit drop\s*;/i)
  assert.match(migration, /drop table pg_temp\.mediumia_phase1a_rag_guard/)
  assert.doesNotMatch(migration, /create or replace function public\.search_agent_document_chunks/i)
  assert.doesNotMatch(migration, /storage\.objects/i)
})

test('workspace RLS helper is private, pinned and requires active customer membership', () => {
  assert.match(migration, /create schema if not exists mediumia_private/)
  assert.match(migration, /create or replace function mediumia_private\.pro_is_active_workspace_member/)
  assert.match(migration, /security definer\s+set search_path = ''/)
  assert.match(migration, /w\.kind = 'customer'/)
  assert.match(migration, /w\.status = 'active'/)
  assert.match(migration, /wm\.status = 'active'/)
  assert.match(migration, /revoke all on schema mediumia_private from public, anon/)
  assert.match(migration, /grant usage on schema mediumia_private to authenticated, service_role/)
  assert.match(migration, /revoke all on table public\.pro_workspaces from public, anon, authenticated/)
  assert.match(migration, /revoke all on table public\.pro_workspace_members from public, anon, authenticated/)
  assert.match(migration, /grant all on table public\.pro_workspaces to service_role/)
  assert.match(migration, /grant all on table public\.pro_workspace_members to service_role/)
})

test('migration encodes explicit backfill invariants for every legacy resource', () => {
  assert.match(migration, /workspace_backfill_missing_membership/)
  assert.match(migration, /workspace_backfill_missing_agent/)
  assert.match(migration, /workspace_backfill_missing_document/)
  assert.match(migration, /workspace_backfill_missing_chunk/)
  assert.match(migration, /membership_workspace_invariant_failed/)
  assert.match(migration, /agent_workspace_invariant_failed/)
  assert.match(migration, /document_workspace_invariant_failed/)
  assert.match(migration, /chunk_workspace_invariant_failed/)
})
