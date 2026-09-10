-- MediumIA Pro workspace/document shadow foundation.
-- Phase 1 is intentionally additive except for removing the obsolete
-- one-live-copilot-per-membership unique index. The current RAG function,
-- legacy document writes and Storage paths remain unchanged in this phase.

-- ---------------------------------------------------------------------------
-- 1. Durable tenant/workspace model
-- ---------------------------------------------------------------------------

create table if not exists public.pro_workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'customer'
    check (kind in ('customer', 'platform')),
  owner_user_id uuid references auth.users(id) on delete restrict,
  name text not null default 'Espace MediumIA Pro'
    check (char_length(name) between 1 and 160),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_workspaces_owner_shape_check check (
    (kind = 'customer' and owner_user_id is not null)
    or (kind = 'platform' and owner_user_id is null)
  )
);

-- Deliberately non-unique: a user may later own more than one workspace.
create index if not exists pro_workspaces_customer_owner_idx
  on public.pro_workspaces(owner_user_id)
  where kind = 'customer';

create unique index if not exists pro_workspaces_single_platform_uidx
  on public.pro_workspaces(kind)
  where kind = 'platform';

create unique index if not exists pro_workspaces_id_owner_uidx
  on public.pro_workspaces(id, owner_user_id);

create table if not exists public.pro_workspace_members (
  workspace_id uuid not null references public.pro_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'editor', 'viewer')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists pro_workspace_members_user_status_idx
  on public.pro_workspace_members(user_id, status, workspace_id);

-- One explicit system workspace. No user is made a member of it here.
insert into public.pro_workspaces(kind, owner_user_id, name, status)
select 'platform', null, 'MediumIA Platform', 'active'
where not exists (
  select 1 from public.pro_workspaces where kind = 'platform'
);

-- One initial durable customer workspace per historical Pro owner. The schema
-- itself still allows a user to own additional workspaces later.
insert into public.pro_workspaces(kind, owner_user_id, name, status)
select distinct 'customer', m.user_id, 'Espace MediumIA Pro', 'active'
from public.pro_memberships m
where not exists (
  select 1
  from public.pro_workspaces w
  where w.kind = 'customer' and w.owner_user_id = m.user_id
);

insert into public.pro_workspace_members(workspace_id, user_id, role, status)
select w.id, w.owner_user_id, 'owner', 'active'
from public.pro_workspaces w
where w.kind = 'customer'
  and w.owner_user_id is not null
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Transitional workspace columns on the current model
-- ---------------------------------------------------------------------------

alter table public.pro_memberships
  add column if not exists workspace_id uuid;

update public.pro_memberships m
set workspace_id = w.id
from public.pro_workspaces w
where m.workspace_id is null
  and w.kind = 'customer'
  and w.owner_user_id = m.user_id;

alter table public.pro_memberships
  add constraint pro_memberships_workspace_fkey
  foreign key (workspace_id)
  references public.pro_workspaces(id)
  on delete restrict
  not valid;

alter table public.pro_memberships
  add constraint pro_memberships_workspace_member_fkey
  foreign key (workspace_id, user_id)
  references public.pro_workspace_members(workspace_id, user_id)
  on delete restrict
  not valid;

alter table public.pro_memberships
  add constraint pro_memberships_id_workspace_user_key
  unique (id, workspace_id, user_id);

alter table public.pro_memberships validate constraint pro_memberships_workspace_fkey;
alter table public.pro_memberships validate constraint pro_memberships_workspace_member_fkey;

alter table public.agents
  add column if not exists workspace_id uuid;

update public.agents a
set workspace_id = m.workspace_id
from public.pro_memberships m
where a.workspace_id is null
  and m.id = a.membership_id
  and m.user_id = a.owner_id;

alter table public.agents
  add constraint agents_id_workspace_key unique (id, workspace_id);

alter table public.agents
  add constraint agents_workspace_id_key unique (workspace_id, id);

alter table public.agents
  add constraint agents_id_workspace_owner_key unique (id, workspace_id, owner_id);

alter table public.agents
  add constraint agents_membership_workspace_owner_fkey
  foreign key (membership_id, workspace_id, owner_id)
  references public.pro_memberships(id, workspace_id, user_id)
  on delete restrict
  not valid;

alter table public.agents validate constraint agents_membership_workspace_owner_fkey;

-- This is the only deliberately non-additive operation in Phase 1. The UI
-- still does not expose multi-agent creation, but the database no longer makes
-- the future model impossible.
drop index if exists public.agents_one_live_copilot_per_membership_idx;

create index if not exists agents_membership_status_idx
  on public.agents(membership_id, status)
  where status <> 'archived';

create index if not exists agents_workspace_status_idx
  on public.agents(workspace_id, status)
  where workspace_id is not null and status <> 'archived';

