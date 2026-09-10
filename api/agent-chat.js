import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin, requireAuth } from '../lib/supabaseAdmin.js'
import {
  buildAgentInstructions,
  resolveAgentRuntimePolicy,
} from '../lib/agentRuntimePolicy.js'

function textFromOpenAIResponse(data) {
  const parts = []
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && part.text) parts.push(part.text)
    }
  }
  return parts.join('\n').trim()
}

function textFromAnthropicResponse(data) {
  return (data?.content || [])
    .filter((part) => part?.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function technicalLog(requestId, action, result, startedAt, errorCode = '') {
  const fields = [
    '[agent-chat]',
    `request_id=${requestId}`,
    `action=${action}`,
    `result=${result}`,
    `duration_ms=${Date.now() - startedAt}`,
  ]
  if (errorCode) fields.push(`error=${errorCode}`)
  console.info(fields.join(' '))
}

function buildKnowledgeContext(matches, maxChars) {
  if (!Array.isArray(matches) || matches.length === 0) return { text: '', sources: [] }
  const blocks = []
  const sources = []
  let totalChars = 0

  for (const match of matches) {
    if (!match?.content || totalChars >= maxChars) break
    const content = String(match.content).slice(0, maxChars - totalChars)
    if (!content) continue
    const label = match.document_name || 'Source MediumIA'
    blocks.push(`[${label} - extrait ${Number(match.chunk_index || 0) + 1}]\n${content}`)
    sources.push({
      document_id: match.document_id,
      document_name: label,
      chunk_index: match.chunk_index,
      rank: match.rank,
    })
    totalChars += content.length
  }

  return { text: blocks.join('\n\n---\n\n'), sources }
}

async function callAnthropic({ apiKey, model, instructions, history, maxOutputTokens }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      thinking: { type: 'disabled' },
      system: instructions,
      messages: history,
    }),
  })

  if (!response.ok) return { error: 'provider_error' }
  const reply = textFromAnthropicResponse(await response.json())
  return reply ? { reply } : { error: 'empty_provider_response' }
}

async function callOpenAI({ apiKey, model, instructions, history, maxOutputTokens }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input: history,
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
  })

  if (!response.ok) return { error: 'provider_error' }
  const reply = textFromOpenAIResponse(await response.json())
  return reply ? { reply } : { error: 'empty_provider_response' }
}

async function writeAudit(db, event) {
  const { error } = await db.from('agent_audit_events').insert({
    owner_id: event.ownerId,
    agent_id: event.agentId,
    event_type: event.eventType,
    resource_type: 'conversation',
    resource_id: event.conversationId || null,
    details: {
      request_id: event.requestId,
      provider: event.provider,
      model: event.model,
      source_count: event.sourceCount || 0,
      duration_ms: event.durationMs,
      result: event.result,
    },
  })
  return !error
}

