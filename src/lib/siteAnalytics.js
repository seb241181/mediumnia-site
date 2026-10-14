// Mesure d'audience Vercel Web Analytics — pages vues uniquement (plan Hobby).
// Les actions importantes (CTA, tirages, réservations) sont déjà mesurées par
// les compteurs MediumIA internes (mediumiaMetrics.js → /api/rdv-config).
//
// Aucun cookie, aucune donnée personnelle : l'adresse envoyée est nettoyée
// (fragments, jetons, paramètres personnels supprimés). Actif uniquement en
// production sur mediumia.fr.

export const PRODUCTION_HOSTS = new Set(['mediumia.fr', 'www.mediumia.fr'])
export const OPT_OUT_KEY = 'mediumia_noanalytics'
export const UTM_KEY = 'mediumia_utm'
export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign']

// Pages de gestion (propriétaire, espace pro) : jamais comptées.
const EXCLUDED_PATHS = [/^\/rdv\/?$/, /^\/pro(\/|$)/, /^\/agents(\/|$)/]
// Pages dont l'adresse contient un code personnel : le code n'est jamais envoyé.
const REDACTED_PATHS = [
  [/^\/carte-cadeau\/[^/]+/, '/carte-cadeau/[code]'],
  [/^\/pro\/conference-rehearsal\/[^/]+/, '/pro/conference-rehearsal/[code]'],
]

// Validation stricte des valeurs UTM : pas d'e-mail, pas de numéro de téléphone,
// pas de jeton, pas de caractères dangereux. Seuls les marqueurs de campagne
// légitimes passent.
const UTM_SAFE_RE = /^[a-zA-Z0-9._~+%-]{1,50}$/

function isValidUtmValue(raw) {
  if (!raw || typeof raw !== 'string') return false
  const v = raw.trim()
  if (!v || v.length > 50) return false
  // Rejeter tout ce qui ressemble à un e-mail, un téléphone ou un identifiant long.
  if (v.includes('@')) return false
  if (/\d{8,}/.test(v)) return false
  if (/^[A-Za-z0-9_-]{20,}$/.test(v) && /\d/.test(v)) return false
  return UTM_SAFE_RE.test(v)
}

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

// ── Paramètres de campagne : lus à l'arrivée, conservés pour la visite (onglet),
// réappliqués aux pages vues envoyées à Vercel.
export function captureUtm(win = globalThis.window) {
  if (!win) return null
  return safe(() => {
    const params = new URL(win.location.href).searchParams
    const found = {}
    for (const key of UTM_PARAMS) {
      const raw = params.get(key)
      if (raw && isValidUtmValue(raw)) found[key] = raw.trim().slice(0, 50)
    }
    if (Object.keys(found).length) win.sessionStorage.setItem(UTM_KEY, JSON.stringify(found))
    return storedUtm(win)
  }, null)
}

export function storedUtm(win = globalThis.window) {
  if (!win) return null
  return safe(() => {
    const value = JSON.parse(win.sessionStorage.getItem(UTM_KEY) || 'null')
    if (!value || typeof value !== 'object') return null
    const clean = {}
    for (const key of UTM_PARAMS) {
      if (typeof value[key] === 'string' && isValidUtmValue(value[key])) clean[key] = value[key].slice(0, 50)
    }
    return Object.keys(clean).length ? clean : null
  }, null)
}

// Adresse envoyée à Vercel : sans fragment, sans paramètre autre que utm_*,
// sans code personnel dans le chemin ; utm de la visite réappliqués.
export function sanitizeAnalyticsUrl(href, utm = null) {
  return safe(() => {
    const url = new URL(href)
    const kept = new URLSearchParams()
    for (const key of UTM_PARAMS) {
      const raw = url.searchParams.get(key) || utm?.[key]
      if (raw && isValidUtmValue(raw)) kept.set(key, raw.trim())
    }
    let path = url.pathname
    for (const [re, replacement] of REDACTED_PATHS) path = path.replace(re, replacement)
    path = path.split('/').map(part => (/^[A-Za-z0-9_-]{20,}$/.test(part) && /\d/.test(part) ? '[id]' : part)).join('/')
    const query = kept.toString()
    return `${url.origin}${path}${query ? `?${query}` : ''}`
  }, null)
}

// Filtre appliqué à chaque page vue envoyée par le composant <Analytics>.
// Appelé une fois dans main.jsx pour créer le callback de beforeSend.
export function makeBeforeSend(win = globalThis.window) {
  captureUtm(win)
  return (event) => {
    if (readOptOut(win)) return null
    const path = safe(() => new URL(event.url).pathname, '')
    if (EXCLUDED_PATHS.some(re => re.test(path))) return null
    const url = sanitizeAnalyticsUrl(event.url, storedUtm(win))
    return url ? { ...event, url } : null
  }
}
