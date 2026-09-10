-- MediumIA Pro Phase 0: additive security foundation.
-- This migration preserves existing prototype data and does not expose /agents.

create table public.pro_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null default 'founder'
    check (access_level in ('founder', 'pro')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pro_memberships_user_id_key unique (user_id),
  constraint pro_memberships_id_user_id_key unique (id, user_id),
  constraint pro_memberships_dates_check check (
    expires_at is null or activated_at is null or expires_at > activated_at
  )
);

create index pro_memberships_status_idx
  on public.pro_memberships(status, expires_at);
alter table public.pro_memberships enable row level security;

create trigger pro_memberships_set_updated_at
before update on public.pro_memberships
for each row execute function public.set_updated_at();

-- Existing prototype owners are retained but deliberately not activated.
insert into public.pro_memberships (user_id, access_level, status)
select distinct owner_id, 'founder', 'suspended'
from public.agents
on conflict (user_id) do nothing;

alter table public.agents add column membership_id uuid;

update public.agents a
set membership_id = m.id
from public.pro_memberships m
where m.user_id = a.owner_id
  and a.membership_id is null;

alter table public.agents
  alter column membership_id set not null,
  add constraint agents_id_owner_id_key unique (id, owner_id),
  add constraint agents_membership_owner_fkey
    foreign key (membership_id, owner_id)
    references public.pro_memberships(id, user_id)
    on delete restrict;

create unique index agents_one_live_copilot_per_membership_idx
  on public.agents(membership_id)
  where status <> 'archived';

alter table public.agent_versions
  add constraint agent_versions_agent_owner_fkey
    foreign key (agent_id, owner_id)
    references public.agents(id, owner_id)
    on delete cascade;

alter table public.agent_conversations
  add constraint agent_conversations_id_agent_owner_key
    unique (id, agent_id, owner_id),
  add constraint agent_conversations_agent_owner_fkey
    foreign key (agent_id, owner_id)
    references public.agents(id, owner_id)
    on delete cascade;

alter table public.agent_messages
  add constraint agent_messages_conversation_agent_owner_fkey
    foreign key (conversation_id, agent_id, owner_id)
    references public.agent_conversations(id, agent_id, owner_id)
    on delete cascade;

alter table public.agent_documents
  add constraint agent_documents_id_agent_owner_key
    unique (id, agent_id, owner_id),
  add constraint agent_documents_agent_owner_fkey
    foreign key (agent_id, owner_id)
    references public.agents(id, owner_id)
    on delete cascade;

alter table public.agent_document_chunks
  add constraint agent_document_chunks_document_agent_owner_fkey
    foreign key (document_id, agent_id, owner_id)
    references public.agent_documents(id, agent_id, owner_id)
    on delete cascade;

alter table public.agent_audit_events
  add constraint agent_audit_events_agent_owner_fkey
    foreign key (agent_id, owner_id)
    references public.agents(id, owner_id)
    on delete cascade,
  add constraint agent_audit_events_no_private_payload_check
    check (not (details ?| array[
      'content', 'message', 'prompt', 'document_text', 'secret', 'token', 'api_key'
    ]));

create index if not exists agent_messages_agent_id_idx
  on public.agent_messages(agent_id);
create index if not exists agent_document_chunks_agent_id_idx
  on public.agent_document_chunks(agent_id);

-- Replace permissive prototype policies with membership-aware policies.
drop policy if exists "Users can read own agents" on public.agents;
drop policy if exists "Users can create own agents" on public.agents;
drop policy if exists "Users can update own agents" on public.agents;
drop policy if exists "Users can delete own draft agents" on public.agents;
drop policy if exists "Users can read own agent versions" on public.agent_versions;
drop policy if exists "Users can create own agent versions" on public.agent_versions;
drop policy if exists "Users can read own conversations" on public.agent_conversations;
drop policy if exists "Users can create own conversations" on public.agent_conversations;
drop policy if exists "Users can update own conversations" on public.agent_conversations;
drop policy if exists "Users can delete own conversations" on public.agent_conversations;
drop policy if exists "Users can read own messages" on public.agent_messages;
drop policy if exists "Users can create own messages" on public.agent_messages;
drop policy if exists "Users can read own agent documents" on public.agent_documents;
drop policy if exists "Users can create own agent documents" on public.agent_documents;
drop policy if exists "Users can update own agent documents" on public.agent_documents;
drop policy if exists "Users can delete own agent documents" on public.agent_documents;
drop policy if exists "Users can read own document chunks" on public.agent_document_chunks;
drop policy if exists "Users can create own document chunks" on public.agent_document_chunks;
drop policy if exists "Users can delete own document chunks" on public.agent_document_chunks;
drop policy if exists "Users can read own audit events" on public.agent_audit_events;
drop policy if exists "Users can create own audit events" on public.agent_audit_events;

