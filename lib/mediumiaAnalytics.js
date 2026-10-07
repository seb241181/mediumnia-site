import { isSupabaseConfigured, getSupabaseAdmin } from './supabaseAdmin.js'

const ALLOWED_EVENTS = new Set([
  'home_view',
  'home_door_click',
  'ecosystem_door_click',
  'chronosphere_example_view',
  'chronosphere_example_cta',
  'chronosphere_payment_opened',
  'chronosphere_purchase_completed',
  'story_visit',
  'story_attributed',
  'question_view',
  'question_payment_started',
  'question_purchase_completed',
  'rdv_view',
  'rdv_booking_started',
  'rdv_booking_completed',
  'rdv_request_sent',
])

const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|question)(:(oracle|chronosphere|reseau|formation|question|q1|q2))?$/
const RDV_SOURCE_RE = /^rdv:(home-hero|home-consultations|home-interview|facebook-organic|instagram-organic|tiktok-organic|google-profile|google-business|solocal|pagesjaunes|apple-business|bing-business|trustpilot|direct)$/
const STORY_SOURCE_RE = /^story-(oracle|quiz)(:[a-z0-9_]{3,64})?$/

// Compteur de visites du site entier : une visite par onglet de navigation,
// envoyée par le navigateur (src/lib/siteVisit.js). Robots écartés ici.
const SITE_VISIT_EVENT = 'site_visit'
const SITE_VISIT_SOURCE = 'site'
const BOT_UA_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|axios|node-fetch/i

export function isLikelyBot(userAgent) {
  const ua = String(userAgent || '')
  return !ua || BOT_UA_RE.test(ua)
}

// Total public : visites du site depuis leur mise en place, plus, avant cette
// date, les visites de l'accueil déjà mesurées (depuis septembre 2026). Le jour
// de la bascule, on retient le plus grand des deux pour ne rien compter deux
// fois ni faire baisser le total.
export function summarizeSiteVisits(rows) {
  const byDate = new Map()
  let firstSiteVisitDate = null
  for (const row of rows || []) {
    const count = Number(row.event_count || 0)
    if (count <= 0 || (row.event_name !== SITE_VISIT_EVENT && row.event_name !== 'home_view')) continue
    const day = byDate.get(row.event_date) || { site: 0, home: 0 }
    if (row.event_name === SITE_VISIT_EVENT) {
      day.site += count
      if (!firstSiteVisitDate || row.event_date < firstSiteVisitDate) firstSiteVisitDate = row.event_date
    } else day.home += count
    byDate.set(row.event_date, day)
  }
  let visits = 0
  let since = null
  for (const [date, day] of byDate) {
    let count
    if (!firstSiteVisitDate || date < firstSiteVisitDate) count = day.home
    else if (date === firstSiteVisitDate) count = Math.max(day.home, day.site)
    else count = day.site
    if (count <= 0) continue
    visits += count
    if (!since || date < since) since = date
  }
  return { visits, since }
}

async function handlePublicStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isSupabaseConfigured()) return res.status(200).json({ visits: 0, since: null })
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('mediumia_event_daily_counts')
      .select('event_date, event_name, event_count')
      .in('event_name', [SITE_VISIT_EVENT, 'home_view'])
    if (error) return res.status(503).json({ error: 'stats_unavailable' })
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json(summarizeSiteVisits(data))
  } catch {
    return res.status(503).json({ error: 'stats_unavailable' })
  }
}

export async function handleMediumiaAnalytics(req, res, action) {
  if (action === 'public-stats') return handlePublicStats(req, res)
  if (action !== 'event') return res.status(404).json({ error: 'Unknown analytics action' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Preview/dev traffic must never pollute production product metrics.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return res.status(204).end()
  }

  const event = String(req.body?.event || '').trim().toLowerCase()
  const source = String(req.body?.source || '').trim().toLowerCase()

  const isSiteVisit = event === SITE_VISIT_EVENT && source === SITE_VISIT_SOURCE
  const validSource = SOURCE_RE.test(source) || STORY_SOURCE_RE.test(source) || RDV_SOURCE_RE.test(source)
  if (!isSiteVisit && (!ALLOWED_EVENTS.has(event) || !validSource)) {
    return res.status(400).json({ error: 'invalid_metric' })
  }
  if (isSiteVisit && isLikelyBot(req.headers?.['user-agent'])) return res.status(204).end()

  if (!isSupabaseConfigured()) {
    return res.status(204).end()
  }

  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.rpc('increment_mediumia_event', {
      p_event_name: event,
      p_source: source,
    })

    if (error) {
      console.warn('[mediumia-metrics] increment failed', error.code || 'unknown')
      return res.status(204).end()
    }
  } catch (error) {
    console.warn('[mediumia-metrics] unexpected failure', error?.message || 'unknown')
  }

  return res.status(204).end()
}
