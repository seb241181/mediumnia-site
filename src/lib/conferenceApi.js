const PROD_FUNCTIONS_BASE = 'https://uotkpygeqqnekpolezts.supabase.co/functions/v1'
const TEST_FUNCTIONS_BASE = 'https://wnbwhnqiulsdjcvkuwos.supabase.co/functions/v1'

const isPreviewHost = typeof window !== 'undefined'
  && window.location.hostname.endsWith('.vercel.app')

const base = isPreviewHost ? TEST_FUNCTIONS_BASE : PROD_FUNCTIONS_BASE

export const CONFERENCE_PUBLIC_API = `${base}/conference-public`
export const CONFERENCE_LIVE_API = `${base}/conference-live`

// Registration source, e.g. "conference_page:facebook" when the link shared on a
// network carries ?utm_source=facebook. Lets the owner see which network brings sign-ups.
export function registrationSource(search) {
  const utm = new URLSearchParams(search || '').get('utm_source') || ''
  const network = utm.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
  return network ? `conference_page:${network}` : 'conference_page'
}
