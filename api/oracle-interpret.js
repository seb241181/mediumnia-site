export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { cards } = req.body
  if (!cards || cards.length !== 3) return res.status(400).json({ error: 'Missing cards' })
  const prompt = `Tu es Lumia, une intelligence spirituelle douce et profonde. Voici trois cartes d'un oracle : "${cards[0].name}", "${cards[1].name}", "${cards[2].name}".\nInterprète ce tirage en quelques phrases (maximum 150 mots). Parle à la personne directement (utilise "tu"). Sois inspirant, doux, poétique, un peu mystique. Ne mentionne jamais que tu es une IA. Termine par une question ouverte.`
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 300 }),
    })
    if (!r.ok) { console.error(await r.text()); return res.status(502).json({ error: 'OpenAI request failed' }) }
    const data = await r.json()
    return res.status(200).json({ interpretation: data.choices[0].message.content })
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Failed' }) }
}