create policy "Members can read own membership" on public.pro_memberships
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Active members can read own copilot" on public.agents
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.pro_memberships m
      where m.id = membership_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can update own copilot profile" on public.agents
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.pro_memberships m
      where m.id = membership_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.pro_memberships m
      where m.id = membership_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can read own conversations" on public.agent_conversations
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id = agent_id
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can read own messages" on public.agent_messages
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.agent_conversations c
      join public.agents a on a.id = c.agent_id
      join public.pro_memberships m on m.id = a.membership_id
      where c.id = conversation_id
        and c.agent_id = agent_id
        and c.owner_id = (select auth.uid())
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can read own documents" on public.agent_documents
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id = agent_id
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can read own document chunks" on public.agent_document_chunks
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.agent_documents d
      join public.agents a on a.id = d.agent_id
      join public.pro_memberships m on m.id = a.membership_id
      where d.id = document_id
        and d.agent_id = agent_id
        and d.owner_id = (select auth.uid())
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Active members can read own audit" on public.agent_audit_events
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.pro_memberships m
      where m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

-- Data API least privilege. System-owned fields and writes stay server-side.
revoke all on table public.pro_memberships from public, anon, authenticated;
revoke all on table public.agents from public, anon, authenticated;
revoke all on table public.agent_versions from public, anon, authenticated;
revoke all on table public.agent_conversations from public, anon, authenticated;
revoke all on table public.agent_messages from public, anon, authenticated;
revoke all on table public.agent_documents from public, anon, authenticated;
revoke all on table public.agent_document_chunks from public, anon, authenticated;
revoke all on table public.agent_audit_events from public, anon, authenticated;

grant select (id, user_id, access_level, status, activated_at, expires_at, created_at, updated_at)
  on public.pro_memberships to authenticated;
grant select (
  id, owner_id, membership_id, name, slug, status, mission, audience, tone,
  knowledge_summary, version, created_at, updated_at
) on public.agents to authenticated;
grant update (name, slug, mission, audience, tone, knowledge_summary)
  on public.agents to authenticated;
grant select on public.agent_conversations to authenticated;
grant select on public.agent_messages to authenticated;
grant select on public.agent_documents to authenticated;
grant select on public.agent_document_chunks to authenticated;
grant select on public.agent_audit_events to authenticated;

grant all on table public.pro_memberships to service_role;
grant all on table public.agents to service_role;
grant all on table public.agent_versions to service_role;
grant all on table public.agent_conversations to service_role;
grant all on table public.agent_messages to service_role;
grant all on table public.agent_documents to service_role;
grant all on table public.agent_document_chunks to service_role;
grant all on table public.agent_audit_events to service_role;

grant usage, select on sequence public.agent_versions_id_seq to service_role;
grant usage, select on sequence public.agent_messages_id_seq to service_role;
grant usage, select on sequence public.agent_document_chunks_id_seq to service_role;
grant usage, select on sequence public.agent_audit_events_id_seq to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.search_agent_document_chunks(uuid, text, integer)
  from public, anon;
grant execute on function public.search_agent_document_chunks(uuid, text, integer)
  to authenticated, service_role;

-- Private Storage is provisioned by migration, never lazily by the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-documents',
  'agent-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own agent documents" on storage.objects;
drop policy if exists "Users can read own stored agent documents" on storage.objects;
drop policy if exists "Users can update own stored agent documents" on storage.objects;
drop policy if exists "Users can delete own stored agent documents" on storage.objects;

