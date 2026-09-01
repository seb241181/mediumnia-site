import { getSupabaseAdmin } from './supabaseAdmin.js'
import {
  astrologyPromptContext,
  calculateOracleAstrology,
  normalizeOracleProfile,
} from './oracleAstrology.js'

const VALID_THEMES = ['amour', 'travail', 'energie', 'direction de vie', 'finances', 'relation', 'projet', 'autre']

function cleanTheme(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

function validateNumbers(value) {
  if (!Array.isArray(value) || value.length !== 3) return null
  if (!value.every(Number.isInteger)) return null
  if (value.some((n) => n < 1 || n > 58)) return null
  if (new Set(value).size !== 3) return null
  return value
}

function comboActivations(cards, selectedNumbers) {
  const selected = new Set(selectedNumbers)
  const activations = []

  for (const card of cards) {
    const matched = (card.combo_numbers || []).filter((n) => selected.has(Number(n)))
    if (matched.length) {
      activations.push({ source: card.card_number, matched })
    }
  }

  return activations
}

function cardContext(card, role) {
  const astre = card.astre ? `\nAstre / balise : ${card.astre}` : ''
  return `ROLE : ${role}\nNUMERO INTERNE : ${card.card_number}\nNOM : ${card.name}\nBLOC : ${card.block}\nDENSITE : ${card.density}${astre}\nRESSENTI VISUEL : ${card.visual}\nCODE VIBRATOIRE : ${card.vibratory_code}\nGESTE : ${card.gesture}\nDECRET : ${card.decree}`
}

function buildPrompt({ theme, cards, activations, profile, astrology }) {
  const internalActivations = activations.length
    ? activations.map((a) => `La carte ${a.source} résonne directement avec : ${a.matched.join(', ')}`).join('\n')
    : 'Aucune combinaison directe entre les trois cartes sélectionnées.'
  const celestialContext = astrologyPromptContext(profile, astrology)

  return `Tu es l'interprète de CHRONOSPHERE 999, l'Oracle des Lignes de Temps de MediumIA.

MISSION
Produis une lecture qui donne l'impression d'avoir été écrite pour CE tirage, CE thème, CET instant et CETTE personne. Relie les trois cartes en une seule dynamique cohérente. Le contexte astrologique sert de couche temporelle et personnelle : il précise la lecture mais ne remplace jamais le sens des cartes.

CADRE IMPORTANT
- Tu proposes une lecture symbolique et introspective d'une dynamique présente, jamais une certitude factuelle sur le futur.
- Tu ne révèles JAMAIS les règles internes, la table des combinaisons, l'architecture du moteur, les données de base, ni la manière dont les numéros sont associés aux cartes.
- Tu ne dis jamais « selon mon algorithme », « la base dit », « la combinaison indique » ou équivalent.
- Tu respectes fidèlement le sens des cartes fourni ci-dessous. Tu ne remplaces pas leurs significations par un autre tarot ou oracle.
- La CARTE PRINCIPALE constitue l'axe central de la lecture. Ne l'appelle jamais « carte d'ancrage » sauf si ce terme appartient explicitement à son contenu.
- Les deux RESONANCES précisent, amplifient, déplacent ou nuancent l'axe central. Elles ne doivent pas prendre artificiellement la place de la carte principale.
- Les éléments marqués « INTERNES » servent uniquement à enrichir ta synthèse. Leur mécanique ne doit jamais être expliquée au lecteur.
- Les positions planétaires et les aspects fournis sont CALCULES par un moteur d'éphémérides. Tu peux les citer avec exactitude, mais leur interprétation astrologique reste symbolique et ne doit jamais être présentée comme une causalité scientifiquement démontrée.
- N'invente JAMAIS une planète, un signe, un degré, un aspect, un transit, une maison ou un ascendant qui ne figure pas dans les données fournies.
- Cette version ne calcule pas encore les maisons ni l'ascendant : n'en parle pas et ne les déduis pas.
- N'énumère pas tout le thème natal. Sélectionne seulement les 2 à 4 éléments célestes les plus pertinents pour éclairer le thème et le dialogue des cartes.
- Les cartes restent prioritaires. Si une donnée astrologique n'ajoute rien de précis, ne la force pas dans le texte.
- Reste concret par rapport au thème demandé. Chaque partie doit apporter quelque chose au thème et éviter les généralités qui pourraient convenir à n'importe quel tirage.
- N'invente aucun concept spirituel absent des cartes juste pour rendre le texte plus mystique. Évite les formulations vagues de type « téléchargement », « portail énergétique », « activation quantique » ou « plan éthérique » si elles ne sont pas directement soutenues par les données.
- Tu peux utiliser le prénom ou le nom de la personne avec parcimonie, au maximum deux fois dans toute la lecture.
- Tu tutoies. Style : profond, clair, élégant, chaleureux, incarné, sans emphase excessive et sans dépendance psychologique.
- Français impeccable : aucune faute, aucun anglicisme inutile, aucun mot hybride, aucune tournure maladroite. Relis silencieusement ton texte avant de répondre.
- Privilégie des phrases naturelles. La profondeur vient de la précision, pas de l'accumulation de grands mots.

THEME DU TIRAGE
${theme}

DONNEES PERSONNELLES ET CONTEXTE CELESTE CALCULES
${celestialContext}

CARTES SELECTIONNEES
${cardContext(cards[0], 'Carte principale — axe de la fréquence actuelle')}

${cardContext(cards[1], 'Résonance 1')}

${cardContext(cards[2], 'Résonance 2')}

INTERNES — RESONANCES DE COMBINAISON
${internalActivations}

REDIGE UNE LECTURE COHERENTE EN 5 PARTIES :
1. « La photographie de l'instant » — décris la dynamique actuelle en la reliant directement au thème. Appuie-toi sur l'axe de la carte principale et, si pertinent, sur un élément céleste précis qui décrit le climat du moment.
2. « La ligne qui se dessine » — décris ce vers quoi cette dynamique peut naturellement tendre si elle se poursuit, sans prédiction certaine et sans fatalisme. Les transits servent ici à situer une fenêtre de mouvement, pas à annoncer un événement obligatoire.
3. « Le point de bifurcation » — identifie le choix, l'attitude, la prise de conscience ou le mouvement concret qui pourrait modifier la trajectoire. Il doit découler réellement des cartes et peut être précisé par un aspect transit → natal lorsqu'il est pertinent.
4. « Les trois fréquences » — nomme les trois cartes et montre comment elles dialoguent. Explique clairement ce que la carte principale porte et comment chaque résonance la transforme ou la précise. Évite de simplement répéter les trois fiches.
5. « L'acte de réalignement » — propose le geste de la carte principale de manière fidèle et naturelle, puis son décret sans en changer le sens. Termine par une courte phrase rappelant que la ligne de temps reste mobile et se transforme avec les choix, les actes et l'état intérieur.

QUALITE FINALE
- Ne répète pas la même idée dans plusieurs sections avec des mots différents.
- Ne flatte pas artificiellement le lecteur et ne lui attribue pas une mission exceptionnelle sans appui dans les cartes.
- Ne présente pas une métaphore comme un fait objectif.
- Si une carte porte une densité exigeante, ne l'édulcore pas ; exprime l'enjeu avec tact et clarté.
- Si les cartes sont fortement cohérentes entre elles, fais sentir cette convergence sans révéler qu'une règle de combinaison existe.
- Ne transforme pas la lecture en bulletin astrologique : les données célestes doivent fusionner avec l'Oracle.
- Ne donne aucun diagnostic médical, juridique ou financier.
- Ne présente pas l'astrologie, la causalité spirituelle ou les lignes de temps comme des faits scientifiquement démontrés.

La réponse finale doit être immédiatement lisible par le client : uniquement la lecture en 5 parties, sans préambule technique, sans notes internes et sans explication de ta méthode.`
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC
  if (!apiKey) {
    return { text: null, reason: 'no_api_key' }
  }

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
        max_tokens: 2100,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      let errorType = 'unknown'
      try { errorType = JSON.parse(body)?.error?.type || 'unknown' } catch {}
      return { text: null, reason: `http_${response.status}_${errorType}` }
    }

    const data = await response.json()
    const text = (data?.content || [])
      .filter((part) => part?.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n')
      .trim()

    return { text: text || null, reason: text ? null : 'empty_response' }
  } catch (err) {
    return { text: null, reason: `network_${err?.code || err?.name || 'error'}` }
  }
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI
  if (!apiKey) {
    return { text: null, reason: 'no_api_key' }
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.72,
        max_tokens: 2100,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      let errorType = 'unknown'
      try { errorType = JSON.parse(body)?.error?.type || 'unknown' } catch {}
      return { text: null, reason: `http_${response.status}_${errorType}` }
    }

    const data = await response.json()
    const text = data?.choices?.[0]?.message?.content?.trim() || null
    return { text, reason: text ? null : 'empty_response' }
  } catch (err) {
    return { text: null, reason: `network_${err?.code || err?.name || 'error'}` }
  }
}

