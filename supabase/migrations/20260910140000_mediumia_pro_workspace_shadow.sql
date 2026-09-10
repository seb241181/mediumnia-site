-- MediumIA Pro Phase 1A: durable workspace foundation.
--
-- This migration intentionally does NOT create the document/version/access
-- shadow model. Phase 1A only establishes tenant/workspace identity on the
-- existing tables and removes the one-live-copilot-per-membership blocker.
-- The current RAG function, document semantics and Storage paths remain
-- authoritative and unchanged.

-- Guard the legacy RAG function byte-for-byte during this migration.
-- Do not use ON COMMIT DROP here: psql may run this file in autocommit mode,
-- which would drop the table before the following INSERT.
create temporary table mediumia_phase1a_rag_guard (
  definition_md5 text not null
);

insert into mediumia_phase1a_rag_guard(definition_md5)
select md5(pg_get_functiondef(
  'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
));

-- Internal privileged helpers live outside the exposed public schema.
create schema if not exists mediumia_private;
revoke all on schema mediumia_private from public, anon;
grant usage on schema mediumia_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Durable tenant/workspace model
-- ---------------------------------------------------------------------------

create table public.pro_workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'customer'
    check (kind in ('customer', 'platform')),
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null default 'Espace MediumIA Pro'
    check (char_length(name) between 1 and 160),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_workspaces_platform_owner_check check (
    kind <> 'platform' or owner_user_id is null
  )
);

-- A user may later own several workspaces; this is deliberately non-unique.
create index pro_workspaces_customer_owner_idx
  on public.pro_workspaces(owner_user_id)
  where kind = 'customer';

create unique index pro_workspaces_single_platform_uidx
  on public.pro_workspaces(kind)
  where kind = 'platform';

