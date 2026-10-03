/**
 * Jeton LUMIA_INTAKE_TOKEN, lu au moment de l'envoi, jamais affiché ni écrit.
 * 1. Trousseau macOS : service « mediumia-lumia », compte « intake-token »
 *    (/usr/bin/security, sans shell).
 * 2. À défaut, variable d'environnement LUMIA_INTAKE_TOKEN (jamais dans Git).
 * Retourne null si aucun jeton : le bridge n'envoie alors rien.
 */
import { execFile } from 'node:child_process'

export const KEYCHAIN_SERVICE = 'mediumia-lumia'
export const KEYCHAIN_ACCOUNT = 'intake-token'

function keychainToken() {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { timeout: 10_000 }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null))
  })
}

export async function readToken({ env = process.env, keychain = keychainToken } = {}) {
  const fromKeychain = await keychain()
  const token = fromKeychain || String(env.LUMIA_INTAKE_TOKEN || '').trim() || null
  return token && token.length >= 32 ? token : null
}

// Présence seulement (commande « doctor ») : jamais la valeur.
export function keychainHasToken() {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
      { timeout: 10_000 }, (error) => resolve(!error))
  })
}
