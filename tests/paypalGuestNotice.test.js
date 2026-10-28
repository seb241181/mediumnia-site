import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async path => readFile(new URL(path, import.meta.url), 'utf8')

test('guest payment info is honest and conditional on PayPal availability', async () => {
  const note = await read('../src/components/PayPalGuestNotice.jsx')
  assert.match(note, /Pas de compte PayPal/)
  assert.match(note, /sans créer de compte PayPal/)
  assert.match(note, /Si PayPal affiche/)
  assert.match(note, /peut ne pas être proposée/)
  assert.doesNotMatch(note, /paiement garanti|toujours disponible|aucun compte n.est nécessaire/i)
})

test('guest notice visible near one-time payment checkout, not monthly subscription', async () => {
  const pages = [
    '../src/components/rdv/RdvDepositCheckout.jsx',
    '../src/components/FormationPage.jsx',
    '../src/components/ConferencePassPage.jsx',
    '../src/components/OraclePage.jsx',
    '../src/components/ChronospherePage.jsx',
    '../src/components/QuestionPage.jsx',
    '../src/components/FormationParcoursPage.jsx',
  ]
  for (const path of pages) {
    const source = await read(path)
    assert.match(source, /import PayPalGuestNotice/, `Missing guest notice import: ${path}`)
    assert.match(source, /<PayPalGuestNotice/, `Missing guest notice rendering: ${path}`)
  }
  const parcours = await read('../src/components/FormationParcoursPage.jsx')
  const monthly = parcours.indexOf('<Consent id="consent-sub"')
  const oneTime = parcours.indexOf('<Consent id="consent-unlock"')
  const notice = parcours.indexOf('<PayPalGuestNotice')
  assert.ok(monthly >= 0 && oneTime > monthly && notice > monthly && notice < oneTime, 'Guest note must be for one-time unlock, not monthly subscription')
})

test('booking checkout payment functions unchanged and no account-free absolute promise', async () => {
  const checkout = await read('../src/components/rdv/RdvDepositCheckout.jsx')
  assert.match(checkout, /rdvDepositAction=\$\{action\}/)
  assert.match(checkout, /rdvDepositAction=capture/)
  assert.match(checkout, /onApprove: async data/)
  assert.doesNotMatch(checkout, /aucun compte n’est nécessaire/)
})
