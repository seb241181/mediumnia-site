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
comment on function public.pro_claim_document_storage_job(uuid, uuid, uuid, uuid, integer) is
  'Claims one retryable Storage deletion job with a bounded lease.';
comment on function public.pro_complete_document_storage_job(uuid, uuid, uuid, uuid) is
  'Idempotently records successful Storage deletion for the active claim.';
comment on function public.pro_fail_document_storage_job(uuid, uuid, uuid, uuid, text, integer) is
  'Records a retryable Storage deletion failure without re-enabling document access.';
comment on function public.pro_finalize_document_deletion(uuid, uuid, uuid) is
  'Marks a DB-neutralized document deleted only after every Storage job completed.';
