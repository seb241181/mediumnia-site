import { createClient } from '@supabase/supabase-js'

function textFromResponse(data) {
  const parts = []
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && part.text) parts.push(part.text)
    }
  }
  return parts.join('\n').trim()
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
- Reste utile, concret et cohérent avec la mission de cet agent.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  const openaiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI

  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Supabase server configuration missing' })
  if (!openaiKey) return res.status(503).json({ error: 'AI server configuration missing' })

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
  const history = [...(latestMessages || [])].reverse().map((m) => ({ role: m.role, content: m.content }))

  const instructions = agent.system_prompt?.trim() || buildInstructions(agent)
  const model = process.env.OPENAI_AGENT_MODEL || agent.model || 'gpt-5-mini'

  let aiResponse
  try {
    aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input: history,
        max_output_tokens: 900,
        store: false,
      }),
    })
  } catch (error) {
    console.error('MediumIA OpenAI network error:', String(error))
    return res.status(502).json({ error: 'Le cerveau IA est momentanément indisponible.' })
  }

  if (!aiResponse.ok) {
    const detail = await aiResponse.text()
    console.error('MediumIA OpenAI error:', aiResponse.status, detail)
    return res.status(502).json({ error: 'Le cerveau IA n’a pas pu répondre.' })
  }

  const aiData = await aiResponse.json()
  const reply = textFromResponse(aiData)
  if (!reply) return res.status(502).json({ error: 'Réponse IA vide.' })

  const { error: assistantMessageError } = await db.from('agent_messages').insert({
    conversation_id: conversationId,
    agent_id: agent.id,
    owner_id: user.id,
    role: 'assistant',
    content: reply,
  })
  if (assistantMessageError) {
    console.error('MediumIA assistant message persistence error:', assistantMessageError)
  }

  return res.status(200).json({ conversationId, reply })
}
