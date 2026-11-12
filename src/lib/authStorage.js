// Stockage de la session Supabase, avec l'option « Rester connecté ».
// - coché (par défaut) : session conservée sur l'appareil (localStorage) ;
// - décoché : session limitée à l'onglet, effacée à sa fermeture (sessionStorage).
// Seul le jeton de session géré par Supabase est stocké : jamais le mot de passe.

export const SESSION_ONLY_FLAG = 'mediumia-auth-session-only'

const safe = (action, fallback = null) => {
  try { return action() } catch { return fallback }
}

export function isSessionOnly(local) {
  return safe(() => local?.getItem(SESSION_ONLY_FLAG) === '1', false)
}

// À appeler juste avant une connexion.
export function setRememberMe(remember, local = globalThis.localStorage) {
  safe(() => (remember ? local.removeItem(SESSION_ONLY_FLAG) : local.setItem(SESSION_ONLY_FLAG, '1')))
}

export function createAuthStorage(local, session) {
  return {
    getItem(key) {
      return safe(() => session.getItem(key)) ?? safe(() => local.getItem(key))
    },
    setItem(key, value) {
      if (isSessionOnly(local)) {
        safe(() => session.setItem(key, value))
        safe(() => local.removeItem(key))
      } else {
        safe(() => local.setItem(key, value))
        safe(() => session.removeItem(key))
      }
    },
    removeItem(key) {
      safe(() => session.removeItem(key))
      safe(() => local.removeItem(key))
    },
  }
}
