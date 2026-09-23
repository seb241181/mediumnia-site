import { getChronosphereReading } from './chronosphereReading.js'

export const CHRONOSPHERE_MAX_SNAPSHOT_SCHEMA_VERSION = 'chronosphere-max-snapshot-v1'
export const CHRONOSPHERE_MAX_ENGINE_VERSION = 'chronosphere-max-memory-foundation-v1'

const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  'birthDate',
  'birthTime',
  'birthPlace',
  'resolvedBirthPlace',
  'timeZone',
  'latitude',
  'longitude',
  'email',
  'deliveryEmail',
  'token',
  'drawToken',
  'packToken',
  'profile',
  'interpretation',
  'reading',
])

function cleanText(value, max = 360) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function compactDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

function sectionById(reading, id) {
  return (reading?.sections || []).find((section) => section.id === id) || null
}

function compactCard(card, role) {
  if (!card) return null
  return {
    role,
    number: Number(card.number ?? card.card_number),
    name: cleanText(card.name, 120),
    block: cleanText(card.block, 120),
    density: cleanText(card.density, 120),
    astre: card.astre ? cleanText(card.astre, 80) : null,
  }
}

function compactAspect(aspect) {
  if (!aspect) return null
  return {
    transitPlanet: cleanText(aspect.transitPlanet, 40),
    aspect: cleanText(aspect.aspect, 40),
    natalPlanet: cleanText(aspect.natalPlanet, 40),
    orb: Number.isFinite(Number(aspect.orb)) ? Number(aspect.orb) : null,
  }
}

function compactWindow(window) {
  if (!window) return null
  return {
    start: compactDate(window.start),
    peak: compactDate(window.peak),
    end: compactDate(window.end),
    aspects: (window.aspects || []).slice(0, 3).map(compactAspect).filter(Boolean),
  }
}

function extractAstrologyContributors(result, reading) {
  const whyNow = (reading?.whyNow || []).slice(0, 3).map((item) => ({
    calculated: cleanText(item.calculated, 180),
    symbolicInterpretation: cleanText(item.interpretation, 180),
  }))

  if (whyNow.length) return whyNow

  const timing = result?.sky?.timing
  const aspects = [
    ...(timing?.primary?.aspects || []),
    ...(timing?.alternatives?.[0]?.aspects || []),
    ...(timing?.caution?.aspects || []),
  ].slice(0, 3)

  return aspects.map((aspect) => ({
    calculated: `${aspect.transitPlanet} ${aspect.aspect} ${aspect.natalPlanet} natal`,
    symbolicInterpretation: 'Point astrologique conservé comme contributeur du climat de lecture.',
  }))
}

function extractActivatedDomain(result, reading) {
  const text = [
    result?.sky?.houseSystem ? `Maisons ${result.sky.houseSystem}` : '',
    result?.sky?.ascendant ? `Ascendant ${result.sky.ascendant}` : '',
    result?.sky?.mc ? `Milieu du Ciel ${result.sky.mc}` : '',
    ...((reading?.whyNow || []).map((item) => item.calculated)),
  ].join(' ')

  const house = text.match(/maison\s+(?:natale\s+)?([IVX]+|\d{1,2})/i)?.[1] || null
  return {
    house,
    domain: cleanText(result?.theme, 80) || null,
    source: house ? 'whyNow' : 'theme',
  }
}

function extractLevers(reading) {
  const content = sectionById(reading, 'concrete_levers')?.content || ''
  const labels = [
    ['now', /(?:À faire maintenant|A faire maintenant)\s*[:：\-–—]?\s*([\s\S]*?)(?=\n\s*(?:À préparer|A préparer|À ne pas forcer|A ne pas forcer)\s*[:：\-–—]?|$)/i],
    ['prepare', /(?:À préparer|A préparer)\s*[:：\-–—]?\s*([\s\S]*?)(?=\n\s*(?:À ne pas forcer|A ne pas forcer)\s*[:：\-–—]?|$)/i],
    ['doNotForce', /(?:À ne pas forcer|A ne pas forcer)\s*[:：\-–—]?\s*([\s\S]*)/i],
  ]
  const fallback = content.split(/\n{2,}|(?:^|\n)\s*[-•]\s*/).map((part) => cleanText(part, 180)).filter(Boolean)
  return labels.map(([key, regex], index) => ({
    key,
    text: cleanText(content.match(regex)?.[1] || fallback[index], 180),
  })).filter((lever) => lever.text)
}

