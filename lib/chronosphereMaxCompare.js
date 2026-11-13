import { normalizeChronosphereMaxSnapshot } from './chronosphereMaxSnapshot.js'

export const CHRONOSPHERE_MAX_COMPARISON_SCHEMA_VERSION = 'chronosphere-max-comparison-v1'

function cleanText(value, max = 260) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function cardKey(card) {
  if (!card) return null
  return Number.isFinite(Number(card.number)) ? `n:${Number(card.number)}` : `name:${cleanText(card.name, 120).toLowerCase()}`
}

function cardLabel(card) {
  if (!card) return ''
  return `N°${card.number} · ${card.name}`
}

function allCards(snapshot) {
  return [snapshot.mainCard, ...(snapshot.resonances || [])].filter(Boolean)
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => cleanText(value, 120)).filter(Boolean))]
}

function planetValues(snapshot) {
  const fromCards = allCards(snapshot).map((card) => card.astre)
  const fromAstro = (snapshot.astrologyContributors || []).flatMap((item) => {
    const matches = item.calculated.match(/\b(Soleil|Lune|Mercure|Vénus|Venus|Mars|Jupiter|Saturne|Uranus|Neptune|Pluton)\b/gi) || []
    return matches.map((planet) => planet.replace(/^Venus$/i, 'Vénus'))
  })
  return uniqueValues([...fromCards, ...fromAstro])
}

