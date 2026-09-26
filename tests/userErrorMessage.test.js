import test from 'node:test'
import assert from 'node:assert/strict'
import { userErrorMessage, httpErrorMessage, NETWORK_MESSAGE, TIMEOUT_MESSAGE, DEFAULT_MESSAGE } from '../src/lib/userErrorMessage.js'

test('a technical code is never shown to the client', () => {
  for (const code of ['capture_failed', 'paypal_create_order_failed', 'auth_required', 'max_read_failed', 'invalid_pass', 'paypal_sdk_load_failed', 'some_new_code']) {
    const msg = userErrorMessage(new Error(code), 'Repli de l’écran.')
    assert.doesNotMatch(msg, /_/, `${code} → ${msg}`)
    assert.match(msg, /\s/, 'une vraie phrase')
  }
})

test('known codes get a precise message, unknown codes the screen fallback', () => {
  assert.match(userErrorMessage('auth_required'), /session a expiré/)
  assert.match(userErrorMessage('capture_failed'), /contact@mediumia\.fr/)
  assert.match(userErrorMessage('paypal_create_order_failed'), /Aucun montant n’a été prélevé/)
  assert.equal(userErrorMessage('brand_new_code', 'Repli.'), 'Repli.')
})

test('browser network and timeout errors are translated', () => {
  assert.equal(userErrorMessage(new TypeError('Failed to fetch')), NETWORK_MESSAGE)
  assert.equal(userErrorMessage(new TypeError('Load failed')), NETWORK_MESSAGE)
  const abort = new Error('The operation was aborted.'); abort.name = 'AbortError'
  assert.equal(userErrorMessage(abort), TIMEOUT_MESSAGE)
})

test('English technical messages fall back, French sentences are kept', () => {
  assert.equal(userErrorMessage(new SyntaxError('Unexpected token < in JSON at position 0'), 'Repli.'), 'Repli.')
  assert.equal(userErrorMessage(new Error('Erreur API'), 'Repli.'), 'Repli.')
  const french = 'Le paiement n’a pas encore été finalisé. Cliquez sur « Vérifier mon paiement » pour reprendre.'
  assert.equal(userErrorMessage(new Error(french)), french)
})

test('empty errors use the fallback, then the default message', () => {
  assert.equal(userErrorMessage(undefined, 'Repli.'), 'Repli.')
  assert.equal(userErrorMessage(null), DEFAULT_MESSAGE)
  assert.equal(userErrorMessage({ error: 'validation_failed' }).startsWith('Certaines informations'), true)
})

test('HTTP failures use the body first, then the status', () => {
  assert.match(httpErrorMessage(500, { error: 'invalid_email' }), /adresse e-mail/)
  assert.match(httpErrorMessage(401, {}), /session a expiré/)
  assert.match(httpErrorMessage(429, {}), /Trop de demandes/)
  assert.match(httpErrorMessage(503, {}), /momentanément indisponible/)
  assert.equal(httpErrorMessage(400, {}, 'Repli.'), 'Repli.')
})

test('English provider messages are never shown', () => {
  assert.match(userErrorMessage(new Error('Email rate limit exceeded')), /Trop de demandes/)
  assert.equal(userErrorMessage(new Error('Invalid login credentials'), 'Repli.'), 'Repli.')
  assert.equal(userErrorMessage(new Error('User already registered'), 'Repli.'), 'Repli.')
})
