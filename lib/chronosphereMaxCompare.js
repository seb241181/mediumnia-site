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
    synthesis: cleanText(
      `La Ligne de Temps part de "${first.synthesis}" et arrive aujourd'hui sur "${last.synthesis}".`,
      360,
    ),
  }
}