alter table public.agent_documents
  add column if not exists workspace_id uuid;

update public.agent_documents d
set workspace_id = a.workspace_id
from public.agents a
where d.workspace_id is null
  and a.id = d.agent_id
  and a.owner_id = d.owner_id;

alter table public.agent_documents
  add constraint agent_documents_id_workspace_key unique (id, workspace_id);

alter table public.agent_documents
  add constraint agent_documents_id_agent_owner_workspace_key
  unique (id, agent_id, owner_id, workspace_id);

alter table public.agent_documents
  add constraint agent_documents_agent_workspace_owner_fkey
  foreign key (agent_id, workspace_id, owner_id)
  references public.agents(id, workspace_id, owner_id)
  on delete cascade
  not valid;

alter table public.agent_documents validate constraint agent_documents_agent_workspace_owner_fkey;

alter table public.agent_document_chunks
  add column if not exists workspace_id uuid,
  add column if not exists document_version_id uuid;

update public.agent_document_chunks c
set workspace_id = d.workspace_id
from public.agent_documents d
where c.workspace_id is null
  and d.id = c.document_id
  and d.agent_id = c.agent_id
  and d.owner_id = c.owner_id;

-- ---------------------------------------------------------------------------
-- 3. Shadow logical document/version/access model
-- ---------------------------------------------------------------------------

create table if not exists public.pro_documents (
  id uuid primary key,
  workspace_id uuid not null references public.pro_workspaces(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 240),
  source_type text not null check (source_type in ('upload', 'paste', 'url')),
  scope text not null default 'workspace'
    check (scope in ('workspace', 'platform')),
  access_mode text not null default 'selected_agents'
    check (access_mode in ('selected_agents', 'all_workspace_agents')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  sensitivity text not null default 'confidential'
    check (sensitivity in ('normal', 'confidential', 'restricted')),
  current_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index if not exists pro_documents_workspace_status_idx
  on public.pro_documents(workspace_id, status, access_mode);

create table if not exists public.pro_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  workspace_id uuid not null,
  version_number integer not null check (version_number > 0),
  storage_bucket text,
  storage_path text,
  sha256 text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 26214400),
  extraction_status text not null
    check (extraction_status in ('uploaded', 'processing', 'ready', 'error', 'archived')),
  approved_for_ai boolean not null default false,
  approved_at timestamptz,
  error_message text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pro_document_versions_document_workspace_fkey
    foreign key (workspace_id, document_id)
    references public.pro_documents(workspace_id, id)
    on delete cascade,
  constraint pro_document_versions_document_version_key
    unique (document_id, version_number),
  constraint pro_document_versions_workspace_id_document_key
    unique (workspace_id, id, document_id)
);

create index if not exists pro_document_versions_document_created_idx
  on public.pro_document_versions(document_id, version_number desc);

create index if not exists pro_document_versions_workspace_approval_idx
  on public.pro_document_versions(workspace_id, extraction_status, approved_for_ai);

create unique index if not exists pro_document_versions_storage_object_uidx
  on public.pro_document_versions(storage_bucket, storage_path)
  where storage_path is not null;

create index if not exists pro_document_versions_workspace_sha_idx
  on public.pro_document_versions(workspace_id, sha256)
  where sha256 is not null;

-- Backfill each existing logical document with the same UUID. Nothing is
-- moved in Storage and no source object is duplicated.
insert into public.pro_documents(
  id, workspace_id, created_by, name, source_type, scope, access_mode,
  status, sensitivity, metadata, created_at, updated_at
)
select
  d.id,
  d.workspace_id,
  d.owner_id,
  d.name,
  d.source_type,
  'workspace',
  'selected_agents',
  case when d.status = 'archived' then 'archived' else 'active' end,
  d.sensitivity,
  jsonb_build_object('legacy_agent_id', d.agent_id, 'shadow_backfill', true),
  d.created_at,
  d.updated_at
from public.agent_documents d
where d.workspace_id is not null
on conflict (id) do nothing;

insert into public.pro_document_versions(
  document_id, workspace_id, version_number,
  storage_bucket, storage_path, mime_type, size_bytes,
  extraction_status, approved_for_ai, approved_at, error_message,
  extraction_metadata, created_by, created_at
)
select
  d.id,
  d.workspace_id,
  1,
  d.storage_bucket,
  d.storage_path,
  d.mime_type,
  d.size_bytes,
  d.status,
  d.approved_for_ai,
  d.approved_at,
  d.error_message,
  d.metadata || jsonb_build_object('legacy_document_version', d.version, 'shadow_backfill', true),
  d.owner_id,
  d.created_at
from public.agent_documents d
where d.workspace_id is not null
  and not exists (
    select 1 from public.pro_document_versions v
    where v.document_id = d.id and v.version_number = 1
  );

