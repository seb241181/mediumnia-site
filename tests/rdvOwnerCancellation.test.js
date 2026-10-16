import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelOwnedBooking } from '../lib/rdvOwnerCancellation.js'

const BOOKING_ID = '9c37d4aa-a97f-413c-842b-72a467a0b789'
const PRACTITIONER_ID = 'f8516a7c-4d16-4e20-9292-49c6136c3fbf'
const USER_ID = '9ee96529-568a-49de-b5d8-bb2359fb99d2'
const input = { id: BOOKING_ID, practitioner_id: PRACTITIONER_ID, confirm: true }

function makeDb({ owned = true, googleEventId = 'google-test-123', entries = [
  { gross_cents: 2000, direction: 'income', payment_method: 'paypal' },
], email = 'test@example.invalid', giftRedemptions = [], balancePayments = [],
  holdIds = [], depositPayments = [], reservationPaymentCents = 0,
  paymentLookupError = false } = {}) {
  const state = {
    booking: {
      id: BOOKING_ID, practitioner_id: PRACTITIONER_ID,
      service_id: 'ed7253a0-d33e-49c0-81f4-fd77a9372772',
      customer_first_name: 'Essai', customer_email: email, timezone: 'Europe/Paris',
      starts_at: '2099-11-16T10:00:00Z', status: 'confirmed', google_event_id: googleEventId,
      booking_source: 'mediumia', reservation_payment_cents: reservationPaymentCents,
    },
    entries: structuredClone(entries),
    giftRedemptions: structuredClone(giftRedemptions),
    balancePayments: structuredClone(balancePayments),
    holdIds: structuredClone(holdIds),
    depositPayments: structuredClone(depositPayments),
    paymentLookupError,
    updateCalls: 0,
    lookupCalls: 0,
  }
  const db = {
    from(table) {
      state.lookupCalls++
      const builder = {
        update(patch) { this.patch = patch; return this },
        select() { return this },
        eq() { return this },
        in() { return this },
        limit() { return this },
        maybeSingle() {
          if (table === 'booking_practitioners') return Promise.resolve({ data: owned ? { id: PRACTITIONER_ID } : null, error: null })
          if (table === 'bookings') {
            if (this.patch) {
              state.updateCalls++
              if (state.booking.status !== 'confirmed') return Promise.resolve({ data: null, error: null })
              Object.assign(state.booking, this.patch)
              return Promise.resolve({ data: { id: BOOKING_ID }, error: null })
            }
            return Promise.resolve({ data: { ...state.booking }, error: null })
          }
          throw new Error('Unexpected single: '+table)
        },
        then(resolve, reject) {
          const rows = {
            rdv_financial_entries: state.entries,
            gift_card_redemptions: state.giftRedemptions,
            rdv_balance_payments: state.balancePayments,
            rdv_booking_holds: state.holdIds.map(id => ({ id })),
            rdv_paypal_payments: state.depositPayments,
          }
          if (!(table in rows)) throw new Error('Unexpected query: '+table)
          return Promise.resolve({
            data: rows[table], error: state.paymentLookupError ? { code: 'TEST_DB_ERROR' } : null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  return { db, state }
}

const run = (db, deps = {}) => cancelOwnedBooking({
  db, userId: USER_ID, input, env: { VERCEL_ENV: 'test' },
  now: () => new Date('2026-10-15T16:00:00Z'),
  deleteGoogle: async () => ({ status: 'deleted' }),
  send: async () => ({ status: 'sent' }), ...deps,
})

test('preview reste en lecture seule, même avec confirmation explicite', async () => {
  const { db, state } = makeDb()
  const result = await run(db, { env: { VERCEL_ENV: 'preview' } })
  assert.equal(result.status, 403)
  assert.equal(state.lookupCalls, 0)
  assert.equal(state.updateCalls, 0)
})

test('l’annulation est réservée au propriétaire authentifié', async () => {
  const { db, state } = makeDb({ owned: false })
  const result = await run(db)
  assert.equal(result.status, 403)
  assert.equal(state.updateCalls, 0)
})

test('échec Google : aucun changement de statut ni remboursement', async () => {
  const { db, state } = makeDb()
  const result = await run(db, { deleteGoogle: async () => ({ status: 'failed' }) })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'google_delete_unconfirmed')
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.updateCalls, 0)
})

test('carte cadeau : annulation bloquée pour revue manuelle', async () => {
  const { db, state } = makeDb({ entries: [{ gross_cents: 990, direction: 'income', payment_method: 'gift_card' }] })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google ne doit pas être appelé') })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'gift_card_requires_manual_review')
  assert.equal(state.updateCalls, 0)
})

test('annulation réussie, paiements inchangés, mail idempotent, aucune deuxième mutation', async () => {
  const { db, state } = makeDb()
  const before = structuredClone(state.entries)
  let sends = 0, deletes = 0
  const deps = {
    deleteGoogle: async () => { deletes++; return { status: 'deleted' } },
    send: async () => { sends++; return { status: 'sent' } },
  }
  const result = await run(db, deps)
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.paid_cents, 2000)
  assert.equal(result.body.financial_review_required, true)
  assert.equal(state.booking.status, 'cancelled')
  assert.equal(state.booking.cancel_reason, 'practitioner_manual')
  assert.deepEqual(state.entries, before)
  const replay = await run(db, deps)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.already_cancelled, true)
  assert.equal(sends, 1)
  assert.equal(deletes, 1)
  assert.equal(state.updateCalls, 1)
})

test('échec e-mail signalé après annulation, sans annuler la mutation ni réessayer', async () => {
  const { db, state } = makeDb({ entries: [] })
  const result = await run(db, { send: async () => { throw new Error('email unavailable') } })
  assert.equal(result.status, 200)
  assert.equal(result.body.cancelled, true)
  assert.equal(result.body.email_status, 'error')
  assert.equal(state.booking.status, 'cancelled')
})

test('une consommation de carte cadeau connue du registre bloque même sans écriture de caisse', async () => {
  const { db, state } = makeDb({ entries: [], giftRedemptions: [{ id: 'gift-use' }] })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google must not be called') })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'gift_card_requires_manual_review')
  assert.equal(state.updateCalls, 0)
})

test('capture PayPal d’arrhes en cours : aucun RDV annulé, aucun événement Google supprimé', async () => {
  const { db, state } = makeDb({
    holdIds: ['hold-id'], depositPayments: [{ status: 'capturing', paypal_capture_id: null }],
  })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google must not be called') })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'payment_in_progress_requires_review')
  assert.equal(state.booking.status, 'confirmed')
})

test('solde PayPal encore en attente : annulation manuelle bloquée', async () => {
  const { db } = makeDb({
    balancePayments: [{ status: 'order_pending', paypal_capture_id: null }],
  })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google must not be called') })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'payment_in_progress_requires_review')
})

test('paiement capturé chez PayPal mais journal absent : rapprochement avant annulation', async () => {
  const { db, state } = makeDb({
    entries: [], holdIds: ['hold-id'],
    depositPayments: [{ status: 'captured', paypal_capture_id: 'CAPTURE-TEST-123' }],
  })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google must not be called') })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'payment_reconciliation_required')
  assert.equal(state.updateCalls, 0)
})

test('arrhes comptabilisées et prouvées : annulation et suivi financier obligatoire', async () => {
  const { db } = makeDb({
    entries: [{ gross_cents: 2000, direction: 'income', payment_method: 'paypal' }],
    holdIds: ['hold-id'],
    depositPayments: [{ status: 'captured', paypal_capture_id: 'CAPTURE-TEST-123' }],
    reservationPaymentCents: 2000,
  })
  const result = await run(db)
  assert.equal(result.status, 200)
  assert.equal(result.body.financial_review_required, true)
  assert.equal(result.body.paid_cents, 2000)
})

test('si le registre de paiement est indisponible, on n’annule pas', async () => {
  const { db, state } = makeDb({ paymentLookupError: true })
  const result = await run(db, { deleteGoogle: async () => assert.fail('Google must not be called') })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'payment_review_unavailable')
  assert.equal(state.updateCalls, 0)
})
