/* global process */

import agentChatHandler from '../api/agent-chat.js'

const AGENT_ID = '2f5dcd1d-fb05-4623-80d6-8779aa5f561d'

export async function handleConferenceCopilotSmoke(req, res) {
  if (process.env.VERCEL_ENV === 'production') return res.status(404).json({ error: 'not_found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const rehearsalToken = String(req.query?.rehearsalToken || '').trim()
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(rehearsalToken)) return res.status(400).json({ error: 'invalid_rehearsal_token' })

  req.method = 'POST'
  req.headers['x-mediumia-rehearsal'] = rehearsalToken
  req.body = {
    agentId: AGENT_ID,
    newConversation: true,
    message: '[TEST E2E CONFÉRENCE] Donne exactement trois questions courtes que Sébastien pourrait sélectionner dans une salle où les participants parlent de médiumnité. Réponds uniquement par trois lignes.',
  }

  return agentChatHandler(req, res)
}