-- current_version_id means the currently AI-eligible published version. A
-- ready-but-unapproved version intentionally leaves this NULL.
update public.pro_documents d
set current_version_id = v.id
from public.pro_document_versions v
where d.id = v.document_id
  and d.workspace_id = v.workspace_id
  and d.current_version_id is null
  and v.version_number = 1
  and v.extraction_status = 'ready'
  and v.approved_for_ai = true;

alter table public.pro_documents
  add constraint pro_documents_current_version_fkey
  foreign key (workspace_id, current_version_id, id)
  references public.pro_document_versions(workspace_id, id, document_id)
  on delete restrict
  not valid;

alter table public.pro_documents validate constraint pro_documents_current_version_fkey;

create table if not exists public.pro_document_agent_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  agent_id uuid not null,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint pro_document_agent_access_document_workspace_fkey
    foreign key (workspace_id, document_id)
    references public.pro_documents(workspace_id, id)
    on delete cascade,
  constraint pro_document_agent_access_agent_workspace_fkey
    foreign key (workspace_id, agent_id)
    references public.agents(workspace_id, id)
    on delete cascade,
  constraint pro_document_agent_access_revocation_check
    check (revoked_at is null or revoked_at >= granted_at)
);

create unique index if not exists pro_document_agent_access_one_active_uidx
  on public.pro_document_agent_access(workspace_id, document_id, agent_id)
  where revoked_at is null;

create index if not exists pro_document_agent_access_agent_active_idx
  on public.pro_document_agent_access(workspace_id, agent_id, document_id)
  where revoked_at is null;

insert into public.pro_document_agent_access(
  workspace_id, document_id, agent_id, granted_by, granted_at, metadata
)
select
  d.workspace_id,
  d.id,
  d.agent_id,
  d.owner_id,
  coalesce(d.approved_at, d.created_at),
  jsonb_build_object('legacy_relation', true, 'shadow_backfill', true)
from public.agent_documents d
where d.workspace_id is not null
  and not exists (
    select 1
    from public.pro_document_agent_access x
    where x.document_id = d.id
      and x.agent_id = d.agent_id
      and x.revoked_at is null
  );

-- Existing chunks stay in place. They only receive tenant/version pointers;
-- no second chunk table and no duplicated content is introduced in Phase 1.
update public.agent_document_chunks c
set document_version_id = v.id
from public.pro_document_versions v
where c.document_version_id is null
  and v.document_id = c.document_id
  and v.workspace_id = c.workspace_id
  and v.version_number = 1;

alter table public.agent_document_chunks
  add constraint agent_document_chunks_legacy_workspace_fkey
  foreign key (document_id, agent_id, owner_id, workspace_id)
  references public.agent_documents(id, agent_id, owner_id, workspace_id)
  on delete cascade
  not valid;

alter table public.agent_document_chunks
  add constraint agent_document_chunks_version_workspace_document_fkey
  foreign key (workspace_id, document_version_id, document_id)
  references public.pro_document_versions(workspace_id, id, document_id)
  on delete cascade
  not valid;

alter table public.agent_document_chunks validate constraint agent_document_chunks_legacy_workspace_fkey;
alter table public.agent_document_chunks validate constraint agent_document_chunks_version_workspace_document_fkey;

create index if not exists agent_document_chunks_workspace_version_idx
  on public.agent_document_chunks(workspace_id, document_version_id, chunk_index)
  where workspace_id is not null and document_version_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Transversal audit shadow table (server writes only in this phase)
-- ---------------------------------------------------------------------------

