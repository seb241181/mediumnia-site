// Parcours d'arrivée MediumIA Pro : après la création du compte sur /agents,
// le lien de confirmation de l'e-mail doit ramener dans l'espace pro, pas sur
// l'accueil. Le lien vise /agents (emailRedirectTo) ; si Supabase renvoie
// quand même vers l'accueil, ce petit repère local ramène la personne vers
// /agents dès que sa connexion est établie. Il ne contient aucune donnée
// personnelle : seulement une date d'expiration.

const KEY = 'mediumia:pro-onboarding'
const TTL_MS = 3 * 24 * 60 * 60 * 1000

export const PRO_SPACE_PATH = '/agents'

export function proConfirmationRedirectUrl(origin = window.location.origin) {
  return `${origin}${PRO_SPACE_PATH}`
}

export function markProOnboarding(now = Date.now()) {
  try { window.localStorage.setItem(KEY, String(now + TTL_MS)) } catch { /* stockage indisponible */ }
}

export function clearProOnboarding() {
  try { window.localStorage.removeItem(KEY) } catch { /* stockage indisponible */ }
}

export function hasPendingProOnboarding(now = Date.now()) {
  try {
    const until = Number(window.localStorage.getItem(KEY))
    if (!until) return false
    if (until < now) { clearProOnboarding(); return false }
    return true
  } catch {
    return false
  }
}

// À appeler une fois au démarrage : une connexion établie pendant le parcours
// Pro (confirmation d'e-mail) renvoie vers l'espace pro.
export function installProOnboardingRedirect(supabase) {
  if (!supabase || typeof window === 'undefined') return
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (!session || !['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) return
    if (!hasPendingProOnboarding()) return
    clearProOnboarding()
    if (!window.location.pathname.startsWith(PRO_SPACE_PATH)) window.location.replace(PRO_SPACE_PATH)
    data?.subscription?.unsubscribe?.()
  })
}
