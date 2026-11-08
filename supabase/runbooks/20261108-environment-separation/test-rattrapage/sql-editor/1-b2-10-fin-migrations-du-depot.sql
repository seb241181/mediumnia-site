-- MediumIA — rattrapage de la base TEST — B2-10 (fin) : 11 migrations du dépôt, de document_shadow à rdv_appointment_reminder
-- Projet : MediumIA RDV PayPal Test (wnbwhnqiulsdjcvkuwos) UNIQUEMENT.
-- Fichier généré par generer.py (ne pas modifier à la main).
-- Tout ou rien : en cas d'erreur, rien n'est conservé. Refusé sur la Production,
-- refusé s'il a déjà été exécuté ou si l'étape précédente manque.
-- Inscrit dans l'historique : b2_10_bloc3_document_shadow_a_rdv_appointment_reminder.
begin;

do $garde$
begin
  if exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     or not exists (select 1 from public.booking_practitioners where slug = 'seb-test') then
    raise exception 'ARRET : cette base n''est pas TEST (wnbwhnqiulsdjcvkuwos). Rien n''a été modifié.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where name in ('b2_10_bloc3_document_shadow_a_rdv_appointment_reminder')) then
    raise exception 'ARRET : ce fichier a déjà été exécuté sur TEST. Rien n''a été modifié.';
  end if;
  if (select count(distinct name) from supabase_migrations.schema_migrations where name in ('b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents', 'b2_10_bloc2_pro_workspace_shadow_fk_indexes')) <> 2 then
    raise exception 'ARRET : une étape précédente manque. Rien n''a été modifié.';
  end if;
end $garde$;

-- >>> migrations/20260910184117_mediumia_pro_phase1b_document_shadow.sql
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

-- >>> migrations/20260911120000_mediumia_pro_phase1b_edge_bridge_support.sql
-- MediumIA Pro Phase 1B-B: narrow operational primitives for the document
-- Edge bridge. This migration does not backfill legacy documents and does not
-- change the legacy RAG function.

create temporary table mediumia_phase1b_edge_rag_guard (
  definition_md5 text not null
);

insert into mediumia_phase1b_edge_rag_guard(definition_md5)
select md5(pg_get_functiondef(
  'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
));

alter table public.pro_document_versions
  add column extraction_attempts integer not null default 0,
  add column last_extraction_operation_id uuid,
  add column last_extraction_claim_id uuid,
  add column last_extraction_claim_request_id uuid;

alter table public.pro_document_versions
  add constraint pro_document_versions_extraction_attempt_check check (
    (
      extraction_attempts = 0
      and last_extraction_operation_id is null
      and last_extraction_claim_id is null
      and last_extraction_claim_request_id is null
    )
    or (
      extraction_attempts > 0
      and last_extraction_operation_id is not null
      and last_extraction_claim_id is not null
      and last_extraction_claim_request_id is not null
    )
  );

create unique index pro_document_versions_last_extraction_claim_uidx
  on public.pro_document_versions(workspace_id, last_extraction_claim_id)
  where last_extraction_claim_id is not null;

create unique index pro_document_versions_last_extraction_claim_request_uidx
  on public.pro_document_versions(workspace_id, last_extraction_claim_request_id)
  where last_extraction_claim_request_id is not null;

alter table public.pro_document_storage_jobs
  add column processing_claim_id uuid,
  add column processing_expires_at timestamptz,
  add column last_claim_id uuid,
  add column claim_request_id uuid,
  add column completion_request_id uuid,
  add column failure_request_id uuid;

alter table public.pro_document_storage_jobs
  add constraint pro_document_storage_jobs_processing_claim_check check (
    (
      status = 'processing'
      and processing_claim_id is not null
      and processing_started_at is not null
      and processing_expires_at is not null
      and processing_expires_at > processing_started_at
    )
    or (
      status <> 'processing'
      and processing_claim_id is null
      and processing_started_at is null
      and processing_expires_at is null
    )
  );

create unique index pro_document_storage_jobs_processing_claim_uidx
  on public.pro_document_storage_jobs(workspace_id, processing_claim_id)
  where processing_claim_id is not null;

create unique index pro_document_storage_jobs_claim_request_uidx
  on public.pro_document_storage_jobs(workspace_id, claim_request_id)
  where claim_request_id is not null;

create unique index pro_document_storage_jobs_completion_request_uidx
  on public.pro_document_storage_jobs(workspace_id, completion_request_id)
  where completion_request_id is not null;

create unique index pro_document_storage_jobs_failure_request_uidx
  on public.pro_document_storage_jobs(workspace_id, failure_request_id)
  where failure_request_id is not null;

-- Pasted text has no Storage phase, but still needs the same durable,
-- idempotent shadow identity before extraction and chunk publication.
create or replace function public.pro_prepare_text_document(
  p_agent_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_name text,
  p_content_sha256 text,
  p_size_bytes bigint
)
returns table (
  document_id uuid,
  version_id uuid,
  workspace_id uuid,
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
  v_normalized_name text;
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
  if p_content_sha256 is null or lower(p_content_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_content_sha256';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 26214400 then
    raise exception using errcode = 'P0001', message = 'invalid_document_size';
  end if;

  v_normalized_name := trim(p_name);

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
      18644
    )
  );

  v_creation_payload_hash := mediumia_private.pro_sha256_jsonb(
    jsonb_build_object(
      'operation', 'prepare_text_document',
      'agent_id', p_agent_id,
      'name', v_normalized_name,
      'content_sha256', lower(p_content_sha256),
      'size_bytes', p_size_bytes
    )
  );

  select
    v.document_id,
    v.id,
    v.creation_payload_hash,
    a.agent_id,
    d.lifecycle_status
    into
      v_document_id,
      v_version_id,
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
      v.extraction_status,
      true
    from public.pro_document_versions v
    where v.id = v_version_id;
    return;
  end if;

  v_document_id := gen_random_uuid();
  v_version_id := gen_random_uuid();

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
    'paste',
    'text/plain',
    p_size_bytes,
    'uploaded',
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
    'paste',
    'processing',
    false,
    'confidential',
    jsonb_build_object(
      'created_via', 'pro_document_bridge',
      'shadow_version_id', v_version_id
    )
  );

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_text_prepared',
    'document',
    v_document_id,
    p_agent_id,
    v_document_id,
    v_version_id,
    p_request_id,
    jsonb_build_object('source_type', 'paste', 'size_bytes', p_size_bytes)
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_workspace_id
    and q.document_id = v_document_id;

  return query select
    v_document_id,
    v_version_id,
    v_workspace_id,
    'uploaded'::text,
    false;
