/* global process */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { GUARDIAN_SYSTEM } from '../lib/guardianKnowledge.js'

const HOURLY_LIMIT = 10
const DAILY_LIMIT = 30

const SYSTEM = `Tu es MediumIA, un assistant dédié à l'accompagnement à la médiumnité consciente.

Tu réponds aux questions des visiteurs sur le parcours MEDIUMIA — Accompagnement à la Médiumnité Consciente, créé par Sébastien Seguin, médium professionnel depuis plus de douze ans.

LE PARCOURS
- 25 modules PDF (269 pages) répartis en 4 niveaux
- 84 exercices guidés et un carnet de pratique intégré
- 12 mois d'accès à l'application MediumIA
- MediumIA comme assistant personnel tout au long du cheminement
- Prix : 597 €, paiement en 4× disponible via PayPal

LES 4 NIVEAUX
1. Les Fondations (modules 1-6) — poser l'intention juste, découvrir son canal dominant
2. La Technique du Canal (modules 7-13) — canalisation consciente, contact avec les défunts
3. Maîtrise et Autonomie (modules 14-20) — gestion des émotions, discernement avancé
4. L'Art du Médium Maître (modules 21-25) — canalisation créative, accompagner les vivants

L'APPROCHE
Clarté sans mystère inutile. Souveraineté intérieure. Autonomie comme objectif.
Aucune religion. Laïque, fondée sur l'expérience directe et le discernement.

CRÉATEUR
Sébastien Seguin, médium professionnel depuis plus de douze ans, des milliers de séances.
Consultations individuelles disponibles via Reservio.

LIMITES
- Tu informes sur le parcours et la médiumnité. Tu ne pratiques pas de consultations médiumniques.
- Si on te demande un tirage ou une prédiction, oriente vers Sébastien Seguin ou l'Oracle Au-delà de l'Âme.
- Réponds toujours en français, avec douceur, clarté et précision.
- Reste concis : 3 à 5 phrases maximum par réponse.
- Après plusieurs échanges, invite naturellement à découvrir le parcours complet.`

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (!xff) return null
  return xff.split(',')[0].trim().toLowerCase()
}

function hashIp(ip, secret) {
  return createHmac('sha256', secret).update(ip).digest('hex')
}

function hashIpGuardian(ip, secret) {
  return createHmac('sha256', secret).update('guardian:' + ip).digest('hex')
}

async function checkRateLimit(supabase, ipHash, endpoint, hourly, daily) {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: ipHash,
    p_endpoint: endpoint,
    p_hourly_limit: hourly,
    p_daily_limit: daily,
  })
  if (error) throw new Error('Rate limit check failed')
  return data
}

function textFromOpenAIResponse(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim()
  }
  const parts = []
  for (const item of data?.output || []) {
    if (item?.type === 'message') {
      for (const part of item.content || []) {
        if ((part?.type === 'output_text' || part?.type === 'text') && part.text) {
          parts.push(part.text)
        }
      }
    }
  }
  return parts.join('\n').trim()
}

async function handleGuardian(req, res) {
  const { history } = req.body || {}

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Historique manquant.' })
  }
  if (history.length > 20) {
    return res.status(400).json({ error: 'Conversation trop longue.' })
  }
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') {
    return res.status(400).json({ error: 'Le dernier message doit provenir du visiteur.' })
  }

  const validatedHistory = []
  for (const msg of history) {
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return res.status(400).json({ error: 'Rôle de message invalide.' })
    }
    const content = typeof msg.content === 'string' ? msg.content : ''
    const maxLen = msg.role === 'user' ? 1200 : 2000
    if (content.length > maxLen) {
      return res.status(400).json({ error: `Message trop long (maximum ${maxLen} caractères).` })
    }
    validatedHistory.push({ role: msg.role, content })
  }

  const openaiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI
  if (!openaiKey) {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  const rateLimitSecret = (process.env.GUARDIAN_RATE_LIMIT_SECRET || process.env.TRIAL_RATE_LIMIT_SECRET || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(rateLimitSecret)) {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  const clientIp = extractClientIp(req)
  if (!clientIp) {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  const ipHash = hashIpGuardian(clientIp, rateLimitSecret)

  try {
    const supabase = getSupabaseAdmin()
    const rl = await checkRateLimit(supabase, ipHash, 'site_guardian', HOURLY_LIMIT, DAILY_LIMIT)
    if (!rl || !rl.allowed) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Trop de messages pour le moment. Merci de réessayer plus tard.',
      })
    }
  } catch {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  const model = process.env.OPENAI_GUARDIAN_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-5-mini'

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: GUARDIAN_SYSTEM,
        input: validatedHistory,
        max_output_tokens: 500,
        store: false,
      }),
    })

    if (!response.ok) {
      console.error('[guardian] OpenAI error', 'status=' + response.status)
      return res.status(502).json({ error: 'Le Gardien est momentanément indisponible. Réessayez dans quelques instants.' })
    }

    const data = await response.json()
    const reply = textFromOpenAIResponse(data)

    return res.status(200).json({
      reply: reply || 'Un léger voile technique m\'empêche de vous répondre correctement. Pouvez-vous reformuler votre question en quelques mots ?',
    })
  } catch (err) {
    console.error('[guardian] Network error:', err?.name || 'Error')
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans quelques instants.' })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { mode } = req.body || {}

  if (mode === 'guardian') {
    return handleGuardian(req, res)
  }

  const { history } = req.body || {}
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Missing history' })
  }
  const last = history[history.length - 1]
  if (last?.role !== 'user') {
    return res.status(400).json({ error: 'Last message must be from user' })
  }
  if (history.length > 12) {
    return res.status(400).json({ error: 'Session trop longue.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC
  if (!apiKey) {
    return res.status(503).json({ error: 'Assistant temporairement indisponible.' })
  }

  const rateLimitSecret = (process.env.TRIAL_RATE_LIMIT_SECRET || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(rateLimitSecret)) {
    return res.status(503).json({ error: 'Assistant temporairement indisponible.' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Assistant temporairement indisponible.' })
  }

  const clientIp = extractClientIp(req)
  if (!clientIp) {
    return res.status(503).json({ error: 'Assistant temporairement indisponible.' })
  }

  const ipHash = hashIp(clientIp, rateLimitSecret)

  try {
    const supabase = getSupabaseAdmin()
    const rl = await checkRateLimit(supabase, ipHash, 'mediumia_trial', HOURLY_LIMIT, DAILY_LIMIT)
    if (!rl || !rl.allowed) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Trop de requêtes. Merci de réessayer plus tard.',
      })
    }
  } catch {
    console.error('[mediumia-trial] Rate limit check failed')
    return res.status(503).json({ error: 'Assistant temporairement indisponible.' })
  }

  const messages = history.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 600),
  }))

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM,
        messages,
      }),
    })

    if (!response.ok) {
      console.error('[mediumia-trial] Provider error:', response.status)
      return res.status(502).json({ error: 'Je suis momentanément indisponible. Réessayez dans quelques instants.' })
    }

    const data = await response.json()
    const reply = (data?.content || [])
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n')
      .trim()

    return res.status(200).json({ reply })
  } catch (err) {
    console.error('[mediumia-trial] Network error:', err?.name || 'Error')
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans quelques instants.' })
  }
}
