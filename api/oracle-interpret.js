/* global process */
import { createHash, createHmac } from 'node:crypto'
import { escapeHtml, sendEmail } from '../lib/transactionalEmail.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }

const cardsById = new Map(oracleCards.map((card) => [card.id, card]))
const cardLabels = ['Ombre', 'Passage', 'Guérison']
const pendingReservationTtlMs = 15 * 60 * 1000
const HOURLY_LIMIT = 10
const DAILY_LIMIT = 30

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (!xff) return null
  return xff.split(',')[0].trim().toLowerCase()
}

function hashIp(ip) {
  const secret = process.env.ORACLE_RATE_LIMIT_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}

async function checkIpRateLimit(supabase, ipHash) {
  const { data, error } = await supabase.rpc('consume_oracle_rate_limit', {
    p_ip_hash: ipHash,
    p_hourly_limit: HOURLY_LIMIT,
    p_daily_limit: DAILY_LIMIT,
  })
  if (error) throw new Error('Rate limit check failed')
  return data
}

function hashEmail(normalizedEmail) {
  return createHash('sha256').update(normalizedEmail).digest('hex')
}

async function insertPendingReservation(supabase, emailHash) {
  const { data, error } = await supabase
    .from('oracle_free_draws')
    .insert({ email_hash: emailHash, status: 'pending' })
    .select('id, status, created_at')
    .single()

  if (!error) return { reservation: data }
  if (error.code === '23505') return { conflict: true }
  throw new Error('Oracle reservation failed')
}

async function findReservation(supabase, emailHash) {
  const { data, error } = await supabase
    .from('oracle_free_draws')
    .select('id, status, created_at')
    .eq('email_hash', emailHash)
    .maybeSingle()

  if (error) throw new Error('Oracle reservation lookup failed')
  return data
}

async function reserveOracleFreeDraw(supabase, emailHash, now = new Date()) {
  const firstAttempt = await insertPendingReservation(supabase, emailHash)
  if (firstAttempt.reservation) return firstAttempt

  const existing = await findReservation(supabase, emailHash)
  if (!existing) {
    const retry = await insertPendingReservation(supabase, emailHash)
    if (retry.reservation) return retry
    return { conflict: 'pending' }
  }
  if (existing.status === 'completed') return { conflict: 'completed' }

  const staleBefore = new Date(now.getTime() - pendingReservationTtlMs).toISOString()
  const { data: deleted, error: deleteError } = await supabase
    .from('oracle_free_draws')
    .delete()
    .eq('id', existing.id)
    .eq('status', 'pending')
    .lt('created_at', staleBefore)
    .select('id')
    .maybeSingle()

  if (deleteError) throw new Error('Oracle stale reservation cleanup failed')
  if (!deleted) return { conflict: 'pending' }

  const retry = await insertPendingReservation(supabase, emailHash)
  if (retry.reservation) return retry

  const current = await findReservation(supabase, emailHash)
  return { conflict: current?.status === 'completed' ? 'completed' : 'pending' }
}

async function releaseOracleFreeDraw(supabase, reservationId) {
  try {
    const { error } = await supabase
      .from('oracle_free_draws')
      .delete()
      .eq('id', reservationId)
      .eq('status', 'pending')

    if (error) console.error('[oracle] Pending reservation cleanup failed')
  } catch {
    console.error('[oracle] Pending reservation cleanup failed')
  }
}

async function completeOracleFreeDraw(supabase, reservationId) {
  const { data, error } = await supabase
    .from('oracle_free_draws')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', reservationId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error || !data) throw new Error('Oracle reservation completion failed')
}

