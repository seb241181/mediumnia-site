import { createHash } from 'node:crypto'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { normalizeDeliveryEmail, sendChronosphereEmail } from './chronosphereEmail.js'
import {
  astrologyPromptContext,
  calculateOracleAstrology,
  normalizeOracleProfile,
} from './oracleAstrology.js'
import {
  CHRONOSPHERE_ENGINE_VERSION,
  CHRONOSPHERE_SCHEMA_VERSION,
  extractChronosphereReadingJson,
  normalizeChronosphereReading,
  readingToInterpretation,
  validateChronosphereReading,
} from './chronosphereReading.js'
import { resolveBirthLocation } from './oracleLocation.js'
import { buildChronosphereMaxSnapshot } from './chronosphereMaxSnapshot.js'
import { compareChronosphereSnapshots, summarizeChronosphereLine } from './chronosphereMaxCompare.js'

const VALID_THEMES = ['amour', 'travail', 'energie', 'direction de vie', 'finances', 'relation', 'projet', 'autre']

function cleanTheme(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

async function authenticatedTimelineUser(req, supabase) {
  const header = String(req.headers?.authorization || '').trim()
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await supabase.auth.getUser(match[1])
  if (error || !data?.user?.id) return null
  return data.user
}

function cleanMaxTimelineTitle(value, fallback) {
  const title = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160)
  return title.length >= 2 ? title : String(fallback || 'Ma Ligne de Temps').slice(0, 160)
}

