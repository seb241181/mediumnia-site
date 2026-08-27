/* global process */
import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }

const cardsById = new Map(oracleCards.map((card) => [card.id, card]))

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { cardIds } = req.body || {}
  if (
    !Array.isArray(cardIds)
    || cardIds.length !== 3
    || !cardIds.every(Number.isInteger)
    || cardIds.some((id) => id < 0 || id > 44)
  ) {
    return res.status(400).json({ error: 'Invalid cardIds' })
  }

  const cards = cardIds.map((id) => cardsById.get(id))
  if (cards.some((card) => !card)) {
    return res.status(400).json({ error: 'Invalid cardIds' })
  }

  const cardLines = cards.map((c, i) => {
    const labels = ['Ombre', 'Passage', 'Guérison']
    const kw = c.keywords ? ` — mots-clés : ${c.keywords}` : ''
    return `Carte ${i + 1} (${labels[i]}) : n°${c.id} « ${c.name} »${kw}`
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
    return res.status(200).json({ interpretation: data.choices[0].message.content })
  } catch (error) {
    console.error('Handler error:', String(error))
    return res.status(500).json({ error: 'Failed', detail: String(error) })
  }
}
