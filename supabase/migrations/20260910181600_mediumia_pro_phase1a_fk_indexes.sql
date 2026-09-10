-- MediumIA Pro Phase 1A follow-up: covering indexes for workspace composite FKs.
-- These indexes do not change authorization or RAG semantics; they only support
-- referential-integrity checks and future workspace-scale access paths.

create index if not exists pro_memberships_workspace_user_fk_idx
  on public.pro_memberships(workspace_id, user_id);

create index if not exists agents_membership_workspace_owner_fk_idx
  on public.agents(membership_id, workspace_id, owner_id);

create index if not exists agent_documents_agent_workspace_owner_fk_idx
  on public.agent_documents(agent_id, workspace_id, owner_id);

create index if not exists agent_document_chunks_document_agent_owner_workspace_fk_idx
  on public.agent_document_chunks(document_id, agent_id, owner_id, workspace_id);
