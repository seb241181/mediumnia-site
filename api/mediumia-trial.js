/* global process */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { GUARDIAN_SYSTEM } from '../lib/guardianKnowledge.js'
import { sendEmail, escapeHtml } from '../lib/transactionalEmail.js'

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
        max_output_tokens: 1200,
        store: false,
        reasoning: { effort: 'low' },
      }),
    })

    if (!response.ok) {
      console.error('[guardian] OpenAI error', 'status=' + response.status)
      return res.status(502).json({ error: 'Le Gardien est momentanément indisponible. Réessayez dans quelques instants.' })
    }

    const data = await response.json()

    const incompleteReason = data.incomplete_details?.reason
    if (data.status) {
      console.info('[guardian] response status=%s incomplete_reason=%s output_tokens=%s reasoning_tokens=%s',
        data.status,
        incompleteReason || 'none',
        data.usage?.output_tokens ?? '?',
        data.usage?.output_tokens_details?.reasoning_tokens ?? '?',
      )
    }

    if (data.status === 'incomplete' && incompleteReason === 'max_output_tokens') {
      return res.status(200).json({
        reply: 'Un léger voile technique m\'empêche de vous répondre correctement. Pouvez-vous reformuler votre question en quelques mots ?',
      })
    }

    const reply = textFromOpenAIResponse(data)

    return res.status(200).json({
      reply: reply || 'Un léger voile technique m\'empêche de vous répondre correctement. Pouvez-vous reformuler votre question en quelques mots ?',
    })
  } catch (err) {
    console.error('[guardian] Network error:', err?.name || 'Error')
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez dans quelques instants.' })
  }
}

const VALID_NEEDS = [
  'Assistant IA pour mes clients',
  'Rendez-vous et organisation',
  'Communication / réseaux',
  'Documents et mémoire métier',
  'Automatisations',
  'Autre',
]

const WAITLIST_HOURLY = 3
const WAITLIST_DAILY = 10

