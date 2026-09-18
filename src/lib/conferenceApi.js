const PROD_FUNCTIONS_BASE = 'https://uotkpygeqqnekpolezts.supabase.co/functions/v1'
const TEST_FUNCTIONS_BASE = 'https://wnbwhnqiulsdjcvkuwos.supabase.co/functions/v1'

const isPreviewHost = typeof window !== 'undefined'
  && window.location.hostname.endsWith('.vercel.app')

const base = isPreviewHost ? TEST_FUNCTIONS_BASE : PROD_FUNCTIONS_BASE

export const CONFERENCE_PUBLIC_API = `${base}/conference-public`
export const CONFERENCE_LIVE_API = `${base}/conference-live`
