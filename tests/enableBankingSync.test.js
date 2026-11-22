import test from 'node:test'
import assert from 'node:assert/strict'
import { protectBankValue } from '../lib/enableBankingAuth.js'
import { fetchBookCredits, syncBankConnection, bankSyncEnabled } from '../lib/enableBankingSync.js'

const PRACT = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'
const REQUEST = '55555555-5555-4555-8555-555555555555'
const REF = 'MDIA-012345ABCDEF'
const now = new Date('2026-11-22T12:00:00Z')
const config = { dataKey: Buffer.alloc(32, 1), aspsp: 'Banque Test' }
const conn = {
  status: 'active', practitioner_id: PRACT, owner_id: OWNER,
  session_id_enc: protectBankValue(SESSION, config),
  account_uid_enc: protectBankValue(ACCOUNT, config),
  valid_until: '2026-12-15T12:00:00Z',
}
const session = {
  status: 'AUTHORIZED', psu_type: 'business',
  aspsp: { name: 'Banque Test', country: 'FR' },
  accounts: [ACCOUNT], access: { valid_until: '2026-12-15T12:00:00Z' },
}
const bookedCredit = {
  status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_id: 'tx1',
  booking_date: '2026-11-21', remittance_information: [REF],
  transaction_amount: { amount: '70.00', currency: 'EUR' },
}
const requested = { id: REQUEST, transfer_reference: REF, amount_cents: 7000,
  status: 'pending', hold: { expires_at: '2026-11-30T12:00:00Z' } }

function fakeDatabase() {
  const records = { candidates: [], updates: [], requested: [requested] }
  const from = table => {
    const builder = {
      select() { return builder },
      eq() { return builder },
      order() { return builder },
      limit() { return builder },
      upsert(row) { records.candidates.push(row); return Promise.resolve({ error: null }) },
      update(row) { records.updates.push(row); return builder },
      then(resolve) {
        return Promise.resolve({
          data: table === 'rdv_bank_booking_requests' ? records.requested : null,
          error: null,
        }).then(resolve)
      },
    }
    return builder
  }
  return { records, from }
}

test('le contrôle quotidien est désactivé sans une autorisation de production', () => {
  assert.equal(bankSyncEnabled({}), false)
  assert.equal(bankSyncEnabled({ VERCEL_ENV: 'preview', ENABLE_BANKING_SYNC_ENABLED: 'true' }), false)
})

test('pagination complète avant tout rapprochement, dates UTC et statut BOOK', async () => {
  const calls = []
  const result = await fetchBookCredits(config, ACCOUNT, now, async (_config, kind, id, query) => {
    calls.push({ kind, id, query })
    return calls.length === 1
      ? { transactions: [bookedCredit], continuation_key: 'next-page' }
      : { transactions: [{ ...bookedCredit, transaction_id: 'tx2' }] }
  })
  assert.equal(result.length, 2)
  assert.deepEqual(calls.map(c => c.query.continuation_key), [undefined, 'next-page'])
  assert.equal(calls[0].query.date_to, '2026-11-22')
  await assert.rejects(() => fetchBookCredits(config, ACCOUNT, now,
    async () => ({ transactions: [], continuation_key: 'repeat' })), /bank_pagination_invalid/)
})

test('session bancaire valide et crédit exact = proposition uniquement, jamais paiement', async () => {
  const db = fakeDatabase()
  const result = await syncBankConnection({
    db, config, connection: conn, now,
    read: async (_config, kind) => kind === 'session' ? session : { transactions: [bookedCredit] },
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.candidates_processed, 1)
  assert.equal(db.records.candidates.length, 1)
  assert.deepEqual({
    request_id: db.records.candidates[0].request_id,
    amount_cents: db.records.candidates[0].amount_cents,
    status: db.records.candidates[0].status,
  }, { request_id: REQUEST, amount_cents: 7000, status: 'review_required' })
  assert.equal(db.records.candidates[0].transaction_hash.length, 64)
  assert.equal(db.records.updates.length, 1)
})

test('mauvais consentement, banque, compte ou type de PSU = aucun rapprochement', async () => {
  for (const bad of [
    { status: 'EXPIRED' }, { psu_type: 'personal' },
    { aspsp: { name: 'Autre', country: 'FR' } },
    { accounts: [SESSION] },
    { access: { valid_until: '2026-11-21T10:00:00Z' } },
  ]) {
    const db = fakeDatabase()
    const result = await syncBankConnection({
      db, config, connection: conn, now,
      read: async () => ({ ...session, ...bad }),
    })
    assert.equal(result.status, 'consent_invalid')
    assert.equal(db.records.candidates.length, 0)
  }
})


test('un consentement multi-comptes ne lit que le compte professionnel approuvé', async () => {
  const db = fakeDatabase()
  const accountReads = []
  const result = await syncBankConnection({
    db, config, connection: conn, now,
    read: async (_config, kind, id) => {
      if (kind === 'session') return { ...session, accounts: [SESSION, ACCOUNT] }
      accountReads.push(id)
      return { transactions: [bookedCredit] }
    },
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(accountReads, [ACCOUNT])
  assert.equal(db.records.candidates.length, 1)
})

test('mouvement au montant différent : aucune proposition conservée', async () => {
  const db = fakeDatabase()
  const result = await syncBankConnection({
    db, config, connection: conn, now,
    read: async (_config, kind) => kind === 'session' ? session
      : { transactions: [{ ...bookedCredit, transaction_amount: { amount: '20.00', currency: 'EUR' } }] },
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.candidates_processed, 0)
  assert.equal(db.records.candidates.length, 0)
})
