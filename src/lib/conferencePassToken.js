// Jeton du Pass conférence (#pass=… dans le lien reçu par e-mail).
//
// Le fragment est retiré de l'adresse dès la lecture (historique, captures d'écran,
// partage), mais le jeton est conservé dans le stockage de session de l'onglet, propre
// à cette page de Pass. Ainsi une annulation PayPal, un rechargement, un retour depuis
// PayPal ou une navigation ne renvoient plus vers « Recevoir mon Pass ».
// Lecture répétable : un second appel (rechargement, double exécution d'un effet React)
// retrouve le même jeton. Le jeton est oublié quand le Pass ne sert plus (payé, déjà
// utilisé, expiré) ; il disparaît aussi à la fermeture de l'onglet.

const PREFIX = 'mediumia:conference-pass:'
const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/
const MAX_AGE_MS = 31 * 24 * 3_600_000

function storageKey(pathname) {
  return PREFIX + String(pathname || '/').replace(/\/+$/, '')
}

function defaultEnv() {
  if (typeof window === 'undefined') return {}
  const storage = (() => { try { return window.sessionStorage } catch { return null } })()
  return { location: window.location, history: window.history, storage }
}

export function takePassToken({ location, history, storage, now = Date.now() } = defaultEnv()) {
  if (!location) return ''
  const key = storageKey(location.pathname)
  const hash = location.hash || ''
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const fromLink = params.get('pass') || ''

  if (params.has('pass')) {
    try { history?.replaceState({}, '', `${location.pathname}${location.search || ''}`) } catch { /* adresse inchangée */ }
  }
  if (TOKEN_RE.test(fromLink)) {
    try { storage?.setItem(key, JSON.stringify({ token: fromLink, savedAt: now })) } catch { /* navigation privée : jeton gardé en mémoire seulement */ }
    return fromLink
  }

  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null')
    if (saved && TOKEN_RE.test(saved.token || '') && now - Number(saved.savedAt || 0) <= MAX_AGE_MS) return saved.token
    if (saved) storage.removeItem(key)
  } catch { /* stockage illisible : comme sans jeton */ }
  return ''
}

export function forgetPassToken({ location, storage } = defaultEnv()) {
  try { storage?.removeItem(storageKey(location?.pathname)) } catch { /* rien à faire */ }
}