create table public.pro_workspace_members (
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

create index pro_workspace_members_user_status_idx
  on public.pro_workspace_members(user_id, status, workspace_id);

create trigger pro_workspaces_set_updated_at
before update on public.pro_workspaces
for each row execute function public.set_updated_at();

create trigger pro_workspace_members_set_updated_at
before update on public.pro_workspace_members
for each row execute function public.set_updated_at();

-- Explicit platform workspace. It has no user membership and is never exposed
-- by the customer-workspace RLS helper below.
insert into public.pro_workspaces(kind, owner_user_id, name, status)
values ('platform', null, 'MediumIA Platform', 'active');

-- One initial customer workspace per current Pro owner. This is only the
-- migration backfill rule; the schema itself allows several workspaces later.
insert into public.pro_workspaces(kind, owner_user_id, name, status)
select distinct 'customer', m.user_id, 'Espace MediumIA Pro', 'active'
from public.pro_memberships m;

insert into public.pro_workspace_members(workspace_id, user_id, role, status)
select w.id, w.owner_user_id, 'owner', 'active'
from public.pro_workspaces w
where w.kind = 'customer'
  and w.owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Workspace assignment for memberships, including future server writes
-- ---------------------------------------------------------------------------

alter table public.pro_memberships
  add column workspace_id uuid;

update public.pro_memberships m
set workspace_id = w.id
from public.pro_workspaces w
where w.kind = 'customer'
  and w.owner_user_id = m.user_id;

-- Future membership creation remains compatible with existing server writers.
-- The advisory transaction lock serializes concurrent creation for one user.
-- Existing membership wins first, which makes INSERT ... ON CONFLICT replays
-- idempotent even if its workspace has since been archived.
create or replace function mediumia_private.pro_assign_membership_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_workspace_id uuid;
  v_workspace_ids uuid[];
  v_workspace_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  select m.workspace_id
    into v_existing_workspace_id
  from public.pro_memberships m
  where m.user_id = new.user_id
  order by m.created_at, m.id
  limit 1;

  if v_existing_workspace_id is not null then
    if new.workspace_id is not null
       and new.workspace_id <> v_existing_workspace_id then
      raise exception 'membership_workspace_mismatch';
    end if;

    new.workspace_id := v_existing_workspace_id;
  elsif new.workspace_id is null then
    select array_agg(w.id order by w.created_at, w.id)
      into v_workspace_ids
    from public.pro_workspaces w
    join public.pro_workspace_members wm
      on wm.workspace_id = w.id
     and wm.user_id = new.user_id
     and wm.role = 'owner'
     and wm.status = 'active'
    where w.kind = 'customer'
      and w.status = 'active';

    if coalesce(cardinality(v_workspace_ids), 0) = 0 then
      insert into public.pro_workspaces(kind, owner_user_id, name, status)
      values ('customer', new.user_id, 'Espace MediumIA Pro', 'active')
      returning id into v_workspace_id;

      insert into public.pro_workspace_members(workspace_id, user_id, role, status)
      values (v_workspace_id, new.user_id, 'owner', 'active');

      new.workspace_id := v_workspace_id;
    elsif cardinality(v_workspace_ids) = 1 then
      new.workspace_id := v_workspace_ids[1];
    else
      raise exception 'workspace_id_required_for_multi_workspace_user';
    end if;
  end if;

  if not exists (
    select 1
    from public.pro_workspaces w
    join public.pro_workspace_members wm
      on wm.workspace_id = w.id
     and wm.user_id = new.user_id
    where w.id = new.workspace_id
      and w.kind = 'customer'
      and wm.status <> 'revoked'
  ) then
    raise exception 'membership_workspace_user_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function mediumia_private.pro_assign_membership_workspace() from public, anon, authenticated;
grant execute on function mediumia_private.pro_assign_membership_workspace() to service_role;

create trigger pro_memberships_assign_workspace
before insert or update of user_id, workspace_id on public.pro_memberships
for each row execute function mediumia_private.pro_assign_membership_workspace();

alter table public.pro_memberships
  add constraint pro_memberships_workspace_fkey
  foreign key (workspace_id)
  references public.pro_workspaces(id)
  on delete restrict;

alter table public.pro_memberships
  add constraint pro_memberships_workspace_member_fkey
  foreign key (workspace_id, user_id)
  references public.pro_workspace_members(workspace_id, user_id)
  on delete restrict;

alter table public.pro_memberships
  add constraint pro_memberships_id_workspace_user_key
  unique (id, workspace_id, user_id);

alter table public.pro_memberships
  alter column workspace_id set not null;

create index pro_memberships_workspace_idx
  on public.pro_memberships(workspace_id, status);

-- ---------------------------------------------------------------------------
-- 3. Existing agent/document/chunk writers derive workspace from their parent
-- ---------------------------------------------------------------------------

alter table public.agents add column workspace_id uuid;

update public.agents a
set workspace_id = m.workspace_id
from public.pro_memberships m
where m.id = a.membership_id
  and m.user_id = a.owner_id;

create or replace function mediumia_private.pro_assign_agent_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select m.workspace_id into v_workspace_id
  from public.pro_memberships m
  where m.id = new.membership_id
    and m.user_id = new.owner_id;

  if v_workspace_id is null then
    raise exception 'agent_membership_workspace_missing';
  end if;

  if new.workspace_id is not null and new.workspace_id <> v_workspace_id then
    raise exception 'agent_workspace_mismatch';
  end if;

  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

revoke all on function mediumia_private.pro_assign_agent_workspace() from public, anon, authenticated;
grant execute on function mediumia_private.pro_assign_agent_workspace() to service_role;

create trigger agents_assign_workspace
before insert or update of membership_id, owner_id, workspace_id on public.agents
for each row execute function mediumia_private.pro_assign_agent_workspace();

alter table public.agents
  add constraint agents_id_workspace_owner_key
  unique (id, workspace_id, owner_id);

alter table public.agents
  add constraint agents_membership_workspace_owner_fkey
  foreign key (membership_id, workspace_id, owner_id)
  references public.pro_memberships(id, workspace_id, user_id)
  on delete restrict;

alter table public.agents alter column workspace_id set not null;

-- Remove only the obsolete cardinality blocker. Multi-agent creation remains
-- hidden in the current UI, but the database no longer forbids it.
drop index if exists public.agents_one_live_copilot_per_membership_idx;

create index agents_membership_status_idx
  on public.agents(membership_id, status)
  where status <> 'archived';

create index agents_workspace_status_idx
  on public.agents(workspace_id, status)
  where status <> 'archived';

alter table public.agent_documents add column workspace_id uuid;

update public.agent_documents d
set workspace_id = a.workspace_id
from public.agents a
where a.id = d.agent_id
  and a.owner_id = d.owner_id;

create or replace function mediumia_private.pro_assign_document_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select a.workspace_id into v_workspace_id
  from public.agents a
  where a.id = new.agent_id
    and a.owner_id = new.owner_id;

  if v_workspace_id is null then
    raise exception 'document_agent_workspace_missing';
  end if;

  if new.workspace_id is not null and new.workspace_id <> v_workspace_id then
    raise exception 'document_workspace_mismatch';
  end if;

  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

revoke all on function mediumia_private.pro_assign_document_workspace() from public, anon, authenticated;
grant execute on function mediumia_private.pro_assign_document_workspace() to service_role;

create trigger agent_documents_assign_workspace
before insert or update of agent_id, owner_id, workspace_id on public.agent_documents
for each row execute function mediumia_private.pro_assign_document_workspace();

alter table public.agent_documents
  add constraint agent_documents_id_agent_owner_workspace_key
  unique (id, agent_id, owner_id, workspace_id);

alter table public.agent_documents
  add constraint agent_documents_agent_workspace_owner_fkey
  foreign key (agent_id, workspace_id, owner_id)
  references public.agents(id, workspace_id, owner_id)
  on delete cascade;

alter table public.agent_documents alter column workspace_id set not null;

create index agent_documents_workspace_agent_idx
  on public.agent_documents(workspace_id, agent_id);

alter table public.agent_document_chunks add column workspace_id uuid;

update public.agent_document_chunks c
set workspace_id = d.workspace_id
from public.agent_documents d
where d.id = c.document_id
  and d.agent_id = c.agent_id
  and d.owner_id = c.owner_id;

create or replace function mediumia_private.pro_assign_chunk_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select d.workspace_id into v_workspace_id
  from public.agent_documents d
  where d.id = new.document_id
    and d.agent_id = new.agent_id
    and d.owner_id = new.owner_id;

  if v_workspace_id is null then
    raise exception 'chunk_document_workspace_missing';
  end if;

  if new.workspace_id is not null and new.workspace_id <> v_workspace_id then
    raise exception 'chunk_workspace_mismatch';
  end if;

  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

revoke all on function mediumia_private.pro_assign_chunk_workspace() from public, anon, authenticated;
grant execute on function mediumia_private.pro_assign_chunk_workspace() to service_role;

create trigger agent_document_chunks_assign_workspace
before insert or update of document_id, agent_id, owner_id, workspace_id
on public.agent_document_chunks
for each row execute function mediumia_private.pro_assign_chunk_workspace();

alter table public.agent_document_chunks
  add constraint agent_document_chunks_legacy_workspace_fkey
  foreign key (document_id, agent_id, owner_id, workspace_id)
  references public.agent_documents(id, agent_id, owner_id, workspace_id)
  on delete cascade;

alter table public.agent_document_chunks alter column workspace_id set not null;

create index agent_document_chunks_workspace_agent_idx
  on public.agent_document_chunks(workspace_id, agent_id, document_id);

-- ---------------------------------------------------------------------------
-- 4. Workspace RLS. Customer workspaces are readable only while both the
--    workspace and the caller membership are active. Platform workspace stays
--    inaccessible to authenticated customers.
-- ---------------------------------------------------------------------------

alter table public.pro_workspaces enable row level security;
alter table public.pro_workspace_members enable row level security;

create or replace function mediumia_private.pro_is_active_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pro_workspaces w
    join public.pro_workspace_members wm
      on wm.workspace_id = w.id
    where w.id = p_workspace_id
      and w.kind = 'customer'
      and w.status = 'active'
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;

revoke all on function mediumia_private.pro_is_active_workspace_member(uuid) from public, anon;
grant execute on function mediumia_private.pro_is_active_workspace_member(uuid) to authenticated, service_role;

revoke all on table public.pro_workspaces from public, anon, authenticated;
revoke all on table public.pro_workspace_members from public, anon, authenticated;
grant select on table public.pro_workspaces to authenticated;
grant select on table public.pro_workspace_members to authenticated;
grant all on table public.pro_workspaces to service_role;
grant all on table public.pro_workspace_members to service_role;

create policy "Active members can read customer workspace"
on public.pro_workspaces
for select to authenticated
using ((select mediumia_private.pro_is_active_workspace_member(id)));

create policy "Active members can read own workspace membership"
on public.pro_workspace_members
for select to authenticated
using (
  user_id = (select auth.uid())
  and (select mediumia_private.pro_is_active_workspace_member(workspace_id))
);

-- ---------------------------------------------------------------------------
-- 5. Backfill invariants and non-regression guard
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

  if exists (select 1 from public.agent_document_chunks where workspace_id is null) then
    raise exception 'workspace_backfill_missing_chunk';
  end if;

  if exists (
    select 1
    from public.pro_memberships m
    join public.pro_workspace_members wm
      on wm.workspace_id = m.workspace_id
     and wm.user_id = m.user_id
    join public.pro_workspaces w on w.id = m.workspace_id
    where w.kind <> 'customer' or wm.status = 'revoked'
  ) then
    raise exception 'membership_workspace_invariant_failed';
  end if;

  if exists (
    select 1
    from public.agents a
    join public.pro_memberships m on m.id = a.membership_id
    where a.workspace_id <> m.workspace_id
       or a.owner_id <> m.user_id
  ) then
    raise exception 'agent_workspace_invariant_failed';
  end if;

  if exists (
    select 1
    from public.agent_documents d
    join public.agents a on a.id = d.agent_id
    where d.workspace_id <> a.workspace_id
       or d.owner_id <> a.owner_id
  ) then
    raise exception 'document_workspace_invariant_failed';
  end if;

  if exists (
    select 1
    from public.agent_document_chunks c
    join public.agent_documents d on d.id = c.document_id
    where c.workspace_id <> d.workspace_id
       or c.agent_id <> d.agent_id
       or c.owner_id <> d.owner_id
  ) then
    raise exception 'chunk_workspace_invariant_failed';
  end if;

  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'agents_one_live_copilot_per_membership_idx'
  ) then
    raise exception 'one_live_copilot_index_still_present';
  end if;

  if (
    select definition_md5 from mediumia_phase1a_rag_guard
  ) <> md5(pg_get_functiondef(
    'public.search_agent_document_chunks(uuid,text,integer)'::regprocedure
  )) then
    raise exception 'legacy_rag_function_changed';
  end if;
end $$;

-- Explicit cleanup works both in psql autocommit and transaction-wrapped
-- migration runners.
drop table pg_temp.mediumia_phase1a_rag_guard;

comment on table public.pro_workspaces is
  'Durable MediumIA Pro tenant. It survives commercial membership lifecycle; document shadow model is introduced only in Phase 1B.';
comment on column public.pro_memberships.workspace_id is
  'Commercial membership target workspace. Assigned automatically for legacy single-workspace writers.';
comment on column public.agents.workspace_id is
  'Durable workspace derived from membership and enforced by trigger plus composite FK.';
comment on column public.agent_documents.workspace_id is
  'Durable workspace derived from the owning agent and enforced by trigger plus composite FK.';
comment on column public.agent_document_chunks.workspace_id is
  'Durable workspace derived from the owning document and enforced by trigger plus composite FK.';