// Contexte de paiement pour « Signaler un problème de paiement ».
//
// Retient le parcours, l'étape et l'identifiant de la dernière tentative
// (commande ou abonnement PayPal) pour les joindre automatiquement à un
// signalement, même après un échec, un rechargement ou une session expirée.
//
// Observation seulement : l'enveloppe autour de paypal.Buttons ne modifie
// jamais les options, les valeurs renvoyées ni les erreurs, et ne déclenche
// aucune commande ni capture. En cas de souci, elle s'efface d'elle-même.

export const PAYMENT_ATTEMPT_KEY = 'mediumia:payment-attempt'
export const PAYMENT_ISSUE_OPEN_EVENT = 'mediumia:payment-issue-open'
const TTL_MS = 48 * 3_600_000
const ATTEMPT_RE = /^[A-Za-z0-9-]{8,64}$/
const STEP_RE = /^[a-z_]{1,40}$/

// Parcours de paiement selon la page ; null = pas de paiement sur cette page.
export function journeyForPath(pathname = '') {
  const path = String(pathname || '')
  if (path.startsWith('/chronosphere-max')) return 'chronosphere_max'
  if (path === '/chronosphere' || path.startsWith('/chronosphere/')) return 'chronosphere'
  if (path === '/rdv/solde') return 'rdv_balance'
  if (/^\/rdv\/(?!lumia(?:\/|$))[a-z0-9-]+\/?$/.test(path)) return 'rdv_deposit'
  if (path.startsWith('/formation/parcours')) return 'parcours'
  if (path === '/formation' || path.startsWith('/formation/')) return 'formation'
  if (path === '/question') return 'email_question'
  if (path === '/cartes-cadeaux' || path.startsWith('/carte-cadeau/')) return 'gift_card'
  if (path.startsWith('/pass/mediumia/') || path === '/conferences') return 'conference_pass'
  if (path === '/oracle') return 'oracle'
  return null
}

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export function rememberPaymentStep({ journey, step, attemptRef = null }, { store = storage(), now = Date.now() } = {}) {
  if (!store || !journey || !STEP_RE.test(String(step || ''))) return
  try {
    const previous = readPaymentAttempt({ store, now })
    // Une étape sans identifiant garde l'identifiant de la même tentative.
    const keepRef = !attemptRef && previous?.journey === journey ? previous.attemptRef : null
    const ref = ATTEMPT_RE.test(String(attemptRef || '')) ? String(attemptRef) : keepRef
    store.setItem(PAYMENT_ATTEMPT_KEY, JSON.stringify({ journey, step, attemptRef: ref, at: new Date(now).toISOString() }))
  } catch {
    // Stockage indisponible (navigation privée…) : le signalement reste possible sans contexte.
  }
}

export function readPaymentAttempt({ store = storage(), now = Date.now() } = {}) {
  if (!store) return null
  try {
    const value = JSON.parse(store.getItem(PAYMENT_ATTEMPT_KEY) || 'null')
    if (!value || !value.at || now - new Date(value.at).getTime() > TTL_MS) return null
    return value
  } catch {
    return null
  }
}

function safe(fn) {
  try { fn() } catch { /* jamais d'effet sur le paiement */ }
}

// Enveloppe d'observation des options de paypal.Buttons.
export function observeButtonOptions(options, record) {
  if (!options || typeof options !== 'object') return options
  const next = { ...options }
  const wrapCreate = (key, startStep, doneStep) => {
    if (typeof options[key] !== 'function') return
    next[key] = function observedCreate(...args) {
      safe(() => record(startStep, null))
      const result = options[key].apply(this, args)
      safe(() => Promise.resolve(result).then(
        (id) => safe(() => record(doneStep, typeof id === 'string' ? id : null)),
        () => safe(() => record(`${startStep}_failed`, null)),
      ))
      return result
    }
  }
  wrapCreate('createOrder', 'order_creation', 'order_created')
  wrapCreate('createSubscription', 'subscription_creation', 'subscription_created')
  if (typeof options.onApprove === 'function') {
    next.onApprove = function observedApprove(data, ...rest) {
      const ref = data?.orderID || data?.subscriptionID || null
      safe(() => record('approved', ref))
      const result = options.onApprove.call(this, data, ...rest)
      safe(() => Promise.resolve(result).then(
        () => safe(() => record('confirmation_returned', ref)),
        () => safe(() => record('confirmation_failed', ref)),
      ))
      return result
    }
  }
  if (typeof options.onError === 'function') {
    next.onError = function observedError(...args) {
      safe(() => record('paypal_error', null))
      return options.onError.apply(this, args)
    }
  }
  if (typeof options.onCancel === 'function') {
    next.onCancel = function observedCancel(data, ...rest) {
      safe(() => record('cancelled', data?.orderID || null))
      return options.onCancel.call(this, data, ...rest)
    }
  }
  return next
}

export function wrapPayPalButtons(paypal, record) {
  if (!paypal || typeof paypal.Buttons !== 'function' || paypal.Buttons.__mediumiaObserved) return paypal
  const original = paypal.Buttons
  function observedButtons(options, ...rest) {
    let observed
    try { observed = observeButtonOptions(options, record) } catch { observed = options }
    return original.call(this, observed, ...rest)
  }
  try {
    Object.assign(observedButtons, original)
    Object.defineProperty(observedButtons, '__mediumiaObserved', { value: true })
    paypal.Buttons = observedButtons
  } catch {
    // Propriété non modifiable : on laisse PayPal intact.
  }
  return paypal
}

// À appeler une fois au démarrage. Observe le SDK PayPal dès qu'il apparaît.
export function installPaymentAttemptObserver(win = typeof window !== 'undefined' ? window : null) {
  if (!win || win.__mediumiaPaymentObserver) return
  win.__mediumiaPaymentObserver = true
  const record = (step, attemptRef) => {
    const journey = journeyForPath(win.location?.pathname) || 'other'
    rememberPaymentStep({ journey, step, attemptRef })
  }
  let current = win.paypal
  try {
    Object.defineProperty(win, 'paypal', {
      configurable: true,
      enumerable: true,
      get() {
        if (current) wrapPayPalButtons(current, record)
        return current
      },
      set(value) {
        current = value
        if (value) wrapPayPalButtons(value, record)
      },
    })
  } catch {
    if (current) wrapPayPalButtons(current, record)
  }
}

// Contexte joint au signalement : seulement s'il concerne le même parcours.
export function issueContext(journey, attempt) {
  const sameJourney = attempt && (!journey || attempt.journey === journey)
  return {
    journey: journey || attempt?.journey || 'other',
    step: sameJourney ? attempt.step : null,
    attemptRef: sameJourney ? attempt.attemptRef : null,
    attemptAt: sameJourney ? attempt.at : null,
  }
}

export function openPaymentIssueReport(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PAYMENT_ISSUE_OPEN_EVENT, { detail }))
}
