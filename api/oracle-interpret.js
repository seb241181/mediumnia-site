/* global process */
import { escapeHtml, sendEmail } from '../lib/transactionalEmail.js'
import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }

const cardsById = new Map(oracleCards.map((card) => [card.id, card]))
const cardLabels = ['Ombre', 'Passage', 'Guérison']

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
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.85, max_tokens: 1500 }),
    })
    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenAI error:', errText)
      return res.status(502).json({ error: 'OpenAI request failed', detail: errText })
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

    return res.status(200).json({
      interpretation,
      emailStatus: emailResult.status === 'sent' ? 'sent' : 'failed',
    })
  } catch (error) {
    console.error('Handler error:', String(error))
    return res.status(500).json({ error: 'Failed', detail: String(error) })
  }
}
