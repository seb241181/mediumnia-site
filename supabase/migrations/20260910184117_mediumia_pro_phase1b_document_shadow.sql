-- MediumIA Pro Phase 1B-A: document shadow foundation.
--
-- This migration is additive. It creates the workspace document/version model,
-- transactional server RPCs, and a lightweight legacy dirty queue. It does not
-- backfill existing documents, move Storage objects, change the Edge Function,
-- or modify the legacy RAG function.

create temporary table mediumia_phase1b_rag_guard (
  definition_md5 text not null
);

insert into mediumia_phase1b_rag_guard(definition_md5)
select md5(pg_get_functiondef(
  'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
));

create schema if not exists mediumia_private;
revoke all on schema mediumia_private from public, anon;
grant usage on schema mediumia_private to service_role;

-- Required targets for workspace-scoped foreign keys below. The primary key on
-- agents remains unchanged; this key only makes the tenant identity explicit.
alter table public.agents
  add constraint agents_workspace_id_key unique (workspace_id, id);

create table public.pro_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.pro_workspaces(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 240),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'archived', 'deleting', 'deleted')),
  access_mode text not null default 'selected_agents'
    check (access_mode in ('selected_agents', 'all_workspace_agents')),
  sensitivity text not null default 'confidential'
    check (sensitivity in ('normal', 'confidential', 'restricted')),
  ai_enabled boolean not null default false,
  current_version_id uuid,
  created_by uuid,
  state_revision bigint not null default 0 check (state_revision >= 0),
  legacy_sync_hash text check (
    legacy_sync_hash is null or legacy_sync_hash ~ '^[0-9a-f]{32}$'
  ),
  legacy_synced_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_documents_workspace_id_key unique (workspace_id, id),
  constraint pro_documents_creator_workspace_fkey
    foreign key (workspace_id, created_by)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (created_by),
  constraint pro_documents_runtime_state_check check (
    not ai_enabled
    or (lifecycle_status = 'active' and current_version_id is not null)
  ),
  constraint pro_documents_deleted_at_check check (
    (lifecycle_status = 'deleted') = (deleted_at is not null)
  )
);

create table public.pro_document_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_type text not null default 'upload'
    check (source_type in ('upload', 'paste', 'url')),
  storage_bucket text,
  storage_path text,
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  mime_type text,
  size_bytes bigint check (
    size_bytes is null or size_bytes between 0 and 26214400
  ),
  extraction_status text not null default 'pending_upload'
    check (extraction_status in ('pending_upload', 'uploaded', 'processing', 'ready', 'failed')),
  processing_claim_id uuid,
  processing_started_at timestamptz,
  processing_expires_at timestamptz,
  completed_claim_id uuid,
  extracted_at timestamptz,
  approved_for_ai boolean not null default false,
  approved_at timestamptz,
  approved_by uuid,
  approval_origin text check (
    approval_origin is null or approval_origin in ('explicit', 'legacy_state')
  ),
  published_at timestamptz,
  publication_origin text check (
    publication_origin is null or publication_origin in ('explicit', 'legacy_backfill')
  ),
  publication_request_id uuid,
  error_code text check (error_code is null or char_length(error_code) between 1 and 160),
  creation_request_id uuid,
  creation_payload_hash text check (
    creation_payload_hash is null or creation_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  upload_verification_request_id uuid,
  upload_verified_at timestamptz,
  approval_request_id uuid,
  completion_request_id uuid,
  completion_payload_hash text check (
    completion_payload_hash is null or completion_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  failure_request_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 32768),
  created_by uuid,
  state_revision bigint not null default 0 check (state_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_document_versions_workspace_id_document_key
    unique (workspace_id, id, document_id),
  constraint pro_document_versions_document_number_key
    unique (workspace_id, document_id, version_number),
  constraint pro_document_versions_storage_path_key
    unique (storage_bucket, storage_path),
  constraint pro_document_versions_document_workspace_fkey
    foreign key (workspace_id, document_id)
    references public.pro_documents(workspace_id, id)
    on delete restrict,
  constraint pro_document_versions_creator_workspace_fkey
    foreign key (workspace_id, created_by)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (created_by),
  constraint pro_document_versions_approver_workspace_fkey
    foreign key (workspace_id, approved_by)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (approved_by),
  constraint pro_document_versions_upload_storage_check check (
    source_type <> 'upload'
    or (storage_bucket is not null and storage_path is not null)
  ),
  constraint pro_document_versions_processing_lease_check check (
    (
      extraction_status = 'processing'
      and processing_claim_id is not null
      and processing_started_at is not null
      and processing_expires_at is not null
      and processing_expires_at > processing_started_at
    )
    or (
      extraction_status <> 'processing'
      and processing_claim_id is null
      and processing_started_at is null
      and processing_expires_at is null
    )
  ),
  constraint pro_document_versions_ready_check check (
    extraction_status <> 'ready' or extracted_at is not null
  ),
  constraint pro_document_versions_approval_check check (
    (
      not approved_for_ai
      and approved_at is null
      and approved_by is null
      and approval_origin is null
    )
    or (
      approved_for_ai
      and extraction_status = 'ready'
      and (
        (
          approval_origin = 'explicit'
          and approved_at is not null
          and approved_by is not null
        )
        or (
          approval_origin = 'legacy_state'
          and approved_by is null
        )
      )
    )
  ),
  constraint pro_document_versions_publication_check check (
    (published_at is null and publication_origin is null)
    or (
      published_at is not null
      and publication_origin in ('explicit', 'legacy_backfill')
      and extraction_status = 'ready'
      and approved_for_ai
    )
  ),
  constraint pro_document_versions_upload_verification_check check (
    upload_verified_at is null or source_type = 'upload'
  )
);

alter table public.pro_documents
  add constraint pro_documents_current_version_fkey
  foreign key (workspace_id, current_version_id, id)
  references public.pro_document_versions(workspace_id, id, document_id)
  on delete restrict
  deferrable initially immediate;

create unique index pro_document_versions_creation_request_uidx
  on public.pro_document_versions(workspace_id, creation_request_id)
  where creation_request_id is not null;

create unique index pro_document_versions_upload_request_uidx
  on public.pro_document_versions(workspace_id, upload_verification_request_id)
  where upload_verification_request_id is not null;

create unique index pro_document_versions_approval_request_uidx
  on public.pro_document_versions(workspace_id, approval_request_id)
  where approval_request_id is not null;

create unique index pro_document_versions_completion_request_uidx
  on public.pro_document_versions(workspace_id, completion_request_id)
  where completion_request_id is not null;

create unique index pro_document_versions_failure_request_uidx
  on public.pro_document_versions(workspace_id, failure_request_id)
  where failure_request_id is not null;

create unique index pro_document_versions_publication_request_uidx
  on public.pro_document_versions(workspace_id, publication_request_id)
  where publication_request_id is not null;

create table public.pro_document_chunks (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 12000),
  created_at timestamptz not null default now(),
  constraint pro_document_chunks_version_index_key
    unique (workspace_id, document_version_id, chunk_index),
  constraint pro_document_chunks_version_workspace_fkey
    foreign key (workspace_id, document_version_id, document_id)
    references public.pro_document_versions(workspace_id, id, document_id)
    on delete restrict
);

create table public.pro_document_agent_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  agent_id uuid not null,
  grant_source text not null default 'bridge'
    check (grant_source in ('bridge', 'legacy_backfill', 'system')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason is null or char_length(revoked_reason) between 1 and 160
  ),
  request_id uuid,
  constraint pro_document_agent_access_document_workspace_fkey
    foreign key (workspace_id, document_id)
    references public.pro_documents(workspace_id, id)
    on delete restrict,
  constraint pro_document_agent_access_agent_workspace_fkey
    foreign key (workspace_id, agent_id)
    references public.agents(workspace_id, id)
    on delete restrict,
  constraint pro_document_agent_access_grantor_workspace_fkey
    foreign key (workspace_id, granted_by)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (granted_by),
  constraint pro_document_agent_access_revoker_workspace_fkey
    foreign key (workspace_id, revoked_by)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (revoked_by),
  constraint pro_document_agent_access_revocation_check check (
    (revoked_at is null and revoked_by is null and revoked_reason is null)
    or (revoked_at is not null and revoked_at >= granted_at)
  )
);

create unique index pro_document_agent_access_active_uidx
  on public.pro_document_agent_access(workspace_id, document_id, agent_id)
  where revoked_at is null;

