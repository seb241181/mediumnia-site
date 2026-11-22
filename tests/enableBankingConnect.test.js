import test from 'node:test'
import assert from 'node:assert/strict'
import { selectApprovedBankAccount } from '../lib/enableBankingConnect.js'

const PRO_IBAN = 'FR7630006000011234567890189'
const OTHER_IBAN = 'FR7630006000019876543210189'
const PRO_UID = '8ec39203-f9ac-4998-b698-7e0496dd0e43'
const OTHER_UID = '67d43672-642e-429c-b89c-bb37b4b70972'

const account = (iban, uid, usage = 'ORGA', currency = 'EUR') => ({
  uid, account_id: { iban }, usage, currency,
})

test('Enable Banking authorize-session format: select only matching PRO account', () => {
  const fromProvider = {
    session_id: '20fd364d-078a-4b15-a813-236f3fa2a5fb',
    psu_type: 'business',
    aspsp: { name: 'Bank', country: 'FR' },
    accounts: [
      account(OTHER_IBAN, OTHER_UID),
      account(PRO_IBAN, PRO_UID),
    ],
  }
  assert.deepEqual(selectApprovedBankAccount(fromProvider.accounts, PRO_IBAN), fromProvider.accounts[1])
})

test('normalise l’IBAN avec des espaces sans le retourner ni le journaliser', () => {
  const one = account(PRO_IBAN, PRO_UID)
  const formatted = PRO_IBAN.slice(0, 4) + ' ' + PRO_IBAN.slice(4, 8) + ' ' + PRO_IBAN.slice(8)
  assert.deepEqual(selectApprovedBankAccount([one], formatted), one)
})

test('refuse compte privé, monnaie étrangère, identifiant manquant ou IBAN différent', () => {
  assert.equal(selectApprovedBankAccount([account(PRO_IBAN, PRO_UID, 'PRIV')], PRO_IBAN), null)
  assert.equal(selectApprovedBankAccount([account(PRO_IBAN, PRO_UID, 'ORGA', 'USD')], PRO_IBAN), null)
  assert.equal(selectApprovedBankAccount([account(PRO_IBAN, 'invalid')], PRO_IBAN), null)
  assert.equal(selectApprovedBankAccount([account(OTHER_IBAN, OTHER_UID)], PRO_IBAN), null)
  assert.equal(selectApprovedBankAccount([], PRO_IBAN), null)
  assert.equal(selectApprovedBankAccount([account(PRO_IBAN, PRO_UID)], 'invalid'), null)
})

test('deux comptes avec le même IBAN empêchent toute sélection automatique', () => {
  assert.equal(selectApprovedBankAccount([
    account(PRO_IBAN, PRO_UID), account(PRO_IBAN, OTHER_UID),
  ], PRO_IBAN), null)
})
