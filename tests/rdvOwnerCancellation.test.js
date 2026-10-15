import test from 'node:test'
import assert from 'node:assert/strict'
import { cancelOwnedBooking } from '../lib/rdvOwnerCancellation.js'

const BOOKING_ID = '9c37d4aa-a97f-413c-842b-72a467a0b789'
const PRACTITIONER_ID = 'f8516a7c-4d16-4e20-9292-49c6136c3fbf'
const USER_ID = '9ee96529-568a-49de-b5d8-bb2359fb99d2'
const input = { id: BOOKING_ID, practitioner_id: PRACTITIONER_ID, confirm: true }

function makeDb({ owned = true, googleEventId = 'google-test-123', entries = [
  { gross_cents: 2000, direction: 'income', payment_method: 'paypal' },
], email = 'test@example.invalid' } = {}) {
  const state = {
    booking: {
      id: BOOKING_ID, practitioner_id: PRACTITIONER_ID,
      service_id: 'ed7253a0-d33e-49c0-81f4-fd77a9372772',
      customer_first_name: 'Essai', customer_email: email, timezone: 'Europe/Paris',
      starts_at: '2099-11-16T10:00:00Z', status: 'confirmed', google_event_id: googleEventId,
      booking_source: 'mediumia',
    },
    entries: structuredClone(entries),
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
          if (table !== 'rdv_financial_entries') throw new Error('Unexpected query: '+table)
          return Promise.resolve({ data: state.entries, error: null }).then(resolve, reject)
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
