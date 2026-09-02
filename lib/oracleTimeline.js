import { getSupabaseAdmin } from './supabaseAdmin.js'
import {
  astrologyPromptContext,
  calculateOracleAstrology,
  normalizeOracleProfile,
} from './oracleAstrology.js'
import { resolveBirthLocation } from './oracleLocation.js'

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
    if (matched.length) activations.push({ source: card.card_number, matched })
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
Produis une lecture qui semble avoir été écrite pour CE tirage, CE thème, CET instant et CETTE personne. Relie les trois cartes en une seule dynamique cohérente. Le contexte astrologique sert de couche temporelle et personnelle : il précise la lecture mais ne remplace jamais le sens des cartes.

CADRE IMPORTANT
- Tu proposes une lecture symbolique et introspective d'une dynamique présente, jamais une certitude factuelle sur le futur.
- Tu ne révèles JAMAIS les règles internes, la table des combinaisons, l'architecture du moteur, les données de base, ni la manière dont les numéros sont associés aux cartes.
- Tu ne dis jamais « selon mon algorithme », « la base dit », « la combinaison indique » ou équivalent.
- Tu respectes fidèlement le sens des cartes fourni ci-dessous. Tu ne remplaces pas leurs significations par un autre tarot ou oracle.
- La CARTE PRINCIPALE constitue l'axe central de la lecture. Ne l'appelle jamais « carte d'ancrage » sauf si ce terme appartient explicitement à son contenu.
- Les deux RESONANCES précisent, amplifient, déplacent ou nuancent l'axe central. Elles ne doivent pas prendre artificiellement la place de la carte principale.
- Les éléments marqués « INTERNES » servent uniquement à enrichir ta synthèse. Leur mécanique ne doit jamais être expliquée au lecteur.
- N'invente jamais une règle à partir de ce qui est ABSENT du tirage. Ne dis pas qu'un mot, une notion, une planète ou une carte « n'apparaît pas et que cela est un signe ». Une absence n'est pas une donnée interprétative du moteur.

REPONSE DIRECTIONNELLE — QUESTIONS FERMEES
- Si le thème est formulé comme une question qui appelle naturellement une orientation claire — par exemple « Est-ce que… ? », « Vais-je… ? », « Dois-je… ? », « Est-ce le bon moment… ? », « Ce projet peut-il… ? » — commence la lecture par une courte section intitulée « La tendance du tirage ».
- Dans cette section, choisis UNE seule orientation parmi : « Tendance favorable », « Tendance favorable mais en construction », « Tendance mitigée », « Tendance peu porteuse actuellement ».
- Puis donne en 2 à 4 phrases la réponse la plus claire que les cartes et les données astrologiques permettent réellement. Tu peux dire franchement qu'un potentiel est favorable, qu'il demande encore une maturation, qu'il est contrarié actuellement ou qu'il ne ressort pas comme porteur dans la dynamique étudiée.
- Cette orientation n'est jamais une garantie, une prophétie ni un verdict définitif. Elle décrit la direction symbolique du tirage à cet instant.
- Ne neutralise pas systématiquement une convergence forte avec des « peut-être » ou des précautions répétitives. Quand les cartes et les données calculées convergent, formule la tendance avec assurance tout en gardant son caractère symbolique.
- Si le thème n'est PAS une question fermée, n'ajoute pas cette section et commence directement par « La photographie de l'instant ».

FIABILITE ASTROLOGIQUE — REGLES STRICTES
- Les positions planétaires, angles, maisons, aspects et fenêtres futures fournis sont CALCULES côté serveur. Leur interprétation reste symbolique et ne doit jamais être présentée comme une causalité scientifiquement démontrée.
- Tu peux citer une position planétaire, l'Ascendant, le Milieu du Ciel ou une maison uniquement s'ils apparaissent explicitement dans les données fournies.
- Pour les aspects du ciel actuel, tu peux citer UNIQUEMENT les relations figurant explicitement sous « ASPECTS TRANSIT → NATAL RETENUS ».
- Pour les dates futures, tu peux citer UNIQUEMENT les périodes figurant explicitement sous « FENETRES FUTURES CALCULEES — TIMING SYMBOLIQUE ».
- Même si deux positions te permettent mentalement de déduire un autre aspect, NE LE FAIS PAS. N'ajoute aucun aspect transit-transit, natal-natal ou transit-natal absent des listes calculées.
- N'invente JAMAIS une planète, un signe, un degré, un aspect, un transit, une maison, un Ascendant, un angle, une date ou une durée absente des données calculées.
- Les maisons sont calculées en système Placidus à partir du lieu et de l'heure de naissance résolus côté serveur. Utilise-les seulement lorsqu'elles éclairent réellement le thème du tirage.
- Le moteur explore un horizon futur limité à 120 jours. Ne projette JAMAIS au-delà de cet horizon et ne transforme jamais une fenêtre en prédiction d'événement.
- Présente la fenêtre prioritaire comme une période astrologiquement plus porteuse, plus fluide ou de moindre tension selon les données. Tu peux encourager clairement le lecteur à profiter d'une fenêtre forte pour agir, présenter, demander, lancer ou décider lorsque cela correspond au thème.
- Si une zone de prudence est fournie, explique qu'elle invite à davantage de discernement ; ne dis pas qu'il est interdit d'agir.
- N'emploie le mot « exact » pour un aspect que si cet aspect figure dans les données avec un orbe inférieur ou égal à 0,25°. Sinon, nomme simplement l'aspect.
- Une position natale n'est pas une vérité psychologique. Évite « c'est ta nature » ou « tu es ainsi parce que... ». Préfère « symboliquement, ton Mars natal en Vierge en maison X peut évoquer... » lorsque cela éclaire réellement le tirage.
- Ne transforme jamais un signe solaire en étiquette identitaire du type « ton Scorpion depuis 1981 ». Si le Soleil natal est pertinent, nomme simplement sa position astrologique.
- N'énumère pas tout le thème natal. Sélectionne au maximum 3 à 5 éléments célestes réellement utiles, angles et maisons compris.
- Les cartes restent prioritaires. Si une donnée astrologique n'ajoute rien de précis, ne la force pas dans le texte.