create policy "Users can upload own stored agent documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agent-documents'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id::text = (storage.foldername(storage.objects.name))[2]
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Users can read own stored agent documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agent-documents'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id::text = (storage.foldername(storage.objects.name))[2]
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Users can update own stored agent documents" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'agent-documents'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id::text = (storage.foldername(storage.objects.name))[2]
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  )
  with check (
    bucket_id = 'agent-documents'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id::text = (storage.foldername(storage.objects.name))[2]
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

create policy "Users can delete own stored agent documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'agent-documents'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.agents a
      join public.pro_memberships m on m.id = a.membership_id
      where a.id::text = (storage.foldername(storage.objects.name))[2]
        and a.owner_id = (select auth.uid())
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > now())
    )
  );

-- Atomic server-only quota counters for the future Copilot API.
create table public.pro_usage_counters (
  membership_id uuid not null references public.pro_memberships(id) on delete cascade,
  action text not null check (action ~ '^[a-z0-9_]{1,80}$'),
  window_type text not null check (window_type in ('hour', 'day')),
  window_start timestamptz not null,
  consumed_units integer not null default 0 check (consumed_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (membership_id, action, window_type, window_start)
);

create index pro_usage_counters_cleanup_idx
  on public.pro_usage_counters(updated_at);
alter table public.pro_usage_counters enable row level security;

revoke all on table public.pro_usage_counters from public, anon, authenticated;
grant select, insert, update, delete on public.pro_usage_counters to service_role;

create or replace function public.consume_pro_usage_quota(
  p_membership_id uuid,
  p_action text,
  p_units integer,
  p_hourly_limit integer,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now);
  v_hour_count integer := 0;
  v_day_count integer := 0;
begin
  if p_action is null or p_action !~ '^[a-z0-9_]{1,80}$'
     or p_units is null or p_units < 1 or p_units > 10000
     or p_hourly_limit is null or p_hourly_limit < 1
     or p_daily_limit is null or p_daily_limit < 1
     or p_hourly_limit > p_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_quota_request');
  end if;

  perform 1
  from public.pro_memberships
  where id = p_membership_id
    and status = 'active'
    and (expires_at is null or expires_at > v_now)
  for share;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'inactive_membership');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_membership_id::text || ':' || p_action, 0)
  );

  select consumed_units into v_hour_count
  from public.pro_usage_counters
  where membership_id = p_membership_id
    and action = p_action
    and window_type = 'hour'
    and window_start = v_hour_start;
  v_hour_count := coalesce(v_hour_count, 0);

  select consumed_units into v_day_count
  from public.pro_usage_counters
  where membership_id = p_membership_id
    and action = p_action
    and window_type = 'day'
    and window_start = v_day_start;
  v_day_count := coalesce(v_day_count, 0);

  if v_hour_count + p_units > p_hourly_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'hourly',
      'hourly_used', v_hour_count,
      'daily_used', v_day_count
    );
  end if;

  if v_day_count + p_units > p_daily_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily',
      'hourly_used', v_hour_count,
      'daily_used', v_day_count
    );
  end if;

  insert into public.pro_usage_counters (
    membership_id, action, window_type, window_start, consumed_units, updated_at
  ) values (
    p_membership_id, p_action, 'hour', v_hour_start, p_units, v_now
  )
  on conflict (membership_id, action, window_type, window_start)
  do update set
    consumed_units = public.pro_usage_counters.consumed_units + excluded.consumed_units,
    updated_at = excluded.updated_at;

  insert into public.pro_usage_counters (
    membership_id, action, window_type, window_start, consumed_units, updated_at
  ) values (
    p_membership_id, p_action, 'day', v_day_start, p_units, v_now
  )
  on conflict (membership_id, action, window_type, window_start)
  do update set
    consumed_units = public.pro_usage_counters.consumed_units + excluded.consumed_units,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'allowed', true,
    'hourly_used', v_hour_count + p_units,
    'daily_used', v_day_count + p_units
  );
end;
$$;

revoke execute on function public.consume_pro_usage_quota(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_pro_usage_quota(uuid, text, integer, integer, integer)
  to service_role;
