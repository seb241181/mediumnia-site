import { createClient } from '@supabase/supabase-js'

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

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5'
const RETIRED_ANTHROPIC_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-opus-20240229',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-7-sonnet-20250219',
])

function resolveAnthropicModel(candidate) {
  const model = (candidate || '').trim() || DEFAULT_ANTHROPIC_MODEL
  return RETIRED_ANTHROPIC_MODELS.has(model) ? DEFAULT_ANTHROPIC_MODEL : model
}

function buildInstructions(agent) {
  return `Tu es « ${agent.name || 'Agent MediumIA'} », un agent IA créé dans MediumIA.

MISSION
${agent.mission || 'Aider son propriétaire dans les limites définies.'}

PUBLIC / INTERLOCUTEUR PRINCIPAL
${agent.audience || 'Non précisé.'}

TON ET MANIÈRE DE S’EXPRIMER
${agent.tone || 'Clair, chaleureux et professionnel.'}

CONNAISSANCES À MOBILISER
${agent.knowledge_summary || 'Aucune connaissance métier spécifique n’a encore été fournie.'}

LIMITES ABSOLUES
${agent.limits || 'Ne pas agir au-delà de la demande et ne pas inventer d’informations sur l’activité du propriétaire.'}

RÈGLES MEDIUMIA
- Respecte strictement les limites ci-dessus.
- N’affirme jamais connaître une information propre à l’entreprise, aux clients ou aux documents du propriétaire si elle ne t’a pas été fournie.
- Si une information métier manque, dis-le clairement et demande-la plutôt que de l’inventer.
- Tu peux utiliser tes connaissances générales pour aider, mais distingue-les des informations spécifiques au propriétaire.
- N’exécute aucune action externe (achat, envoi, rendez-vous, publication, modification de données) tant qu’un outil et une autorisation explicite ne te sont pas fournis.
- Réponds dans la langue de l’utilisateur, sauf demande contraire.
- Reste utile, concret et cohérent avec la mission de cet agent.
- Quand des SOURCES MEDIUMIA sont fournies, elles ont priorité pour les faits propres à l’entreprise.
- N’invente jamais le contenu d’une source absente. Si les sources ne permettent pas de répondre, dis-le.
- Quand tu t’appuies sur une source MediumIA, mentionne naturellement son nom dans la réponse si cela aide à vérifier l’information.`
}

function buildKnowledgeContext(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return { text: '', sources: [] }
  const blocks = []
  const sources = []
  let totalChars = 0
  for (const match of matches) {
    if (!match?.content || totalChars >= 12000) break
    const remaining = 12000 - totalChars
    const content = String(match.content).slice(0, remaining)
    if (!content) continue
    const label = match.document_name || 'Source MediumIA'
    blocks.push(`[${label} — extrait ${Number(match.chunk_index || 0) + 1}]\n${content}`)
    sources.push({
      document_id: match.document_id,
      document_name: label,
      chunk_index: match.chunk_index,
      rank: match.rank,
    })
    totalChars += content.length
  }
  return {
    text: blocks.length ? `\n\nSOURCES MEDIUMIA VALIDÉES PAR LE PROPRIÉTAIRE\n${blocks.join('\n\n---\n\n')}` : '',
    sources,
  }
}

async function callAnthropic({ apiKey, model, instructions, history }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      thinking: { type: 'disabled' },
      system: instructions,
      messages: history,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    let errorType = 'unknown'
    try { errorType = JSON.parse(detail)?.error?.type || 'unknown' } catch { /* corps non-JSON */ }
    console.error(
      'MediumIA Anthropic error:',
      'status=' + response.status,
      'type=' + errorType,
      'model=' + model,
      'request_id=' + (response.headers.get('request-id') || 'n/a'),
      'body=' + detail,
    )
    return { error: 'Le cerveau Anthropic n’a pas pu répondre.' }
  }

  const data = await response.json()
  const reply = textFromAnthropicResponse(data)
  return reply ? { reply } : { error: 'Réponse Anthropic vide.' }
}

