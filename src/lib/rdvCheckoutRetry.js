export function createCheckoutOrderGate(now = Date.now) {
  let inFlight = null
  let retryAt = 0
  let lastError

  return (submit) => {
    if (inFlight) return inFlight
    if (now() < retryAt) return Promise.reject(lastError)
    inFlight = Promise.resolve().then(submit).catch((error) => {
      const delay = error.retryAfterSeconds || 15
      retryAt = now() + delay * 1000
      lastError = error
      throw error
    }).finally(() => { inFlight = null })
    return inFlight
  }
}