create table public.pro_document_sync_queue (
  workspace_id uuid not null,
  document_id uuid not null,
  dirty_revision bigint not null default 1 check (dirty_revision > 0),
  dirty_at timestamptz not null default now(),
  reason text not null default 'legacy_write'
    check (char_length(reason) between 1 and 80),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) between 1 and 160
  ),
  last_request_id uuid,
  primary key (workspace_id, document_id)
);

create table public.pro_document_storage_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  operation text not null default 'delete_object'
    check (operation = 'delete_object'),
  storage_bucket text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  scheduled_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) between 1 and 160
  ),
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_document_storage_jobs_version_workspace_fkey
    foreign key (workspace_id, document_version_id, document_id)
    references public.pro_document_versions(workspace_id, id, document_id)
    on delete restrict,
  constraint pro_document_storage_jobs_version_operation_key
    unique (workspace_id, document_version_id, operation),
  constraint pro_document_storage_jobs_state_check check (
    (status = 'processing' and processing_started_at is not null and completed_at is null)
    or (status = 'completed' and completed_at is not null)
    or (status in ('pending', 'failed') and completed_at is null)
  )
);

create table public.pro_audit_events (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null
    references public.pro_workspaces(id) on delete restrict,
  actor_type text not null default 'system'
    check (actor_type in ('user', 'service', 'system', 'migration')),
  actor_user_id uuid,
  event_type text not null check (char_length(event_type) between 1 and 120),
  resource_type text not null check (char_length(resource_type) between 1 and 80),
  resource_id uuid,
  agent_id uuid,
  document_id uuid,
  document_version_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(metadata) = 'object'
      and octet_length(metadata::text) <= 8192
      and not (metadata ?| array[
        'content', 'chunk', 'chunks', 'document_text', 'message', 'prompt',
        'secret', 'token', 'api_key', 'authorization', 'paypal'
      ])
    ),
  created_at timestamptz not null default now(),
  constraint pro_audit_events_actor_workspace_fkey
    foreign key (workspace_id, actor_user_id)
    references public.pro_workspace_members(workspace_id, user_id)
    on delete set null (actor_user_id)
);

create unique index pro_audit_events_request_uidx
  on public.pro_audit_events(workspace_id, request_id)
  where request_id is not null;

create index pro_documents_workspace_status_idx
  on public.pro_documents(workspace_id, lifecycle_status, updated_at desc);

create index pro_documents_creator_idx
  on public.pro_documents(workspace_id, created_by)
  where created_by is not null;

create index pro_documents_current_version_idx
  on public.pro_documents(workspace_id, current_version_id, id)
  where current_version_id is not null;

create index pro_document_versions_document_idx
  on public.pro_document_versions(workspace_id, document_id, version_number desc);

create index pro_document_versions_creator_idx
  on public.pro_document_versions(workspace_id, created_by)
  where created_by is not null;

create index pro_document_versions_approver_idx
  on public.pro_document_versions(workspace_id, approved_by)
  where approved_by is not null;

create index pro_document_versions_processing_idx
  on public.pro_document_versions(processing_expires_at)
  where extraction_status = 'processing';

create index pro_document_chunks_document_version_idx
  on public.pro_document_chunks(workspace_id, document_id, document_version_id);

create index pro_document_chunks_version_fk_idx
  on public.pro_document_chunks(workspace_id, document_version_id, document_id);

create index pro_document_agent_access_agent_idx
  on public.pro_document_agent_access(workspace_id, agent_id, document_id)
  where revoked_at is null;

create index pro_document_agent_access_document_fk_idx
  on public.pro_document_agent_access(workspace_id, document_id);

create index pro_document_agent_access_agent_fk_idx
  on public.pro_document_agent_access(workspace_id, agent_id);

create index pro_document_agent_access_grantor_idx
  on public.pro_document_agent_access(workspace_id, granted_by)
  where granted_by is not null;

create index pro_document_agent_access_revoker_idx
  on public.pro_document_agent_access(workspace_id, revoked_by)
  where revoked_by is not null;

create index pro_document_sync_queue_retry_idx
  on public.pro_document_sync_queue(next_attempt_at, dirty_at);

create index pro_document_storage_jobs_retry_idx
  on public.pro_document_storage_jobs(status, scheduled_at)
  where status in ('pending', 'failed');

create index pro_document_storage_jobs_version_fk_idx
  on public.pro_document_storage_jobs(workspace_id, document_version_id, document_id);

create index pro_audit_events_workspace_created_idx
  on public.pro_audit_events(workspace_id, created_at desc);

create index pro_audit_events_document_created_idx
  on public.pro_audit_events(workspace_id, document_id, created_at desc)
  where document_id is not null;

create index pro_audit_events_actor_idx
  on public.pro_audit_events(workspace_id, actor_user_id)
  where actor_user_id is not null;

create trigger pro_documents_set_updated_at
before update on public.pro_documents
for each row execute function public.set_updated_at();

create trigger pro_document_versions_set_updated_at
before update on public.pro_document_versions
for each row execute function public.set_updated_at();

create trigger pro_document_storage_jobs_set_updated_at
before update on public.pro_document_storage_jobs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invariant and audit helpers
-- ---------------------------------------------------------------------------

create or replace function mediumia_private.pro_sha256_jsonb(p_payload jsonb)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_payload::text, 'UTF8')),
    'hex'
  );
$$;

