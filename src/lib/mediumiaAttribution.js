const KEY = 'mediumia_story_source'
const VISIT_KEY = 'mediumia_story_visit_tracked'
const VALID = new Set(['story-oracle', 'story-quiz'])

export function storyAttributionUrl(kind) {
  const source = kind === 'quiz' ? 'story-quiz' : 'story-oracle'
  const path = kind === 'quiz' ? '/quiz-sensibilite' : '/oracle'
  return `https://mediumia.fr${path}?src=${source}`
}

export function readStoryAttribution() {
  if (typeof window === 'undefined') return null
  try {
    const urlSource = new URL(window.location.href).searchParams.get('src')
    if (VALID.has(urlSource)) {
      sessionStorage.setItem(KEY, urlSource)
      return urlSource
    }
    const stored = sessionStorage.getItem(KEY)
    return VALID.has(stored) ? stored : null
  } catch {
    return null
  }
}

export function consumeStoryVisitFlag(source) {
  if (!source || typeof window === 'undefined') return false
  try {
    const value = sessionStorage.getItem(VISIT_KEY)
    if (value === source) return false
    sessionStorage.setItem(VISIT_KEY, source)
    return true
  } catch {
    return true
  }
}
