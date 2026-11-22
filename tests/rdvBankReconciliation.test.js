import test from 'node:test'
import assert from 'node:assert/strict'
import { proposeBankTransferMatches } from '../lib/rdvBankReconciliation.js'

const reference = 'MDIA-ABCDEF012345'
const request = { id: 'booking-request-1', reference, amount_cents: 7000, status: 'pending', expires_at: '2026-12-01T12:00:00Z' }
const bankCredit = { status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { amount: '70.00', currency: 'EUR' }, transaction_id: 'bank-1', booking_date: '2026-11-22', remittance_information: ['Virement pour', reference] }
const now = new Date('2026-11-22T12:00:00Z')

function run(transactions, requests = [request]) { return proposeBankTransferMatches({ transactions, requests, now }) }

test('une opération bancaire créditée avec référence exacte et montant exact reste à valider par le propriétaire', () => {
  const result = run([bankCredit])
  assert.deepEqual(result.review, [])
  assert.deepEqual(result.matches, [{ request_id: request.id, reference, amount_cents: 7000, bank_transaction_id: 'bank-1', booked_on: '2026-11-22', status: 'review_required' }])
})

test('débits et mouvements non comptabilisés ne prouvent jamais un encaissement', () => {
  for (const changes of [{ credit_debit_indicator: 'DBIT' }, { status: 'PDNG' }, { transaction_amount: { amount: '70.00', currency: 'USD' } }]) {
    assert.deepEqual(run([{ ...bankCredit, ...changes }]), { matches: [], review: [] })
  }
})

test('montant erroné, référence ambiguë, identifiant bancaire manquant → revue et jamais confirmation', () => {
  for (const changes of [
    { transaction_amount: { amount: '20.00', currency: 'EUR' } },
    { remittance_information: [reference, 'MDIA-1234567890AB'] },
    { transaction_id: null },
  ]) {
    const result = run([{ ...bankCredit, ...changes }])
    assert.equal(result.matches.length, 0)
    assert.equal(result.review.length, 1)
  }
})

test('doublons bancaires et demandes expirées ne sont pas approuvés', () => {
  assert.equal(run([bankCredit, { ...bankCredit, transaction_id: 'bank-2' }]).matches.length, 0)
  assert.deepEqual(run([bankCredit], [{ ...request, expires_at: '2026-11-21T12:00:00Z' }]).review[0]?.reason, 'request_expired')
})

test('virement sans référence ou demande déjà confirmée restent hors des correspondances', () => {
  assert.deepEqual(run([{ ...bankCredit, remittance_information: ['Merci'] }]), { matches: [], review: [] })
  assert.deepEqual(run([bankCredit], [{ ...request, status: 'confirmed' }]), { matches: [], review: [] })
})
