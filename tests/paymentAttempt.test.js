import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const attempt = await import('../src/lib/paymentAttempt.js')
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function memoryStore() {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data }
}

test('le bouton apparaît sur chaque parcours de paiement, pas ailleurs', () => {
  const cases = {
    '/chronosphere': 'chronosphere', '/chronosphere/exemple': 'chronosphere', '/chronosphere-max': 'chronosphere_max',
    '/rdv/sebastien-seguin': 'rdv_deposit', '/rdv/solde': 'rdv_balance', '/formation': 'formation', '/formation/parcours': 'parcours',
    '/question': 'email_question', '/cartes-cadeaux': 'gift_card', '/carte-cadeau/XYZ': 'gift_card',
    '/pass/mediumia/conference-22-octobre': 'conference_pass', '/conferences': 'conference_pass', '/oracle': 'oracle',
    '/': null, '/mentions': null, '/rdv': null, '/rdv/lumia': null, '/reseau': null, '/pro': null,
  }
  for (const [path, journey] of Object.entries(cases)) assert.equal(attempt.journeyForPath(path), journey, path)
})

test('observation PayPal transparente : mêmes valeurs, mêmes erreurs, même « this »', async () => {
  const steps = []
  const record = (step, ref) => steps.push([step, ref])
  const self = { id: 'paypal-context' }
  const options = {
    style: { layout: 'vertical' },
    createOrder: async function () { assert.equal(this, self); return 'ORDER1234567890A' },
    onApprove: async function (data) { assert.equal(data.orderID, 'ORDER1234567890A'); throw new Error('capture refusée') },
    onError() { return 'erreur traitée' },
    onCancel: (data) => `annulé ${data.orderID}`,
  }
  const observed = attempt.observeButtonOptions(options, record)
  assert.equal(observed.style, options.style, 'autres options inchangées')
  assert.equal(await observed.createOrder.call(self), 'ORDER1234567890A')
  await assert.rejects(observed.onApprove.call(self, { orderID: 'ORDER1234567890A' }), /capture refusée/, 'l’erreur remonte telle quelle')
  assert.equal(observed.onError(new Error('x')), 'erreur traitée')
  assert.equal(observed.onCancel({ orderID: 'ORDER1234567890A' }), 'annulé ORDER1234567890A')
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(steps.map(([s]) => s), ['order_creation', 'order_created', 'approved', 'confirmation_failed', 'paypal_error', 'cancelled'])
  assert.ok(steps.some(([s, ref]) => s === 'order_created' && ref === 'ORDER1234567890A'))
})

test('un enregistrement défaillant ne casse jamais le paiement', async () => {
  const observed = attempt.observeButtonOptions({ createOrder: () => 'ORDER1234567890A', onApprove: () => 'ok' }, () => { throw new Error('stockage plein') })
  assert.equal(observed.createOrder(), 'ORDER1234567890A')
  assert.equal(observed.onApprove({ orderID: 'ORDER1234567890A' }), 'ok')
  const syncThrow = attempt.observeButtonOptions({ createOrder: () => { throw new Error('refus') } }, () => {})
  assert.throws(() => syncThrow.createOrder(), /refus/)
})

test('paypal.Buttons enveloppé une seule fois, propriétés et instance d’origine conservées', () => {
  const instance = { render: () => 'rendu' }
  function Buttons(opts) { Buttons.lastOptions = opts; return instance }
  Buttons.driver = 'zoid'
  const paypal = { Buttons, version: '5' }
  attempt.wrapPayPalButtons(paypal, () => {})
  const once = paypal.Buttons
  attempt.wrapPayPalButtons(paypal, () => {})
  assert.equal(paypal.Buttons, once, 'pas de double enveloppe')
  assert.equal(paypal.Buttons.driver, 'zoid')
  assert.equal(paypal.Buttons({ createOrder: () => 'A' }), instance)
  assert.equal(paypal.version, '5')
  const frozen = Object.freeze({ Buttons })
  assert.doesNotThrow(() => attempt.wrapPayPalButtons(frozen, () => {}), 'objet non modifiable : rien ne casse')
})

