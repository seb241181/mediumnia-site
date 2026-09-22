export const CHRONOSPHERE_SCHEMA_VERSION = 'chronosphere-max-v1'
export const CHRONOSPHERE_ENGINE_VERSION = 'chronosphere-999-58-max-v1'

export const READING_SECTION_TITLES = [
  "La photographie de l'instant",
  'La fréquence principale',
  'Les deux résonances',
  'Ce que racontent les trois fréquences ensemble',
  'Le ciel de naissance et le contexte astrologique',
  'La ligne de temps',
  'Les deux chemins possibles',
  'Vos leviers concrets',
  'La question que Chronosphère vous renvoie',
]

const READING_SECTION_IDS = [
  'current_picture',
  'main_frequency',
  'two_resonances',
  'three_frequencies_synthesis',
  'birth_sky_context',
  'timeline',
  'two_possible_paths',
  'concrete_levers',
  'mirror_question',
]

const DIRECTION_LABELS = [
  'Tendance favorable',
  'Tendance favorable mais en construction',
  'Tendance mitigée',
  'Tendance peu porteuse actuellement',
]

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim()
}

function stripMarkdownHeading(value) {
  return cleanText(value)
    .replace(/^#{1,4}\s*/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .trim()
}

function titleIndex(value) {
  const withoutNumber = stripMarkdownHeading(value).replace(/^\d+[.)]\s*/, '').trim().toLowerCase()
  return READING_SECTION_TITLES.findIndex((title) => title.toLowerCase() === withoutNumber)
}

function normalizeDirection(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const label = DIRECTION_LABELS.find((candidate) => candidate.toLowerCase() === value.trim().replace(/\.$/, '').toLowerCase())
    return label ? { label, content: '' } : null
  }
  const label = DIRECTION_LABELS.find((candidate) => candidate.toLowerCase() === cleanText(value.label).replace(/\.$/, '').toLowerCase())
  if (!label) return null
  return { label, content: cleanText(value.content || value.text || value.summary) }
}

function normalizeSection(section, index) {
  const sectionIndex = Number.isInteger(index) ? index : titleIndex(section?.title)
  if (sectionIndex < 0 || sectionIndex >= READING_SECTION_TITLES.length) return null
  const content = cleanText(section?.content || section?.text)
  if (!content) return null
  return {
    id: READING_SECTION_IDS[sectionIndex],
    number: sectionIndex + 1,
    title: READING_SECTION_TITLES[sectionIndex],
    content,
  }
}

export function normalizeChronosphereReading(value, realignmentAct = null) {
  const summary30s = cleanText(value?.summary30s || value?.summary || value?.resume30s)
  const direction = normalizeDirection(value?.direction || value?.tendency || value?.tendance)
  const sourceSections = Array.isArray(value?.sections) ? value.sections : []
  const sections = sourceSections
    .map((section, index) => normalizeSection(section, index))
    .filter(Boolean)

  const normalizedAct = {
    gesture: cleanText(value?.realignmentAct?.gesture || realignmentAct?.gesture),
    decree: cleanText(value?.realignmentAct?.decree || realignmentAct?.decree),
  }

  return {
    summary30s,
    direction,
    sections,
    realignmentAct: normalizedAct.gesture || normalizedAct.decree ? normalizedAct : null,
  }
}

export function validateChronosphereReading(reading) {
  const normalized = normalizeChronosphereReading(reading)
  const titles = new Set(normalized.sections.map((section) => section.title))
  const missingSections = READING_SECTION_TITLES.filter((title) => !titles.has(title))
  const valid = Boolean(normalized.summary30s)
    && normalized.sections.length === READING_SECTION_TITLES.length
    && missingSections.length === 0
    && Boolean(normalized.realignmentAct?.gesture)
    && Boolean(normalized.realignmentAct?.decree)

  return { valid, missingSections, reading: normalized }
}

export function extractChronosphereReadingJson(value) {
  const text = cleanText(value)
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!candidate || !candidate.trim().startsWith('{')) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export function parseLegacyChronosphereReading(value, realignmentAct = null) {
  const text = cleanText(value)
  if (!text) return normalizeChronosphereReading({ sections: [] }, realignmentAct)

  const photoMatch = text.match(/(?:^|\n)(?:#+\s*)?(?:\*\*)?1\.\s*La photographie de l'instant(?:\*\*)?/i)
  const head = photoMatch
    ? text.slice(0, photoMatch.index + (photoMatch[0].startsWith('\n') ? 1 : 0))
    : ''
  const body = photoMatch ? text.slice(photoMatch.index + (photoMatch[0].startsWith('\n') ? 1 : 0)) : text
  const directionMatch = head.match(
    /\*{0,2}(Tendance (?:favorable(?: mais en construction)?|mitigée|peu porteuse actuellement))\.?\*{0,2}/i,
  )
  const summary30s = head
    .replace(/(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?(?:Résumé en 30 secondes|Votre tirage en 30 secondes|La tendance du tirage)(?:\*\*)?\s*/gi, '\n')
    .replace(directionMatch?.[0] || '', '')
    .replace(/\*\*/g, '')
    .trim()

  const lines = body.split('\n')
  const sections = []
  let current = null

  for (const line of lines) {
    const index = titleIndex(line)
    if (index >= 0) {
      if (current) sections.push(normalizeSection(current, current.number - 1))
      current = { number: index + 1, title: READING_SECTION_TITLES[index], content: '' }
      continue
    }
    if (current) current.content += `${line}\n`
  }
  if (current) sections.push(normalizeSection(current, current.number - 1))

  return normalizeChronosphereReading({
    summary30s,
    direction: directionMatch ? { label: directionMatch[1].replace(/\.$/, ''), content: summary30s } : null,
    sections: sections.filter(Boolean),
    realignmentAct,
  })
}

export function readingToInterpretation(reading) {
  const normalized = normalizeChronosphereReading(reading)
  const chunks = []
  if (normalized.summary30s) chunks.push(`Résumé en 30 secondes\n${normalized.summary30s}`)
  if (normalized.direction?.label) {
    chunks.push(`La tendance du tirage\n${normalized.direction.label}${normalized.direction.content ? `\n${normalized.direction.content}` : ''}`)
  }
  for (const section of normalized.sections) {
    chunks.push(`${section.number}. ${section.title}\n${section.content}`)
  }
  return chunks.join('\n\n').trim()
}

export function getChronosphereReading(result) {
  const reading = result?.reading
  const realignmentAct = result?.reading?.realignmentAct || {
    gesture: result?.cards?.[0]?.gesture,
    decree: result?.cards?.[0]?.decree,
  }
  const validation = validateChronosphereReading(reading)
  if (validation.valid) return validation.reading
  return parseLegacyChronosphereReading(result?.interpretation, realignmentAct)
}
