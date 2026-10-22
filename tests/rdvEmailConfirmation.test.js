import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getRdvEmailConfirmation } from '../lib/rdvEmailConfirmation.js'

test('reservation confirmation distinguishes a sent email', () => {
  assert.deepEqual(getRdvEmailConfirmation('sent'), {
    sent: true,
    message: 'Le service d’envoi a accepté l’e-mail de confirmation.',
  })
  assert.equal(getRdvEmailConfirmation('already_sent').sent, true)
})

test('reservation remains confirmed when email was not configured', () => {
  const result = getRdvEmailConfirmation('not_configured')
  assert.equal(result.sent, false)
  assert.match(result.message, /Aucun e-mail de confirmation n’a été envoyé/)
  assert.match(result.message, /Votre rendez-vous reste confirmé/)
})

test('a missing cancellation token does not claim email delivery', () => {
  const result = getRdvEmailConfirmation('not_sent_token_error')
  assert.equal(result.sent, false)
  assert.match(result.message, /Aucun e-mail de confirmation n’a été envoyé automatiquement/)
})

test('unknown or uncertain email status never claims sent or not sent', () => {
  for (const status of [undefined, 'pending', 'error', 'unexpected']) {
    const result = getRdvEmailConfirmation(status)
    assert.equal(result.sent, null)
    assert.match(result.message, /L’envoi de l’e-mail n’a pas pu être vérifié/)
  }
})

test('email status is preserved through payment polling and gift-card completion', async () => {
  const [checkout, giftCard, publicPage] = await Promise.all([
    readFile(new URL('../src/components/rdv/RdvDepositCheckout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/rdv/GiftCardRedeem.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(checkout, /email_confirmation:\s*status\.email_confirmation/)
  assert.match(giftCard, /email_confirmation:\s*data\.email_confirmation/)
  assert.match(publicPage, /result\.email_confirmation\s*\?\?\s*result\.emailConfirmation\s*\?\?\s*result\.emailStatus/)
  assert.match(publicPage, /emailConfirmation\.sent === true/)
})
