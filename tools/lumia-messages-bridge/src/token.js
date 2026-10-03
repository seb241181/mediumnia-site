/**
 * Jetons lus au moment de l'envoi, jamais affichés ni écrits.
 * 1. Trousseau macOS : service « mediumia-lumia », compte « intake-token »
 *    (RDV) ou « inbox-token » (boîte de réception), via /usr/bin/security, sans shell.
 * 2. À défaut, variable d'environnement LUMIA_INTAKE_TOKEN / LUMIA_INBOX_TOKEN (jamais dans Git).
 * Retourne null si aucun jeton : le bridge n'envoie alors rien.
 */
import { execFile } from 'node:child_process'
import process from 'node:process'

export const KEYCHAIN_SERVICE = 'mediumia-lumia'
export const KEYCHAIN_ACCOUNT = 'intake-token'
export const INBOX_KEYCHAIN_ACCOUNT = 'inbox-token'

function keychainToken(account = KEYCHAIN_ACCOUNT) {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { timeout: 10_000 }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null))
  })
}

export async function readToken({ env = process.env, keychain = keychainToken } = {}) {
  const fromKeychain = await keychain(KEYCHAIN_ACCOUNT)
  const token = fromKeychain || String(env.LUMIA_INTAKE_TOKEN || '').trim() || null
  return token && token.length >= 32 ? token : null
}

export async function readInboxToken({ env = process.env, keychain = keychainToken } = {}) {
  const fromKeychain = await keychain(INBOX_KEYCHAIN_ACCOUNT)
  const token = fromKeychain || String(env.LUMIA_INBOX_TOKEN || '').trim() || null
  return token && token.length >= 32 ? token : null
}

// Présence seulement (commande « doctor ») : jamais la valeur.
export function keychainHasToken(account = KEYCHAIN_ACCOUNT) {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account],
      { timeout: 10_000 }, (error) => resolve(!error))
  })
}