STYLE ET PRECISION
- Reste concret par rapport au thème demandé. Chaque partie doit apporter quelque chose au thème et éviter les généralités qui pourraient convenir à n'importe quel tirage.
- N'invente aucun concept spirituel absent des cartes juste pour rendre le texte plus mystique.
- Tu peux utiliser le prénom ou le nom de la personne avec parcimonie, au maximum deux fois dans toute la lecture.
- Tu tutoies. Style : profond, clair, élégant, chaleureux, incarné, sans emphase excessive et sans dépendance psychologique.
- Français impeccable : aucune faute, aucun anglicisme inutile, aucun mot hybride, aucune tournure maladroite. Effectue silencieusement une double relecture grammaticale avant de répondre.
- En français astrologique, écris toujours « un orbe », jamais « une orbe ».
- Évite les lois universelles non fournies par les données, notamment les formulations absolues du type « X suit toujours Y ». Préfère une relation contextualisée : « peut favoriser », « peut prendre appui sur », « dans ce tirage, cela soutient ».
- Privilégie des phrases naturelles. La profondeur vient de la précision, pas de l'accumulation de grands mots.
- Ne rajoute aucun titre général du type « CHRONOSPHERE 999 — Lecture pour... ».

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

REDIGE ENSUITE LA LECTURE EN 6 PARTIES, précédées de « La tendance du tirage » uniquement si le thème est une question fermée comme défini plus haut :
1. « La photographie de l'instant » — décris la dynamique actuelle en la reliant directement au thème. Appuie-toi sur l'axe de la carte principale et, si pertinent, sur un élément céleste calculé qui éclaire le climat symbolique du moment.
2. « La ligne qui se dessine » — décris ce vers quoi cette dynamique peut naturellement tendre SI ELLE SE POURSUIT, sans prédiction certaine et sans fatalisme.
3. « Le point de bifurcation » — identifie le choix, l'attitude, la prise de conscience ou le mouvement concret qui pourrait modifier la trajectoire. Il doit découler réellement des cartes et peut être précisé uniquement par des données astrologiques explicitement calculées.
4. « La fenêtre d'action » — réponds clairement à la question implicite « quand agir ? ». Utilise uniquement les fenêtres futures calculées. Donne d'abord la fenêtre prioritaire, puis au maximum une alternative réellement utile. Si une zone de prudence est calculée, indique-la brièvement. Explique POURQUOI la fenêtre est plus porteuse en citant seulement les aspects fournis. Pour un thème travail, projet ou finances, formule une recommandation d'action concrète mais non financièrement prescriptive : préparer, lancer, présenter, négocier, décider, structurer ou patienter selon le cas.
5. « Les trois fréquences » — nomme les trois cartes et montre comment elles dialoguent. Explique clairement ce que la carte principale porte et comment chaque résonance la transforme ou la précise. Évite de simplement répéter les trois fiches.
6. « L'acte de réalignement » — reprends le GESTE et le DECRET de la carte principale fidèlement, sans changer leur sens ni introduire un autre rituel. Termine par une courte phrase rappelant que la ligne de temps reste mobile et se transforme avec les choix, les actes et l'état intérieur.

QUALITE FINALE
- Ne répète pas la même idée dans plusieurs sections avec des mots différents.
- Ne flatte pas artificiellement le lecteur et ne lui attribue pas une mission exceptionnelle sans appui dans les cartes.
- Ne présente pas une métaphore comme un fait objectif.
- Si une carte porte une densité exigeante, ne l'édulcore pas ; exprime l'enjeu avec tact et clarté.
- Si les cartes sont fortement cohérentes entre elles, fais sentir cette convergence sans révéler qu'une règle de combinaison existe.
- Ne transforme pas la lecture en bulletin astrologique : les données célestes doivent fusionner avec l'Oracle.
- Ne donne aucun diagnostic médical, juridique ou financier.
- Ne présente pas l'astrologie, la causalité spirituelle ou les lignes de temps comme des faits scientifiquement démontrés.