export default async function handler(req, res) {
  const requestId = randomUUID()
  const startedAt = Date.now()

  if (req.method !== 'POST') {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'method_not_allowed')
    return res.status(405).json({ error: 'Method not allowed', requestId })
  }

  let runtime
  try {
    runtime = resolveAgentRuntimePolicy()
  } catch {
    technicalLog(requestId, 'chat', 'failed', startedAt, 'runtime_configuration')
    return res.status(503).json({ error: 'AI server configuration missing', requestId })
  }

  const auth = await requireAuth(req)
  if (auth.error) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, auth.error)
    return res.status(auth.status).json({ error: auth.error, requestId })
  }

  const { agentId, conversationId: requestedConversationId, message } = req.body || {}
  const cleanMessage = typeof message === 'string' ? message.trim() : ''
  if (!agentId || !cleanMessage) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'invalid_request')
    return res.status(400).json({ error: 'agentId and message are required', requestId })
  }
  if (cleanMessage.length > runtime.limits.maxMessageChars) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'message_too_long')
    return res.status(400).json({ error: 'Message too long', requestId })
  }

  const db = getSupabaseAdmin()
  const { data: membership } = await db
    .from('pro_memberships')
    .select('id, status, expires_at')
    .eq('user_id', auth.userId)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || (membership.expires_at && new Date(membership.expires_at) <= new Date())) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'pro_access_required')
    return res.status(403).json({ error: 'pro_access_required', requestId })
  }

  const { data: agent } = await db
    .from('agents')
    .select('id, owner_id, membership_id, name, status, mission, audience, tone, knowledge_summary')
    .eq('id', agentId)
    .eq('owner_id', auth.userId)
    .eq('membership_id', membership.id)
    .maybeSingle()

  if (!agent) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'copilot_not_found')
    return res.status(404).json({ error: 'Copilot introuvable', requestId })
  }
  if (agent.status !== 'active' && agent.status !== 'draft') {
    technicalLog(requestId, 'chat', 'rejected', startedAt, 'copilot_unavailable')
    return res.status(403).json({ error: 'Copilot indisponible', requestId })
  }

  const { data: quota, error: quotaError } = await db.rpc('consume_pro_usage_quota', {
    p_membership_id: membership.id,
    p_action: 'agent_chat_message',
    p_units: 1,
    p_hourly_limit: runtime.limits.hourlyMessages,
    p_daily_limit: runtime.limits.dailyMessages,
  })
  if (quotaError) {
    technicalLog(requestId, 'chat', 'failed', startedAt, 'quota_unavailable')
    return res.status(503).json({ error: 'quota_unavailable', requestId })
  }
  if (!quota?.allowed) {
    technicalLog(requestId, 'chat', 'rejected', startedAt, `quota_${quota?.reason || 'exceeded'}`)
    return res.status(429).json({ error: 'usage_limit_reached', requestId })
  }

  let conversationId = requestedConversationId || null
  if (conversationId) {
    const { data: conversation } = await db
      .from('agent_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('agent_id', agent.id)
      .eq('owner_id', auth.userId)
      .maybeSingle()
    if (!conversation) {
      technicalLog(requestId, 'chat', 'rejected', startedAt, 'conversation_not_found')
      return res.status(404).json({ error: 'Conversation introuvable', requestId })
    }
  } else {
    const title = cleanMessage.replace(/\s+/g, ' ').slice(0, 70) || 'Nouvelle conversation'
    const { data: conversation, error } = await db
      .from('agent_conversations')
      .insert({ agent_id: agent.id, owner_id: auth.userId, title })
      .select('id')
      .single()
    if (error || !conversation) {
      technicalLog(requestId, 'chat', 'failed', startedAt, 'conversation_create_failed')
      return res.status(500).json({ error: 'Impossible de créer la conversation', requestId })
    }
    conversationId = conversation.id
  }

  const { error: userMessageError } = await db.from('agent_messages').insert({
    conversation_id: conversationId,
    agent_id: agent.id,
    owner_id: auth.userId,
    role: 'user',
    content: cleanMessage,
  })
  if (userMessageError) {
    technicalLog(requestId, 'chat', 'failed', startedAt, 'message_persistence_failed')
    return res.status(500).json({ error: 'Impossible d’enregistrer le message', requestId })
  }

  const { data: latestMessages, error: historyError } = await db
    .from('agent_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('agent_id', agent.id)
    .eq('owner_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(runtime.limits.historyMessages)

  if (historyError) {
    technicalLog(requestId, 'chat', 'failed', startedAt, 'history_unavailable')
    return res.status(500).json({ error: 'Impossible de charger la conversation', requestId })
  }

  const history = [...(latestMessages || [])]
    .reverse()
    .map(({ role, content }) => ({ role, content }))

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  let knowledgeMatches = []
  if (supabaseUrl && publishableKey) {
    const token = (req.headers.authorization || '').slice(7)
    const userDb = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data } = await userDb.rpc('search_agent_document_chunks', {
      p_agent_id: agent.id,
      p_query: cleanMessage,
      p_limit: runtime.limits.knowledgeMatches,
    })
    knowledgeMatches = data || []
  }

  const knowledge = buildKnowledgeContext(knowledgeMatches, runtime.limits.knowledgeChars)
  const instructions = buildAgentInstructions(agent, knowledge.text)

  let result
  try {
    if (runtime.provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC
      if (!apiKey) throw new Error('provider_not_configured')
      result = await callAnthropic({
        apiKey,
        model: runtime.model,
        instructions,
        history,
        maxOutputTokens: runtime.limits.maxOutputTokens,
      })
    } else {
      const apiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI
      if (!apiKey) throw new Error('provider_not_configured')
      result = await callOpenAI({
        apiKey,
        model: runtime.model,
        instructions,
        history,
        maxOutputTokens: runtime.limits.maxOutputTokens,
      })
    }
  } catch (error) {
    const errorCode = error?.message === 'provider_not_configured'
      ? 'provider_not_configured'
      : 'provider_network_error'
    await writeAudit(db, {
      ownerId: auth.userId,
      agentId: agent.id,
      eventType: 'agent_response_failed',
      conversationId,
      requestId,
      provider: runtime.provider,
      model: runtime.model,
      sourceCount: knowledge.sources.length,
      durationMs: Date.now() - startedAt,
      result: errorCode,
    })
    technicalLog(requestId, 'chat', 'failed', startedAt, errorCode)
    return res.status(502).json({ error: 'Le copilote est momentanément indisponible.', requestId, messageSaved: true })
  }

  if (result.error) {
    await writeAudit(db, {
      ownerId: auth.userId,
      agentId: agent.id,
      eventType: 'agent_response_failed',
      conversationId,
      requestId,
      provider: runtime.provider,
      model: runtime.model,
      sourceCount: knowledge.sources.length,
      durationMs: Date.now() - startedAt,
      result: result.error,
    })
    technicalLog(requestId, 'chat', 'failed', startedAt, result.error)
    return res.status(502).json({ error: 'Le copilote n’a pas pu répondre.', requestId, messageSaved: true })
  }

  const { error: assistantMessageError } = await db.from('agent_messages').insert({
    conversation_id: conversationId,
    agent_id: agent.id,
    owner_id: auth.userId,
    role: 'assistant',
    content: result.reply,
    provider: runtime.provider,
    model: runtime.model,
    sources: knowledge.sources,
  })
  if (assistantMessageError) {
    technicalLog(requestId, 'chat', 'failed', startedAt, 'assistant_persistence_failed')
    return res.status(500).json({ error: 'Réponse reçue mais non enregistrée', requestId })
  }

  await writeAudit(db, {
    ownerId: auth.userId,
    agentId: agent.id,
    eventType: 'agent_response_generated',
    conversationId,
    requestId,
    provider: runtime.provider,
    model: runtime.model,
    sourceCount: knowledge.sources.length,
    durationMs: Date.now() - startedAt,
    result: 'success',
  })

  technicalLog(requestId, 'chat', 'success', startedAt)
  return res.status(200).json({
    conversationId,
    reply: result.reply,
    sources: knowledge.sources,
    requestId,
  })
}
