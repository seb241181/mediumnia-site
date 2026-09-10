-- MediumIA Pro Phase 0 cleanup: make server-only intent explicit and cover composite FKs.
-- Additive only. No client access is granted and no existing data is rewritten.

-- Cover every composite foreign key introduced by Phase 0 so deletes/joins do not
-- require avoidable scans as the Pro dataset grows.
create index if not exists agents_membership_owner_idx
  on public.agents(membership_id, owner_id);

create index if not exists agent_versions_agent_owner_idx
  on public.agent_versions(agent_id, owner_id);

create index if not exists agent_conversations_agent_owner_idx
  on public.agent_conversations(agent_id, owner_id);

create index if not exists agent_messages_conversation_agent_owner_idx
  on public.agent_messages(conversation_id, agent_id, owner_id);

create index if not exists agent_documents_agent_owner_idx
  on public.agent_documents(agent_id, owner_id);

create index if not exists agent_document_chunks_document_agent_owner_idx
  on public.agent_document_chunks(document_id, agent_id, owner_id);

create index if not exists agent_audit_events_agent_owner_idx
  on public.agent_audit_events(agent_id, owner_id);

-- These two tables are intentionally server-only. Keep explicit deny-all RLS
-- policies for client roles in addition to the absence of client table grants.
-- This is defense in depth if a future migration accidentally broadens grants.
drop policy if exists "No client access to agent versions" on public.agent_versions;
create policy "No client access to agent versions"
  on public.agent_versions
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "No client access to Pro usage counters" on public.pro_usage_counters;
create policy "No client access to Pro usage counters"
  on public.pro_usage_counters
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.agent_versions is
  'MediumIA Pro server-only version history. Client roles are denied by grants and explicit RLS.';

comment on table public.pro_usage_counters is
  'MediumIA Pro server-only atomic quota counters. Only trusted server code may consume or mutate quota.';