function daysBetween(a, b) {
  const da = typeof a === 'string' ? new Date(`${a}T00:00:00Z`) : null
  const db = typeof b === 'string' ? new Date(`${b}T00:00:00Z`) : null
  if (!da || !db || Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

function tokenSet(value) {
  return new Set(cleanText(value, 1000).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 4))
}

function overlapRatio(a, b) {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (!left.size || !right.size) return 0
  const common = [...left].filter((token) => right.has(token)).length
  return common / Math.min(left.size, right.size)
}

function fact(kind, label, dataCompared, symbolicInterpretation, meta = {}) {
  return {
    kind,
    label,
    dataCompared: cleanText(dataCompared, 300),
    symbolicInterpretation: cleanText(symbolicInterpretation, 300),
    ...meta,
  }
}

export function compareChronosphereSnapshots(previousRaw, currentRaw, options = {}) {
  const previous = normalizeChronosphereMaxSnapshot(previousRaw)
  const current = normalizeChronosphereMaxSnapshot(currentRaw)
  const previousCards = new Map(allCards(previous).map((card) => [cardKey(card), card]))
  const currentCards = new Map(allCards(current).map((card) => [cardKey(card), card]))
  const recurringCards = [...previousCards.entries()]
    .filter(([key]) => currentCards.has(key))
    .map(([key, card]) => ({ previous: card, current: currentCards.get(key) }))
  const disappearedCards = [...previousCards.entries()]
    .filter(([key]) => !currentCards.has(key))
    .map(([, card]) => card)
  const newCards = [...currentCards.entries()]
    .filter(([key]) => !previousCards.has(key))
    .map(([, card]) => card)
  const previousPlanets = planetValues(previous)
  const currentPlanets = planetValues(current)
  const recurringPlanets = previousPlanets.filter((planet) => currentPlanets.includes(planet))
  const previousDomain = previous.activatedDomain?.house || previous.activatedDomain?.domain
  const currentDomain = current.activatedDomain?.house || current.activatedDomain?.domain
  const timingDeltaDays = daysBetween(previous.timing?.primary?.peak, current.timing?.primary?.peak)
  const bifurcationOverlap = overlapRatio(previous.bifurcationPoint, current.bifurcationPoint)

  const facts = []
  if (recurringCards.length) {
    facts.push(fact(
      'recurring_card',
      'Carte récurrente',
      recurringCards.map(({ current: card }) => cardLabel(card)).join(' · '),
      'Une même fréquence reste active dans la Ligne de Temps : elle n’est pas encore seulement un souvenir du tirage précédent.',
      { cards: recurringCards.map(({ current: card }) => cardLabel(card)) },
    ))
  }
  if (disappearedCards.length) {
    facts.push(fact(
      'card_disappeared',
      'Carte qui ne ressort plus',
      disappearedCards.map(cardLabel).join(' · '),
      'Ce point ne structure plus la nouvelle lecture de la même façon ; la situation peut avoir changé de centre de gravité.',
      { cards: disappearedCards.map(cardLabel) },
    ))
  }
  if (newCards.length) {
    facts.push(fact(
      'new_card',
      'Nouvelle fréquence',
      newCards.map(cardLabel).join(' · '),
      'Un nouvel axe symbolique apparaît dans la lecture actuelle.',
      { cards: newCards.map(cardLabel) },
    ))
  }
  if (previous.mainCard?.number !== current.mainCard?.number) {
    facts.push(fact(
      'main_frequency_changed',
      'Fréquence principale déplacée',
      `${cardLabel(previous.mainCard)} -> ${cardLabel(current.mainCard)}`,
      'Le tirage actuel ne répond plus depuis le même point d’entrée : le thème est suivi, mais l’angle principal évolue.',
    ))
  }
  if (recurringPlanets.length) {
    facts.push(fact(
      'recurring_planet',
      'Contributeur astrologique récurrent',
      recurringPlanets.join(' · '),
      'Un même marqueur céleste continue d’accompagner la situation, sans être présenté comme une causalité objective.',
      { planets: recurringPlanets },
    ))
  }
  if (previousDomain && currentDomain && previousDomain === currentDomain) {
    facts.push(fact(
      'recurring_domain',
      'Domaine activé récurrent',
      String(currentDomain),
      'Le même domaine symbolique reste au premier plan de la Ligne de Temps.',
      { domain: currentDomain },
    ))
  }
  if (Number.isInteger(timingDeltaDays) && timingDeltaDays !== 0) {
    const direction = timingDeltaDays > 0 ? 'plus tardive' : 'plus proche'
    facts.push(fact(
      'primary_window_moved',
      'Fenêtre principale déplacée',
      `${previous.timing.primary.peak} -> ${current.timing.primary.peak} (${Math.abs(timingDeltaDays)} jours)`,
      `La fenêtre prioritaire devient ${direction}. C’est un déplacement de climat calculé, pas l’annonce d’un événement.`,
      { daysDelta: timingDeltaDays, direction },
    ))
  }
  if (previous.timing?.quality && current.timing?.quality && previous.timing.quality !== current.timing.quality) {
    facts.push(fact(
      'climate_changed',
      'Climat temporel modifié',
      `${previous.timing.quality} -> ${current.timing.quality}`,
      'Le contexte temporel conserve le même thème, mais sa tonalité de soutien ou de tension se modifie.',
    ))
  }
  if (previous.bifurcationPoint && current.bifurcationPoint) {
    const persists = bifurcationOverlap >= 0.28
    facts.push(fact(
      persists ? 'bifurcation_persists' : 'bifurcation_changed',
      persists ? 'Point de bifurcation persistant' : 'Point de bifurcation déplacé',
      persists ? 'Mots clés communs détectés entre les deux formulations.' : 'Les formulations du point de bifurcation divergent.',
      persists
        ? 'Le choix central semble encore travailler la même zone intérieure.'
        : 'La décision à clarifier ne se pose plus exactement au même endroit.',
      { overlap: Number(bifurcationOverlap.toFixed(2)) },
    ))
  }

  return {
    schemaVersion: CHRONOSPHERE_MAX_COMPARISON_SCHEMA_VERSION,
    comparedAt: options.comparedAt || null,
    previousSequence: Number(options.previousSequence) || null,
    currentSequence: Number(options.currentSequence) || null,
    facts,
    summary: {
      persistent: facts.filter((item) => ['recurring_card', 'recurring_planet', 'recurring_domain', 'bifurcation_persists'].includes(item.kind)),
      moved: facts.filter((item) => ['main_frequency_changed', 'primary_window_moved', 'climate_changed', 'bifurcation_changed'].includes(item.kind)),
      opened: facts.filter((item) => item.kind === 'new_card'),
      noLongerAppears: facts.filter((item) => item.kind === 'card_disappeared'),
    },
  }
}

export function summarizeChronosphereLine(entries) {
  const ordered = [...(entries || [])].sort((a, b) => Number(a.sequenceNumber) - Number(b.sequenceNumber))
  const first = ordered[0]?.snapshot
  const last = ordered.at(-1)?.snapshot
  if (!first || !last) return null
  const comparison = ordered.length >= 2
    ? compareChronosphereSnapshots(ordered.at(-2).snapshot, last, {
      previousSequence: ordered.at(-2).sequenceNumber,
      currentSequence: ordered.at(-1).sequenceNumber,
    })
    : null
  return {
    title: cleanText(ordered[0]?.timelineTitle || 'Votre Ligne de Temps', 120),
    entriesCount: ordered.length,
    fromTheme: first.theme,
    currentTheme: last.theme,
    firstWindow: first.timing?.primary?.peak || null,
    currentWindow: last.timing?.primary?.peak || null,
    trajectory: comparison?.summary || null,
    // Comparaison directe de la dernière lecture avec la première (3 lectures).
    fromStart: ordered.length >= 3
      ? compareChronosphereSnapshots(first, last, {
        previousSequence: ordered[0].sequenceNumber,
        currentSequence: ordered.at(-1).sequenceNumber,
      }).summary
      : null,
    recurringNumbers: recurringNumbersAcrossLine(ordered),
    redThread: detectRedThreadCard(ordered),
    synthesis: cleanText(
      `La Ligne de Temps part de "${first.synthesis}" et arrive aujourd'hui sur "${last.synthesis}".`,
      360,
    ),
  }
}

// ── Mémoire des Lignes de Temps ─────────────────────────────────────────────
// Tout ce qui suit est calculé à partir des résumés déjà enregistrés
// (snapshot_json). Aucune correspondance n'est inventée : une récurrence
// existe seulement quand le même numéro de carte a réellement été choisi
// dans plusieurs lectures de la même Ligne de Temps.

function orderedEntries(entries) {
  return [...(entries || [])]
    .filter((entry) => entry?.snapshot)
    .map((entry) => ({ sequenceNumber: Number(entry.sequenceNumber), snapshot: normalizeChronosphereMaxSnapshot(entry.snapshot) }))
    .filter((entry) => Number.isInteger(entry.sequenceNumber))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
}

export function recurringNumbersAcrossLine(entries) {
  const byNumber = new Map()
  for (const entry of orderedEntries(entries)) {
    for (const card of allCards(entry.snapshot)) {
      const number = Number(card.number)
      if (!Number.isInteger(number)) continue
      const item = byNumber.get(number) || { number, name: card.name, readings: [], mainIn: [] }
      if (!item.readings.includes(entry.sequenceNumber)) item.readings.push(entry.sequenceNumber)
      if (card.role === 'main' && !item.mainIn.includes(entry.sequenceNumber)) item.mainIn.push(entry.sequenceNumber)
      byNumber.set(number, item)
    }
  }
  return [...byNumber.values()]
    .filter((item) => item.readings.length >= 2)
    .sort((a, b) => b.readings.length - a.readings.length || b.mainIn.length - a.mainIn.length || a.number - b.number)
}

// Carte fil rouge : jamais obligatoire. Elle n'émerge qu'après trois lectures,
// et seulement si UNE carte se détache nettement :
//  - choisie dans les trois lectures ; ou
//  - choisie dans deux lectures dont au moins une fois comme carte principale.
// En cas d'égalité entre plusieurs cartes, aucune n'est désignée.
export function detectRedThreadCard(entries) {
  const ordered = orderedEntries(entries)
  if (ordered.length < 3) return null
  const recurring = recurringNumbersAcrossLine(ordered)
  const inAll = recurring.filter((item) => item.readings.length >= 3)
  if (inAll.length === 1) return { ...inAll[0], reason: 'three_readings' }
  if (inAll.length > 1) {
    const best = Math.max(...inAll.map((item) => item.mainIn.length))
    const leaders = inAll.filter((item) => item.mainIn.length === best)
    return best > 0 && leaders.length === 1 ? { ...leaders[0], reason: 'three_readings' } : null
  }
  const strongPairs = recurring.filter((item) => item.readings.length === 2 && item.mainIn.length >= 1)
  return strongPairs.length === 1 ? { ...strongPairs[0], reason: 'two_readings_with_main' } : null
}

// Contexte de mémoire pour la rédaction d'une nouvelle lecture MAX.
// previousEntries : lectures déjà enregistrées de CETTE Ligne de Temps.
// currentCards : les trois cartes du tirage en cours (la première est la principale).
export function buildMaxMemoryForReading(previousEntries, currentCards) {
  const previous = orderedEntries(previousEntries)
  if (!previous.length) return null
  const sequence = previous.at(-1).sequenceNumber + 1
  const current = {
    sequenceNumber: sequence,
    snapshot: {
      mainCard: currentCards?.[0] ? { number: currentCards[0].number ?? currentCards[0].card_number, name: currentCards[0].name, role: 'main' } : null,
      resonances: (currentCards || []).slice(1, 3).map((card, index) => ({ number: card.number ?? card.card_number, name: card.name, role: `resonance_${index + 1}` })),
    },
  }
  const line = [...previous, current]
  const currentNumbers = new Set(allCards(normalizeChronosphereMaxSnapshot(current.snapshot)).map((card) => Number(card.number)))
  const recurring = recurringNumbersAcrossLine(line).filter((item) => currentNumbers.has(item.number))
  return {
    sequence,
    isFinal: sequence >= 3,
    previous: previous.map((entry) => ({
      sequenceNumber: entry.sequenceNumber,
      readAt: cleanText(entry.snapshot.readAt, 10) || null,
      cards: allCards(entry.snapshot).map((card) => ({ number: Number(card.number), name: card.name, main: card.role === 'main' })),
      synthesis: entry.snapshot.synthesis,
      stillOpen: cleanText(entry.snapshot.stillOpen, 180) || null,
      bifurcationPoint: cleanText(entry.snapshot.bifurcationPoint, 220) || null,
      levers: (entry.snapshot.levers || []).map((lever) => lever.text),
    })),
    recurringNumbers: recurring,
    redThread: sequence >= 3 ? detectRedThreadCard(line) : null,
  }
}

export function maxMemoryPromptContext(memory) {
  if (!memory?.previous?.length) return ''
  const previous = memory.previous.map((entry) => {
    const cards = entry.cards.map((card) => `N°${card.number} ${card.name}${card.main ? ' (principale)' : ''}`).join(' · ')
    return [
      `LECTURE ${entry.sequenceNumber}${entry.readAt ? ` — ${entry.readAt}` : ''}`,
      `Cartes choisies : ${cards}`,
      entry.synthesis ? `Synthèse d'alors : ${entry.synthesis}` : '',
      entry.stillOpen ? `Ce qui restait ouvert : ${entry.stillOpen}` : '',
      entry.bifurcationPoint ? `Question renvoyée : ${entry.bifurcationPoint}` : '',
      entry.levers?.length ? `Leviers proposés : ${entry.levers.join(' | ')}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const recurring = memory.recurringNumbers.length
    ? memory.recurringNumbers.map((item) => `N°${item.number} ${item.name} — choisie aux lectures ${item.readings.join(', ')}`).join('\n')
    : 'AUCUN. Aucune carte du tirage actuel n\'avait été choisie auparavant.'

  const redThread = memory.isFinal
    ? (memory.redThread
      ? `N°${memory.redThread.number} ${memory.redThread.name} — choisie aux lectures ${memory.redThread.readings.join(', ')}.`
      : 'AUCUNE. Les données ne désignent aucune carte fil rouge : n\'en nomme pas.')
    : null

  const stage = memory.isFinal
    ? 'Cette lecture est la TROISIEME et dernière : « La Synthèse ». Elle doit relire la trajectoire complète, en comparant aussi directement cette lecture à la PREMIERE.'
    : 'Cette lecture est la DEUXIEME : « Le Mouvement ». Elle doit mettre en perspective ce tirage avec le point de départ.'

  return `MEMOIRE DE LA LIGNE DE TEMPS — LECTURES PRECEDENTES DU MEME COMPTE
${stage}

${previous}

NOMBRES RECURRENTS CALCULES (cartes du tirage actuel déjà choisies auparavant)
${recurring}
${redThread ? `\nCARTE FIL ROUGE CALCULEE\n${redThread}\n` : ''}
REGLES DE CONTINUITE — STRICTES
- Les trois cartes du tirage ACTUEL restent le centre de la lecture. La mémoire éclaire, elle ne remplace pas.
- Tu peux dire qu'une carte revient UNIQUEMENT si elle figure sous « NOMBRES RECURRENTS CALCULES ». Si la liste indique AUCUN, ne suggère aucun retour de carte et ne commente pas cette absence.
${memory.isFinal ? '- Tu ne nommes une « carte fil rouge » QUE si elle figure sous « CARTE FIL ROUGE CALCULEE ». Sinon, n\'emploie pas cette expression.' : '- N\'emploie pas l\'expression « carte fil rouge » dans cette lecture.'}
- N'invente aucun lien symbolique entre une carte actuelle et une carte passée qui ne soit pas fondé sur leur sens fourni ou sur les données ci-dessus.
- Les lectures précédentes sont des lectures symboliques, pas des faits. Ne dis JAMAIS que quelque chose s'est produit, a été accompli ou a échoué dans la vie de la personne. Écris « la première lecture mettait en avant… », « la question renvoyée était… », jamais « tu as fait… », « tu as traversé… », « depuis, il s'est passé… ».
- DISTINGUE TOUJOURS l'évolution du TIRAGE de l'expérience VECUE. Ce qui change entre deux lectures, ce sont les cartes choisies et ce qu'elles mettent en avant : tu ignores tout de ce que la personne a réellement vécu, ressenti, décidé ou transformé entre-temps. Le sujet de tes phrases de continuité est donc la lecture, le tirage ou la carte, jamais la personne.
- N'affirme aucune transformation personnelle : pas de « tu as évolué », « tu as changé », « tu as mûri », « tu as intégré », « tu as dépassé », « tu n'es plus au même endroit », « ton chemin parcouru », « ce que tu portes depuis la première lecture », « ce que tu as évité jusqu'ici ». Écris plutôt « le tirage se déplace de… vers… », « cette lecture met désormais l'accent sur… », « la question posée par la première lecture reste symboliquement ouverte ».
- Si tu évoques un possible écho dans la vie de la personne, formule-le comme une invitation à vérifier (« à toi de voir si cela résonne avec ce que tu vis »), jamais comme un constat.
- Ne suppose pas que les leviers proposés ont été suivis ou ignorés.
- Dis clairement, quand les données le montrent, ce qui PERSISTE, ce qui CHANGE et ce qui S'OUVRE entre les lectures, toujours comme un déplacement symbolique de la lecture.
- Ne recopie pas les synthèses passées : reformule-les brièvement.

OU PLACER LA CONTINUITE (sans ajouter de section ni de champ JSON)
- "summary30s" : une phrase situe ce tirage dans la Ligne de Temps.
- « La photographie de l'instant » : relie le tirage actuel à la lecture précédente.
- « Ce que racontent les trois fréquences ensemble » : ${memory.isFinal ? 'rédige la synthèse de la trajectoire complète des trois lectures (départ, mouvement, point d\'arrivée), en comparant explicitement la troisième à la première, et en nommant la carte fil rouge seulement si elle est calculée.' : 'explique ce qui persiste, ce qui change et ce qui s\'ouvre depuis la première lecture.'}
- « La question que Chronosphère vous renvoie » : tiens compte de la question renvoyée précédemment, sans la répéter mot pour mot.`
}
