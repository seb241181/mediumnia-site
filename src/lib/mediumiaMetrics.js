import { consumeStoryVisitFlag, readStoryAttribution } from './mediumiaAttribution.js'

const ENDPOINT = '/api/rdv-config?analyticsAction=event'

const EVENT_RE = /^[a-z0-9_]{3,64}$/
const SOURCE_RE = /^[a-z0-9:_-]{1,80}$/

function sendMetric(event, source) {
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, source }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // Metrics must never interfere with the user journey.
  }
}

export function trackMediumiaMetric(eventName, source = 'unknown') {
  const event = String(eventName || '').trim().toLowerCase()
  const eventSource = String(source || 'unknown').trim().toLowerCase()
  if (!EVENT_RE.test(event) || !SOURCE_RE.test(eventSource)) return

  const attribution = readStoryAttribution()
  if (attribution && consumeStoryVisitFlag(attribution)) sendMetric('story_visit', attribution)

  sendMetric(event, eventSource)
  if (attribution && event !== 'story_visit' && event !== 'story_attributed') {
    sendMetric('story_attributed', `${attribution}:${event}`)
  }
}