async function persistChronosphereMaxMemory({
  supabase,
  maxPack,
  maxUser,
  requestedTimelineId,
  requestedTimelineTitle,
  profile,
  normalizedTheme,
  drawId,
  result,
  sequenceNumber,
}) {
  if (!maxPack?.id || !maxUser?.id) throw new Error('max_memory_context_missing')

  await supabase.from('mediumia_profiles').upsert({
    user_id: maxUser.id,
    full_name: profile.fullName,
    birth_date: profile.birthDate,
    birth_time: profile.birthTime,
    birth_place: profile.birthPlace,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  let { data: timeline, error: timelineError } = await supabase.from('chronosphere_timelines')
    .select('id, title, theme, status, created_at, updated_at')
    .eq('user_id', maxUser.id)
    .eq('max_pack_id', maxPack.id)
    .maybeSingle()
  if (timelineError) throw new Error('max_timeline_lookup_failed')

  if (!timeline) {
    if (requestedTimelineId) throw new Error('max_timeline_mismatch')
    const { data: created, error: createError } = await supabase.from('chronosphere_timelines')
      .insert({
        user_id: maxUser.id,
        max_pack_id: maxPack.id,
        title: cleanMaxTimelineTitle(requestedTimelineTitle, normalizedTheme),
        theme: normalizedTheme,
        status: 'active',
        memory_consent_at: new Date().toISOString(),
      })
      .select('id, title, theme, status, created_at, updated_at')
      .single()
    if (createError || !created) throw new Error('max_timeline_create_failed')
    timeline = created
  }

  if (requestedTimelineId && requestedTimelineId !== timeline.id) throw new Error('max_timeline_mismatch')

  const { data: existing, error: existingError } = await supabase.from('chronosphere_timeline_entries')
    .select('id, sequence_number, read_at, snapshot_json, comparison_json')
    .eq('timeline_id', timeline.id)
    .eq('source_draw_table', 'chronosphere_pack_draws')
    .eq('source_draw_id', drawId)
    .maybeSingle()
  if (existingError) throw new Error('max_timeline_entry_lookup_failed')

  if (existing) {
    return {
      timelineId: timeline.id,
      timelineTitle: timeline.title,
      sequenceNumber: existing.sequence_number,
      comparison: existing.comparison_json || null,
      finalSynthesis: null,
    }
  }

  const sequence = Math.max(1, Math.min(3, Number(sequenceNumber) || 1))
  const snapshot = buildChronosphereMaxSnapshot(result, {
    sourceDrawTable: 'chronosphere_pack_draws',
    sourceDrawId: drawId,
    readAt: result.createdAt,
    theme: normalizedTheme,
  })

  let previous = null
  if (sequence > 1) {
    const { data: previousEntry, error: previousError } = await supabase.from('chronosphere_timeline_entries')
      .select('sequence_number, snapshot_json')
      .eq('timeline_id', timeline.id)
      .eq('sequence_number', sequence - 1)
      .maybeSingle()
    if (previousError) throw new Error('max_timeline_previous_lookup_failed')
    previous = previousEntry
  }

  const comparison = previous?.snapshot_json
    ? compareChronosphereSnapshots(previous.snapshot_json, snapshot, {
      previousSequence: previous.sequence_number,
      currentSequence: sequence,
      comparedAt: new Date().toISOString(),
    })
    : null

  const { error: entryError } = await supabase.from('chronosphere_timeline_entries').insert({
    timeline_id: timeline.id,
    user_id: maxUser.id,
    source_draw_table: 'chronosphere_pack_draws',
    source_draw_id: drawId,
    sequence_number: sequence,
    read_at: result.createdAt,
    snapshot_json: snapshot,
    comparison_json: comparison,
  })
  if (entryError) throw new Error('max_timeline_entry_create_failed')

  await supabase.from('chronosphere_timelines')
    .update({ status: sequence >= 3 ? 'closed' : 'active', updated_at: new Date().toISOString() })
    .eq('id', timeline.id)
    .eq('user_id', maxUser.id)

  let finalSynthesis = null
  if (sequence >= 3) {
    const { data: allEntries, error: entriesError } = await supabase.from('chronosphere_timeline_entries')
      .select('sequence_number, snapshot_json')
      .eq('timeline_id', timeline.id)
      .order('sequence_number', { ascending: true })
    if (entriesError) throw new Error('max_timeline_entries_lookup_failed')
    finalSynthesis = summarizeChronosphereLine((allEntries || []).map((entry) => ({
      sequenceNumber: entry.sequence_number,
      timelineTitle: timeline.title,
      snapshot: entry.snapshot_json,
    })))
  }

  return {
    timelineId: timeline.id,
    timelineTitle: timeline.title,
    sequenceNumber: sequence,
    comparison,
    finalSynthesis,
  }
}

function deliveryFailureCode(result) {
  if (result?.status === 'not_configured') return 'resend_not_configured'
  if (Number.isInteger(result?.httpStatus)) return `resend_http_${result.httpStatus}`
  return 'resend_failed'
}

async function updateEmailDeliveryFailure(supabase, drawTable, drawId, failureCode) {
  const { error } = await supabase
    .from(drawTable)
    .update({ email_delivery_failure_code: failureCode })
    .eq('id', drawId)
    .eq('status', 'completed')

  if (error) console.error('[oracle-timeline] email delivery failure update failed:', error.code || 'supabase_update_failed')
}

async function deliverCompletedTimeline({ supabase, drawTable, drawId, deliveryEmail, deliveryEmailHash, result, pack }) {
  const { data: draw, error: drawError } = await supabase
    .from(drawTable)
    .select('email_sent_at')
    .eq('id', drawId)
    .eq('status', 'completed')
    .maybeSingle()

  if (drawError || !draw) {
    console.error('[oracle-timeline] email delivery lookup failed:', drawError?.code || 'draw_not_found')
    return { email: 'error' }
  }
  if (draw.email_sent_at) return { email: 'sent' }

  const emailResult = await sendChronosphereEmail({ drawId, deliveryEmail, result, pack })
  if (emailResult.status !== 'sent') {
    await updateEmailDeliveryFailure(supabase, drawTable, drawId, deliveryFailureCode(emailResult))
    return { email: 'error' }
  }

  const { error: updateError } = await supabase
    .from(drawTable)
    .update({
      delivery_email_hash: deliveryEmailHash,
      email_sent_at: new Date().toISOString(),
      email_delivery_failure_code: null,
    })
    .eq('id', drawId)
    .eq('status', 'completed')

  if (updateError) {
    console.error('[oracle-timeline] email delivery success update failed:', updateError.code || 'supabase_update_failed')
    return { email: 'error' }
  }

  return { email: 'sent' }
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
- Si le thème est formulé comme une question qui appelle naturellement une orientation claire — par exemple « Est-ce que… ? », « Vais-je… ? », « Dois-je… ? », « Est-ce le bon moment… ? », « Ce projet peut-il… ? » — renseigne le champ JSON "direction".
- Dans cette section, choisis UNE seule orientation parmi : « Tendance favorable », « Tendance favorable mais en construction », « Tendance mitigée », « Tendance peu porteuse actuellement ».
- Puis donne en 2 à 4 phrases la réponse la plus claire que les cartes et les données astrologiques permettent réellement. Tu peux dire franchement qu'un potentiel est favorable, qu'il demande encore une maturation, qu'il est contrarié actuellement ou qu'il ne ressort pas comme porteur dans la dynamique étudiée.
- Cette orientation n'est jamais une garantie, une prophétie ni un verdict définitif. Elle décrit la direction symbolique du tirage à cet instant.
- Ne neutralise pas systématiquement une convergence forte avec des « peut-être » ou des précautions répétitives. Quand les cartes et les données calculées convergent, formule la tendance avec assurance tout en gardant son caractère symbolique.
- Si le thème n'est PAS une question fermée, mets "direction": null.

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

STRUCTURE V2 OBLIGATOIRE
Tu dois produire une lecture structurée JSON, sans markdown extérieur, sans bloc de code, sans préambule.

Le JSON doit respecter exactement cette forme :
{
  "summary30s": "Résumé en 30 secondes : 2 à 4 phrases maximum. Résumé immédiatement utile du tirage.",
  "direction": null,
  "closure": null,
  "whyNow": [],
  "sections": [
    { "title": "La photographie de l'instant", "content": "..." },
    { "title": "La fréquence principale", "content": "..." },
    { "title": "Les deux résonances", "content": "..." },
    { "title": "Ce que racontent les trois fréquences ensemble", "content": "..." },
    { "title": "Le ciel de naissance et le contexte astrologique", "content": "..." },
    { "title": "La ligne de temps", "content": "..." },
    { "title": "Les deux chemins possibles", "content": "..." },
    { "title": "Vos leviers concrets", "content": "..." },
    { "title": "La question que Chronosphère vous renvoie", "content": "..." }
  ]
}

Si le thème est une question fermée, "direction" doit être :
{
  "label": "Tendance favorable" OU "Tendance favorable mais en construction" OU "Tendance mitigée" OU "Tendance peu porteuse actuellement",
  "content": "2 à 4 phrases de nuance claire."
}

Si le thème n'est pas une question fermée, "direction" doit être null.

Après la photographie de l'instant, si et seulement si les données permettent réellement de l'établir, renseigne "closure" :
{
  "stillOpen": "ce qui reste ouvert",
  "mainLock": "le verrou principal",
  "opensAfterClosure": "ce dont la clôture pourrait permettre l'ouverture"
}

Si ce bloc serait forcé ou trop spéculatif, mets "closure": null. Ne crée jamais un événement obligatoire.

Pour le bloc visible « Pourquoi maintenant ? », entre le contexte astrologique et la ligne de temps, renseigne "whyNow" avec 2 à 3 éléments maximum quand les données calculées le permettent :
[
  {
    "calculated": "donnée calculée explicitement fournie : transit/aspect, point natal touché, maison/domaine activé ou fenêtre calculée",
    "interpretation": "interprétation symbolique courte liée au thème"
  }
]

Chaque "calculated" doit citer uniquement une donnée présente dans IDENTITE DE LECTURE, ANGLES ET MAISONS, POSITIONS NATALES, CIEL DU TIRAGE, ASPECTS RETENUS ou FENETRES FUTURES. Si tu n'as pas 2 éléments solides, donne seulement 1 élément ; si aucun élément solide n'existe, mets [].

DETAIL DES 9 SECTIONS
1. « La photographie de l'instant » — décris la dynamique actuelle en la reliant directement au thème. Appuie-toi d'abord sur la carte principale et, si pertinent, sur un élément céleste calculé qui éclaire le climat symbolique du moment.
2. « La fréquence principale » — approfondis la carte principale : ce qu'elle met en mouvement, sa ressource, sa vigilance et ce qu'elle demande concrètement dans CE thème. N'en fais pas une fiche générique de la carte.
3. « Les deux résonances » — explique séparément ce que chaque résonance vient préciser, amplifier, déplacer ou nuancer autour de l'axe principal.
4. « Ce que racontent les trois fréquences ensemble » — produis une vraie synthèse intégrée. Fais apparaître le mouvement commun des trois cartes en une trajectoire simple et mémorable, sans révéler la mécanique interne des combinaisons.
5. « Le ciel de naissance et le contexte astrologique » — retiens seulement 2 à 5 éléments célestes calculés réellement utiles au thème. Explique-les en français clair, sans réciter un thème astral et sans transformer une position astrologique en vérité psychologique.
6. « La ligne de temps » — réponds clairement à « quand préparer, avancer ou ralentir ? ». Utilise uniquement les fenêtres futures calculées. Donne la fenêtre prioritaire, au maximum une alternative utile et la zone de prudence si elle existe. Explique pourquoi en citant seulement les aspects explicitement fournis. Pour travail, projet ou finances, propose des verbes d'action concrets mais non prescriptifs : préparer, tester, présenter, négocier, structurer, décider ou patienter.
7. « Les deux chemins possibles » — présente deux trajectoires conditionnelles : a) « Si tu maintiens la dynamique actuelle… » ; b) « Si tu modifies l'élément clé… ». Décris des tendances plausibles, jamais des événements garantis. L'élément clé doit découler du tirage.
8. « Vos leviers concrets » — donne exactement trois leviers courts et applicables : « À faire maintenant », « À préparer », « À ne pas forcer ». Ils doivent être spécifiques au thème et cohérents avec les cartes et le timing.
9. « La question que Chronosphère vous renvoie » — termine la lecture détaillée par UNE question d'introspection précise, directement reliée au point de bifurcation du tirage. Elle doit aider à décider ou à clarifier, pas simplement sonner spirituelle.

L'acte de réalignement est construit par l'interface à partir du GESTE et du DECRET exacts de la carte principale : ne crée donc PAS de dixième partie et ne répète pas le geste ni le décret dans les sections.

QUALITE FINALE
- Ne répète pas la même idée dans plusieurs sections avec des mots différents.
- Ne flatte pas artificiellement le lecteur et ne lui attribue pas une mission exceptionnelle sans appui dans les cartes.
- Ne présente pas une métaphore comme un fait objectif.
- Si une carte porte une densité exigeante, ne l'édulcore pas ; exprime l'enjeu avec tact et clarté.
- Si les cartes sont fortement cohérentes entre elles, fais sentir cette convergence sans révéler qu'une règle de combinaison existe.
- Ne transforme pas la lecture en bulletin astrologique : les données célestes doivent fusionner avec l'Oracle.
- Ne donne aucun diagnostic médical, juridique ou financier.
- Ne présente pas l'astrologie, la causalité spirituelle ou les lignes de temps comme des faits scientifiquement démontrés.

La réponse finale doit être uniquement le JSON valide demandé. Aucun texte avant ou après le JSON.`
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

function buildValidatedReading(text, cards) {
  const json = extractChronosphereReadingJson(text)
  if (!json) return { reading: null, reason: 'invalid_json' }

  const reading = normalizeChronosphereReading(json, {
    gesture: cards?.[0]?.gesture,
    decree: cards?.[0]?.decree,
  })
  const validation = validateChronosphereReading(reading)
  if (!validation.valid) {
    return {
      reading: null,
      reason: `invalid_structure:${validation.missingSections.join('|') || 'required_fields'}`,
    }
  }

  return { reading: validation.reading, reason: null }
}

async function interpretTimeline(input) {
  const prompt = buildPrompt(input)
  const anthropic = await callAnthropic(prompt)
  if (anthropic.text) {
    const structured = buildValidatedReading(anthropic.text, input.cards)
    if (structured.reading) return structured.reading
    console.error('[oracle-timeline] anthropic returned invalid V2 reading:', structured.reason)
  }
  const openai = await callOpenAI(prompt)
  if (openai.text) {
    const structured = buildValidatedReading(openai.text, input.cards)
    if (structured.reading) return structured.reading
    console.error('[oracle-timeline] openai returned invalid V2 reading:', structured.reason)
  }
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
  const publicAspects = (window) => (window?.aspects || []).slice(0, 3).map((aspect) => ({
    transitPlanet: aspect.transitPlanet,
    aspect: aspect.aspect,
    natalPlanet: aspect.natalPlanet,
    orb: aspect.orb,
  }))
  return {
    horizonDays: timing.horizonDays,
    quality: timing.quality,
    primary: {
      start: timing.primary.start,
      peak: timing.primary.peak,
      end: timing.primary.end,
      aspects: publicAspects(timing.primary),
    },
    alternatives: timing.alternatives.map((window) => ({
      start: window.start,
      peak: window.peak,
      end: window.end,
      aspects: publicAspects(window),
    })),
    caution: timing.caution ? {
      start: timing.caution.start,
      peak: timing.caution.peak,
      end: timing.caution.end,
      aspects: publicAspects(timing.caution),
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
  const deliveryEmail = normalizeDeliveryEmail(req.body?.deliveryEmail)
  if (!deliveryEmail) return res.status(400).json({ error: 'invalid_email', message: 'Indiquez une adresse e-mail valide.' })

  const packToken = typeof req.body?.packToken === 'string' ? req.body.packToken.trim() : ''
  const drawToken = typeof req.body?.drawToken === 'string' ? req.body.drawToken.trim() : ''
  if (!packToken && !drawToken) {
    return res.status(402).json({ error: 'payment_required', message: 'Un tirage payant est requis.' })
  }

  const isPack = Boolean(packToken)
  const tokenHash = createHash('sha256').update(isPack ? packToken : drawToken).digest('hex')
  const drawTable = isPack ? 'chronosphere_pack_draws' : 'chronosphere_paid_draws'
  const supabase = getSupabaseAdmin()

  let maxPack = null
  let maxUser = null
  const requestedTimelineId = typeof req.body?.maxTimelineId === 'string' ? req.body.maxTimelineId.trim() : ''
  const requestedTimelineTitle = typeof req.body?.maxTimelineTitle === 'string' ? req.body.maxTimelineTitle.trim() : ''
  const maxReadNonce = typeof req.body?.maxReadNonce === 'string' ? req.body.maxReadNonce.trim() : ''

  if (isPack) {
    const { data: packMeta, error: packMetaError } = await supabase.from('chronosphere_credit_packs')
      .select('id, user_id, product_type')
      .eq('pack_token_hash', tokenHash)
      .maybeSingle()
    if (packMetaError) return res.status(503).json({ error: 'pack_status_unavailable' })
    if (packMeta?.product_type === 'max3') {
      maxUser = await authenticatedTimelineUser(req, supabase)
      if (!maxUser || maxUser.id !== packMeta.user_id) return res.status(401).json({ error: 'auth_required', message: 'Connectez-vous au compte MediumIA ayant acheté ChronoSphère MAX.' })
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(maxReadNonce)) return res.status(400).json({ error: 'invalid_max_read_nonce' })
      maxPack = packMeta
    }
  }

  const requestHash = createHash('sha256')
    .update(JSON.stringify({
      numbers,
      theme: normalizedTheme,
      profile: req.body?.profile,
      deliveryEmail,
      ...(maxPack ? { maxReadNonce, requestedTimelineId, requestedTimelineTitle } : {}),
    }))
    .digest('hex')
  const deliveryEmailHash = createHash('sha256').update(deliveryEmail).digest('hex')

  const { data: tokenResult, error: tokenError } = await supabase.rpc(
    isPack ? 'consume_chronosphere_pack_credit' : 'consume_chronosphere_draw_token',
    isPack ? { p_pack_token_hash: tokenHash, p_request_hash: requestHash } : { p_token_hash: tokenHash, p_request_hash: requestHash },
  )

  if (tokenError || !tokenResult?.allowed) {
    const reason = tokenResult?.reason || 'invalid_token'
    const messages = {
      invalid_token: 'Ce jeton de tirage est invalide ou expiré.',
      already_consumed: 'Ce tirage a déjà été utilisé.',
      in_progress: 'Ce tirage est en cours de traitement.',
      payment_pending: 'Le paiement n\'a pas encore été finalisé.',
      no_credits: 'Vos trois tirages ont déjà été utilisés. Vous pouvez obtenir un nouveau pack.',
    }
    return res.status(reason === 'in_progress' ? 409 : 403).json({
      error: `draw_token_${reason}`,
      message: messages[reason] || 'Jeton de tirage invalide.',
    })
  }

  const drawId = tokenResult.draw_id
  const processingClaimId = isPack ? tokenResult.claim_id : null
  const credits = isPack ? {
    creditsRemaining: Number.isInteger(tokenResult.result_json?.creditsRemaining)
      ? tokenResult.result_json.creditsRemaining
      : tokenResult.credits_remaining,
    creditsTotal: Number.isInteger(tokenResult.result_json?.creditsTotal)
      ? tokenResult.result_json.creditsTotal
      : tokenResult.credits_total,
  } : {}
  if (tokenResult.cached && tokenResult.result_json) {
    let max = null
    if (maxPack) {
      try {
        max = await persistChronosphereMaxMemory({
          supabase,
          maxPack,
          maxUser,
          requestedTimelineId,
          requestedTimelineTitle,
          profile,
          normalizedTheme,
          drawId,
          result: tokenResult.result_json,
          sequenceNumber: credits.creditsTotal - credits.creditsRemaining,
        })
      } catch (error) {
        console.error('[oracle-timeline] MAX cached memory sync failed:', error?.message || 'max_memory_sync_failed')
        return res.status(409).json({
          error: error?.message || 'max_memory_sync_failed',
          message: 'La lecture a déjà été générée, mais sa mémoire MAX n’a pas pu être synchronisée. Aucun nouveau paiement n’est nécessaire : réessayez dans quelques instants.',
          ...credits,
        })
      }
    }
    const delivery = await deliverCompletedTimeline({
      supabase,
      drawTable,
      drawId,
      deliveryEmail,
      deliveryEmailHash,
      result: tokenResult.result_json,
      pack: isPack ? { packToken, creditsRemaining: credits.creditsRemaining, product: maxPack ? 'max3' : 'pack3' } : null,
    })
    return res.status(200).json({ ...tokenResult.result_json, ...credits, ...(max ? { max } : {}), delivery })
  }

  let drawClaimedProcessing = true

  try {
    const drawDate = new Date()
    const location = await resolveBirthLocation(profile.birthPlace)
    const astrology = calculateOracleAstrology(profile, location, drawDate, normalizedTheme)
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
    const reading = await interpretTimeline({ theme: normalizedTheme, cards, activations, profile, astrology })
    const interpretation = readingToInterpretation(reading)

    const responsePayload = {
      schemaVersion: CHRONOSPHERE_SCHEMA_VERSION,
      engineVersion: CHRONOSPHERE_ENGINE_VERSION,
      engine: CHRONOSPHERE_ENGINE_VERSION,
      mode: 'cards-plus-natal-geometry-plus-timing-plus-direction',
      createdAt: drawDate.toISOString(),
      theme: normalizedTheme,
      profile: {
        fullName: profile.fullName,
        birthDate: profile.birthDate,
        birthTime: profile.birthTime,
        birthPlace: profile.birthPlace,
      },
      sky: {
        resolvedBirthPlace: astrology.location.label,
        timeZone: astrology.location.timeZone,
        houseSystem: astrology.geometry.houseSystem,
        ascendant: astrology.geometry.ascendant.label,
        mc: astrology.geometry.mc.label,
        sunSign: astrology.natal.find((planet) => planet.planet === 'Soleil')?.sign || null,
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
      reading,
      interpretation,
      ...credits,
    }

    const { data: completeResult, error: completeError } = await supabase.rpc(
      isPack ? 'complete_chronosphere_pack_draw' : 'complete_chronosphere_draw',
      isPack
        ? { p_draw_id: drawId, p_result_json: responsePayload, p_claim_id: processingClaimId }
        : { p_draw_id: drawId, p_result_json: responsePayload },
    )
    if (completeError || completeResult !== true) {
      console.error('[oracle-timeline] draw completion failed')
      return res.status(500).json({ error: 'draw_completion_failed' })
    }
    drawClaimedProcessing = false

    let max = null
    if (maxPack) {
      max = await persistChronosphereMaxMemory({
        supabase,
        maxPack,
        maxUser,
        requestedTimelineId,
        requestedTimelineTitle,
        profile,
        normalizedTheme,
        drawId,
        result: responsePayload,
        sequenceNumber: credits.creditsTotal - credits.creditsRemaining,
      })
    }

    const delivery = await deliverCompletedTimeline({
      supabase,
      drawTable,
      drawId,
      deliveryEmail,
      deliveryEmailHash,
      result: responsePayload,
      pack: isPack ? { packToken, creditsRemaining: credits.creditsRemaining, product: maxPack ? 'max3' : 'pack3' } : null,
    })
    return res.status(200).json({ ...responsePayload, ...credits, ...(max ? { max } : {}), delivery })
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
    if (code.startsWith('max_')) return res.status(409).json({ error: code, message: 'La mémoire MAX n’a pas pu être synchronisée. Aucun nouveau paiement n’est nécessaire.' })
    return res.status(500).json({ error: 'timeline_interpretation_unavailable' })
  } finally {
    if (drawClaimedProcessing) {
      try {
        const resetResult = isPack
          ? await supabase.rpc('release_chronosphere_pack_credit', {
            p_draw_id: drawId,
            p_failure_code: 'timeline_engine_failed',
            p_claim_id: processingClaimId,
          })
          : await supabase.from('chronosphere_paid_draws')
            .update({ status: 'ready', processing_started_at: null, request_hash: null })
            .eq('id', drawId)
            .eq('status', 'processing')

        if (resetResult.error) {
          console.error('[oracle-timeline] draw reset failed:', resetResult.error.code || 'supabase_update_failed')
        }
      } catch {
        console.error('[oracle-timeline] draw reset request failed')
      }
    }
  }
}