async function callOpenAI({ apiKey, model, instructions, history }) {
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
      max_output_tokens: 900,
      store: false,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('MediumIA OpenAI error:', response.status, detail)
    return { error: 'Le cerveau OpenAI n’a pas pu répondre.' }
  }

  const data = await response.json()
  const reply = textFromOpenAIResponse(data)
  return reply ? { reply } : { error: 'Réponse OpenAI vide.' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Supabase server configuration missing' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const { agentId, conversationId: requestedConversationId, message } = req.body || {}
  const cleanMessage = typeof message === 'string' ? message.trim() : ''
  if (!agentId || !cleanMessage) return res.status(400).json({ error: 'agentId and message are required' })
  if (cleanMessage.length > 4000) return res.status(400).json({ error: 'Message too long' })

  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: userData, error: userError } = await db.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return res.status(401).json({ error: 'Invalid session' })

  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  const { count: recentCount } = await db
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .gte('created_at', minuteAgo)
  if ((recentCount || 0) >= 20) return res.status(429).json({ error: 'Trop de messages en peu de temps. Réessayez dans une minute.' })

  const { data: agent, error: agentError } = await db
    .from('agents')
    .select('id, owner_id, name, status, provider, model, mission, audience, tone, knowledge_summary, limits, system_prompt')
    .eq('id', agentId)
    .single()

  if (agentError || !agent) return res.status(404).json({ error: 'Agent introuvable' })
  if (agent.status === 'suspended' || agent.status === 'archived') return res.status(403).json({ error: 'Cet agent n’est pas disponible.' })

  let conversationId = requestedConversationId || null
  if (conversationId) {
    const { data: conversation, error } = await db
      .from('agent_conversations')
      .select('id, agent_id')
      .eq('id', conversationId)
      .eq('agent_id', agent.id)
      .single()
    if (error || !conversation) return res.status(404).json({ error: 'Conversation introuvable' })
  } else {
    const title = cleanMessage.replace(/\s+/g, ' ').slice(0, 70) || 'Nouvelle conversation'
    const { data: conversation, error } = await db
      .from('agent_conversations')
      .insert({ agent_id: agent.id, owner_id: user.id, title })
      .select('id')
      .single()
    if (error || !conversation) return res.status(500).json({ error: 'Impossible de créer la conversation' })
    conversationId = conversation.id
  }

  const { error: userMessageError } = await db.from('agent_messages').insert({
    conversation_id: conversationId,
    agent_id: agent.id,
    owner_id: user.id,
    role: 'user',
    content: cleanMessage,
  })
  if (userMessageError) return res.status(500).json({ error: 'Impossible d’enregistrer le message' })

  const { data: latestMessages, error: historyError } = await db
    .from('agent_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (historyError) return res.status(500).json({ error: 'Impossible de charger la conversation' })
  const history = [...(latestMessages || [])]
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }))

  let knowledgeMatches = []
  const { data: matchedChunks, error: knowledgeError } = await db.rpc('search_agent_document_chunks', {
    p_agent_id: agent.id,
    p_query: cleanMessage,
    p_limit: 6,
  })
  if (knowledgeError) {
    console.error('MediumIA knowledge search error:', knowledgeError.message)
  } else {
    knowledgeMatches = matchedChunks || []
  }

  const knowledge = buildKnowledgeContext(knowledgeMatches)
  const instructions = (agent.system_prompt?.trim() || buildInstructions(agent)) + knowledge.text
  const provider = (agent.provider || 'anthropic').toLowerCase()

  let result
  try {
    if (provider === 'anthropic') {
      const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC
      if (!anthropicKey) {
        return res.status(503).json({ error: 'Anthropic server configuration missing', conversationId, messageSaved: true })
      }
      const model = resolveAnthropicModel(process.env.ANTHROPIC_AGENT_MODEL || agent.model)
      result = await callAnthropic({ apiKey: anthropicKey, model, instructions, history })
      if (result.error) return res.status(502).json({ error: result.error, conversationId, messageSaved: true })
      result.provider = 'anthropic'
      result.model = model
    } else if (provider === 'openai') {
      const openaiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI
      if (!openaiKey) {
        return res.status(503).json({ error: 'OpenAI server configuration missing', conversationId, messageSaved: true })
      }
      const model = process.env.OPENAI_AGENT_MODEL || agent.model || 'gpt-5-mini'
      result = await callOpenAI({ apiKey: openaiKey, model, instructions, history })
      if (result.error) return res.status(502).json({ error: result.error, conversationId, messageSaved: true })
      result.provider = 'openai'
      result.model = model
    } else {
      return res.status(400).json({ error: `Fournisseur IA non pris en charge : ${provider}`, conversationId, messageSaved: true })
    }
  } catch (error) {
    console.error('MediumIA provider network error:', String(error))
    return res.status(502).json({ error: 'Le cerveau IA est momentanément indisponible.', conversationId, messageSaved: true })
  }

  const { error: assistantMessageError } = await db.from('agent_messages').insert({
    conversation_id: conversationId,
    agent_id: agent.id,
    owner_id: user.id,
    role: 'assistant',
    content: result.reply,
    provider: result.provider,
    model: result.model,
    sources: knowledge.sources,
  })
  if (assistantMessageError) console.error('MediumIA assistant message persistence error:', assistantMessageError)

  await db.from('agent_audit_events').insert({
    owner_id: user.id,
    agent_id: agent.id,
    event_type: 'agent_response_generated',
    resource_type: 'conversation',
    resource_id: conversationId,
    details: {
      provider: result.provider,
      model: result.model,
      source_count: knowledge.sources.length,
    },
  })

  return res.status(200).json({
    conversationId,
    reply: result.reply,
    provider: result.provider,
    model: result.model,
    sources: knowledge.sources,
  })
}
