import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('CGV des consultations : page dédiée et route accessible avant paiement', async () => {
  const [legal, app, checkout, footer] = await Promise.all([
    readFile('src/components/LegalPages.jsx','utf8'),
    readFile('src/App.jsx','utf8'),
    readFile('src/components/rdv/RdvDepositCheckout.jsx','utf8'),
    readFile('src/components/LegalFooter.jsx','utf8'),
  ])
  assert.match(legal, /export function ConditionsRdv/)
  assert.match(legal, /Au moins 48 heures avant/)
  assert.match(legal, /Moins de 48 heures avant/)
  assert.match(legal, /droit de rétractation/)
  assert.match(app, /p === '\/conditions-rdv'/)
  assert.match(app, /view === 'conditions-rdv'/)
  assert.match(footer, /href="\/conditions-rdv"/)
  assert.match(checkout, /href="\/conditions-rdv" target="_blank"/)
  assert.match(checkout, /J’ai lu et j’accepte/)
})
test('RDV : la nouvelle version des conditions est conservée dans tous les paiements', async () => {
  const [deposit, full, bank] = await Promise.all([
    readFile('lib/rdvDepositApiHandler.js','utf8'),
    readFile('lib/rdvFullPaymentApiHandler.js','utf8'),
    readFile('lib/rdvBankBooking.js','utf8'),
  ])
  for(const source of [deposit,full,bank]){
    assert.match(source, /RDV_TERMS_VERSION/)
    assert.match(source, /p_terms_version:\s*TERMS_VERSION/)
  }
})