end;
$$;

-- Abandon only an unpublished replacement version. Version 1 must be
-- neutralized with pro_delete_document so an empty document cannot linger.
create or replace function public.pro_abandon_document_version(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  version_id uuid,
  extraction_status text,
  storage_jobs_created integer,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_version public.pro_document_versions%rowtype;
  v_jobs integer := 0;
begin
  if p_version_id is null or p_actor_user_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_version_abandon_request';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select v.document_id
    from public.pro_document_versions v
    where v.id = p_version_id
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

  if v_version.id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  if v_document.lifecycle_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;
  if v_document.current_version_id is null then
    raise exception using errcode = 'P0001', message = 'version_one_requires_document_delete';
  end if;
  if v_document.current_version_id = p_version_id or v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;
  if v_version.source_type <> 'upload'
     or v_version.storage_bucket is null
     or v_version.storage_path is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_upload';
  end if;

  if v_version.extraction_status = 'failed'
     and v_version.error_code = 'upload_abandoned'
     and v_version.failure_request_id = p_request_id then
    select count(*)::integer into v_jobs
    from public.pro_document_storage_jobs j
    where j.workspace_id = v_document.workspace_id
      and j.document_version_id = p_version_id;

    return query select
      v_document.id,
      p_version_id,
      'failed'::text,
      v_jobs,
      true;
    return;
  end if;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_document.workspace_id
      and v.failure_request_id = p_request_id
      and v.id <> p_version_id
  ) or exists (
    select 1
    from public.pro_audit_events a
    where a.workspace_id = v_document.workspace_id
      and a.request_id = p_request_id
      and (
        a.event_type <> 'document_version_upload_abandoned'
        or a.resource_id <> p_version_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.extraction_status = 'processing' then
    raise exception using errcode = 'P0001', message = 'document_extraction_in_progress';
  end if;
  if v_version.extraction_status not in ('pending_upload', 'uploaded', 'failed') then
    raise exception using errcode = 'P0001', message = 'document_version_not_abandonable';
  end if;

  update public.pro_document_versions v
  set extraction_status = 'failed',
      processing_claim_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      approved_for_ai = false,
      approved_at = null,
      approved_by = null,
      approval_origin = null,
      error_code = 'upload_abandoned',
      failure_request_id = p_request_id,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  insert into public.pro_document_storage_jobs(
    workspace_id,
    document_id,
    document_version_id,
    storage_bucket,
    storage_path,
    request_id
  ) values (
    v_document.workspace_id,
    v_document.id,
    p_version_id,
    v_version.storage_bucket,
    v_version.storage_path,
    p_request_id
  )
  on conflict (workspace_id, document_version_id, operation) do nothing;
  get diagnostics v_jobs = row_count;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_version_upload_abandoned',
    'document_version',
    p_version_id,
    null,
    v_document.id,
    p_version_id,
    p_request_id,
    jsonb_build_object('storage_jobs_created', v_jobs)
  );

  return query select
    v_document.id,
    p_version_id,
    'failed'::text,
    v_jobs,
    false;
end;
$$;

-- An HTTP operation identifies one logical extraction attempt. Replaying that
-- operation while its lease is active returns the same claim; retrying after a
-- committed failure requires a new operation and therefore receives a fresh
-- fenced claim. A stale lease always becomes a new numbered attempt.
create or replace function public.pro_claim_document_extraction_attempt(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_lease_seconds integer default 300
)
returns table (
  document_id uuid,
  version_id uuid,
  claim_id uuid,
  lease_expires_at timestamptz,
  extraction_status text,
  attempt_number integer,
  error_code text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_version public.pro_document_versions%rowtype;
  v_claim record;
  v_claim_id uuid;
  v_claim_request_id uuid;
  v_attempt_number integer;
begin
  if p_version_id is null or p_actor_user_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_extraction_attempt';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode = 'P0001', message = 'invalid_claim_lease';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select v.document_id
    from public.pro_document_versions v
    where v.id = p_version_id
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

  if v_version.id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;
  if v_document.lifecycle_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'document_not_active';
  end if;
  if v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;

  if v_version.extraction_status = 'ready' then
    return query select
      v_document.id,
      p_version_id,
      v_version.completed_claim_id,
      null::timestamptz,
      'ready'::text,
      v_version.extraction_attempts,
      null::text,
      true;
    return;
  end if;

  if v_version.extraction_status = 'processing'
     and v_version.processing_expires_at > now() then
    if v_version.last_extraction_operation_id = p_operation_id
       and v_version.last_extraction_claim_id = v_version.processing_claim_id then
      return query select
        v_document.id,
        p_version_id,
        v_version.processing_claim_id,
        v_version.processing_expires_at,
        'processing'::text,
        v_version.extraction_attempts,
        null::text,
        true;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'extraction_in_progress';
  end if;

  if v_version.extraction_status = 'failed'
     and v_version.last_extraction_operation_id = p_operation_id
     and v_version.last_extraction_claim_id is not null then
    return query select
      v_document.id,
      p_version_id,
      v_version.last_extraction_claim_id,
      null::timestamptz,
      'failed'::text,
      v_version.extraction_attempts,
      v_version.error_code,
      true;
    return;
  end if;

  v_claim_id := gen_random_uuid();
  v_claim_request_id := gen_random_uuid();
  v_attempt_number := v_version.extraction_attempts + 1;

  select c.* into v_claim
  from public.pro_claim_document_extraction(
    p_version_id,
    p_actor_user_id,
    v_claim_id,
    v_claim_request_id,
    p_lease_seconds
  ) c;

  update public.pro_document_versions v
  set extraction_attempts = v_attempt_number,
      last_extraction_operation_id = p_operation_id,
      last_extraction_claim_id = v_claim_id,
      last_extraction_claim_request_id = v_claim_request_id
  where v.id = p_version_id
    and v.workspace_id = v_document.workspace_id;

  return query select
    v_claim.document_id,
    v_claim.version_id,
    v_claim.claim_id,
    v_claim.lease_expires_at,
    v_claim.extraction_status,
    v_attempt_number,
    null::text,
    false;
end;
$$;

create or replace function public.pro_claim_document_storage_job(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid,
  p_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  job_status text,
  claim_id uuid,
  lease_expires_at timestamptz,
  attempts integer,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_job public.pro_document_storage_jobs%rowtype;
  v_lease_expires_at timestamptz;
begin
  if p_document_id is null or p_actor_user_id is null
     or p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_storage_job_claim';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode = 'P0001', message = 'invalid_storage_job_lease';
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

  select j.* into v_job
  from public.pro_document_storage_jobs j
  where j.workspace_id = v_document.workspace_id
    and j.claim_request_id = p_request_id
  limit 1
  for update;

  if v_job.id is not null then
    if v_job.document_id <> p_document_id
       or coalesce(v_job.processing_claim_id, v_job.last_claim_id) is distinct from p_claim_id then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    return query select
      v_job.id,
      v_job.document_id,
      v_job.document_version_id,
      v_job.storage_bucket,
      v_job.storage_path,
      v_job.status,
      p_claim_id,
      v_job.processing_expires_at,
      v_job.attempts,
      true;
    return;
  end if;

  select j.* into v_job
  from public.pro_document_storage_jobs j
  where j.workspace_id = v_document.workspace_id
    and j.document_id = p_document_id
    and (
      (j.status in ('pending', 'failed') and j.scheduled_at <= now())
      or (j.status = 'processing' and j.processing_expires_at <= now())
    )
  order by j.scheduled_at, j.created_at, j.id
  for update skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  v_lease_expires_at := now() + make_interval(secs => p_lease_seconds);

  update public.pro_document_storage_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      processing_started_at = now(),
      processing_expires_at = v_lease_expires_at,
      processing_claim_id = p_claim_id,
      claim_request_id = p_request_id,
      last_error_code = null
  where j.id = v_job.id
  returning j.* into v_job;

  return query select
    v_job.id,
    v_job.document_id,
    v_job.document_version_id,
    v_job.storage_bucket,
    v_job.storage_path,
    v_job.status,
    p_claim_id,
    v_job.processing_expires_at,
    v_job.attempts,
    false;
end;
$$;

create or replace function public.pro_complete_document_storage_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid
)
returns table (
  job_id uuid,
  document_id uuid,
  job_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_job public.pro_document_storage_jobs%rowtype;
begin
  if p_job_id is null or p_actor_user_id is null
     or p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_storage_job_completion';
  end if;

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select j.document_id
    from public.pro_document_storage_jobs j
    where j.id = p_job_id
  )
  for update;

  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'storage_job_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select j.* into v_job
  from public.pro_document_storage_jobs j
  where j.id = p_job_id
    and j.workspace_id = v_document.workspace_id
    and j.document_id = v_document.id
  for update;

  if v_job.status = 'completed' then
    if v_job.last_claim_id is distinct from p_claim_id
       or v_job.completion_request_id is distinct from p_request_id then
      raise exception using errcode = 'P0001', message = 'storage_completion_payload_conflict';
    end if;
    return query select p_job_id, v_document.id, 'completed'::text, true;
    return;
  end if;

  if v_job.status <> 'processing' or v_job.processing_claim_id <> p_claim_id then
    raise exception using errcode = 'P0001', message = 'storage_job_claim_lost';
  end if;
  if v_job.processing_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'storage_job_claim_expired';
  end if;

  update public.pro_document_storage_jobs j
  set status = 'completed',
      processing_started_at = null,
      processing_expires_at = null,
      processing_claim_id = null,
      last_claim_id = p_claim_id,
      completed_at = now(),
      completion_request_id = p_request_id,
      last_error_code = null
  where j.id = p_job_id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_storage_delete_completed',
    'document_storage_job',
    p_job_id,
    null,
    v_document.id,
    v_job.document_version_id,
    p_request_id,
    jsonb_build_object('attempts', v_job.attempts)
  );

  return query select p_job_id, v_document.id, 'completed'::text, false;
end;
$$;

create or replace function public.pro_fail_document_storage_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_request_id uuid,
  p_error_code text,
  p_retry_seconds integer default 60
)
returns table (
  job_id uuid,
  document_id uuid,
  job_status text,
  scheduled_at timestamptz,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_job public.pro_document_storage_jobs%rowtype;
  v_error_code text;
  v_scheduled_at timestamptz;
begin
  if p_job_id is null or p_actor_user_id is null
     or p_claim_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_storage_job_failure';
  end if;
  if p_error_code is null or char_length(trim(p_error_code)) not between 1 and 160 then
    raise exception using errcode = 'P0001', message = 'invalid_storage_error';
  end if;
  if p_retry_seconds not between 0 and 86400 then
    raise exception using errcode = 'P0001', message = 'invalid_storage_retry_delay';
  end if;
  v_error_code := trim(p_error_code);

  select d.* into v_document
  from public.pro_documents d
  where d.id = (
    select j.document_id
    from public.pro_document_storage_jobs j
    where j.id = p_job_id
  )
  for update;

  if v_document.id is null then
    raise exception using errcode = 'P0001', message = 'storage_job_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_document.workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select j.* into v_job
  from public.pro_document_storage_jobs j
  where j.id = p_job_id
    and j.workspace_id = v_document.workspace_id
    and j.document_id = v_document.id
  for update;

  if v_job.status = 'failed'
     and v_job.last_claim_id = p_claim_id
     and v_job.failure_request_id = p_request_id then
    if v_job.last_error_code is distinct from v_error_code then
      raise exception using errcode = 'P0001', message = 'storage_failure_payload_conflict';
    end if;
    return query select p_job_id, v_document.id, 'failed'::text, v_job.scheduled_at, true;
    return;
  end if;

  if v_job.status <> 'processing' or v_job.processing_claim_id <> p_claim_id then
    raise exception using errcode = 'P0001', message = 'storage_job_claim_lost';
  end if;

  v_scheduled_at := now() + make_interval(secs => p_retry_seconds);
  update public.pro_document_storage_jobs j
  set status = 'failed',
      processing_started_at = null,
      processing_expires_at = null,
      processing_claim_id = null,
      last_claim_id = p_claim_id,
      scheduled_at = v_scheduled_at,
      completed_at = null,
      failure_request_id = p_request_id,
      last_error_code = v_error_code
  where j.id = p_job_id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_storage_delete_failed',
    'document_storage_job',
    p_job_id,
    null,
    v_document.id,
    v_job.document_version_id,
    p_request_id,
    jsonb_build_object('error_code', v_error_code, 'retry_seconds', p_retry_seconds)
  );

  return query select p_job_id, v_document.id, 'failed'::text, v_scheduled_at, false;
