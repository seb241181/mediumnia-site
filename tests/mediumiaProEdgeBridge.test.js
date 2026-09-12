import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Phase 1B-B keeps the existing HTTP actions and hides shadow internals from the UI', () => {
  const edge = read('supabase/functions/agent-documents/index.ts')
  const ui = read('src/components/AgentDocuments.jsx')

  for (const action of ['create_text', 'prepare_upload', 'finalize_upload', 'retry_extract', 'set_approval', 'delete']) {
    assert.match(edge, new RegExp(`action === ["']${action}["']`))
  }
  assert.match(ui, /invokeAgentDocumentAction\(\{/)
  assert.doesNotMatch(ui, /workspace_id|version_id|processing_claim_id/)
  assert.doesNotMatch(edge, /body\.(?:workspace_id|actor_user_id|version_id|processing_claim_id)/)
})

test('new file uploads use server-derived RPC identities and atomic extraction completion', () => {
  const edge = read('supabase/functions/agent-documents/index.ts')
  const bridge = read('supabase/functions/agent-documents/bridge.ts')
  const shadowProcessor = edge.slice(
    edge.indexOf('async function processShadowUploadedDocument'),
    edge.indexOf('export async function handleAgentDocumentsRequest'),
  )

  assert.match(edge, /rpc\(["']pro_prepare_document_upload["']/)
  assert.match(edge, /prepared\.document_id/)
  assert.match(edge, /prepared\.version_id/)
  assert.match(edge, /prepared\.storage_bucket/)
  assert.match(edge, /prepared\.storage_path/)
  assert.match(bridge, /pro_mark_document_version_uploaded/)
  assert.match(bridge, /pro_claim_document_extraction_attempt/)
  assert.match(bridge, /pro_complete_document_extraction/)
  assert.match(bridge, /pro_fail_document_extraction/)
  assert.doesNotMatch(shadowProcessor, /agent_document_chunks/)
})

test('real Storage bytes are checked before mark and used for SHA-256 plus parsing', () => {
  const edge = read('supabase/functions/agent-documents/index.ts')
  const bridge = read('supabase/functions/agent-documents/bridge.ts')
  const ui = read('src/components/AgentDocuments.jsx')

  assert.match(edge, /blob\.size > MAX_FILE_BYTES/)
  assert.match(edge, /blob\.size !== expectedSize/)
  assert.match(edge, /invalid_pdf_signature/)
  assert.match(edge, /invalid_docx_signature/)
  assert.match(edge, /contentSha256: await sha256Hex\(bytes\)/)
  assert.ok(bridge.indexOf('const verified = await verifySource()') < bridge.indexOf('pro_mark_document_version_uploaded'))
  assert.ok(ui.indexOf('if (uploadError)') < ui.indexOf("invokeDocumentAction('finalize_upload'"))
  assert.match(ui, /if \(finalizeError\.stored\) uploadCompleted = true/)
})

test('shadow approval and deletion use RPCs while legacy compatibility remains explicit', () => {
  const edge = read('supabase/functions/agent-documents/index.ts')
  const bridge = read('supabase/functions/agent-documents/bridge.ts')

  assert.match(bridge, /pro_approve_document_version/)
  assert.match(bridge, /pro_publish_document_version/)
  assert.match(bridge, /pro_set_document_ai_enabled/)
  assert.ok(bridge.indexOf('await rpc("pro_delete_document"') < bridge.indexOf('await removeObject('))
  assert.match(edge, /processLegacyUploadedDocument/)
  assert.match(edge, /rpc\(["']pro_prepare_text_document["']/)
  assert.match(edge, /Deletion is the sole reconcile-on-demand exception during 1B-B/)
  assert.match(edge, /pro_reconcile_legacy_document/)
})

test('support migration adds narrow saga RPCs without changing or backfilling RAG', () => {
  const migration = read('supabase/migrations/20260911120000_mediumia_pro_phase1b_edge_bridge_support.sql')

  for (const routine of [
    'pro_prepare_text_document',
    'pro_abandon_document_version',
    'pro_claim_document_extraction_attempt',
    'pro_claim_document_storage_job',
    'pro_complete_document_storage_job',
    'pro_fail_document_storage_job',
    'pro_finalize_document_deletion',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${routine}`))
    assert.match(migration, new RegExp(`grant execute on function public\\.${routine}`))
  }
  assert.match(migration, /mediumia_phase1b_edge_rag_guard/)
  assert.doesNotMatch(migration, /update public\.agent_document_chunks|insert into public\.agent_document_chunks/)
  assert.doesNotMatch(migration, /api\/agent-chat|create or replace function public\.search_agent_document_chunks/)
})
