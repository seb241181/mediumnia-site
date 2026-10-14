// Mesure d'audience Vercel Web Analytics — pages vues uniquement (plan Hobby).
// Les actions importantes (CTA, tirages, réservations) sont déjà mesurées par
// les compteurs MediumIA internes (mediumiaMetrics.js → /api/rdv-config).
//
// Aucun cookie, aucune donnée personnelle : l'adresse envoyée est nettoyée
// (fragments et paramètres supprimés, codes personnels masqués). Actif
// uniquement en production sur mediumia.fr.
//
// Attention : beforeSend supprime TOUS les paramètres de requête (y compris
// les UTM). Les statistiques UTM détaillées ne sont donc pas disponibles,
// ni sur le plan Hobby ni sur un plan supérieur, tant que ce filtre est actif.

export const PRODUCTION_HOSTS = new Set(['mediumia.fr', 'www.mediumia.fr'])
export const OPT_OUT_KEY = 'mediumia_noanalytics'

// Pages sensibles : gestion, paiement, annulation, administration.
// Jamais comptées dans les statistiques.
const EXCLUDED_PATHS = [
  /^\/rdv\/?$/,            // tableau de bord propriétaire
  /^\/rdv\/annuler(\/|$)/, // annulation de rendez-vous (jeton personnel)
  /^\/rdv\/solde(\/|$)/,   // paiement du solde (jeton personnel)
  /^\/pro(\/|$)/,          // espace professionnel et conférences
  /^\/agents(\/|$)/,       // administration des assistants IA
]

// Pages dont l'adresse contient un code personnel : le code n'est jamais envoyé.
const REDACTED_PATHS = [
  [/^\/carte-cadeau\/[^/]+/, '/carte-cadeau/[code]'],
  [/^\/pro\/conference-rehearsal\/[^/]+/, '/pro/conference-rehearsal/[code]'],
]

const safe = (fn, fallback = null) => {
  try { return fn() } catch { return fallback }
}

// ── Exclusion de mes propres visites : ?noanalytics=1 (mémorisé), ?noanalytics=0 pour réactiver.
export function readOptOut(win = globalThis.window) {
  if (!win) return true
  return safe(() => {
    const flag = new URL(win.location.href).searchParams.get('noanalytics')
    if (flag === '1') win.localStorage.setItem(OPT_OUT_KEY, '1')
    if (flag === '0') win.localStorage.removeItem(OPT_OUT_KEY)
    return win.localStorage.getItem(OPT_OUT_KEY) === '1'
  }, false)
}

const isProdBuild = () => safe(() => import.meta.env?.PROD === true, false)

// Production uniquement : build de production ET domaine mediumia.fr (jamais
// sur les déploiements de preview *.vercel.app ni en local), hors exclusion.
export function analyticsEnabled(win = globalThis.window, { prodBuild = isProdBuild() } = {}) {
  if (!win || !prodBuild) return false
  if (!PRODUCTION_HOSTS.has(String(win.location?.hostname || '').toLowerCase())) return false
  if (win.navigator?.webdriver) return false
  return !readOptOut(win)
}

// Adresse envoyée à Vercel : sans fragment, sans aucun paramètre de requête,
// sans code personnel dans le chemin.
export function sanitizeAnalyticsUrl(href) {
  return safe(() => {
    const url = new URL(href)
    let path = url.pathname
    for (const [re, replacement] of REDACTED_PATHS) path = path.replace(re, replacement)
    path = path.split('/').map(part => (/^[A-Za-z0-9_-]{20,}$/.test(part) && /\d/.test(part) ? '[id]' : part)).join('/')
    return `${url.origin}${path}`
  }, null)
}

// Filtre appliqué à chaque page vue envoyée par le composant <Analytics>.
// Appelé une fois dans main.jsx pour créer le callback de beforeSend.
export function makeBeforeSend(win = globalThis.window) {
  return (event) => {
    if (readOptOut(win)) return null
    const path = safe(() => new URL(event.url).pathname, '')
    if (EXCLUDED_PATHS.some(re => re.test(path))) return null
    const url = sanitizeAnalyticsUrl(event.url)
    return url ? { ...event, url } : null
  }
}