create or replace function mediumia_private.pro_assert_workspace_actor(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_workspace_id is null or p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'workspace_actor_required';
  end if;

  select wm.role
    into v_role
  from public.pro_workspace_members wm
  join public.pro_workspaces w
    on w.id = wm.workspace_id
   and w.kind = 'customer'
   and w.status = 'active'
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_actor_user_id
    and wm.status = 'active';

  if v_role is null then
    raise exception using errcode = 'P0001', message = 'workspace_membership_required';
  end if;

  if not (v_role = any(p_allowed_roles)) then
    raise exception using errcode = 'P0001', message = 'workspace_role_insufficient';
  end if;

  if not exists (
    select 1
    from public.pro_memberships m
    where m.workspace_id = p_workspace_id
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'pro_access_required';
  end if;
end;
$$;

create or replace function mediumia_private.pro_write_audit(
  p_workspace_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id uuid,
  p_agent_id uuid,
  p_document_id uuid,
  p_document_version_id uuid,
  p_request_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.pro_audit_events(
    workspace_id,
    actor_type,
    actor_user_id,
    event_type,
    resource_type,
    resource_id,
    agent_id,
    document_id,
    document_version_id,
    request_id,
    metadata
  )
  values (
    p_workspace_id,
    p_actor_type,
    p_actor_user_id,
    p_event_type,
    p_resource_type,
    p_resource_id,
    p_agent_id,
    p_document_id,
    p_document_version_id,
    p_request_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function mediumia_private.pro_validate_document_runtime_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.access_mode <> 'selected_agents' then
    raise exception using errcode = 'P0001', message = 'phase1c_access_mode_locked';
  end if;

  if new.current_version_id is not null and not exists (
    select 1
    from public.pro_document_versions v
    where v.id = new.current_version_id
      and v.workspace_id = new.workspace_id
      and v.document_id = new.id
      and v.extraction_status = 'ready'
      and v.approved_for_ai = true
      and v.published_at is not null
  ) then
    raise exception using errcode = '23514', message = 'invalid_current_document_version';
  end if;

  if new.ai_enabled and (
    new.lifecycle_status <> 'active' or new.current_version_id is null
  ) then
    raise exception using errcode = '23514', message = 'invalid_document_ai_state';
  end if;

  return new;
end;
$$;

create trigger pro_documents_validate_runtime_state
before insert or update of workspace_id, current_version_id, ai_enabled, lifecycle_status, access_mode
on public.pro_documents
for each row execute function mediumia_private.pro_validate_document_runtime_state();

create or replace function mediumia_private.pro_protect_published_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;

  if tg_op = 'UPDATE' and old.published_at is not null and (
    new.workspace_id is distinct from old.workspace_id
    or new.document_id is distinct from old.document_id
    or new.version_number is distinct from old.version_number
    or new.source_type is distinct from old.source_type
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.content_sha256 is distinct from old.content_sha256
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.extraction_status is distinct from old.extraction_status
    or new.processing_claim_id is distinct from old.processing_claim_id
    or new.processing_started_at is distinct from old.processing_started_at
    or new.processing_expires_at is distinct from old.processing_expires_at
    or new.completed_claim_id is distinct from old.completed_claim_id
    or new.extracted_at is distinct from old.extracted_at
    or new.approved_for_ai is distinct from old.approved_for_ai
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.approval_origin is distinct from old.approval_origin
    or new.published_at is distinct from old.published_at
    or new.publication_origin is distinct from old.publication_origin
    or new.publication_request_id is distinct from old.publication_request_id
    or new.error_code is distinct from old.error_code
    or new.creation_request_id is distinct from old.creation_request_id
    or new.creation_payload_hash is distinct from old.creation_payload_hash
    or new.upload_verification_request_id is distinct from old.upload_verification_request_id
    or new.upload_verified_at is distinct from old.upload_verified_at
    or new.approval_request_id is distinct from old.approval_request_id
    or new.completion_request_id is distinct from old.completion_request_id
    or new.completion_payload_hash is distinct from old.completion_payload_hash
    or new.failure_request_id is distinct from old.failure_request_id
    or new.metadata is distinct from old.metadata
    or new.created_by is distinct from old.created_by
  ) then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

create trigger pro_document_versions_protect_published
before update or delete on public.pro_document_versions
for each row execute function mediumia_private.pro_protect_published_version();

create or replace function mediumia_private.pro_protect_published_chunks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
begin
  v_version_id := case when tg_op = 'DELETE' then old.document_version_id else new.document_version_id end;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.id = v_version_id
      and v.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'published_version_chunks_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger pro_document_chunks_protect_published
before insert or update or delete on public.pro_document_chunks
for each row execute function mediumia_private.pro_protect_published_chunks();

create or replace function mediumia_private.pro_audit_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'audit_events_append_only';
end;
$$;

create trigger pro_audit_events_append_only
before update or delete on public.pro_audit_events
for each row execute function mediumia_private.pro_audit_append_only();

-- ---------------------------------------------------------------------------
-- Legacy dirty queue. Transition tables collapse a bulk chunk statement to one
-- upsert per document; they never attempt to rebuild the shadow themselves.
-- ---------------------------------------------------------------------------

create or replace function mediumia_private.pro_enqueue_legacy_new_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agent_documents' then
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select distinct n.workspace_id, n.id, 1, now(), tg_argv[0]
    from new_rows n
    where n.workspace_id is not null
    on conflict on constraint pro_document_sync_queue_pkey do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  else
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select distinct n.workspace_id, n.document_id, 1, now(), tg_argv[0]
    from new_rows n
    where n.workspace_id is not null
    on conflict (workspace_id, document_id) do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  end if;
  return null;
end;
$$;

create or replace function mediumia_private.pro_enqueue_legacy_old_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agent_documents' then
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select distinct o.workspace_id, o.id, 1, now(), tg_argv[0]
    from old_rows o
    where o.workspace_id is not null
    on conflict (workspace_id, document_id) do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  else
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select distinct o.workspace_id, o.document_id, 1, now(), tg_argv[0]
    from old_rows o
    where o.workspace_id is not null
    on conflict (workspace_id, document_id) do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  end if;
  return null;
end;
$$;

create or replace function mediumia_private.pro_enqueue_legacy_updated_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agent_documents' then
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select changed.workspace_id, changed.document_id, 1, now(), tg_argv[0]
    from (
      select o.workspace_id, o.id as document_id from old_rows o
      union
      select n.workspace_id, n.id as document_id from new_rows n
    ) changed
    where changed.workspace_id is not null
    on conflict (workspace_id, document_id) do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  else
    insert into public.pro_document_sync_queue(
      workspace_id, document_id, dirty_revision, dirty_at, reason
    )
    select changed.workspace_id, changed.document_id, 1, now(), tg_argv[0]
    from (
      select o.workspace_id, o.document_id from old_rows o
      union
      select n.workspace_id, n.document_id from new_rows n
    ) changed
    where changed.workspace_id is not null
    on conflict (workspace_id, document_id) do update set
      dirty_revision = public.pro_document_sync_queue.dirty_revision + 1,
      dirty_at = excluded.dirty_at,
      reason = excluded.reason,
      attempts = 0,
      next_attempt_at = excluded.dirty_at,
      locked_at = null,
      last_error_code = null,
      last_request_id = null;
  end if;
  return null;
end;
$$;

create trigger pro_queue_legacy_documents_insert
after insert on public.agent_documents
referencing new table as new_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_new_rows('legacy_document_insert');

create trigger pro_queue_legacy_documents_update
after update on public.agent_documents
referencing old table as old_rows new table as new_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_updated_rows('legacy_document_update');

create trigger pro_queue_legacy_documents_delete
after delete on public.agent_documents
referencing old table as old_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_old_rows('legacy_document_delete');

create trigger pro_queue_legacy_chunks_insert
after insert on public.agent_document_chunks
referencing new table as new_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_new_rows('legacy_chunks_insert');

create trigger pro_queue_legacy_chunks_update
after update on public.agent_document_chunks
referencing old table as old_rows new table as new_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_updated_rows('legacy_chunks_update');

create trigger pro_queue_legacy_chunks_delete
after delete on public.agent_document_chunks
referencing old table as old_rows
for each statement execute function mediumia_private.pro_enqueue_legacy_old_rows('legacy_chunks_delete');

-- ---------------------------------------------------------------------------
-- Transactional server RPCs. They are deliberately unavailable to browser
-- roles and derive workspace identity from the agent/document/version.
-- ---------------------------------------------------------------------------

create or replace function public.pro_prepare_document_upload(
  p_agent_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns table (
  document_id uuid,
  version_id uuid,
  workspace_id uuid,
  storage_bucket text,
  storage_path text,
  extraction_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_owner_id uuid;
  v_document_id uuid;
  v_version_id uuid;
  v_storage_path text;
  v_extension text;
  v_normalized_name text;
  v_normalized_mime_type text;
  v_creation_payload_hash text;
  v_existing_payload_hash text;
  v_existing_agent_id uuid;
  v_existing_lifecycle_status text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 240 then
    raise exception using errcode = 'P0001', message = 'invalid_document_name';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 26214400 then
    raise exception using errcode = 'P0001', message = 'invalid_document_size';
  end if;

  v_normalized_name := trim(p_name);
  v_normalized_mime_type := lower(trim(coalesce(p_mime_type, 'application/octet-stream')));

  select a.workspace_id, a.owner_id
    into v_workspace_id, v_owner_id
  from public.agents a
  join public.pro_memberships m
    on m.id = a.membership_id
   and m.workspace_id = a.workspace_id
   and m.user_id = a.owner_id
  where a.id = p_agent_id
    and a.status in ('active', 'draft')
  for share of a;

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'agent_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_workspace_id::text || ':' || p_request_id::text,
      18642
    )
  );

  v_creation_payload_hash := mediumia_private.pro_sha256_jsonb(
    jsonb_build_object(
      'operation', 'prepare_document_upload',
      'agent_id', p_agent_id,
      'name', v_normalized_name,
      'mime_type', v_normalized_mime_type,
      'size_bytes', p_size_bytes
    )
  );

  select
    v.document_id,
    v.id,
    v.storage_path,
    v.creation_payload_hash,
    a.agent_id,
    d.lifecycle_status
    into
      v_document_id,
      v_version_id,
      v_storage_path,
      v_existing_payload_hash,
      v_existing_agent_id,
      v_existing_lifecycle_status
  from public.pro_document_versions v
  join public.pro_documents d
    on d.workspace_id = v.workspace_id
   and d.id = v.document_id
  join public.pro_document_agent_access a
    on a.workspace_id = v.workspace_id
   and a.document_id = v.document_id
   and a.request_id = p_request_id
  where v.workspace_id = v_workspace_id
    and v.creation_request_id = p_request_id
  limit 1;

  if v_document_id is not null then
    if v_existing_agent_id <> p_agent_id
       or v_existing_payload_hash is distinct from v_creation_payload_hash then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;
    if v_existing_lifecycle_status <> 'active' then
      raise exception using errcode = 'P0001', message = 'document_not_active';
    end if;

    return query
    select
      v_document_id,
      v_version_id,
      v_workspace_id,
      'agent-documents'::text,
      v_storage_path,
      v.extraction_status,
      true
    from public.pro_document_versions v
    where v.id = v_version_id;
    return;
  end if;

  v_extension := lower(substring(v_normalized_name from '\.([a-z0-9]+)$'));
  if v_extension is null or v_extension <> all(array['pdf', 'txt', 'md', 'csv', 'json', 'docx']::text[]) then
    raise exception using errcode = 'P0001', message = 'unsupported_document_type';
  end if;

  v_document_id := gen_random_uuid();
  v_version_id := gen_random_uuid();
  v_storage_path := format(
    'workspaces/%s/documents/%s/versions/%s/source.%s',
    v_workspace_id,
    v_document_id,
    v_version_id,
    v_extension
  );

  insert into public.pro_documents(
    id, workspace_id, name, created_by
  ) values (
    v_document_id, v_workspace_id, v_normalized_name, p_actor_user_id
  );

  insert into public.pro_document_versions(
    id,
    workspace_id,
    document_id,
    version_number,
    source_type,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    extraction_status,
    creation_request_id,
    creation_payload_hash,
    created_by
  ) values (
    v_version_id,
    v_workspace_id,
    v_document_id,
    1,
    'upload',
    'agent-documents',
    v_storage_path,
    lower(trim(coalesce(p_mime_type, 'application/octet-stream'))),
    p_size_bytes,
    'pending_upload',
    p_request_id,
    v_creation_payload_hash,
    p_actor_user_id
  );

  insert into public.pro_document_agent_access(
    workspace_id,
    document_id,
    agent_id,
    grant_source,
    granted_by,
    request_id
  ) values (
    v_workspace_id,
    v_document_id,
    p_agent_id,
    'bridge',
    p_actor_user_id,
    p_request_id
  );

  insert into public.agent_documents(
    id,
    agent_id,
    owner_id,
    workspace_id,
    name,
    source_type,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    status,
    approved_for_ai,
    sensitivity,
    metadata
  ) values (
    v_document_id,
    p_agent_id,
    v_owner_id,
    v_workspace_id,
    v_normalized_name,
    'upload',
    'agent-documents',
    v_storage_path,
    v_normalized_mime_type,
    p_size_bytes,
    'processing',
    false,
    'confidential',
    jsonb_build_object(
      'upload_pending', true,
      'created_via', 'pro_document_bridge',
      'shadow_version_id', v_version_id
    )
  );

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_upload_prepared',
    'document',
    v_document_id,
    p_agent_id,
    v_document_id,
    v_version_id,
    p_request_id,
    jsonb_build_object('source_type', 'upload', 'size_bytes', p_size_bytes)
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_workspace_id
    and q.document_id = v_document_id;

  return query select
    v_document_id,
    v_version_id,
    v_workspace_id,
    'agent-documents'::text,
    v_storage_path,
    'pending_upload'::text,
    false;
end;
$$;

create or replace function public.pro_prepare_document_version_upload(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns table (
  document_id uuid,
  version_id uuid,
  workspace_id uuid,
  version_number integer,
  storage_bucket text,
  storage_path text,
  extraction_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_existing public.pro_document_versions%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_storage_path text;
  v_extension text;
  v_normalized_name text;
  v_normalized_mime_type text;
  v_creation_payload_hash text;
begin
  if p_document_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_version_upload_request';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 240 then
    raise exception using errcode = 'P0001', message = 'invalid_document_name';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 26214400 then
    raise exception using errcode = 'P0001', message = 'invalid_document_size';
  end if;

  v_normalized_name := trim(p_name);
  v_normalized_mime_type := lower(trim(coalesce(p_mime_type, 'application/octet-stream')));
  v_extension := lower(substring(v_normalized_name from '\.([a-z0-9]+)$'));
  if v_extension is null or v_extension <> all(array['pdf', 'txt', 'md', 'csv', 'json', 'docx']::text[]) then
    raise exception using errcode = 'P0001', message = 'unsupported_document_type';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = p_document_id
  for update;
  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'document_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  if v_document.lifecycle_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;

  v_creation_payload_hash := mediumia_private.pro_sha256_jsonb(
    jsonb_build_object(
      'operation', 'prepare_document_version_upload',
      'document_id', p_document_id,
      'name', v_normalized_name,
      'mime_type', v_normalized_mime_type,
      'size_bytes', p_size_bytes
    )
  );

  select v.* into v_existing
  from public.pro_document_versions v
  where v.workspace_id = v_document.workspace_id
    and v.creation_request_id = p_request_id
  limit 1;

  if v_existing.id is not null then
    if v_existing.document_id <> p_document_id
       or v_existing.creation_payload_hash is distinct from v_creation_payload_hash then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return query select
      p_document_id,
      v_existing.id,
      v_document.workspace_id,
      v_existing.version_number,
      v_existing.storage_bucket,
      v_existing.storage_path,
      v_existing.extraction_status,
      true;
    return;
  end if;

  select coalesce(max(v.version_number), 0) + 1
    into v_version_number
  from public.pro_document_versions v
  where v.workspace_id = v_document.workspace_id
    and v.document_id = p_document_id;

  v_version_id := gen_random_uuid();
  v_storage_path := format(
    'workspaces/%s/documents/%s/versions/%s/source.%s',
    v_document.workspace_id,
    p_document_id,
    v_version_id,
    v_extension
  );

  insert into public.pro_document_versions(
    id,
    workspace_id,
    document_id,
    version_number,
    source_type,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    extraction_status,
    creation_request_id,
    creation_payload_hash,
    created_by
  ) values (
    v_version_id,
    v_document.workspace_id,
    p_document_id,
    v_version_number,
    'upload',
    'agent-documents',
    v_storage_path,
    v_normalized_mime_type,
    p_size_bytes,
    'pending_upload',
    p_request_id,
    v_creation_payload_hash,
    p_actor_user_id
  );

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_version_upload_prepared',
    'document_version',
    v_version_id,
    null,
    p_document_id,
    v_version_id,
    p_request_id,
    jsonb_build_object(
      'source_type', 'upload',
      'size_bytes', p_size_bytes,
      'version_number', v_version_number
    )
  );

  return query select
    p_document_id,
    v_version_id,
    v_document.workspace_id,
    v_version_number,
    'agent-documents'::text,
    v_storage_path,
    'pending_upload'::text,
    false;
end;
$$;

create or replace function public.pro_mark_document_version_uploaded(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  version_id uuid,
  extraction_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_version public.pro_document_versions%rowtype;
begin
  if p_version_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_upload_verification_request';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select v.document_id from public.pro_document_versions v where v.id = p_version_id
  )
  for update;
  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
    and v.workspace_id = v_document.workspace_id
    and v.document_id = v_document.id
  for update;

  if v_document.lifecycle_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;
  if v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;
  if v_version.source_type <> 'upload'
     or v_version.storage_bucket is null
     or v_version.storage_path is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_upload';
  end if;

  if v_version.upload_verification_request_id = p_request_id then
    return query select
      v_document.id,
      p_version_id,
      v_version.extraction_status,
      true;
    return;
  end if;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_document.workspace_id
      and v.upload_verification_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.extraction_status = 'uploaded' then
    return query select v_document.id, p_version_id, 'uploaded'::text, true;
    return;
  end if;
  if v_version.extraction_status not in ('pending_upload', 'failed') then
    raise exception using errcode = 'P0001', message = 'document_version_upload_state_invalid';
  end if;

  update public.pro_document_versions v
  set extraction_status = 'uploaded',
      upload_verification_request_id = p_request_id,
      upload_verified_at = now(),
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_version_uploaded',
    'document_version',
    p_version_id,
    null,
    v_document.id,
    p_version_id,
    p_request_id,
    '{}'::jsonb
  );

  return query select v_document.id, p_version_id, 'uploaded'::text, false;
end;
$$;

create or replace function public.pro_claim_document_extraction(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  document_id uuid,
  version_id uuid,
  claim_id uuid,
  lease_expires_at timestamptz,
  extraction_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_workspace_id uuid;
  v_version public.pro_document_versions%rowtype;
  v_expires_at timestamptz;
begin
  if p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'claim_and_request_required';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode = 'P0001', message = 'invalid_claim_lease';
  end if;

  select v.document_id into v_document_id
  from public.pro_document_versions v
  where v.id = p_version_id;
  if v_document_id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  select d.workspace_id into v_workspace_id
  from public.pro_documents d
  where d.id = v_document_id
  for update;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'document_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
    and v.workspace_id = v_workspace_id
    and v.document_id = v_document_id
  for update;

  if v_version.id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;
  if exists (
    select 1 from public.pro_documents d
    where d.id = v_document_id and d.lifecycle_status <> 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;
  if v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;
  if v_version.extraction_status = 'ready' then
    return query select
      v_document_id,
      p_version_id,
      v_version.completed_claim_id,
      null::timestamptz,
      'ready'::text,
      true;
    return;
  end if;

  if v_version.extraction_status = 'pending_upload' then
    raise exception using errcode = 'P0001', message = 'document_version_not_uploaded';
  end if;
  if v_version.source_type = 'upload'
     and v_version.extraction_status in ('uploaded', 'failed')
     and v_version.upload_verified_at is null then
    raise exception using errcode = 'P0001', message = 'document_version_source_not_verified';
  end if;

  if v_version.extraction_status = 'processing'
     and v_version.processing_claim_id = p_claim_id
     and v_version.processing_expires_at > now() then
    return query select
      v_document_id,
      p_version_id,
      p_claim_id,
      v_version.processing_expires_at,
      'processing'::text,
      true;
    return;
  end if;

  if v_version.extraction_status = 'processing'
     and v_version.processing_expires_at > now() then
    raise exception using errcode = 'P0001', message = 'extraction_in_progress';
  end if;

  v_expires_at := now() + make_interval(secs => p_lease_seconds);
  update public.pro_document_versions v
  set extraction_status = 'processing',
      processing_claim_id = p_claim_id,
      processing_started_at = now(),
      processing_expires_at = v_expires_at,
      error_code = null,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_extraction_claimed',
    'document_version',
    p_version_id,
    null,
    v_document_id,
    p_version_id,
    p_request_id,
    jsonb_build_object('lease_seconds', p_lease_seconds)
  );

  return query select
    v_document_id,
    p_version_id,
    p_claim_id,
    v_expires_at,
    'processing'::text,
    false;
end;
$$;

create or replace function public.pro_complete_document_extraction(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid,
  p_content_sha256 text,
  p_chunks jsonb,
  p_extraction_metadata jsonb default '{}'::jsonb
)
returns table (
  document_id uuid,
  version_id uuid,
  chunk_count integer,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_workspace_id uuid;
  v_version public.pro_document_versions%rowtype;
  v_legacy public.agent_documents%rowtype;
  v_chunk_count integer;
  v_distinct_indexes integer;
  v_min_index integer;
  v_max_index integer;
  v_valid_content boolean;
  v_canonical_chunks jsonb;
  v_completion_payload_hash text;
  v_sync_legacy boolean;
begin
  if p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'claim_and_request_required';
  end if;
  if p_content_sha256 is null or lower(p_content_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_content_sha256';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_document_chunks';
  end if;
  if p_extraction_metadata is null or jsonb_typeof(p_extraction_metadata) <> 'object'
     or octet_length(p_extraction_metadata::text) > 32768 then
    raise exception using errcode = 'P0001', message = 'invalid_extraction_metadata';
  end if;

  select
    count(*)::integer,
    count(distinct (item ->> 'chunk_index')::integer)::integer,
    min((item ->> 'chunk_index')::integer),
    max((item ->> 'chunk_index')::integer),
    bool_and(
      jsonb_typeof(item -> 'content') = 'string'
      and char_length(item ->> 'content') between 1 and 12000
    )
  into
    v_chunk_count,
    v_distinct_indexes,
    v_min_index,
    v_max_index,
    v_valid_content
  from jsonb_array_elements(p_chunks) item;

  if v_chunk_count <> v_distinct_indexes
     or v_min_index <> 0
     or v_max_index <> v_chunk_count - 1
     or not coalesce(v_valid_content, false) then
    raise exception using errcode = 'P0001', message = 'invalid_document_chunks';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'chunk_index', (item ->> 'chunk_index')::integer,
      'content', item ->> 'content'
    )
    order by (item ->> 'chunk_index')::integer
  )
  into v_canonical_chunks
  from jsonb_array_elements(p_chunks) item;

  v_completion_payload_hash := mediumia_private.pro_sha256_jsonb(
    jsonb_build_object(
      'content_sha256', lower(p_content_sha256),
      'chunks', v_canonical_chunks,
      'metadata', p_extraction_metadata
    )
  );

  select v.document_id into v_document_id
  from public.pro_document_versions v
  where v.id = p_version_id;
  if v_document_id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  select d.workspace_id into v_workspace_id
  from public.pro_documents d
  where d.id = v_document_id
  for update;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'document_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
    and v.workspace_id = v_workspace_id
    and v.document_id = v_document_id
  for update;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_workspace_id
      and v.completion_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.extraction_status = 'ready'
     and (
       v_version.completion_request_id = p_request_id
       or v_version.completed_claim_id = p_claim_id
     ) then
    if v_version.completion_payload_hash is distinct from v_completion_payload_hash then
      raise exception using errcode = 'P0001', message = 'completion_payload_conflict';
    end if;
    if v_version.completion_request_id = p_request_id
       and v_version.completed_claim_id is distinct from p_claim_id then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;
    select count(*)::integer into v_chunk_count
    from public.pro_document_chunks c
    where c.workspace_id = v_workspace_id
      and c.document_version_id = p_version_id;
    return query select v_document_id, p_version_id, v_chunk_count, true;
    return;
  end if;

  if v_version.extraction_status <> 'processing'
     or v_version.processing_claim_id <> p_claim_id then
    raise exception using errcode = 'P0001', message = 'extraction_claim_lost';
  end if;
  if v_version.processing_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'extraction_claim_expired';
  end if;

  select d.* into v_legacy
  from public.agent_documents d
  where d.id = v_document_id
    and d.workspace_id = v_workspace_id
  for update;
  if v_legacy.id is null then
    raise exception using errcode = 'P0001', message = 'legacy_document_missing';
  end if;

  delete from public.pro_document_chunks c
  where c.workspace_id = v_workspace_id
    and c.document_version_id = p_version_id;

  insert into public.pro_document_chunks(
    workspace_id, document_id, document_version_id, chunk_index, content
  )
  select
    v_workspace_id,
    v_document_id,
    p_version_id,
    (item ->> 'chunk_index')::integer,
    item ->> 'content'
  from jsonb_array_elements(p_chunks) item
  order by (item ->> 'chunk_index')::integer;

  update public.pro_document_versions v
  set extraction_status = 'ready',
      processing_claim_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      completed_claim_id = p_claim_id,
      extracted_at = now(),
      content_sha256 = lower(p_content_sha256),
      completion_request_id = p_request_id,
      completion_payload_hash = v_completion_payload_hash,
      metadata = v.metadata || p_extraction_metadata,
      error_code = null,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  select d.current_version_id is null or d.current_version_id = p_version_id
    into v_sync_legacy
  from public.pro_documents d
  where d.id = v_document_id;

  if v_sync_legacy then
    delete from public.agent_document_chunks c
    where c.document_id = v_document_id
      and c.agent_id = v_legacy.agent_id
      and c.owner_id = v_legacy.owner_id;

    insert into public.agent_document_chunks(
      document_id, agent_id, owner_id, workspace_id, chunk_index, content
    )
    select
      v_document_id,
      v_legacy.agent_id,
      v_legacy.owner_id,
      v_workspace_id,
      (item ->> 'chunk_index')::integer,
      item ->> 'content'
    from jsonb_array_elements(p_chunks) item
    order by (item ->> 'chunk_index')::integer;

    update public.agent_documents d
    set status = 'ready',
        approved_for_ai = false,
        approved_at = null,
        storage_bucket = v_version.storage_bucket,
        storage_path = v_version.storage_path,
        mime_type = v_version.mime_type,
        size_bytes = v_version.size_bytes,
        error_message = null,
        metadata = d.metadata
          || p_extraction_metadata
          || jsonb_build_object(
            'upload_pending', false,
            'indexed_server', true,
            'chunks', v_chunk_count,
            'shadow_version_id', p_version_id
          )
    where d.id = v_document_id;
  end if;

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_extraction_completed',
    'document_version',
    p_version_id,
    v_legacy.agent_id,
    v_document_id,
    p_version_id,
    p_request_id,
    jsonb_build_object('chunk_count', v_chunk_count)
  );

  if v_sync_legacy then
    delete from public.pro_document_sync_queue q
    where q.workspace_id = v_workspace_id
      and q.document_id = v_document_id;
  end if;

  return query select v_document_id, p_version_id, v_chunk_count, false;
end;
$$;

create or replace function public.pro_fail_document_extraction(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid,
  p_error_code text
)
returns table (
  document_id uuid,
  version_id uuid,
  extraction_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_workspace_id uuid;
  v_version public.pro_document_versions%rowtype;
  v_has_current boolean;
  v_error_code text;
begin
  if p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'claim_and_request_required';
  end if;
  if p_error_code is null or char_length(trim(p_error_code)) not between 1 and 160 then
    raise exception using errcode = 'P0001', message = 'invalid_extraction_error';
  end if;
  v_error_code := trim(p_error_code);

  select v.document_id into v_document_id
  from public.pro_document_versions v
  where v.id = p_version_id;
  select d.workspace_id, d.current_version_id is not null
    into v_workspace_id, v_has_current
  from public.pro_documents d
  where d.id = v_document_id
  for update;

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
  for update;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_workspace_id
      and v.failure_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.extraction_status = 'failed'
     and v_version.failure_request_id = p_request_id then
    if v_version.error_code is distinct from v_error_code then
      raise exception using errcode = 'P0001', message = 'failure_payload_conflict';
    end if;
    return query select v_document_id, p_version_id, 'failed'::text, true;
    return;
  end if;
  if v_version.extraction_status <> 'processing'
     or v_version.processing_claim_id <> p_claim_id then
    raise exception using errcode = 'P0001', message = 'extraction_claim_lost';
  end if;

  update public.pro_document_versions v
  set extraction_status = 'failed',
      processing_claim_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      error_code = v_error_code,
      failure_request_id = p_request_id,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  if not v_has_current then
    update public.agent_documents d
    set status = 'error',
        approved_for_ai = false,
        approved_at = null,
        error_message = v_error_code
    where d.id = v_document_id
      and d.workspace_id = v_workspace_id;

    update public.pro_documents d
    set ai_enabled = false,
        state_revision = d.state_revision + 1
    where d.id = v_document_id;
  end if;

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_extraction_failed',
    'document_version',
    p_version_id,
    null,
    v_document_id,
    p_version_id,
    p_request_id,
    jsonb_build_object('error_code', v_error_code)
  );

  if not v_has_current then
    delete from public.pro_document_sync_queue q
    where q.workspace_id = v_workspace_id
      and q.document_id = v_document_id;
  end if;

  return query select v_document_id, p_version_id, 'failed'::text, false;
end;
$$;

create or replace function public.pro_approve_document_version(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  version_id uuid,
  approved_for_ai boolean,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_workspace_id uuid;
  v_version public.pro_document_versions%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;

  select v.document_id into v_document_id
  from public.pro_document_versions v
  where v.id = p_version_id;
  select d.workspace_id into v_workspace_id
  from public.pro_documents d
  where d.id = v_document_id
  for update;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
  for update;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_workspace_id
      and v.approval_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.approved_for_ai then
    return query select v_document_id, p_version_id, true, true;
    return;
  end if;
  if v_version.extraction_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'document_version_not_ready';
  end if;
  if v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;

  update public.pro_document_versions v
  set approved_for_ai = true,
      approved_at = now(),
      approved_by = p_actor_user_id,
      approval_origin = 'explicit',
      approval_request_id = p_request_id,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_version_approved',
    'document_version',
    p_version_id,
    null,
    v_document_id,
    p_version_id,
    p_request_id,
    '{}'::jsonb
  );

  return query select v_document_id, p_version_id, true, false;
end;
$$;

create or replace function public.pro_publish_document_version(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  version_id uuid,
  ai_enabled boolean,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_version public.pro_document_versions%rowtype;
  v_legacy public.agent_documents%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select v.document_id from public.pro_document_versions v where v.id = p_version_id
  )
  for update;
  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
    and v.workspace_id = v_document.workspace_id
    and v.document_id = v_document.id
  for update;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_document.workspace_id
      and v.publication_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_document.current_version_id = p_version_id
     and v_version.published_at is not null
     and v_document.ai_enabled then
    return query select v_document.id, p_version_id, true, true;
    return;
  end if;
  if v_document.lifecycle_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;
  if v_version.extraction_status <> 'ready' or not v_version.approved_for_ai then
    raise exception using errcode = 'P0001', message = 'document_version_not_publishable';
  end if;

  select d.* into v_legacy
  from public.agent_documents d
  where d.id = v_document.id
    and d.workspace_id = v_document.workspace_id
  for update;
  if v_legacy.id is null then
    raise exception using errcode = 'P0001', message = 'legacy_document_missing';
  end if;

  if v_document.current_version_id is distinct from p_version_id then
    delete from public.agent_document_chunks c
    where c.document_id = v_document.id
      and c.agent_id = v_legacy.agent_id
      and c.owner_id = v_legacy.owner_id;

    insert into public.agent_document_chunks(
      document_id, agent_id, owner_id, workspace_id, chunk_index, content
    )
    select
      v_document.id,
      v_legacy.agent_id,
      v_legacy.owner_id,
      v_document.workspace_id,
      c.chunk_index,
      c.content
    from public.pro_document_chunks c
    where c.workspace_id = v_document.workspace_id
      and c.document_version_id = p_version_id
    order by c.chunk_index;
  end if;

  update public.pro_document_versions v
  set published_at = coalesce(v.published_at, now()),
      publication_origin = coalesce(v.publication_origin, 'explicit'),
      publication_request_id = coalesce(v.publication_request_id, p_request_id),
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  update public.pro_documents d
  set current_version_id = p_version_id,
      ai_enabled = true,
      state_revision = d.state_revision + 1
  where d.id = v_document.id;

  update public.agent_documents d
  set status = 'ready',
      approved_for_ai = true,
      approved_at = now(),
      version = v_version.version_number,
      storage_bucket = v_version.storage_bucket,
      storage_path = v_version.storage_path,
      mime_type = v_version.mime_type,
      size_bytes = v_version.size_bytes,
      error_message = null,
      metadata = d.metadata || jsonb_build_object('shadow_version_id', p_version_id)
  where d.id = v_document.id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_version_published',
    'document_version',
    p_version_id,
    v_legacy.agent_id,
    v_document.id,
    p_version_id,
    p_request_id,
    jsonb_build_object('version_number', v_version.version_number)
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_document.workspace_id
    and q.document_id = v_document.id;

  return query select v_document.id, p_version_id, true, false;
end;
$$;

create or replace function public.pro_set_document_ai_enabled(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_enabled boolean,
  p_request_id uuid
)
returns table (
  document_id uuid,
  ai_enabled boolean,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_existing_event_type text;
  v_existing_resource_id uuid;
begin
  if p_enabled is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_ai_toggle_request';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = p_document_id
  for update;
  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'document_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select a.event_type, a.resource_id
    into v_existing_event_type, v_existing_resource_id
  from public.pro_audit_events a
  where a.workspace_id = v_document.workspace_id
    and a.request_id = p_request_id
  limit 1;

  if v_existing_event_type is not null then
    if v_existing_resource_id is distinct from p_document_id
       or v_existing_event_type <> (case
         when p_enabled then 'document_ai_enabled'
         else 'document_ai_disabled'
       end) then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;
    return query select p_document_id, v_document.ai_enabled, true;
    return;
  end if;

  if v_document.ai_enabled = p_enabled then
    perform mediumia_private.pro_write_audit(
      v_document.workspace_id,
      'user',
      p_actor_user_id,
      case when p_enabled then 'document_ai_enabled' else 'document_ai_disabled' end,
      'document',
      p_document_id,
      null,
      p_document_id,
      v_document.current_version_id,
      p_request_id,
      jsonb_build_object('state_unchanged', true)
    );
    return query select p_document_id, p_enabled, true;
    return;
  end if;

  if p_enabled and not exists (
    select 1
    from public.pro_document_versions v
    where v.id = v_document.current_version_id
      and v.workspace_id = v_document.workspace_id
      and v.document_id = v_document.id
      and v.extraction_status = 'ready'
      and v.approved_for_ai
      and v.published_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'document_has_no_publishable_version';
  end if;

  update public.pro_documents d
  set ai_enabled = p_enabled,
      state_revision = d.state_revision + 1
  where d.id = p_document_id;

  update public.agent_documents d
  set approved_for_ai = p_enabled,
      approved_at = case when p_enabled then coalesce(d.approved_at, now()) else null end
  where d.id = p_document_id
    and d.workspace_id = v_document.workspace_id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    case when p_enabled then 'document_ai_enabled' else 'document_ai_disabled' end,
    'document',
    p_document_id,
    null,
    p_document_id,
    v_document.current_version_id,
    p_request_id,
    '{}'::jsonb
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_document.workspace_id
    and q.document_id = p_document_id;

  return query select p_document_id, p_enabled, false;
end;
$$;

create or replace function public.pro_delete_document(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  lifecycle_status text,
  storage_jobs_created integer,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_jobs integer := 0;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = p_document_id
  for update;
  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'document_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  if v_document.lifecycle_status in ('deleting', 'deleted') then
    select count(*)::integer into v_jobs
    from public.pro_document_storage_jobs j
    where j.workspace_id = v_document.workspace_id
      and j.document_id = p_document_id;
    return query select p_document_id, v_document.lifecycle_status, v_jobs, true;
    return;
  end if;

  update public.pro_documents d
  set lifecycle_status = 'deleting',
      ai_enabled = false,
      state_revision = d.state_revision + 1
  where d.id = p_document_id;

  update public.pro_document_agent_access a
  set revoked_at = now(),
      revoked_by = p_actor_user_id,
      revoked_reason = 'document_deleting'
  where a.workspace_id = v_document.workspace_id
    and a.document_id = p_document_id
    and a.revoked_at is null;

  update public.agent_documents d
  set status = 'archived',
      approved_for_ai = false,
      approved_at = null
  where d.id = p_document_id
    and d.workspace_id = v_document.workspace_id;

  insert into public.pro_document_storage_jobs(
    workspace_id,
    document_id,
    document_version_id,
    storage_bucket,
    storage_path,
    request_id
  )
  select
    v.workspace_id,
    v.document_id,
    v.id,
    v.storage_bucket,
    v.storage_path,
    p_request_id
  from public.pro_document_versions v
  where v.workspace_id = v_document.workspace_id
    and v.document_id = p_document_id
    and v.storage_bucket is not null
    and v.storage_path is not null
  on conflict (workspace_id, document_version_id, operation) do nothing;
  get diagnostics v_jobs = row_count;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_deletion_requested',
    'document',
    p_document_id,
    null,
    p_document_id,
    v_document.current_version_id,
    p_request_id,
    jsonb_build_object('storage_jobs_created', v_jobs)
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_document.workspace_id
    and q.document_id = p_document_id;

  return query select p_document_id, 'deleting'::text, v_jobs, false;
end;
$$;

-- Idempotent bootstrap/reconciliation used by the later 1B-C backfill and by
-- the 1B-B queue drainer. It never receives a workspace from its caller.
create or replace function public.pro_reconcile_legacy_document(
  p_document_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  version_id uuid,
  reconciliation_action text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_legacy public.agent_documents%rowtype;
  v_document public.pro_documents%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_created_by uuid;
  v_sync_hash text;
  v_extraction_status text;
  v_ready boolean;
  v_approved boolean;
  v_queue_revision bigint;
  v_queue_last_request_id uuid;
begin
  if p_document_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_reconciliation_request';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_document_id::text, 18641)
  );

  -- Keep the same document-before-legacy lock order as complete, publish,
  -- toggle, and delete so reconciliation cannot deadlock those paths.
  select d.* into v_document
  from public.pro_documents d
  where d.id = p_document_id
  for update;

  select d.* into v_legacy
  from public.agent_documents d
  where d.id = p_document_id
  for update;

  if v_legacy.id is null then
    if v_document.id is not null then
      update public.pro_documents d
      set lifecycle_status = 'deleting',
          ai_enabled = false,
          state_revision = d.state_revision + 1
      where d.id = p_document_id
        and d.lifecycle_status not in ('deleting', 'deleted');

      update public.pro_document_agent_access a
      set revoked_at = coalesce(a.revoked_at, now()),
          revoked_reason = coalesce(a.revoked_reason, 'legacy_document_missing')
      where a.workspace_id = v_document.workspace_id
        and a.document_id = p_document_id
        and a.revoked_at is null;

      insert into public.pro_document_storage_jobs(
        workspace_id,
        document_id,
        document_version_id,
        storage_bucket,
        storage_path,
        request_id
      )
      select
        v.workspace_id,
        v.document_id,
        v.id,
        v.storage_bucket,
        v.storage_path,
        p_request_id
      from public.pro_document_versions v
      where v.workspace_id = v_document.workspace_id
        and v.document_id = p_document_id
        and v.storage_bucket is not null
        and v.storage_path is not null
      on conflict (workspace_id, document_version_id, operation) do nothing;

      perform mediumia_private.pro_write_audit(
        v_document.workspace_id,
        'system',
        null,
        'legacy_document_missing',
        'document',
        p_document_id,
        null,
        p_document_id,
        v_document.current_version_id,
        p_request_id,
        '{}'::jsonb
      );
    end if;

    delete from public.pro_document_sync_queue q
    where q.document_id = p_document_id;

    return query select p_document_id, null::uuid, 'legacy_missing'::text, false;
    return;
  end if;

  select q.dirty_revision, q.last_request_id
    into v_queue_revision, v_queue_last_request_id
  from public.pro_document_sync_queue q
  where q.workspace_id = v_legacy.workspace_id
    and q.document_id = p_document_id;

  select case when exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = v_legacy.workspace_id
      and wm.user_id = v_legacy.owner_id
  ) then v_legacy.owner_id else null end
  into v_created_by;

  select md5(concat_ws(
    '|',
    v_legacy.workspace_id::text,
    v_legacy.agent_id::text,
    v_legacy.name,
    v_legacy.source_type,
    coalesce(v_legacy.storage_bucket, ''),
    coalesce(v_legacy.storage_path, ''),
    coalesce(v_legacy.mime_type, ''),
    coalesce(v_legacy.size_bytes::text, ''),
    v_legacy.status,
    v_legacy.approved_for_ai::text,
    v_legacy.sensitivity,
    coalesce((
      select string_agg(c.chunk_index::text || ':' || md5(c.content), ',' order by c.chunk_index)
      from public.agent_document_chunks c
      where c.document_id = v_legacy.id
        and c.agent_id = v_legacy.agent_id
        and c.owner_id = v_legacy.owner_id
    ), '')
  )) into v_sync_hash;

  if v_document.id is not null and v_document.legacy_sync_hash = v_sync_hash then
    delete from public.pro_document_sync_queue q
    where q.workspace_id = v_legacy.workspace_id
      and q.document_id = p_document_id
      and v_queue_revision is not null
      and q.dirty_revision = v_queue_revision;
    return query select p_document_id, v_document.current_version_id, 'already_synced'::text, true;
    return;
  end if;

  -- Phase 1B-A never rewrites an existing shadow version from an out-of-band
  -- legacy mutation. The queue remains dirty for an explicit 1B-C comparison
  -- instead of silently violating published-version immutability.
  if v_document.id is not null then
    if v_queue_last_request_id = p_request_id then
      return query select
        p_document_id,
        v_document.current_version_id,
        'divergence'::text,
        true;
      return;
    end if;

    if exists (
      select 1
      from public.pro_audit_events a
      where a.workspace_id = v_legacy.workspace_id
        and a.request_id = p_request_id
    ) then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    insert into public.pro_document_sync_queue(
      workspace_id,
      document_id,
      dirty_revision,
      dirty_at,
      reason,
      attempts,
      next_attempt_at,
      locked_at,
      last_error_code,
      last_request_id
    ) values (
      v_legacy.workspace_id,
      p_document_id,
      1,
      now(),
      'legacy_shadow_divergence',
      1,
      now() + interval '30 seconds',
      null,
      'legacy_shadow_divergence',
      p_request_id
    )
    on conflict on constraint pro_document_sync_queue_pkey do update set
      attempts = public.pro_document_sync_queue.attempts + 1,
      next_attempt_at = now() + make_interval(
        secs => least(
          3600,
          30 * power(2, least(public.pro_document_sync_queue.attempts, 6))::integer
        )
      ),
      locked_at = null,
      last_error_code = 'legacy_shadow_divergence',
      last_request_id = p_request_id;

    perform mediumia_private.pro_write_audit(
      v_legacy.workspace_id,
      'system',
      null,
      'legacy_document_divergence',
      'document',
      p_document_id,
      v_legacy.agent_id,
      p_document_id,
      v_document.current_version_id,
      p_request_id,
      jsonb_build_object('queue_revision', coalesce(v_queue_revision, 1))
    );

    return query select
      p_document_id,
      v_document.current_version_id,
      'divergence'::text,
      false;
    return;
  end if;

  v_ready := v_legacy.status = 'ready';
  v_approved := v_ready and v_legacy.approved_for_ai;
  v_extraction_status := case v_legacy.status
    when 'ready' then 'ready'
    when 'error' then 'failed'
    when 'uploaded' then 'uploaded'
    when 'processing' then 'uploaded'
    when 'archived' then 'failed'
    else 'failed'
  end;

  insert into public.pro_documents(
    id,
    workspace_id,
    name,
    lifecycle_status,
    sensitivity,
    ai_enabled,
    created_by,
    legacy_sync_hash,
    legacy_synced_at,
    created_at,
    updated_at
  ) values (
    v_legacy.id,
    v_legacy.workspace_id,
    v_legacy.name,
    case when v_legacy.status = 'archived' then 'archived' else 'active' end,
    v_legacy.sensitivity,
    false,
    v_created_by,
    v_sync_hash,
    now(),
    v_legacy.created_at,
    v_legacy.updated_at
  );
  v_version_number := greatest(1, v_legacy.version);

  v_version_id := gen_random_uuid();
  insert into public.pro_document_versions(
    id,
    workspace_id,
    document_id,
    version_number,
    source_type,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    extraction_status,
    extracted_at,
    approved_for_ai,
    approved_at,
    approved_by,
    approval_origin,
    published_at,
    publication_origin,
    error_code,
    metadata,
    created_by,
    created_at,
    updated_at
  ) values (
    v_version_id,
    v_legacy.workspace_id,
    v_legacy.id,
    v_version_number,
    v_legacy.source_type,
    v_legacy.storage_bucket,
    v_legacy.storage_path,
    v_legacy.mime_type,
    v_legacy.size_bytes,
    v_extraction_status,
    case when v_ready then coalesce(v_legacy.updated_at, now()) else null end,
    v_approved,
    case when v_approved then v_legacy.approved_at else null end,
    null,
    case when v_approved then 'legacy_state' else null end,
    null,
    null,
    v_legacy.error_message,
    coalesce(v_legacy.metadata, '{}'::jsonb)
      || jsonb_build_object('legacy_document_version', v_legacy.version),
    v_created_by,
    v_legacy.created_at,
    v_legacy.updated_at
  );

  insert into public.pro_document_chunks(
    workspace_id, document_id, document_version_id, chunk_index, content, created_at
  )
  select
    c.workspace_id,
    c.document_id,
    v_version_id,
    c.chunk_index,
    c.content,
    c.created_at
  from public.agent_document_chunks c
  where c.document_id = v_legacy.id
    and c.agent_id = v_legacy.agent_id
    and c.owner_id = v_legacy.owner_id
  order by c.chunk_index;

  insert into public.pro_document_agent_access(
    workspace_id,
    document_id,
    agent_id,
    grant_source,
    granted_by,
    granted_at
  ) values (
    v_legacy.workspace_id,
    v_legacy.id,
    v_legacy.agent_id,
    'legacy_backfill',
    null,
    now()
  )
  on conflict do nothing;

  if v_approved then
    update public.pro_document_versions v
    set published_at = now(),
        publication_origin = 'legacy_backfill',
        state_revision = v.state_revision + 1
    where v.id = v_version_id;

    update public.pro_documents d
    set current_version_id = v_version_id,
        ai_enabled = true,
        legacy_sync_hash = v_sync_hash,
        legacy_synced_at = now(),
        state_revision = d.state_revision + 1
    where d.id = p_document_id;
  else
    update public.pro_documents d
    set legacy_sync_hash = v_sync_hash,
        legacy_synced_at = now()
    where d.id = p_document_id;
  end if;

  perform mediumia_private.pro_write_audit(
    v_legacy.workspace_id,
    'system',
    null,
    'legacy_document_reconciled',
    'document',
    p_document_id,
    v_legacy.agent_id,
    p_document_id,
    v_version_id,
    p_request_id,
    jsonb_build_object(
      'version_number', v_version_number,
      'approval_origin', case when v_approved then 'legacy_state' else null end,
      'legacy_approved_at_present', v_legacy.approved_at is not null,
      'publication_origin', case when v_approved then 'legacy_backfill' else null end
    )
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_legacy.workspace_id
    and q.document_id = p_document_id
    and v_queue_revision is not null
    and q.dirty_revision = v_queue_revision;

  return query select p_document_id, v_version_id, 'synchronized'::text, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-only access. No browser policy exposes the shadow before Phase 1C.
-- ---------------------------------------------------------------------------

alter table public.pro_documents enable row level security;
alter table public.pro_document_versions enable row level security;
alter table public.pro_document_chunks enable row level security;
alter table public.pro_document_agent_access enable row level security;
alter table public.pro_document_sync_queue enable row level security;
alter table public.pro_document_storage_jobs enable row level security;
alter table public.pro_audit_events enable row level security;

revoke all on table public.pro_documents from public, anon, authenticated;
revoke all on table public.pro_document_versions from public, anon, authenticated;
revoke all on table public.pro_document_chunks from public, anon, authenticated;
revoke all on table public.pro_document_agent_access from public, anon, authenticated;
revoke all on table public.pro_document_sync_queue from public, anon, authenticated;
revoke all on table public.pro_document_storage_jobs from public, anon, authenticated;
revoke all on table public.pro_audit_events from public, anon, authenticated;

grant select, insert, update, delete on table public.pro_documents to service_role;
grant select, insert, update, delete on table public.pro_document_versions to service_role;
grant select, insert, update, delete on table public.pro_document_chunks to service_role;
grant select, insert, update, delete on table public.pro_document_agent_access to service_role;
grant select, insert, update, delete on table public.pro_document_sync_queue to service_role;
grant select, insert, update, delete on table public.pro_document_storage_jobs to service_role;
grant select, insert, update, delete on table public.pro_audit_events to service_role;
grant usage, select on sequence public.pro_document_chunks_id_seq to service_role;
grant usage, select on sequence public.pro_audit_events_id_seq to service_role;

create policy "No client access to Pro documents"
on public.pro_documents for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro document versions"
on public.pro_document_versions for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro document chunks"
on public.pro_document_chunks for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro document agent access"
on public.pro_document_agent_access for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro document sync queue"
on public.pro_document_sync_queue for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro document storage jobs"
on public.pro_document_storage_jobs for all to anon, authenticated
using (false) with check (false);

create policy "No client access to Pro audit events"
on public.pro_audit_events for all to anon, authenticated
using (false) with check (false);

revoke all on function mediumia_private.pro_sha256_jsonb(jsonb) from public, anon, authenticated;
revoke all on function mediumia_private.pro_assert_workspace_actor(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function mediumia_private.pro_write_audit(uuid, text, uuid, text, text, uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function mediumia_private.pro_validate_document_runtime_state() from public, anon, authenticated;
revoke all on function mediumia_private.pro_protect_published_version() from public, anon, authenticated;
revoke all on function mediumia_private.pro_protect_published_chunks() from public, anon, authenticated;
revoke all on function mediumia_private.pro_audit_append_only() from public, anon, authenticated;
revoke all on function mediumia_private.pro_enqueue_legacy_new_rows() from public, anon, authenticated;
revoke all on function mediumia_private.pro_enqueue_legacy_old_rows() from public, anon, authenticated;
revoke all on function mediumia_private.pro_enqueue_legacy_updated_rows() from public, anon, authenticated;

grant execute on function mediumia_private.pro_sha256_jsonb(jsonb) to service_role;
grant execute on function mediumia_private.pro_assert_workspace_actor(uuid, uuid, text[]) to service_role;
grant execute on function mediumia_private.pro_write_audit(uuid, text, uuid, text, text, uuid, uuid, uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.pro_prepare_document_upload(uuid, uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.pro_prepare_document_version_upload(uuid, uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.pro_mark_document_version_uploaded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pro_claim_document_extraction(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.pro_complete_document_extraction(uuid, uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.pro_fail_document_extraction(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.pro_approve_document_version(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pro_publish_document_version(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pro_set_document_ai_enabled(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.pro_delete_document(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pro_reconcile_legacy_document(uuid, uuid) from public, anon, authenticated;

grant execute on function public.pro_prepare_document_upload(uuid, uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.pro_prepare_document_version_upload(uuid, uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.pro_mark_document_version_uploaded(uuid, uuid, uuid) to service_role;
grant execute on function public.pro_claim_document_extraction(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.pro_complete_document_extraction(uuid, uuid, uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.pro_fail_document_extraction(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.pro_approve_document_version(uuid, uuid, uuid) to service_role;
grant execute on function public.pro_publish_document_version(uuid, uuid, uuid) to service_role;
grant execute on function public.pro_set_document_ai_enabled(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.pro_delete_document(uuid, uuid, uuid) to service_role;
grant execute on function public.pro_reconcile_legacy_document(uuid, uuid) to service_role;

do $$
begin
  if (
    select definition_md5 from mediumia_phase1b_rag_guard
  ) <> md5(pg_get_functiondef(
    'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
  )) then
    raise exception 'legacy_rag_function_changed';
  end if;
end;
$$;

drop table pg_temp.mediumia_phase1b_rag_guard;

comment on table public.pro_documents is
  'Phase 1B-A workspace-owned document identities. Server-only shadow; no RAG effect before Phase 1C.';
comment on column public.pro_documents.ai_enabled is
  'Revocable runtime switch. Published version approval remains immutable historical evidence.';
comment on table public.pro_document_sync_queue is
  'Dirty legacy document signals. Drained by the Phase 1B-B Edge bridge and the Phase 1B-C reconciliation run.';
comment on table public.pro_document_storage_jobs is
  'Retryable Storage work created only after database access has been neutralized. No worker is installed in Phase 1B-A.';
