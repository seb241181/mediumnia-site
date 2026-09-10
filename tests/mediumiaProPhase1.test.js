import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Founder pilot requires an existing authenticated founder membership', () => {
  const source = read('src/components/FounderCopilotAccess.jsx')

  assert.match(source, /from\('pro_memberships'\)/)
  assert.match(source, /membership\.access_level !== 'founder'/)
  assert.match(source, /membership\.status !== 'active'/)
  assert.match(source, /membership\?\.expires_at/)
  assert.doesNotMatch(source, /signUp/)
  assert.match(source, /documentsEnabled=\{false\}/)
})

test('Founder pilot opens only the existing non-archived copilot', () => {
  const source = read('src/components/FounderCopilotAccess.jsx')

  assert.match(source, /from\('agents'\)/)
  assert.match(source, /neq\('status', 'archived'\)/)
  assert.match(source, /limit\(1\)/)
  assert.doesNotMatch(source, /from\('agents'\)[\s\S]*\.insert\(/)
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

test('server enforces a fresh conversation even if a stale conversation id is sent', () => {
  const source = read('api/agent-chat.js')

  assert.match(source, /newConversation = false/)
  assert.match(source, /typeof newConversation !== 'boolean'/)
  assert.match(source, /let conversationId = newConversation === true \? null : \(requestedConversationId \|\| null\)/)
  assert.match(source, /insert\(\{ agent_id: agent\.id, owner_id: auth\.userId, title \}\)/)
  assert.match(source, /messageSaved: true, conversationId/)
})

test('public Pro waitlist remains available independently from Founder pilot', () => {
  const wrapper = read('src/components/ProWaitlistPage.jsx')
  const publicPage = read('src/components/ProWaitlistPublic.jsx')

  assert.match(wrapper, /startsWith\('\/agents'\)/)
  assert.match(wrapper, /<ProWaitlistPublic/)
  assert.match(publicPage, /mode: 'pro-waitlist'/)
  assert.match(publicPage, /sourcePage: '\/pro'/)
})
