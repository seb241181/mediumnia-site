export function createAccountScope() {
  let active = true
  return { current: () => active, close: () => { active = false } }
}

export function maxAttemptKey(userId) {
  return `chronosphere_max_attempt:${userId}`
}

const userKeyPrefixes = ['chronosphere_max_attempt:', 'chronosphere_max_pending:', 'chronosphere_max_packToken:']

function clearMatchingKeys(storage, shouldRemove) {
  if (!storage) return
  try {
    const keys = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && shouldRemove(key)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch { /* Storage may be unavailable. */ }
}

export function clearChronosphereMaxUserState(previousUserId, local = globalThis.localStorage, session = globalThis.sessionStorage) {
  if (!previousUserId) return
  const keys = new Set(userKeyPrefixes.map((prefix) => `${prefix}${previousUserId}`))
  for (const storage of [local, session]) clearMatchingKeys(storage, (key) => keys.has(key))
}

export function clearChronosphereMaxOtherUserState(currentUserId, local = globalThis.localStorage, session = globalThis.sessionStorage) {
  for (const storage of [local, session]) {
    clearMatchingKeys(storage, (key) => userKeyPrefixes.some((prefix) => key.startsWith(prefix) && key !== `${prefix}${currentUserId}`))
  }
}

export function readMaxAttempt(storage, userId) {
  if (!userId) return null
  try {
    const value = JSON.parse(storage.getItem(maxAttemptKey(userId)) || 'null')
    if (!value || typeof value.nonce !== 'string') return null
    return { nonce: value.nonce, ...(typeof value.id === 'string' ? { id: value.id } : {}) }
  } catch { return null }
}

export function writeMaxAttempt(storage, userId, attempt) {
  // No birth data, e-mail, result or auth token is needed to resume a reading.
  if (!userId) return
  if (!attempt) storage.removeItem(maxAttemptKey(userId))
  else storage.setItem(maxAttemptKey(userId), JSON.stringify({ nonce: attempt.nonce, ...(attempt.id ? { id: attempt.id } : {}) }))
}
