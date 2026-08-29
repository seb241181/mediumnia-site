/* global process */
/**
 * POST /api/guardian-chat
 *
 * API publique du Gardien de MediumIA.
 * Utilise OpenAI Responses API avec store:false.
 * Rate-limité via la RPC existante consume_api_rate_limit.
 */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { GUARDIAN_SYSTEM } from '../lib/guardianKnowledge.js'

const HOURLY_LIMIT = 10
const DAILY_LIMIT = 30
const MAX_MESSAGES = 12
const MAX_CHARS = 600

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (!xff) return null
  return xff.split(',')[0].trim().toLowerCase()
}

function hashIp(ip, secret) {
  return createHmac('sha256', secret).update('guardian:' + ip).digest('hex')
}

async function checkRateLimit(supabase, ipHash) {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: ipHash,
    p_endpoint: 'site_guardian',
    p_hourly_limit: HOURLY_LIMIT,
    p_daily_limit: DAILY_LIMIT,
  })
  if (error) throw new Error('Rate limit check failed')
  return data
}

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' })
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI
  if (!apiKey) {
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

  const ipHash = hashIp(clientIp, rateLimitSecret)

  try {
    const supabase = getSupabaseAdmin()
    const rl = await checkRateLimit(supabase, ipHash)
    if (!rl || !rl.allowed) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Trop de messages pour le moment. Merci de réessayer plus tard.',
      })
    }
  } catch {
    return res.status(503).json({ error: 'Le Gardien est temporairement indisponible.' })
  }

  const { history } = req.body || {}

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Historique manquant.' })
  }
  if (history.length > MAX_MESSAGES) {
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
    if (content.length > MAX_CHARS) {
      return res.status(400).json({ error: `Message trop long (maximum ${MAX_CHARS} caractères).` })
    }
    validatedHistory.push({ role: msg.role, content })
  }

  const model = process.env.OPENAI_GUARDIAN_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-5-mini'

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      console.error('[guardian-chat] OpenAI error', 'status=' + response.status)
      return res.status(502).json({ error: 'Le Gardien est momentanément indisponible. Réessayez dans quelques instants.' })
    }

    const data = await response.json()
    const reply = textFromResponse(data)

    if (!reply) {
      return res.status(502).json({ error: 'Le Gardien n\'a pas pu formuler de réponse.' })
    }

    return res.status(200).json({ reply })
  } catch (err) {
    console.error('[guardian-chat] Network error:', err?.name || 'Error')
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans quelques instants.' })
  }
}
