import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

// 27/09/2026 : l'espace /agents s'ouvre aux professionnels invités du Réseau
// (plus seulement au Founder). Les garanties restent les mêmes : aucun droit
// ne vient du navigateur, le serveur décide de l'accès et écrit seul.
test('/agents access is decided by the server from an active membership, never by the browser', () => {
  const source = read('src/components/FounderCopilotAccess.jsx')
  const server = read('lib/proWorkspace.js')

  assert.match(source, /\?action=\$\{action\}/)
  assert.match(source, /data\.membership\?\.live/)
  assert.doesNotMatch(source, /from\('pro_memberships'\)/)
  assert.doesNotMatch(source, /from\('pro_invitations'\)/)
  assert.match(source, /documentsEnabled=\{true\}/)
  assert.match(server, /membership\.status !== 'active'/)
  assert.match(server, /membership\.expires_at/)
  // Un compte créé sur /agents ne donne rien sans invitation et adresse confirmée.
  assert.match(server, /if \(!user\.confirmed\) return \{ status: 403, body: \{ error: 'email_not_confirmed' \} \}/)
  // L'activation passe par la fonction SQL atomique (service_role uniquement).
  assert.match(server, /db\.rpc\('claim_mediumia_pro_invitation'/)
  assert.match(server, /outcome\?\.result === 'invitation_not_found'\) return \{ status: 403, body: \{ error: 'invitation_not_found' \} \}/)
})

test('assistants are created and edited only through the server, one live assistant per member', () => {
  const source = read('src/components/FounderCopilotAccess.jsx')
  const server = read('lib/proWorkspace.js')

  assert.doesNotMatch(source, /from\('agents'\)/)
  assert.match(server, /from\('agents'\)[\s\S]*neq\('status', 'archived'\)[\s\S]*limit\(1\)/)
  // Fournisseur, statut et fiche Réseau sont fixés par le serveur.
  assert.match(server, /provider: 'anthropic',\n\s+reseau_slug: reseauSlug,\n\s+public_enabled: false/)
  assert.doesNotMatch(server, /input\??\.(provider|model|system_prompt|permissions|public_enabled|reseau_slug)/)
})

