insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

insert into public.pro_memberships (id, user_id, status, activated_at) values
  ('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now()),
  ('10000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', now());

insert into public.agents (
  id, owner_id, membership_id, name, status, mission, provider, model, system_prompt
) values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Copilote A', 'active', 'Mission A', 'anthropic', 'database-model-a', 'database-prompt-a'),
  ('20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '10000000-0000-4000-8000-000000000002', 'Copilote B', 'active', 'Mission B', 'openai', 'database-model-b', 'database-prompt-b'),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'Ancien copilote A', 'archived', 'Archive', 'openai', 'legacy-model', 'legacy-prompt');

insert into public.agent_conversations (id, agent_id, owner_id, title) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Conversation A'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Conversation B');

insert into public.agent_messages (conversation_id, agent_id, owner_id, role, content) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user', 'Message A'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user', 'Message B');

insert into public.agent_documents (
  id, agent_id, owner_id, name, source_type, status, approved_for_ai
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Document A', 'paste', 'ready', true),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Document B', 'paste', 'ready', true);

insert into public.agent_document_chunks (
  document_id, agent_id, owner_id, chunk_index, content
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, 'Information reservee a A'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0, 'Information reservee a B');

insert into public.agent_audit_events (
  owner_id, agent_id, event_type, resource_type, resource_id, details
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-4000-8000-000000000001', 'seeded', 'conversation', '30000000-0000-4000-8000-000000000001', '{"result":"success"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '20000000-0000-4000-8000-000000000002', 'seeded', 'conversation', '30000000-0000-4000-8000-000000000002', '{"result":"success"}');