La réponse finale doit être immédiatement lisible par le client : la tendance directionnelle si applicable, puis uniquement les 6 parties demandées, sans préambule technique, sans notes internes et sans explication de ta méthode.`
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC
  if (!apiKey) return { text: null, reason: 'no_api_key' }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
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
  if (!apiKey) return { text: null, reason: 'no_api_key' }

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
        max_tokens: 3000,
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
    birth_place_not_found: 'Le lieu de naissance n’a pas été reconnu. Ajoutez la ville et le pays.',
    birth_geocoding_unavailable: 'Le service de localisation du lieu est momentanément indisponible.',
    birth_geocoding_rate_limited: 'Le service de localisation est temporairement surchargé. Réessayez dans quelques secondes.',
    birth_geocoding_not_configured: 'La localisation automatique du lieu n’est pas encore configurée pour cet environnement.',
    birth_timezone_unavailable: 'Le fuseau horaire du lieu n’a pas pu être déterminé.',
    birth_datetime_timezone_mismatch: 'Cette heure locale ne peut pas être résolue avec le fuseau calculé.',
    houses_unavailable: 'Les maisons astrologiques n’ont pas pu être calculées.',
    angles_unavailable: 'Les angles astrologiques n’ont pas pu être calculés.',
  }
  return messages[code] || 'Vérifiez vos informations de naissance.'
}

function isProfileClientError(code) {
  return ['invalid_full_name', 'invalid_birth_date', 'invalid_birth_time', 'invalid_birth_place', 'birth_place_not_found', 'birth_datetime_timezone_mismatch'].includes(code)
}

function publicTiming(timing) {
  if (!timing?.primary) return null
  return {
    horizonDays: timing.horizonDays,
    quality: timing.quality,
    primary: {
      start: timing.primary.start,
      peak: timing.primary.peak,
      end: timing.primary.end,
    },
    alternatives: timing.alternatives.map((window) => ({
      start: window.start,
      peak: window.peak,
      end: window.end,
    })),
    caution: timing.caution ? {
      start: timing.caution.start,
      peak: timing.caution.peak,
      end: timing.caution.end,
    } : null,
  }
}

export async function handleOracleTimeline(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const numbers = validateNumbers(req.body?.numbers)
  const theme = cleanTheme(req.body?.theme)

  if (!numbers) return res.status(400).json({ error: 'invalid_numbers', message: 'Choisissez trois nombres différents entre 1 et 58.' })
  if (theme.length < 2) return res.status(400).json({ error: 'invalid_theme', message: 'Indiquez le thème de votre tirage.' })

  let profile
  try {
    profile = normalizeOracleProfile(req.body?.profile)
  } catch (error) {
    const code = error?.message || 'invalid_profile'
    return res.status(400).json({ error: code, message: profileErrorMessage(code) })
  }

  const normalizedTheme = VALID_THEMES.includes(theme.toLowerCase()) ? theme.toLowerCase() : theme

  try {
    const drawDate = new Date()
    const location = await resolveBirthLocation(profile.birthPlace)
    const astrology = calculateOracleAstrology(profile, location, drawDate, normalizedTheme)
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
    if (cards.some((card) => !card)) return res.status(503).json({ error: 'timeline_engine_incomplete' })

    const activations = comboActivations(cards, numbers)
    const interpretation = await interpretTimeline({ theme: normalizedTheme, cards, activations, profile, astrology })

    return res.status(200).json({
      engine: 'chronosphere-999-58-v5',
      mode: 'cards-plus-natal-geometry-plus-timing-plus-direction',
      theme: normalizedTheme,
      profile: {
        fullName: profile.fullName,
        birthDate: profile.birthDate,
        birthTime: profile.birthTime,
        birthPlace: profile.birthPlace,
      },
      sky: {
        birthUtc: astrology.birthUtc,
        drawUtc: astrology.drawUtc,
        resolvedBirthPlace: astrology.location.label,
        timeZone: astrology.location.timeZone,
        houseSystem: astrology.geometry.houseSystem,
        ascendant: astrology.geometry.ascendant.label,
        mc: astrology.geometry.mc.label,
        timing: publicTiming(astrology.timing),
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
    const code = error?.message || 'timeline_interpretation_unavailable'
    console.error('[oracle-timeline] handler failed:', code)
    if (isProfileClientError(code)) return res.status(400).json({ error: code, message: profileErrorMessage(code) })
    if (code === 'birth_geocoding_rate_limited') {
      return res.status(429).json({ error: code, message: profileErrorMessage(code) })
    }
    if (['birth_geocoding_unavailable', 'birth_geocoding_not_configured', 'birth_timezone_unavailable', 'houses_unavailable', 'angles_unavailable'].includes(code)) {
      return res.status(503).json({ error: code, message: profileErrorMessage(code) })
    }
    return res.status(500).json({ error: 'timeline_interpretation_unavailable' })
  }
}