function assertMinimized(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SNAPSHOT_KEYS.has(key)) {
      throw new Error(`chronosphere_max_snapshot_forbidden_key:${path}${key}`)
    }
    assertMinimized(child, `${path}${key}.`)
  }
}

export function buildChronosphereMaxSnapshot(result, options = {}) {
  const reading = getChronosphereReading(result)
  const cards = (result?.cards || []).map((card, index) => compactCard(card, index === 0 ? 'main' : `resonance_${index}`)).filter(Boolean)
  const timing = result?.sky?.timing || {}
  const snapshot = {
    schemaVersion: CHRONOSPHERE_MAX_SNAPSHOT_SCHEMA_VERSION,
    engineVersion: CHRONOSPHERE_MAX_ENGINE_VERSION,
    sourceSchemaVersion: cleanText(result?.schemaVersion, 80) || null,
    sourceEngineVersion: cleanText(result?.engineVersion || result?.engine, 120) || null,
    sourceDraw: {
      table: cleanText(options.sourceDrawTable, 80) || null,
      id: cleanText(options.sourceDrawId, 80) || null,
    },
    theme: cleanText(result?.theme || options.theme, 120),
    question: cleanText(options.question || result?.question || result?.theme, 180),
    readAt: cleanText(options.readAt || result?.createdAt, 40) || null,
    mainCard: cards[0] || null,
    resonances: cards.slice(1, 3),
    synthesis: cleanText(reading?.summary30s || sectionById(reading, 'three_frequencies_synthesis')?.content, 260),
    stillOpen: cleanText(reading?.closure?.stillOpen, 180) || null,
    openCycle: cleanText(reading?.closure?.opensAfterClosure || reading?.closure?.mainLock, 180) || null,
    bifurcationPoint: cleanText(sectionById(reading, 'mirror_question')?.content || reading?.closure?.mainLock, 220) || null,
    timing: {
      horizonDays: Number(timing.horizonDays) || 120,
      quality: cleanText(timing.quality, 80) || null,
      primary: compactWindow(timing.primary),
      alternatives: (timing.alternatives || []).slice(0, 2).map(compactWindow).filter(Boolean),
      caution: compactWindow(timing.caution),
    },
    activatedDomain: extractActivatedDomain(result, reading),
    astrologyContributors: extractAstrologyContributors(result, reading),
    levers: extractLevers(reading),
  }

  assertMinimized(snapshot)
  return snapshot
}

export function normalizeChronosphereMaxSnapshot(value) {
  const snapshot = {
    ...value,
    schemaVersion: value?.schemaVersion || CHRONOSPHERE_MAX_SNAPSHOT_SCHEMA_VERSION,
    engineVersion: value?.engineVersion || CHRONOSPHERE_MAX_ENGINE_VERSION,
    theme: cleanText(value?.theme, 120),
    question: cleanText(value?.question, 180),
    mainCard: compactCard(value?.mainCard, 'main'),
    resonances: (value?.resonances || []).slice(0, 2).map((card, index) => compactCard(card, `resonance_${index + 1}`)).filter(Boolean),
    synthesis: cleanText(value?.synthesis, 260),
    timing: {
      horizonDays: Number(value?.timing?.horizonDays) || 120,
      quality: cleanText(value?.timing?.quality, 80) || null,
      primary: compactWindow(value?.timing?.primary),
      alternatives: (value?.timing?.alternatives || []).slice(0, 2).map(compactWindow).filter(Boolean),
      caution: compactWindow(value?.timing?.caution),
    },
    astrologyContributors: (value?.astrologyContributors || []).slice(0, 5).map((item) => ({
      calculated: cleanText(item.calculated, 180),
      symbolicInterpretation: cleanText(item.symbolicInterpretation || item.interpretation, 180),
    })).filter((item) => item.calculated),
    levers: (value?.levers || []).slice(0, 3).map((item) => ({
      key: cleanText(item.key, 40),
      text: cleanText(item.text, 180),
    })).filter((item) => item.text),
  }
  assertMinimized(snapshot)
  return snapshot
}
