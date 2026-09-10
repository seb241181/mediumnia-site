# MediumIA Pro Phase 0

This document records the reconciliation between the Agents objects found in
Supabase and the migrations previously available in Git. Production was used
read-only for the initial inventory; reconstruction and adversarial tests run in
ephemeral local PostgreSQL and PostgREST containers before rollout.

## Reconciliation

| Object | Decision | Phase 0 result |
| --- | --- | --- |
| `agents` | Harden | Reused as the logical copilot and linked to one Pro membership. Runtime fields remain server-owned. |
| `agent_versions` | Reuse | Ownership consistency is enforced with composite foreign keys. The table remains explicitly server-only. |
| `agent_conversations` | Harden | Reused for multiple conversations and bound to the matching agent and owner. |
| `agent_messages` | Harden | The cross-agent RLS tautology is removed and relational ownership is enforced by the database. |
| `agent_documents` | Harden | Reused for private document metadata and bound to the matching agent and owner. |
| `agent_document_chunks` | Harden | The cross-agent RLS tautology is removed. No embedding or parsing pipeline is added. |
| `agent_audit_events` | Harden | Client inserts are revoked; only safe server metadata is accepted. |
| `search_agent_document_chunks` | Harden | Anonymous and `PUBLIC` execution are revoked; owner checks remain mandatory. |
| `agent-documents` bucket | Replace bootstrap | The private bucket is now created by migration with size and MIME restrictions. |
| `ensure-agent-documents-bucket` | Remove later | Source is recovered for traceability, but the migration is the authoritative bootstrap. No function was deleted or deployed in Phase 0. |
| `pro_memberships` | Add | Minimal Founder/Pro access boundary, with existing owners backfilled as suspended. |
| `pro_usage_counters` | Add | Atomic server-only hourly and daily quota accounting, with an explicit deny-all client RLS policy. |

The historical `supabase/agents_schema.sql` file is retained as a legacy
snapshot only. The ordered files under `supabase/migrations` are the source of
truth for rebuilding the schema.

## Security guarantees

- Active membership is required to read or update the user's copilot data.
- Composite constraints prevent cross-wiring conversations, messages,
  documents, chunks, versions, or audit events to another copilot context.
- Composite foreign keys introduced by Phase 0 have covering indexes so their
  integrity checks and parent-row operations do not degrade into avoidable scans
  as the Pro dataset grows.
- At most one non-archived copilot exists per membership.
- Authenticated clients can update only safe profile columns. Provider, model,
  system prompt, permissions, limits, messages, documents, chunks, versions,
  usage counters, and audit events remain server-owned.
- `agent_versions` and `pro_usage_counters` use explicit deny-all RLS policies
  for `anon` and `authenticated` in addition to having no client write grants.
  This is deliberate defense in depth, not a missing access policy.
- Storage uses the private path `user-id/agent-id/file`, including membership
  validation for insert, read, update, and delete.
- Search is unavailable to anonymous callers and preserves row-level checks.
- The chat API resolves provider, model, prompt, permissions, and limits from a
  server-only policy and records no private content in technical logs.
- Quota consumption is serialized transactionally and cannot over-consume
  during concurrent requests.

## Phase 0 cleanup

The cleanup migration `20260910045000_mediumia_pro_phase0_cleanup.sql` is
strictly additive. It adds covering indexes for the composite foreign keys and
makes the server-only intent of `agent_versions` and `pro_usage_counters`
explicit through deny-all client policies and table comments. It grants no new
client capability and rewrites no application data.

## Verification

Run the isolated reconstruction and REST/RLS suite with:

```sh
npm run test:pro-phase0
```

The integration suite starts fresh PostgreSQL and PostgREST containers, applies
the recovered migrations plus the Phase 0 hardening migration, creates Users A
and B, exercises REST and RPC access with signed test JWTs, and removes every
test container and network afterward.

Run the repository unit suite with:

```sh
npm test
```

The unit suite additionally verifies that the cleanup migration contains all
seven covering composite indexes, explicit deny-all client policies for both
server-only tables, and no destructive table/data operation. The cleanup SQL
must still pass Preview/build review before any Production rollout.

## Production status

The Phase 0 hardening migration was deployed to Production on 2026-09-10 after
preflight, logical backup, Vercel `READY`, and postflight verification. Existing
prototype data was preserved and the backfilled membership remained
`suspended`. The cleanup migration must follow the same controlled rollout and
must not activate any membership or expose the Copilot UI.

## Deferred work

- No public `/agents` product or final "Mon Copilote IA" interface.
- No automatic memory, embeddings, vector search, or PDF/DOCX parsing.
- No external actions, agenda, Gmail, RDV, publication, or automation tools.
- No Founder activation or Phase 1 onboarding until Phase 0 cleanup is reviewed
  and explicitly approved for Production.
