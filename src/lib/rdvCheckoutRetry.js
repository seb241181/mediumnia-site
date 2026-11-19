export function assertCurrentCheckout(isCurrent) {
  if (!isCurrent()) throw new Error('checkout_context_changed')
}

export function createCheckoutOrderGate(now = Date.now) {
  const inFlight = new Map()
  let retryAt = 0
  let lastError

  return (checkoutId, paymentChoice, submit) => {
    const key = JSON.stringify([checkoutId, paymentChoice])
    if (inFlight.has(key)) return inFlight.get(key)
    if (now() < retryAt) return Promise.reject(lastError)
    const pending = Promise.resolve().then(submit).catch((error) => {
      if (error.message === 'checkout_context_changed') throw error
      const delay = error.retryAfterSeconds || 15
      const deadline = now() + delay * 1000
      if (deadline >= retryAt) {
        retryAt = deadline
        lastError = error
      }
      throw error
    }).finally(() => { inFlight.delete(key) })
    inFlight.set(key, pending)
    return pending
  }
}
