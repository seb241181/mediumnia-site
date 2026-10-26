import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { phoneActionHref } from '../src/lib/rdvPhoneActions.js'

test('un numéro de client ouvre Messages sans envoyer automatiquement', () => {
  assert.equal(phoneActionHref('06 12 34 56 78'), 'sms:0612345678')
  assert.equal(phoneActionHref('+33 (0) 6-12-34-56-78'), 'sms:+330612345678')
  assert.equal(phoneActionHref('+33 6 12 34 56 78'), 'sms:+33612345678')
  assert.equal(phoneActionHref('06 12 34 56 78', 'tel'), 'tel:0612345678')
})

test('les destinataires invalides ne produisent pas de lien actionnable', () => {
  for (const value of [null, '', '123', '+33123<script>', '+336+12345678', '06?body=Bonjour']) {
    assert.equal(phoneActionHref(value), null)
  }
  assert.equal(phoneActionHref('0612345678', 'https'), null)
})

test('la demande propose Messages au clic sur le numéro et Appeler en option', () => {
  const jsx = readFileSync(new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /href=\{messageHref\}/)
  assert.match(jsx, /Ouvrir Messages pour répondre/)
  assert.match(jsx, /href=\{callHref\}/)
  assert.match(jsx, /Appeler/)
})