test('Founder chat stays inside client-readable columns and sends mutations through server API', () => {
  const source = read('src/components/AgentChat.jsx')

  assert.match(source, /select\('id, name, status, mission, audience, tone, knowledge_summary'\)/)
  assert.doesNotMatch(source, /select\([^\n]*limits/)
  assert.match(source, /fetch\('\/api\/agent-chat'/)
  assert.match(source, /Authorization: `Bearer \$\{token\}`/)
  assert.match(source, /documentsEnabled = true/)
})

test('Founder can request a fresh conversation without deleting prior history', () => {
  const source = read('src/components/AgentChat.jsx')

  assert.match(source, /function startNewConversation\(\)/)
  assert.match(source, /setConversationId\(null\)/)
  assert.match(source, /setNewConversationRequested\(true\)/)
  assert.match(source, /setMessages\(\[\]\)/)
  assert.match(source, /\+ Nouvelle conversation/)
  assert.match(source, /newConversation: startingFresh/)
  assert.match(source, /conversationId: startingFresh \? null : conversationId/)
  assert.doesNotMatch(source, /from\('agent_conversations'\)[\s\S]*\.delete\(/)
})

test('Founder can list and reopen prior conversations without client-side mutation', () => {
  const source = read('src/components/AgentChat.jsx')

  assert.match(source, /const \[conversations, setConversations\] = useState\(\[\]\)/)
  assert.match(source, /select\('id, title, created_at, updated_at'\)/)
  assert.match(source, /order\('created_at', \{ ascending: false \}\)/)
  assert.match(source, /limit\(25\)/)
  assert.match(source, /async function openConversation\(conversation\)/)
  assert.match(source, /\.eq\('conversation_id', conversation\.id\)/)
  assert.match(source, />Historique</)
  assert.match(source, /aria-pressed=\{selected\}/)
  assert.doesNotMatch(source, /from\('agent_conversations'\)[\s\S]*\.(update|delete)\(/)
})

test('server enforces a fresh conversation even if a stale conversation id is sent', () => {
  const source = read('api/agent-chat.js')

  assert.match(source, /newConversation = false/)
  assert.match(source, /typeof newConversation !== 'boolean'/)
  assert.match(source, /let conversationId = newConversation === true \? null : \(requestedConversationId \|\| null\)/)
  assert.match(source, /insert\(\{ agent_id: agent\.id, owner_id: auth\.userId, title \}\)/)
  assert.match(source, /messageSaved: true, conversationId/)
})

test('Founder document UI keeps reads client-side but sends every mutation through authenticated Edge function', () => {
  const source = read('src/components/AgentDocuments.jsx')

  assert.match(source, /from\('agent_documents'\)[\s\S]*\.select\(/)
  assert.match(source, /supabase\.functions\.invoke\('agent-documents'/)
  for (const action of ['create_text', 'prepare_upload', 'finalize_upload', 'set_approval', 'delete']) {
    assert.match(source, new RegExp(`invokeDocumentAction\\('${action}'`))
  }
  assert.match(source, /uploadToSignedUrl\(/)
  assert.doesNotMatch(source, /\.from\('agent_documents'\)[\s\S]*\.(insert|update|delete)\(/)
  assert.doesNotMatch(source, /\.from\('agent_document_chunks'\)/)
  assert.doesNotMatch(source, /\.storage[\s\S]*\.upload\(/)
  assert.doesNotMatch(source, /ensure-agent-documents-bucket/)
})

test('document Edge function authenticates ownership and keeps privileged writes server-side', () => {
  const source = read('supabase/functions/agent-documents/index.ts')
  const bridge = read('supabase/functions/agent-documents/bridge.ts')

  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(source, /userClient\.auth\.getUser\(\)/)
  assert.match(source, /from\(["']pro_memberships["']\)[\s\S]*\.eq\(["']id["'], agent\.membership_id\)[\s\S]*\.eq\(["']user_id["'], user\.id\)[\s\S]*\.eq\(["']status["'], ["']active["']\)/)
  assert.match(source, /from\(["']agents["']\)[\s\S]*\.eq\(["']owner_id["'], user\.id\)/)
  assert.match(source, /membership\.workspace_id !== agent\.workspace_id/)
  assert.match(source, /pro_prepare_document_upload/)
  assert.match(source, /createSignedUploadUrl\(String\(prepared\.storage_path\)/)
  assert.doesNotMatch(source, /storagePath = `\$\{user\.id\}/)
  assert.match(bridge, /MAX_FILE_BYTES = 25 \* 1024 \* 1024/)
  assert.match(source, /MAX_TEXT_CHARS = 750_000/)
  assert.match(source, /approved_for_ai: false/)
  assert.match(source, /action === ["']set_approval["']/)
  assert.match(source, /action === ["']delete["']/)
  assert.doesNotMatch(source, /Deno\.env\.get\(["'].*VITE_/)
})

test('Phase 1 migration removes prototype raw Storage access for document clients', () => {
  const migration = read('supabase/migrations/20260910054200_mediumia_pro_phase1_documents_server_only.sql')

  for (const policy of [
    'Users can upload own stored agent documents',
    'Users can read own stored agent documents',
    'Users can update own stored agent documents',
    'Users can delete own stored agent documents',
  ]) {
    assert.match(migration, new RegExp(`drop policy if exists "${policy}" on storage\\.objects`))
  }
  assert.match(migration, /update storage\.buckets[\s\S]*set public = false[\s\S]*where id = 'agent-documents'/)
  assert.doesNotMatch(migration, /create policy/i)
})

test('public Pro waitlist remains available independently from Founder pilot', () => {
  const wrapper = read('src/components/ProWaitlistPage.jsx')
  const publicPage = read('src/components/ProWaitlistPublic.jsx')

  assert.match(wrapper, /startsWith\('\/agents'\)/)
  assert.match(wrapper, /<ProWaitlistPublic/)
  assert.match(publicPage, /mode: 'pro-waitlist'/)
  assert.match(publicPage, /sourcePage: '\/pro'/)
})