end;
$$;

create or replace function public.pro_finalize_document_deletion(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns table (
  document_id uuid,
  lifecycle_status text,
  pending_storage_jobs integer,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.pro_documents%rowtype;
  v_pending integer;
begin
  if p_document_id is null or p_actor_user_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_document_deletion_finalization';
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

  select count(*)::integer into v_pending
  from public.pro_document_storage_jobs j
  where j.workspace_id = v_document.workspace_id
    and j.document_id = p_document_id
    and j.status <> 'completed';

  if v_document.lifecycle_status = 'deleted' then
    return query select p_document_id, 'deleted'::text, v_pending, true;
    return;
  end if;
  if v_document.lifecycle_status <> 'deleting' then
    raise exception using errcode = 'P0001', message = 'document_not_deleting';
  end if;
  if v_pending > 0 then
    return query select p_document_id, 'deleting'::text, v_pending, true;
    return;
  end if;

  update public.pro_documents d
  set lifecycle_status = 'deleted',
      ai_enabled = false,
      deleted_at = now(),
      state_revision = d.state_revision + 1
  where d.id = p_document_id;

  perform mediumia_private.pro_write_audit(
    v_document.workspace_id,
    'user',
    p_actor_user_id,
    'document_deletion_completed',
    'document',
    p_document_id,
    null,
    p_document_id,
    v_document.current_version_id,
    p_request_id,
    '{}'::jsonb
  );

  return query select p_document_id, 'deleted'::text, 0, false;
end;
$$;

revoke all on function public.pro_prepare_text_document(uuid, uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.pro_abandon_document_version(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.pro_claim_document_extraction_attempt(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.pro_claim_document_storage_job(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.pro_complete_document_storage_job(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.pro_fail_document_storage_job(uuid, uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.pro_finalize_document_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.pro_prepare_text_document(uuid, uuid, uuid, text, text, bigint)
  to service_role;
grant execute on function public.pro_abandon_document_version(uuid, uuid, uuid)
  to service_role;
grant execute on function public.pro_claim_document_extraction_attempt(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.pro_claim_document_storage_job(uuid, uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.pro_complete_document_storage_job(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.pro_fail_document_storage_job(uuid, uuid, uuid, uuid, text, integer)
  to service_role;
grant execute on function public.pro_finalize_document_deletion(uuid, uuid, uuid)
  to service_role;

do $$
begin
  if (
    select definition_md5 from mediumia_phase1b_edge_rag_guard
  ) <> md5(pg_get_functiondef(
    'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
  )) then
    raise exception 'legacy_rag_function_changed';
  end if;
end;
$$;

drop table pg_temp.mediumia_phase1b_edge_rag_guard;

comment on function public.pro_prepare_text_document(uuid, uuid, uuid, text, text, bigint) is
  'Idempotently prepares one pasted-text document in legacy and shadow models.';
comment on function public.pro_abandon_document_version(uuid, uuid, uuid) is
  'Abandons one unpublished N+1 upload without changing the current published version.';
comment on function public.pro_claim_document_extraction_attempt(uuid, uuid, uuid, integer) is
  'Claims one attempt-aware extraction lease while preserving network-retry idempotence and stale-worker fencing.';
comment on function public.pro_claim_document_storage_job(uuid, uuid, uuid, uuid, integer) is
  'Claims one retryable Storage deletion job with a bounded lease.';
comment on function public.pro_complete_document_storage_job(uuid, uuid, uuid, uuid) is
  'Idempotently records successful Storage deletion for the active claim.';
comment on function public.pro_fail_document_storage_job(uuid, uuid, uuid, uuid, text, integer) is
  'Records a retryable Storage deletion failure without re-enabling document access.';
comment on function public.pro_finalize_document_deletion(uuid, uuid, uuid) is
  'Marks a DB-neutralized document deleted only after every Storage job completed.';

-- >>> migrations/20260923180000_customer_reviews.sql
-- Avis clients MediumIA : collecte, modération par le propriétaire, publication.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Tant qu'elle n'est pas appliquée, le site affiche « collecte bientôt ouverte » et
-- n'affiche aucun avis.
--
-- Accès : uniquement via le serveur (clé service_role, api/rdv-config.js?reviewsAction=…).
-- RLS activée sans aucune policy : ni anon ni authenticated ne peuvent lire l'e-mail
-- des auteurs ou publier eux-mêmes un avis.
-- Aucune adresse IP n'est stockée ; la limite d'envoi se fait par adresse e-mail.

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  display_name text not null check (char_length(display_name) between 2 and 60),
  email text not null check (char_length(email) between 5 and 254),
  offering text not null check (offering in ('consultation', 'oracle', 'chronosphere', 'formation', 'conference', 'autre')),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 30 and 1500),
  experience_month text check (experience_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  consent_publication boolean not null check (consent_publication),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderated_at timestamptz,
  rejection_reason text check (rejection_reason is null or rejection_reason in ('insulting', 'personal_data', 'off_topic', 'not_a_customer', 'duplicate', 'requested_by_author'))
);

create index if not exists customer_reviews_status_created_idx
  on public.customer_reviews (status, created_at desc);
create index if not exists customer_reviews_email_created_idx
  on public.customer_reviews (lower(email), created_at desc);

alter table public.customer_reviews enable row level security;
revoke all on table public.customer_reviews from public, anon, authenticated;

-- Vérification (doit renvoyer 0 ligne) :
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'customer_reviews' and grantee in ('anon', 'authenticated');

-- >>> migrations/20260924100000_rdv_review_requests.sql
-- Demande d'avis Google après une consultation.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Tant qu'elle n'est pas appliquée, la tâche quotidienne ignore simplement cette étape.
--
-- review_request_sent_at est posé AVANT l'envoi (réservation atomique de la ligne) :
-- chaque rendez-vous reçoit au plus une demande, même si la tâche est relancée.

alter table public.bookings
  add column if not exists review_request_sent_at timestamptz;

create index if not exists bookings_review_request_pending_idx
  on public.bookings (ends_at)
  where status = 'confirmed' and review_request_sent_at is null;

-- La tâche quotidienne ne considère que les rendez-vous terminés depuis 12 h à 4 jours :
-- les anciens clients ne reçoivent pas de demande tardive.

-- >>> migrations/20260924120000_gift_cards.sql
-- Cartes cadeaux MediumIA : achat, envoi, utilisation.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.
--
-- TVA : toutes les prestations concernées sont au même taux (20 %), la carte est donc
-- un « bon à usage unique » : la TVA est comptée à la vente (écriture gift_card_sale).
-- Son utilisation est enregistrée avec payment_method = 'gift_card' pour solder le
-- rendez-vous, mais n'est pas recomptée dans le chiffre d'affaires.

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_last4 text not null check (char_length(code_last4) = 4),
  view_token_hash text not null unique,
  kind text not null check (kind in ('amount', 'consultation', 'chronosphere', 'coffret')),
  label text not null check (char_length(label) between 3 and 160),
  price_cents integer not null check (price_cents > 0 and price_cents <= 100000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  consultation_credit_cents integer not null default 0 check (consultation_credit_cents >= 0),
  balance_cents integer not null default 0 check (balance_cents >= 0 and balance_cents <= consultation_credit_cents),
  service_id uuid references public.booking_services(id) on delete set null,
  chronosphere_product text check (chronosphere_product is null or chronosphere_product in ('pack3', 'max3')),
  chronosphere_redeemed_at timestamptz,
  buyer_name text not null check (char_length(buyer_name) between 1 and 80),
  buyer_email text not null check (char_length(buyer_email) between 5 and 254),
  recipient_name text not null check (char_length(recipient_name) between 1 and 80),
  recipient_email text check (recipient_email is null or char_length(recipient_email) between 5 and 254),
  message text check (message is null or char_length(message) <= 400),
  send_on date,
  recipient_sent_at timestamptz,
  buyer_sent_at timestamptz,
  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'active', 'used', 'cancelled')),
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  paid_at timestamptz,
  expires_at timestamptz,
  terms_version text not null,
  created_at timestamptz not null default now(),
  constraint gift_cards_paid_state check (
    (status = 'payment_pending' and paypal_capture_id is null and paid_at is null)
    or (status <> 'payment_pending' and paypal_capture_id is not null and paid_at is not null and expires_at is not null)
  )
);

create index if not exists gift_cards_recipient_due_idx
  on public.gift_cards (send_on)
  where status = 'active' and recipient_email is not null and recipient_sent_at is null;

create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

-- Code en clair et jeton de la carte à imprimer, nécessaires pour envoyer la carte
-- (à l'acheteur, puis au bénéficiaire à la date choisie). Table séparée, serveur seul.
create table if not exists public.gift_card_delivery_secrets (
  gift_card_id uuid primary key references public.gift_cards(id) on delete cascade,
  code text not null,
  view_token text not null
);

alter table public.gift_cards enable row level security;
alter table public.gift_card_redemptions enable row level security;
alter table public.gift_card_delivery_secrets enable row level security;
revoke all on table public.gift_cards from public, anon, authenticated;
revoke all on table public.gift_card_redemptions from public, anon, authenticated;
revoke all on table public.gift_card_delivery_secrets from public, anon, authenticated;

-- Comptabilité : vente de carte (entry_kind) et utilisation (payment_method).
alter table public.rdv_financial_entries drop constraint if exists rdv_financial_entries_entry_kind_check;
alter table public.rdv_financial_entries add constraint rdv_financial_entries_entry_kind_check
  check (entry_kind in ('arrhes', 'balance', 'full_payment', 'refund', 'arrhes_retained', 'adjustment', 'gift_card_sale'));
alter table public.rdv_financial_entries drop constraint if exists rdv_financial_entries_payment_method_check;
alter table public.rdv_financial_entries add constraint rdv_financial_entries_payment_method_check
  check (payment_method in ('paypal', 'card', 'cash', 'check', 'transfer', 'other', 'gift_card'));

-- >>> migrations/20260924204500_conference_raffle_eligibility.sql
-- Explicit raffle eligibility for conference registrations.
-- Household members, the organizer and anyone involved in the draw can be kept
-- registered for the conference while being excluded from raffle participation.

alter table public.conference_registrations
  add column if not exists raffle_eligible boolean not null default true,
  add column if not exists raffle_exclusion_reason text;

create or replace function public.enter_conference_raffle(p_raffle_id uuid, p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_raffle public.conference_raffles%rowtype;
  v_registration public.conference_registrations%rowtype;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;

  if v_raffle.status not in ('scheduled','open') then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_open');
  end if;
  if v_raffle.opens_at is not null and now() < v_raffle.opens_at then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_open');
  end if;
  if v_raffle.closes_at is not null and now() > v_raffle.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'raffle_closed');
  end if;

  select * into v_registration from public.conference_registrations where id = p_registration_id;
  if not found or v_registration.event_id <> v_raffle.event_id then
    return jsonb_build_object('ok', false, 'reason', 'registration_invalid');
  end if;
  if v_registration.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'registration_cancelled');
  end if;
  if not v_registration.raffle_eligible then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_eligible');
  end if;
  if v_registration.attended_at is null then
    return jsonb_build_object('ok', false, 'reason', 'attendance_required');
  end if;
  if v_registration.live_last_seen_at is null or v_registration.live_last_seen_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'live_presence_required');
  end if;

  insert into public.conference_raffle_entries (raffle_id, registration_id)
  values (p_raffle_id, p_registration_id)
  on conflict (raffle_id, registration_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.draw_conference_raffle(p_raffle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raffle public.conference_raffles%rowtype;
  v_winner uuid;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;

  if v_raffle.winner_registration_id is not null then
    return jsonb_build_object('ok', true, 'alreadyDrawn', true, 'winnerRegistrationId', v_raffle.winner_registration_id);
  end if;

  if v_raffle.closes_at is not null and now() < v_raffle.closes_at and v_raffle.status <> 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_closed');
  end if;

  select e.registration_id
    into v_winner
  from public.conference_raffle_entries e
  join public.conference_registrations r on r.id = e.registration_id
  where e.raffle_id = p_raffle_id
    and r.event_id = v_raffle.event_id
    and r.attended_at is not null
    and r.status <> 'cancelled'
    and r.raffle_eligible
  order by gen_random_uuid()
  limit 1;

  if v_winner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_eligible_entries');
  end if;

  update public.conference_raffles
  set winner_registration_id = v_winner,
      drawn_at = now(),
      status = 'drawn',
      updated_at = now()
  where id = p_raffle_id;

  return jsonb_build_object('ok', true, 'winnerRegistrationId', v_winner);
end;
$$;

revoke all on function public.enter_conference_raffle(uuid, uuid) from public, anon, authenticated;
revoke all on function public.draw_conference_raffle(uuid) from public, anon, authenticated;
grant execute on function public.enter_conference_raffle(uuid, uuid) to service_role;
grant execute on function public.draw_conference_raffle(uuid) to service_role;

-- >>> migrations/20260925090000_defi_intuition_reminders.sql
-- Défi Intuition : rappel quotidien par e-mail, facultatif.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.
-- Seule l'adresse e-mail est conservée, avec la date du consentement ; la
-- désinscription garde la ligne (date de retrait) pour ne plus jamais écrire.

create table if not exists public.defi_reminders (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) between 5 and 254),
  consent_at timestamptz not null,
  last_sent_on date,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists defi_reminders_due_idx
  on public.defi_reminders (last_sent_on nulls first)
  where unsubscribed_at is null;

alter table public.defi_reminders enable row level security;
revoke all on table public.defi_reminders from public, anon, authenticated;

-- >>> migrations/20260926100000_formation_parcours_597.sql
-- Parcours MediumIA au mois, modèle définitif 597 € TTC :
--   Découverte 29 € → 11 × 48 € (2 modules à chaque fois) → dernière mensualité 40 €
--   = 597 €, le prix de la Formation complète, jamais plus.
--
-- Remplace l'ancienne 20260925120000 (modèle 34 €), jamais appliquée et archivée
-- dans supabase/archive/ : crée les mêmes tables, colonnes, index, droits et
-- fonction, avec les règles 597 €. Si ces tables existaient déjà (cas imprévu),
-- seules les règles de montant sont remplacées.
-- Idempotente : peut être relancée sans effet de bord. Tout ou rien (transaction).
-- Aucun paiement enregistré n'est modifié ni supprimé.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor
-- Supabase), après le runbook supabase/runbooks/20260926-parcours-597/.
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.


-- 1. Registre des paiements encaissés pour la formation (source de vérité du plafond).
create table if not exists public.mediumia_formation_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  kind text not null check (kind in ('discovery', 'full', 'monthly', 'unlock', 'refund')),
  refunded_kind text check (refunded_kind is null or refunded_kind in ('discovery', 'full', 'monthly', 'unlock')),
  -- Montant réellement encaissé (ou remboursé), en centimes.
  amount_cents integer not null check (amount_cents > 0),
  -- Valeur pour le parcours : égale au montant en production ; en Sandbox la
  -- Découverte et l'achat complet sont facturés 1 € mais valent leur prix réel.
  value_cents integer not null check (value_cents > 0),
  paypal_ref text not null unique,
  paypal_subscription_id text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((kind = 'refund') = (refunded_kind is not null))
);

create index if not exists mediumia_formation_payments_user_idx
  on public.mediumia_formation_payments (user_id, paypal_env);

-- 2. Abonnements mensuels (48 € répétés, puis la dernière mensualité).
--    Les règles de montant sont posées au point 5.
create table if not exists public.mediumia_formation_subscriptions (
  paypal_subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  paypal_plan_id text not null,
  regular_count integer not null,
  step_cents integer not null,
  final_cents integer not null,
  status text not null default 'approval_pending'
    check (status in ('approval_pending', 'active', 'suspended', 'cancelled', 'expired', 'completed')),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  last_synced_at timestamptz
);

-- Un seul abonnement vivant par élève et par environnement.
create unique index if not exists mediumia_formation_subscriptions_one_live
  on public.mediumia_formation_subscriptions (user_id, paypal_env)
  where status in ('approval_pending', 'active');

-- 3. Paiement « Tout débloquer » / dernière mensualité en une fois (commande PayPal).
create table if not exists public.mediumia_formation_unlock_orders (
  paypal_order_id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  amount_cents integer not null,
  status text not null default 'created' check (status in ('created', 'captured', 'refused')),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

-- 4. Plans PayPal créés automatiquement (un par environnement et par modèle).
create table if not exists public.mediumia_paypal_plans (
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  code text not null,
  paypal_product_id text not null,
  paypal_plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (paypal_env, code)
);

alter table public.mediumia_formation_payments enable row level security;
alter table public.mediumia_formation_subscriptions enable row level security;
alter table public.mediumia_formation_unlock_orders enable row level security;
alter table public.mediumia_paypal_plans enable row level security;
revoke all on table public.mediumia_formation_payments from public, anon, authenticated;
revoke all on table public.mediumia_formation_subscriptions from public, anon, authenticated;
revoke all on table public.mediumia_formation_unlock_orders from public, anon, authenticated;
revoke all on table public.mediumia_paypal_plans from public, anon, authenticated;

-- 5. Règles de montant 597 €. Les anciennes règles (34 €, 368 €), quel que soit
--    leur nom, sont retirées d'après leur définition, puis remplacées.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'c'
      and (
        (c.conrelid = 'public.mediumia_formation_subscriptions'::regclass
          and pg_get_constraintdef(c.oid) ~ '(step_cents|final_cents|regular_count)')
        or (c.conrelid = 'public.mediumia_formation_unlock_orders'::regclass
          and pg_get_constraintdef(c.oid) ~ 'amount_cents')
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$$;

-- Au plus 11 × 48 € puis une dernière mensualité de 48 € au plus, et jamais plus
-- de 568 € prélevés par un abonnement (597 € − la Découverte). Seule exception :
-- d'éventuels essais Sandbox de l'ancien modèle 34 € (argent fictif), conservés tels quels.
alter table public.mediumia_formation_subscriptions
  add constraint mediumia_formation_subscriptions_amounts_597_check check (
    (step_cents = 4800
      and regular_count between 1 and 11
      and final_cents between 1 and 4800
      and regular_count * step_cents + final_cents <= 56800)
    or (paypal_env = 'sandbox'
      and step_cents = 3400
      and regular_count between 1 and 11
      and final_cents between 1 and 3400)
  );

-- « Tout débloquer » : au plus 568 € (597 € − la Découverte).
alter table public.mediumia_formation_unlock_orders
  add constraint mediumia_formation_unlock_orders_amount_597_check check (amount_cents between 1 and 56800);

-- 6. Les achats déjà provisionnés comptent dans le parcours (idempotent).
--    Achat complet live à 568 € (crédit Découverte) : valeur 568 €, et la
--    Découverte 29 € déjà enregistrée complète les 597 €.
insert into public.mediumia_formation_payments (user_id, paypal_env, kind, amount_cents, value_cents, paypal_ref, paid_at)
select p.user_id,
       p.paypal_env,
       p.product_code,
       p.amount_cents,
       case when p.paypal_env = 'live' then p.amount_cents
            when p.product_code = 'discovery' then 2900
            else 59700 end,
       p.paypal_capture_id,
       coalesce(p.captured_at, p.provisioned_at, now())
from public.mediumia_paypal_purchases p
where p.status = 'provisioned'
  and p.user_id is not null
  and p.paypal_capture_id is not null
  and p.product_code in ('discovery', 'full')
on conflict (paypal_ref) do nothing;

-- 7. Accès progressif : un accès « full » peut couvrir 1 à 25 modules (le
--    parcours monte de 2 en 2). Découverte inchangée (module 1).
alter table public.mediumia_entitlements drop constraint if exists mediumia_entitlements_level_scope_check;
alter table public.mediumia_entitlements add constraint mediumia_entitlements_level_scope_check
  check ((access_level = 'discovery' and max_module = 1) or (access_level = 'full' and max_module between 1 and 25));

-- Un seul droit d'accès « parcours » par élève et par environnement, mis à jour
-- à chaque paiement encaissé (module maximum et fin d'accès recalculés).
create or replace function public.mediumia_set_path_entitlement(
  p_user_id uuid,
  p_env text,
  p_max_module integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := 'parcours:' || p_env || ':' || p_user_id::text;
  v_row public.mediumia_entitlements%rowtype;
begin
  if p_user_id is null or p_env not in ('sandbox', 'live') or p_max_module not between 1 and 25 or p_expires_at is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  insert into public.mediumia_students (user_id) values (p_user_id) on conflict (user_id) do nothing;

  -- A path row at module 1 (Discovery bought with the new parcours) keeps the
  -- Discovery level, so the coach uses the Discovery frame.
  update public.mediumia_entitlements
  set max_module = p_max_module,
      access_level = case when p_max_module = 1 then 'discovery' else 'full' end,
      access_expires_at = p_expires_at,
      status = 'active',
      updated_at = now()
  where type = 'purchase' and origin_ref = v_ref
  returning * into v_row;

  if not found then
    insert into public.mediumia_entitlements (user_id, type, origin_ref, access_started_at, access_expires_at, status, access_level, max_module)
    values (p_user_id, 'purchase', v_ref, now(), p_expires_at, 'active', case when p_max_module = 1 then 'discovery' else 'full' end, p_max_module)
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'ok', 'entitlement_id', v_row.id, 'max_module', v_row.max_module, 'access_expires_at', v_row.access_expires_at);
end;
$$;

revoke all on function public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz) to service_role;

-- >>> migrations/20260927150800_mediumia_pro_reseau_invitations.sql
-- MediumIA Pro — étape 1 des assistants du Réseau.
--
-- 1. Invitations : l'administrateur invite un professionnel par e-mail. Le
--    professionnel crée son compte avec cette adresse puis active lui-même son
--    espace ; le serveur (service_role) crée alors son adhésion « pro ».
-- 2. Chaque assistant peut être rattaché à une fiche du Réseau (reseau_slug) et
--    être affiché publiquement sur cette fiche (public_enabled, étape 2).
--
-- Additif : aucune donnée existante n'est modifiée. Les invitations et
-- activations restent serveur-only. Les droits RLS historiques sur quelques
-- champs de profil sûrs de l'agent ne sont pas élargis par cette migration.

create table if not exists public.pro_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(trim(email))) stored,
  reseau_slug text check (reseau_slug is null or reseau_slug ~ '^[a-z0-9-]{2,80}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pro_invitations_one_pending_per_email_idx
  on public.pro_invitations(email_normalized)
  where status = 'pending';

-- Une fiche du Réseau ne peut avoir qu'une invitation active à la fois.
-- Une nouvelle invitation redevient possible après révocation.
create unique index if not exists pro_invitations_one_live_per_reseau_slug_idx
  on public.pro_invitations(reseau_slug)
  where reseau_slug is not null and status in ('pending', 'accepted');

create index if not exists pro_invitations_accepted_user_idx
  on public.pro_invitations(accepted_user_id)
  where accepted_user_id is not null;

alter table public.pro_invitations enable row level security;

drop trigger if exists pro_invitations_set_updated_at on public.pro_invitations;
create trigger pro_invitations_set_updated_at
before update on public.pro_invitations
for each row execute function public.set_updated_at();

revoke all on table public.pro_invitations from public, anon, authenticated;
grant select, insert, update on table public.pro_invitations to service_role;

comment on table public.pro_invitations is
  'Invitations MediumIA Pro (Réseau). Lecture et écriture réservées au serveur.';

-- Activation atomique : l'adhésion et l'acceptation de l'invitation sont
-- validées dans la même transaction. Exécution réservée au service_role.
create or replace function public.claim_mediumia_pro_invitation(
  p_user_id uuid,
  p_email_normalized text
)
returns table(result text, invitation_reseau_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.pro_memberships%rowtype;
  v_invitation public.pro_invitations%rowtype;
  v_now timestamptz := now();
begin
  select *
    into v_membership
  from public.pro_memberships
  where user_id = p_user_id
  for update;

  if found then
    if v_membership.status = 'active'
       and (v_membership.expires_at is null or v_membership.expires_at > v_now) then
      return query select 'already_active'::text, null::text;
      return;
    end if;

    if v_membership.status <> 'invited' then
      return query select 'membership_locked'::text, null::text;
      return;
    end if;
  end if;

  select *
    into v_invitation
  from public.pro_invitations
  where email_normalized = lower(trim(p_email_normalized))
    and status = 'pending'
  order by created_at
  limit 1
  for update;

  if not found then
    return query select 'invitation_not_found'::text, null::text;
    return;
  end if;

  if v_membership.id is null then
    insert into public.pro_memberships(user_id, access_level, status, activated_at)
    values (p_user_id, 'pro', 'active', v_now)
    returning * into v_membership;
  else
    update public.pro_memberships
    set status = 'active',
        access_level = 'pro',
        activated_at = v_now
    where id = v_membership.id;
  end if;

  update public.pro_invitations
  set status = 'accepted',
      accepted_user_id = p_user_id,
      accepted_at = v_now
  where id = v_invitation.id
    and status = 'pending';

  if not found then
    raise exception 'invitation_claim_race';
  end if;

  return query select 'activated'::text, v_invitation.reseau_slug;
end;
$$;

revoke all on function public.claim_mediumia_pro_invitation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_mediumia_pro_invitation(uuid, text)
  to service_role;

alter table public.agents
  add column if not exists reseau_slug text
    check (reseau_slug is null or reseau_slug ~ '^[a-z0-9-]{2,80}$'),
  add column if not exists public_enabled boolean not null default false;

-- Une fiche du Réseau n'a qu'un assistant vivant.
create unique index if not exists agents_one_live_per_reseau_slug_idx
  on public.agents(reseau_slug)
  where reseau_slug is not null and status <> 'archived';

-- Le membre lit ces réglages ; il ne les modifie que via le serveur.
grant select (reseau_slug, public_enabled, limits) on public.agents to authenticated;

-- Vérification après exécution (attendu : 1 table, 2 colonnes) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'pro_invitations';
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'agents'
--     and column_name in ('reseau_slug', 'public_enabled');

-- >>> migrations/20260928200000_mediumia_pro_public_assistant.sql
-- MediumIA Pro — étape 2 : l'assistant répond aux visiteurs sur la fiche Réseau.
--
-- 1. Quota : 300 réponses par mois et par assistant (mois civil, heure de
--    Paris), plus une limite par visiteur (par heure et par jour) contre les abus.
--    Le visiteur n'est connu que par une empreinte HMAC calculée côté serveur :
--    aucune adresse IP n'est stockée, et ces empreintes sont effacées après 2 jours.
-- 2. Mise en ligne : seul le serveur (validation par l'administrateur dans le
--    Pilotage) passe public_enabled à true ; on garde la date et l'auteur.
--
-- Additif : aucune donnée existante n'est modifiée. Aucun message de visiteur
-- n'est enregistré en base. Tout est réservé au service_role.

create table if not exists public.pro_public_assistant_usage (
  agent_id uuid not null references public.agents(id) on delete cascade,
  scope text not null check (scope in ('agent_month', 'visitor_hour', 'visitor_day')),
  subject text not null check (subject = 'all' or subject ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  consumed_units integer not null default 0 check (consumed_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (agent_id, scope, subject, window_start)
);

create index if not exists pro_public_assistant_usage_cleanup_idx
  on public.pro_public_assistant_usage(scope, window_start);

alter table public.pro_public_assistant_usage enable row level security;
revoke all on table public.pro_public_assistant_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.pro_public_assistant_usage to service_role;

comment on table public.pro_public_assistant_usage is
  'Compteurs de l''assistant public des fiches Réseau. Aucune IP, aucun message : empreintes HMAC effacées après 2 jours.';

create or replace function public.consume_public_assistant_quota(
  p_agent_id uuid,
  p_visitor_hash text,
  p_monthly_limit integer,
  p_visitor_hourly_limit integer,
  p_visitor_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_month_used integer := 0;
  v_hour_used integer := 0;
  v_day_used integer := 0;
begin
  if p_agent_id is null
     or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$'
     or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 100000
     or p_visitor_hourly_limit is null or p_visitor_hourly_limit < 1
     or p_visitor_daily_limit is null or p_visitor_daily_limit < p_visitor_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_quota_request');
  end if;

  perform 1 from public.agents where id = p_agent_id and status = 'active';
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'agent_unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public-assistant:' || p_agent_id::text, 0));

  -- Les empreintes de visiteurs ne servent qu'au jour même : on les efface vite.
  delete from public.pro_public_assistant_usage
  where scope in ('visitor_hour', 'visitor_day')
    and window_start < v_now - interval '2 days';

  select coalesce(sum(consumed_units), 0) into v_month_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'agent_month' and subject = 'all' and window_start = v_month_start;

  select coalesce(sum(consumed_units), 0) into v_hour_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'visitor_hour' and subject = p_visitor_hash and window_start = v_hour_start;

  select coalesce(sum(consumed_units), 0) into v_day_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'visitor_day' and subject = p_visitor_hash and window_start = v_day_start;

  if v_month_used + 1 > p_monthly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;
  if v_hour_used + 1 > p_visitor_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'visitor_hourly', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;
  if v_day_used + 1 > p_visitor_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'visitor_daily', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;

  insert into public.pro_public_assistant_usage (agent_id, scope, subject, window_start, consumed_units, updated_at)
  values
    (p_agent_id, 'agent_month', 'all', v_month_start, 1, v_now),
    (p_agent_id, 'visitor_hour', p_visitor_hash, v_hour_start, 1, v_now),
    (p_agent_id, 'visitor_day', p_visitor_hash, v_day_start, 1, v_now)
  on conflict (agent_id, scope, subject, window_start)
  do update set
    consumed_units = public.pro_public_assistant_usage.consumed_units + 1,
    updated_at = excluded.updated_at;

  return jsonb_build_object('allowed', true, 'monthly_used', v_month_used + 1, 'monthly_limit', p_monthly_limit);
end;
$$;

revoke all on function public.consume_public_assistant_quota(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_assistant_quota(uuid, text, integer, integer, integer)
  to service_role;

alter table public.agents
  add column if not exists public_enabled_at timestamptz,
  add column if not exists public_enabled_by uuid references auth.users(id) on delete set null;

-- Vérification après exécution (attendu : 1 table, 1 fonction, 2 colonnes) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'pro_public_assistant_usage';
-- select count(*) from pg_proc where proname = 'consume_public_assistant_quota';
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'agents'
--     and column_name in ('public_enabled_at', 'public_enabled_by');

-- >>> migrations/20260929101207_rdv_appointment_reminder.sql
-- MediumIA Rendez-vous — rappels de rendez-vous.
--
-- appointment_reminder_sent_at     : e-mail de rappel J-3 (un seul par RDV).
-- appointment_sms_reminder_sent_at : futur SMS J-1, marque distincte pour
--                                    éviter tout doublon (aucun prestataire
--                                    SMS n'est branché pour l'instant).
-- La tâche quotidienne réserve la ligne avant l'envoi. Additif : aucune donnée
-- existante n'est modifiée (colonnes vides pour tous les rendez-vous actuels).

alter table public.bookings
  add column if not exists appointment_reminder_sent_at timestamptz,
  add column if not exists appointment_sms_reminder_sent_at timestamptz;

create index if not exists bookings_appointment_reminder_due_idx
  on public.bookings(starts_at)
  where status = 'confirmed' and appointment_reminder_sent_at is null;

-- Vérification après exécution (attendu : 2) :
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'bookings'
--     and column_name in ('appointment_reminder_sent_at', 'appointment_sms_reminder_sent_at');

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200100', 'b2_10_bloc3_document_shadow_a_rdv_appointment_reminder', 'rattrapage-test');

commit;

select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
