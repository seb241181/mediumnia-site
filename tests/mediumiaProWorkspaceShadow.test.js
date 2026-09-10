import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = 'supabase/migrations/20260910140000_mediumia_pro_workspace_shadow.sql'
const migration = fs.readFileSync(path.join(root, migrationPath), 'utf8')

test('workspace shadow model separates durable tenant ownership from commercial membership', () => {
  assert.match(migration, /create table if not exists public\.pro_workspaces/)
  assert.match(migration, /create table if not exists public\.pro_workspace_members/)
  assert.match(migration, /alter table public\.pro_memberships\s+add column if not exists workspace_id uuid/)
  assert.match(migration, /pro_memberships_workspace_member_fkey/)
  assert.match(migration, /references public\.pro_workspace_members\(workspace_id, user_id\)/)
  assert.match(migration, /insert into public\.pro_workspaces\(kind, owner_user_id, name, status\)[\s\S]*'platform'/)

  // Owning several workspaces later must stay possible.
  assert.match(migration, /pro_workspaces_customer_owner_idx/)
  assert.doesNotMatch(migration, /unique index if not exists pro_workspaces_customer_owner/)
})

test('legacy rows are backfilled but workspace columns remain transitional until writers are workspace-aware', () => {
  assert.match(migration, /alter table public\.agents\s+add column if not exists workspace_id uuid/)
  assert.match(migration, /alter table public\.agent_documents\s+add column if not exists workspace_id uuid/)
  assert.match(migration, /add column if not exists workspace_id uuid,\s+add column if not exists document_version_id uuid/)
  assert.match(migration, /workspace_backfill_missing_membership/)
  assert.match(migration, /workspace_backfill_missing_agent/)
  assert.match(migration, /workspace_backfill_missing_document/)
  assert.match(migration, /workspace_backfill_missing_chunk_version/)
  assert.doesNotMatch(migration, /alter column workspace_id set not null/i)
})

test('shadow documents are versioned and AI approval belongs to the version', () => {
  const documentTable = migration.slice(
    migration.indexOf('create table if not exists public.pro_documents'),
    migration.indexOf('create table if not exists public.pro_document_versions'),
  )
  const versionTable = migration.slice(
    migration.indexOf('create table if not exists public.pro_document_versions'),
    migration.indexOf('-- Backfill each existing logical document'),
  )

  assert.doesNotMatch(documentTable, /approved_for_ai/)
  assert.match(versionTable, /approved_for_ai boolean not null default false/)
  assert.match(versionTable, /unique \(document_id, version_number\)/)
  assert.match(migration, /v\.extraction_status = 'ready'[\s\S]*v\.approved_for_ai = true/)
  assert.match(migration, /pro_documents_current_version_fkey/)
  assert.match(migration, /pro_document_versions_storage_object_uidx/)
  assert.match(migration, /pro_document_versions_workspace_sha_idx/)
})

test('document to agent access is revocable and cross-workspace links are blocked structurally', () => {
  assert.match(migration, /create table if not exists public\.pro_document_agent_access/)
  assert.match(migration, /foreign key \(workspace_id, document_id\)[\s\S]*references public\.pro_documents\(workspace_id, id\)/)
  assert.match(migration, /foreign key \(workspace_id, agent_id\)[\s\S]*references public\.agents\(workspace_id, id\)/)
  assert.match(migration, /pro_document_agent_access_one_active_uidx[\s\S]*where revoked_at is null/)
  assert.match(migration, /shadow_document_access_mismatch/)
  assert.match(migration, /shadow_cross_workspace_access_detected/)
})

test('Phase 1 removes the one-agent database blocker without cutting over RAG or Storage', () => {
  assert.match(migration, /drop index if exists public\.agents_one_live_copilot_per_membership_idx/)
  assert.match(migration, /create index if not exists agents_membership_status_idx/)
  assert.doesNotMatch(migration, /create or replace function public\.search_agent_document_chunks/i)
  assert.doesNotMatch(migration, /drop function[^;]*search_agent_document_chunks/i)
  assert.doesNotMatch(migration, /storage\.objects/i)
  assert.doesNotMatch(migration, /create table if not exists public\.pro_document_chunks/i)
})

test('new shadow tables are read-only to authenticated users and platform data is not exposed', () => {
  for (const table of [
    'pro_workspaces',
    'pro_workspace_members',
    'pro_documents',
    'pro_document_versions',
    'pro_document_agent_access',
    'pro_audit_events',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, authenticated`))
  }
  assert.match(migration, /kind = 'customer'/)
  assert.match(migration, /scope = 'workspace'/)
  assert.match(migration, /No INSERT\/UPDATE\/DELETE policies are created for authenticated users/)
})