async function handleProWaitlist(req, res) {
  const { firstName, email, activity, primaryNeed, message, consent, sourcePage, utmSource, utmMedium, utmCampaign } = req.body || {}

  if (typeof firstName !== 'string' || !firstName.trim() || firstName.trim().length > 80) {
    return res.status(400).json({ error: 'Prénom invalide.' })
  }
  if (typeof email !== 'string' || !email.trim() || email.trim().length > 254 || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide.' })
  }
  if (typeof activity !== 'string' || !activity.trim() || activity.trim().length > 120) {
    return res.status(400).json({ error: 'Activité invalide.' })
  }
  if (!VALID_NEEDS.includes(primaryNeed)) {
    return res.status(400).json({ error: 'Besoin principal invalide.' })
  }
  if (message != null && (typeof message !== 'string' || message.length > 1000)) {
    return res.status(400).json({ error: 'Message trop long.' })
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'Le consentement est obligatoire.' })
  }

  const rateLimitSecret = (process.env.TRIAL_RATE_LIMIT_SECRET || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(rateLimitSecret)) {
    return res.status(503).json({ error: 'Service temporairement indisponible.' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Service temporairement indisponible.' })
  }

  const clientIp = extractClientIp(req)
  if (!clientIp) {
    return res.status(503).json({ error: 'Service temporairement indisponible.' })
  }

  const ipHash = createHmac('sha256', rateLimitSecret).update('pro_waitlist:' + clientIp).digest('hex')

  const supabase = getSupabaseAdmin()

  try {
    const rl = await checkRateLimit(supabase, ipHash, 'pro_waitlist', WAITLIST_HOURLY, WAITLIST_DAILY)
    if (!rl || !rl.allowed) {
      return res.status(429).json({ error: 'Trop de demandes. Merci de réessayer plus tard.' })
    }
  } catch {
    return res.status(503).json({ error: 'Service temporairement indisponible.' })
  }

  const cleanFirst = firstName.trim().slice(0, 80)
  const cleanEmail = email.trim().slice(0, 254)
  const emailNormalized = cleanEmail.toLowerCase()
  const cleanActivity = activity.trim().slice(0, 120)
  const cleanMessage = message ? String(message).trim().slice(0, 1000) || null : null
  const cleanSource = typeof sourcePage === 'string' ? sourcePage.slice(0, 200) : null
  const cleanUtmSource = typeof utmSource === 'string' ? utmSource.slice(0, 200) : null
  const cleanUtmMedium = typeof utmMedium === 'string' ? utmMedium.slice(0, 200) : null
  const cleanUtmCampaign = typeof utmCampaign === 'string' ? utmCampaign.slice(0, 200) : null

  try {
    const { error: upsertError } = await supabase
      .from('pro_waitlist')
      .upsert({
        first_name: cleanFirst,
        email: cleanEmail,
        email_normalized: emailNormalized,
        activity: cleanActivity,
        primary_need: primaryNeed,
        message: cleanMessage,
        consent_at: new Date().toISOString(),
        source_page: cleanSource,
        utm_source: cleanUtmSource,
        utm_medium: cleanUtmMedium,
        utm_campaign: cleanUtmCampaign,
      }, { onConflict: 'email_normalized', ignoreDuplicates: false })

    if (upsertError) {
      console.error('[pro-waitlist] Upsert failed')
      return res.status(500).json({ error: 'Une erreur est survenue.' })
    }
  } catch {
    console.error('[pro-waitlist] DB error')
    return res.status(500).json({ error: 'Une erreur est survenue.' })
  }

  const ownerEmail = 'contact@mediumia.fr'
  const h = escapeHtml

  sendEmail({
    to: ownerEmail,
    subject: `Nouveau prospect MediumIA Pro — ${cleanActivity}`,
    html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:600px">
<h2 style="color:#C9A84C">Nouveau prospect MediumIA Pro</h2>
<p><strong>Prénom :</strong> ${h(cleanFirst)}</p>
<p><strong>Email :</strong> ${h(cleanEmail)}</p>
<p><strong>Activité :</strong> ${h(cleanActivity)}</p>
<p><strong>Besoin principal :</strong> ${h(primaryNeed)}</p>
${cleanMessage ? `<p><strong>Message :</strong> ${h(cleanMessage)}</p>` : ''}
${cleanSource ? `<p><strong>Source :</strong> ${h(cleanSource)}</p>` : ''}
${cleanUtmSource ? `<p><strong>UTM :</strong> ${h(cleanUtmSource)} / ${h(cleanUtmMedium || '')} / ${h(cleanUtmCampaign || '')}</p>` : ''}
</div>`,
    text: `Nouveau prospect MediumIA Pro\n\nPrénom : ${cleanFirst}\nEmail : ${cleanEmail}\nActivité : ${cleanActivity}\nBesoin : ${primaryNeed}\n${cleanMessage ? `Message : ${cleanMessage}\n` : ''}`,
  }).catch(() => {})

  sendEmail({
    to: cleanEmail,
    subject: 'Votre inscription à la liste prioritaire MediumIA Pro',
    html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:600px">
<h2 style="color:#C9A84C">MediumIA Pro — Liste prioritaire</h2>
<p>Bonjour ${h(cleanFirst)},</p>
<p>Votre demande d'accès prioritaire à MediumIA Pro est bien enregistrée.</p>
<p>Vous ferez partie des premiers professionnels informés de l'ouverture.</p>
<p style="color:#6f687c;font-size:13px;margin-top:24px">MediumIA · mediumia.fr</p>
</div>`,
    text: `Bonjour ${cleanFirst},\n\nVotre demande d'accès prioritaire à MediumIA Pro est bien enregistrée.\nVous ferez partie des premiers professionnels informés de l'ouverture.\n\nMediumIA · mediumia.fr`,
  }).catch(() => {})

  return res.status(200).json({ success: true })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { mode } = req.body || {}

  if (mode === 'guardian') {
    return handleGuardian(req, res)
  }

  if (mode === 'pro-waitlist') {
    return handleProWaitlist(req, res)
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
