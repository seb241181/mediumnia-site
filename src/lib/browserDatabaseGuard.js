// Séparation TEST / PRODUCTION (navigateur) : une préversion ne se connecte
// jamais à la base de Production, et la Production à aucune autre base.
export const PRODUCTION_SUPABASE_HOST = 'uotkpygeqqnekpolezts.supabase.co'

export function browserDatabaseAllowed(url, tier) {
  if (!url) return false
  let host
  try { host = new URL(url).hostname.toLowerCase() } catch { return false }
  if (host === PRODUCTION_SUPABASE_HOST) return tier === 'production'
  return tier !== 'production'
}
