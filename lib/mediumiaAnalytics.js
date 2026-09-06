import { isSupabaseConfigured, getSupabaseAdmin } from './supabaseAdmin.js'

const ALLOWED_EVENTS = new Set([
  'home_view',
  'home_door_click',
  'ecosystem_door_click',
  'chronosphere_example_view',
  'chronosphere_example_cta',
  'chronosphere_payment_opened',
])

const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example)(:(oracle|chronosphere|reseau|formation))?$/

export async function handleMediumiaAnalytics(req, res, action) {
  if (action !== 'event') return res.status(404).json({ error: 'Unknown analytics action' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Preview/dev traffic must never pollute production product metrics.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return res.status(204).end()
  }

  const event = String(req.body?.event || '').trim().toLowerCase()
  const source = String(req.body?.source || '').trim().toLowerCase()

  if (!ALLOWED_EVENTS.has(event) || !SOURCE_RE.test(source)) {
    return res.status(400).json({ error: 'invalid_metric' })
  }

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
