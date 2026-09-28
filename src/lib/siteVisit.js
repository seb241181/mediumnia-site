import { trackMediumiaMetric } from './mediumiaMetrics.js'

// Compteur de visites du site entier : une seule fois par onglet de navigation,
// quelle que soit la page d'arrivée. Aucun cookie, aucun identifiant : le
// serveur n'ajoute qu'un au total du jour. Les espaces de gestion (rendez-vous,
// pilotage, espace pro) ne comptent pas.
const KEY = 'mediumia_visit_counted'
const EXCLUDED = [/^\/rdv(\/|$)/, /^\/agents(\/|$)/, /^\/pro(\/|$)/]

export function countSiteVisitOnce(win = typeof window === 'undefined' ? null : window) {
  if (!win) return false
  if (win.navigator?.webdriver) return false
  if (EXCLUDED.some((re) => re.test(win.location?.pathname || ''))) return false
  try {
    if (win.sessionStorage.getItem(KEY)) return false
    win.sessionStorage.setItem(KEY, '1')
  } catch {
    // Stockage indisponible : on ne compte pas plutôt que de compter en double.
    return false
  }
  trackMediumiaMetric('site_visit', 'site')
  return true
}