test('SDK chargé plus tard, ou complété après coup : observé dès l’accès', () => {
  const store = memoryStore()
  const original = globalThis.localStorage
  globalThis.localStorage = store
  try {
    const win = { location: { pathname: '/chronosphere-max' } }
    globalThis.window = win
    win.localStorage = store
    attempt.installPaymentAttemptObserver(win)
    const sdk = {}
    win.paypal = sdk // espace de noms créé d'abord
    sdk.Buttons = (opts) => opts // Buttons ajouté ensuite
    const opts = win.paypal.Buttons({ createOrder: () => 'ORDER1234567890A' })
    opts.createOrder()
    const saved = JSON.parse(store.getItem(attempt.PAYMENT_ATTEMPT_KEY))
    assert.deepEqual([saved.journey, saved.step], ['chronosphere_max', 'order_creation'])
  } finally {
    globalThis.localStorage = original
    delete globalThis.window
  }
})

test('contexte conservé 48 h (rechargement, session expirée), identifiant gardé d’une étape à l’autre', () => {
  const store = memoryStore()
  const t0 = Date.parse('2026-11-08T12:00:00Z')
  attempt.rememberPaymentStep({ journey: 'rdv_balance', step: 'order_created', attemptRef: '8AB12345CD678901E' }, { store, now: t0 })
  attempt.rememberPaymentStep({ journey: 'rdv_balance', step: 'capture_failed' }, { store, now: t0 + 1000 })
  const saved = attempt.readPaymentAttempt({ store, now: t0 + 2000 })
  assert.deepEqual([saved.step, saved.attemptRef], ['capture_failed', '8AB12345CD678901E'])
  assert.equal(attempt.readPaymentAttempt({ store, now: t0 + 49 * 3_600_000 }), null, 'expiré après 48 h')
  attempt.rememberPaymentStep({ journey: 'formation', step: 'order_created', attemptRef: '<b>bad' }, { store, now: t0 })
  assert.equal(attempt.readPaymentAttempt({ store, now: t0 }).attemptRef, null, 'identifiant invalide ignoré')
  const ctx = attempt.issueContext('chronosphere', { journey: 'formation', step: 'approved', attemptRef: 'X1234567', at: 'now' })
  assert.deepEqual(ctx, { journey: 'chronosphere', step: null, attemptRef: null, attemptAt: null }, 'jamais le contexte d’un autre parcours')
})

test('montage : bouton global, lien près de PayPal, fichiers ChronoSphère non modifiés', () => {
  const main = read('src/main.jsx')
  assert.match(main, /installPaymentAttemptObserver\(\)/)
  assert.match(main, /<PaymentIssueLauncher \/>/)
  assert.match(read('src/components/PayPalGuestNotice.jsx'), /openPaymentIssueReport\(\)/)
  for (const file of ['src/components/ChronospherePage.jsx', 'src/components/ChronosphereMaxPage.jsx', 'lib/chronospherePayPal.js']) {
    assert.doesNotMatch(read(file), /PaymentIssue|paymentAttempt/, `${file} intact (chantier Codex)`)
  }
  const form = read('src/components/PaymentIssueReport.jsx')
  assert.match(form, /paymentIssueAction=submit/)
  assert.match(form, /id="payment-issue-website"/, 'piège à robots')
  assert.match(form, /N’indiquez jamais de numéro de carte/)
})

test('solde RDV : formulaire propre à la page, sans jamais envoyer le jeton du lien', () => {
  const page = read('public/rdv-solde.html')
  assert.match(page, /id="issueForm"/)
  assert.match(page, /journey: 'rdv_balance'/)
  assert.match(page, /noteStep\('order_created', data\.id\)/)
  assert.match(page, /noteStep\('capture_failed', orderId\)/)
  const body = page.slice(page.indexOf("fetch('/api/rdv-config?paymentIssueAction=submit'"), page.indexOf("const body = await response.json()", page.indexOf('paymentIssueAction=submit')))
  assert.doesNotMatch(body, /\btoken\b/, 'le jeton du lien de solde ne part jamais')
  assert.match(page, /page_path: '\/rdv\/solde'/)
})