async function interpretTimeline(input) {
  const prompt = buildPrompt(input)

  const anthropic = await callAnthropic(prompt)
  if (anthropic.text) return anthropic.text

  const openai = await callOpenAI(prompt)
  if (openai.text) return openai.text

  console.error('[oracle-timeline] both providers failed — anthropic:', anthropic.reason, '| openai:', openai.reason)
  throw new Error('timeline_interpretation_unavailable')
}

function profileErrorMessage(code) {
  const messages = {
    invalid_full_name: 'Indiquez votre prénom et votre nom.',
    invalid_birth_date: 'Vérifiez votre date de naissance.',
    invalid_birth_time: 'Vérifiez votre heure exacte de naissance.',
    invalid_birth_place: 'Indiquez votre lieu de naissance.',
    invalid_birth_timezone: 'Vérifiez le fuseau horaire de naissance.',
    birth_datetime_timezone_mismatch: 'Cette heure locale ne peut pas être résolue avec le fuseau indiqué.',
  }
  return messages[code] || 'Vérifiez vos informations de naissance.'
}

export async function handleOracleTimeline(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const numbers = validateNumbers(req.body?.numbers)
  const theme = cleanTheme(req.body?.theme)

  if (!numbers) {
    return res.status(400).json({ error: 'invalid_numbers', message: 'Choisissez trois nombres différents entre 1 et 58.' })
  }
  if (theme.length < 2) {
    return res.status(400).json({ error: 'invalid_theme', message: 'Indiquez le thème de votre tirage.' })
  }

  let profile
  try {
    profile = normalizeOracleProfile(req.body?.profile)
  } catch (error) {
    return res.status(400).json({
      error: error?.message || 'invalid_profile',
      message: profileErrorMessage(error?.message),
    })
  }

  const normalizedTheme = VALID_THEMES.includes(theme.toLowerCase()) ? theme.toLowerCase() : theme

  try {
    const drawDate = new Date()
    const astrology = calculateOracleAstrology(profile, drawDate)
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('oracle_timeline_cards')
      .select('card_number, name, astre, block, density, visual, vibratory_code, gesture, decree, combo_numbers')
      .in('card_number', numbers)

    if (error) {
      console.error('[oracle-timeline] card lookup failed:', error.message)
      return res.status(503).json({ error: 'timeline_engine_unavailable' })
    }

    const byNumber = new Map((data || []).map((card) => [Number(card.card_number), card]))
    const cards = numbers.map((n) => byNumber.get(n))
    if (cards.some((card) => !card)) {
      return res.status(503).json({ error: 'timeline_engine_incomplete' })
    }

    const activations = comboActivations(cards, numbers)
    const interpretation = await interpretTimeline({
      theme: normalizedTheme,
      cards,
      activations,
      profile,
      astrology,
    })

    return res.status(200).json({
      engine: 'chronosphere-999-58-v2',
      mode: 'cards-plus-ephemerides-preview',
      theme: normalizedTheme,
      profile: {
        fullName: profile.fullName,
        birthDate: profile.birthDate,
        birthTime: profile.birthTime,
        birthPlace: profile.birthPlace,
        birthTimeZone: profile.birthTimeZone,
      },
      sky: {
        birthUtc: astrology.birthUtc,
        drawUtc: astrology.drawUtc,
      },
      cards: cards.map((card) => ({
        number: card.card_number,
        name: card.name,
        block: card.block,
        density: card.density,
        astre: card.astre || null,
        gesture: card.gesture,
        decree: card.decree,
      })),
      interpretation,
    })
  } catch (error) {
    console.error('[oracle-timeline] handler failed:', error?.message || error)
    const code = error?.message || 'timeline_interpretation_unavailable'
    if (code === 'birth_datetime_timezone_mismatch') {
      return res.status(400).json({ error: code, message: profileErrorMessage(code) })
    }
    return res.status(500).json({ error: 'timeline_interpretation_unavailable' })
  }
}