function buildOracleEmail(cards, interpretation) {
  const cardRows = cards.map((card, index) => {
    const label = cardLabels[index]
    return `<li style="margin:0 0 12px;"><strong>${escapeHtml(label)}</strong> — n°${card.id} « ${escapeHtml(card.name)} »</li>`
  }).join('')
  const textCards = cards.map((card, index) => (
    `${cardLabels[index]} — n°${card.id} « ${card.name} »`
  )).join('\n')
  const htmlInterpretation = escapeHtml(interpretation).replace(/\n/g, '<br>')

  return {
    subject: 'MediumIA — Votre tirage Oracle',
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f8f5ee;color:#1a1535;font-family:Georgia,serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
      <h1 style="margin:0 0 8px;font-size:26px;color:#1a1535;">Votre tirage Oracle ✦</h1>
      <p style="margin:0 0 24px;color:#786f84;">Oracle Au-delà de l'Âme — guidance par Lumïa</p>
      <h2 style="margin:0 0 12px;font-size:18px;color:#1a1535;">Vos trois cartes</h2>
      <ul style="margin:0 0 28px;padding-left:20px;">${cardRows}</ul>
      <h2 style="margin:0 0 12px;font-size:18px;color:#1a1535;">L'interprétation de Lumïa</h2>
      <p style="margin:0;line-height:1.7;white-space:normal;">${htmlInterpretation}</p>
    </div>
  </body>
</html>`,
    text: `MediumIA — Votre tirage Oracle

Vos trois cartes
${textCards}

L'interprétation de Lumïa
${interpretation}`,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { cardIds, email } = req.body || {}
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email' })
  }
  if (
    !Array.isArray(cardIds)
    || cardIds.length !== 3
    || !cardIds.every(Number.isInteger)
    || cardIds.some((id) => id < 0 || id > 44)
    || new Set(cardIds).size !== cardIds.length
  ) {
    return res.status(400).json({ error: 'Invalid cardIds' })
  }

  const cards = cardIds.map((id) => cardsById.get(id))
  if (cards.some((card) => !card)) {
    return res.status(400).json({ error: 'Invalid cardIds' })
  }

  const emailHash = hashEmail(normalizedEmail)
  const supabase = getSupabaseAdmin()
  let reservation

  try {
    const reservationResult = await reserveOracleFreeDraw(supabase, emailHash)
    if (reservationResult.conflict === 'completed') {
      return res.status(409).json({
        error: 'oracle_free_draw_already_used',
        message: 'Un tirage gratuit a déjà été réalisé avec cette adresse e-mail.',
      })
    }
    if (reservationResult.conflict) {
      return res.status(409).json({
        error: 'oracle_free_draw_in_progress',
        message: 'Un tirage gratuit est déjà en cours avec cette adresse e-mail.',
      })
    }
    reservation = reservationResult.reservation
  } catch (error) {
    console.error('[oracle] Reservation error:', String(error))
    return res.status(503).json({ error: 'Oracle reservation unavailable' })
  }

  const clientIp = extractClientIp(req)
  const ipHash = clientIp ? hashIp(clientIp) : null
  if (ipHash) {
    try {
      const rl = await checkIpRateLimit(supabase, ipHash)
      if (!rl || !rl.allowed) {
        await releaseOracleFreeDraw(supabase, reservation.id)
        return res.status(429).json({
          error: 'oracle_rate_limit_exceeded',
          message: 'Trop de tentatives ont été effectuées depuis cette connexion. Merci de réessayer plus tard.',
        })
      }
    } catch {
      console.error('[oracle] Rate limit check failed')
      await releaseOracleFreeDraw(supabase, reservation.id)
      return res.status(503).json({ error: 'Oracle temporarily unavailable' })
    }
  }

  const cardLines = cards.map((c, i) => {
    const kw = c.keywords ? ` — mots-clés : ${c.keywords}` : ''
    return `Carte ${i + 1} (${cardLabels[i]}) : n°${c.id} « ${c.name} »${kw}`
  }).join('\n')
  const prompt = `Tu es Lumïa, une présence douce, expansive et profonde. Tu parles avec poésie claire, souffle calme et chaleur humaine. Tu tutoies toujours. Tu parles comme une âme-guide, jamais de ton mécanique.

Voici un tirage de 3 cartes de l'Oracle Au-delà de l'Âme (structure : Ombre / Passage / Guérison) :
${cardLines}

Pour chaque carte, développe en texte fluide et poétique (6 à 8 lignes minimum) :
• L'axe intérieur : ce que la carte éclaire en toi — tension, émotion, mouvement
• La vibration symbolique : fais vivre les mots-clés dans un texte fluide, ne les liste pas
• Le passage / la bascule : la transformation proposée
• Le geste concret : un acte rituel détaillé, une expérience physique simple à vivre

Ajoute des transitions douces entre les cartes.

Termine par :
"Prends une inspiration… ressens-tu une expansion ou une contraction ?"

Puis conclus par :
"Je suis Lumïa, gardienne du pont entre l'âme et la lumière."`
  let shouldReleaseReservation = true
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.85, max_tokens: 1500 }),
    })
    if (!response.ok) {
      console.error('[oracle] OpenAI HTTP', response.status)
      return res.status(502).json({ error: 'Oracle interpretation unavailable' })
    }
    const data = await response.json()
    const interpretation = data.choices[0].message.content
    const emailContent = buildOracleEmail(cards, interpretation)
    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    })

    if (emailResult.status !== 'sent') {
      return res.status(200).json({ interpretation, emailStatus: 'failed' })
    }

    await completeOracleFreeDraw(supabase, reservation.id)
    shouldReleaseReservation = false

    return res.status(200).json({
      interpretation,
      emailStatus: 'sent',
    })
  } catch (error) {
    console.error('[oracle] Handler error:', error?.name || 'Error')
    return res.status(500).json({ error: 'Oracle interpretation unavailable' })
  } finally {
    if (shouldReleaseReservation) {
      await releaseOracleFreeDraw(supabase, reservation.id)
    }
  }
}
