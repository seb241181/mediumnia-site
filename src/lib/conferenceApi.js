const PROD_FUNCTIONS_BASE = 'https://uotkpygeqqnekpolezts.supabase.co/functions/v1'
const TEST_FUNCTIONS_BASE = 'https://wnbwhnqiulsdjcvkuwos.supabase.co/functions/v1'

// The build target, not the browser hostname, selects the environment.
const base = import.meta.env?.VITE_MEDIUMIA_DEPLOY_TIER === 'production'
  ? PROD_FUNCTIONS_BASE
  : TEST_FUNCTIONS_BASE

export const CONFERENCE_PUBLIC_API = `${base}/conference-public`
export const CONFERENCE_LIVE_API = `${base}/conference-live`

// Registration source, e.g. "conference_page:facebook" when the link shared on a
// network carries ?utm_source=facebook. Lets the owner see which network brings sign-ups.
export function registrationSource(search) {
  const utm = new URLSearchParams(search || '').get('utm_source') || ''
  const network = utm.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
  return network ? `conference_page:${network}` : 'conference_page'
}