create table if not exists public.pro_audit_events (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null references public.pro_workspaces(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user'
    check (actor_type in ('user', 'system')),
  agent_id uuid,
  document_id uuid,
  document_version_id uuid,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pro_audit_events_actor_check check (
    (actor_type = 'user' and actor_user_id is not null)
    or actor_type = 'system'
  ),
  constraint pro_audit_events_version_requires_document_check check (
    document_version_id is null or document_id is not null
  ),
  constraint pro_audit_events_agent_workspace_fkey
    foreign key (workspace_id, agent_id)
    references public.agents(workspace_id, id)
    on delete restrict,
  constraint pro_audit_events_document_workspace_fkey
    foreign key (workspace_id, document_id)
    references public.pro_documents(workspace_id, id)
    on delete restrict,
  constraint pro_audit_events_version_workspace_document_fkey
    foreign key (workspace_id, document_version_id, document_id)
    references public.pro_document_versions(workspace_id, id, document_id)
    on delete restrict
);

create index if not exists pro_audit_events_workspace_created_idx
  on public.pro_audit_events(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. RLS: authenticated users may only read their active customer workspace.
--    All writes remain server-only during the shadow phase.
-- ---------------------------------------------------------------------------

alter table public.pro_workspaces enable row level security;
alter table public.pro_workspace_members enable row level security;
alter table public.pro_documents enable row level security;
alter table public.pro_document_versions enable row level security;
alter table public.pro_document_agent_access enable row level security;
alter table public.pro_audit_events enable row level security;

revoke all on public.pro_workspaces from anon, authenticated;
revoke all on public.pro_workspace_members from anon, authenticated;
revoke all on public.pro_documents from anon, authenticated;
revoke all on public.pro_document_versions from anon, authenticated;
revoke all on public.pro_document_agent_access from anon, authenticated;
revoke all on public.pro_audit_events from anon, authenticated;

grant select on public.pro_workspaces to authenticated;
grant select on public.pro_workspace_members to authenticated;
grant select on public.pro_documents to authenticated;
grant select on public.pro_document_versions to authenticated;
grant select on public.pro_document_agent_access to authenticated;
grant select on public.pro_audit_events to authenticated;

create policy "Members can read own workspace membership"
on public.pro_workspace_members
for select to authenticated
using (user_id = (select auth.uid()) and status = 'active');

create policy "Members can read own active workspaces"
on public.pro_workspaces
for select to authenticated
using (
  kind = 'customer'
  and status = 'active'
  and exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = pro_workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  )
);

create policy "Members can read workspace documents"
on public.pro_documents
for select to authenticated
using (
  scope = 'workspace'
  and exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = pro_documents.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  )
);

create policy "Members can read workspace document versions"
on public.pro_document_versions
for select to authenticated
using (
  exists (
    select 1
    from public.pro_workspace_members wm
    join public.pro_documents d
      on d.workspace_id = wm.workspace_id
     and d.id = pro_document_versions.document_id
    where wm.workspace_id = pro_document_versions.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and d.scope = 'workspace'
  )
);

create policy "Members can read workspace document access"
on public.pro_document_agent_access
for select to authenticated
using (
  exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = pro_document_agent_access.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  )
);

create policy "Members can read workspace audit"
on public.pro_audit_events
for select to authenticated
using (
  exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = pro_audit_events.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  )
);

-- No INSERT/UPDATE/DELETE policies are created for authenticated users.
-- Platform workspace/documents have no user membership and are therefore not
-- exposed by these policies. Publication support comes in a later phase.

-- ---------------------------------------------------------------------------
-- 6. Invariants for the historical backfill. These fail the migration rather
--    than silently accepting an incomplete tenant mapping.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.pro_memberships where workspace_id is null) then
    raise exception 'workspace_backfill_missing_membership';
  end if;
  if exists (select 1 from public.agents where workspace_id is null) then
    raise exception 'workspace_backfill_missing_agent';
  end if;
  if exists (select 1 from public.agent_documents where workspace_id is null) then
    raise exception 'workspace_backfill_missing_document';
  end if;
  if exists (
    select 1 from public.agent_document_chunks
    where workspace_id is null or document_version_id is null
  ) then
    raise exception 'workspace_backfill_missing_chunk_version';
  end if;

  if (select count(*) from public.agent_documents)
     <> (select count(*) from public.pro_documents where scope = 'workspace') then
    raise exception 'shadow_document_count_mismatch';
  end if;

  if (select count(*) from public.agent_documents)
     <> (select count(*) from public.pro_document_versions where version_number = 1) then
    raise exception 'shadow_version_count_mismatch';
  end if;

  if exists (
    (select d.id as document_id, d.agent_id
       from public.agent_documents d
     except
     select a.document_id, a.agent_id
       from public.pro_document_agent_access a
      where a.revoked_at is null)
    union all
    (select a.document_id, a.agent_id
       from public.pro_document_agent_access a
      where a.revoked_at is null
     except
     select d.id, d.agent_id
       from public.agent_documents d)
  ) then
    raise exception 'shadow_document_access_mismatch';
  end if;

  if exists (
    select 1
    from public.pro_document_agent_access x
    join public.pro_documents d on d.id = x.document_id
    join public.agents a on a.id = x.agent_id
    where x.workspace_id <> d.workspace_id
       or x.workspace_id <> a.workspace_id
  ) then
    raise exception 'shadow_cross_workspace_access_detected';
  end if;
end $$;

comment on table public.pro_documents is
  'Shadow logical document model for MediumIA Pro. Legacy RAG remains authoritative until a later cutover migration.';
comment on column public.pro_memberships.workspace_id is
  'Transitional workspace link. Kept nullable until all current writers are workspace-aware.';
comment on column public.agents.workspace_id is
  'Transitional workspace link. Kept nullable until all current writers are workspace-aware.';
comment on column public.agent_documents.workspace_id is
  'Transitional workspace link. Kept nullable until the document writer is workspace-aware.';
comment on column public.agent_document_chunks.document_version_id is
  'Shadow version pointer. Current RAG does not use it yet.';
