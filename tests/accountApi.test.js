import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAccountOverview, handleAccountApi, shapeAccountBooking } from '../lib/accountApiHandler.js'

const NOW = new Date('2026-11-11T10:00:00.000Z')

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

// Faux Supabase : chaque jeton correspond à un utilisateur, chaque utilisateur à ses rendez-vous.
function fakeSupabase({ users = {}, bookings = {}, rateAllowed = true, syncError = null } = {}) {
  const calls = []
  return {
    calls,
    auth: {
      async getUser(token) {
        const user = users[token]
        return user ? { data: { user }, error: null } : { data: { user: null }, error: new Error('invalid') }
      },
    },
    async rpc(name, params) {
      calls.push({ name, params })
      if (name === 'consume_api_rate_limit') return { data: { allowed: rateAllowed }, error: null }
      if (name === 'mediumia_account_sync_primary_email') return { data: syncError ? { ok: false, error: syncError } : { ok: true }, error: null }
      if (name === 'mediumia_account_bookings') return { data: bookings[params.p_user_id] || [], error: null }
      return { data: null, error: new Error('unexpected rpc') }
    },
  }
}

const ALICE = { id: 'user-alice', email: 'Alice@Example.fr', email_confirmed_at: '2026-11-01T00:00:00Z' }
const BOB = { id: 'user-bob', email: 'bob@example.fr', email_confirmed_at: '2026-11-01T00:00:00Z' }

const row = (overrides = {}) => ({
  id: 'booking-1',
  starts_at: '2026-12-01T09:00:00.000Z',
  ends_at: '2026-12-01T10:00:00.000Z',
  timezone: 'Europe/Paris',
  status: 'confirmed',
  cancelled_at: null,
  cancel_origin: null,
  service_title: 'Guidance',
  duration_min: 60,
  practitioner_name: 'Sébastien Seguin',
  customer_first_name: 'Alice',
  customer_last_name: 'Martin',
  customer_phone: '+33600000001',
  modality: 'video',
  video_channel: 'whatsapp',
  price_cents: 9000,
  paid_cents: 3000,
  payment_pending: false,
  entries: [{ kind: 'arrhes', direction: 'income', method: 'paypal', occurred_at: '2026-11-02T08:00:00Z', gross_cents: 3000 }],
  ...overrides,
})

const call = (supabase, { token, query = {}, method = 'GET' } = {}) => {
  const res = fakeRes()
  const req = { method, query, headers: token ? { authorization: `Bearer ${token}` } : {} }
  return handleAccountApi(req, res, 'overview', { supabase, now: NOW }).then(() => res)
}

test('sans jeton ou avec un jeton invalide : refusé, aucune lecture', async () => {
  const supabase = fakeSupabase({ users: { 'tok-alice': ALICE }, bookings: { 'user-alice': [row()] } })
  for (const token of [undefined, 'faux-jeton']) {
    const res = await call(supabase, { token })
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.error, 'unauthenticated')
  }
  assert.equal(supabase.calls.length, 0)
})

test('adresse non confirmée : refusé, aucune lecture', async () => {
  const supabase = fakeSupabase({ users: { tok: { ...ALICE, email_confirmed_at: null } } })
  const res = await call(supabase, { token: 'tok' })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'email_not_verified')
  assert.equal(supabase.calls.length, 0)
})

test('un compte ne peut pas lire les rendez-vous d’un autre, même en le demandant', async () => {
  const supabase = fakeSupabase({
    users: { 'tok-alice': ALICE, 'tok-bob': BOB },
    bookings: { 'user-alice': [row()], 'user-bob': [row({ id: 'booking-bob' })] },
  })
  // Bob tente de viser Alice par tous les paramètres imaginables.
  const res = await call(supabase, {
    token: 'tok-bob',
    query: { user_id: 'user-alice', userId: 'user-alice', email: 'alice@example.fr', p_user_id: 'user-alice', booking_id: 'booking-1' },
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.upcoming.map((b) => b.id), ['booking-bob'])
  for (const { name, params } of supabase.calls) {
    if (name !== 'consume_api_rate_limit') assert.deepEqual(params, { p_user_id: 'user-bob' })
  }
  assert.equal(res.body.account.email, 'bob@example.fr')
  assert.equal(res.headers['Cache-Control'], 'no-store')
})

test('limite de débit et méthode', async () => {
  const limited = await call(fakeSupabase({ users: { tok: ALICE }, rateAllowed: false }), { token: 'tok' })
  assert.equal(limited.statusCode, 429)
  const post = await call(fakeSupabase({ users: { tok: ALICE } }), { token: 'tok', method: 'POST' })
  assert.equal(post.statusCode, 405)
  const res = fakeRes()
  await handleAccountApi({ method: 'GET', query: {}, headers: {} }, res, 'inconnue', { supabase: fakeSupabase() })
  assert.equal(res.statusCode, 404)
})

test('adresse déjà rattachée à un autre compte : signalé, jamais fusionné', async () => {
  const supabase = fakeSupabase({ users: { tok: ALICE }, syncError: 'email_linked_to_other_account' })
  const res = await call(supabase, { token: 'tok' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.account.emailLinkedElsewhere, true)
  assert.deepEqual(res.body.upcoming, [])
})

test('arrhes réellement encaissées, solde restant et paiement en attente', () => {
  const booking = shapeAccountBooking(row({ payment_pending: true }))
  assert.equal(booking.amounts.depositPaidCents, 3000)
  assert.equal(booking.amounts.paidCents, 3000)
  assert.equal(booking.amounts.dueCents, 6000)
  // Le paiement en attente est signalé mais ne réduit pas le reste dû.
  assert.equal(booking.amounts.paymentPending, true)
  assert.equal(booking.payments.length, 1)
})

test('solde réglé, paiement intégral, remboursement et transfert d’arrhes', () => {
  const settled = shapeAccountBooking(row({
    paid_cents: 9000,
    entries: [
      { kind: 'arrhes', direction: 'income', method: 'paypal', gross_cents: 3000 },
      { kind: 'balance', direction: 'income', method: 'cash', gross_cents: 6000 },
    ],
  }))
  assert.equal(settled.amounts.balancePaidCents, 6000)
  assert.equal(settled.amounts.dueCents, 0)
  assert.equal(settled.payments[1].method, 'cash')

  const gift = shapeAccountBooking(row({ paid_cents: 9000, entries: [{ kind: 'full_payment', direction: 'income', method: 'gift_card', gross_cents: 9000 }] }))
  assert.equal(gift.amounts.fullPaymentCents, 9000)
  assert.equal(gift.payments[0].method, 'gift_card')

  const refunded = shapeAccountBooking(row({
    status: 'cancelled', cancelled_at: '2026-11-05T08:00:00Z', cancel_origin: 'client', paid_cents: 0,
    entries: [
      { kind: 'arrhes', direction: 'income', method: 'paypal', gross_cents: 3000 },
      { kind: 'refund', direction: 'refund', method: 'paypal', gross_cents: 3000 },
    ],
  }))
  assert.equal(refunded.amounts.refundedCents, 3000)
  assert.equal(refunded.amounts.paidCents, 0)
  assert.equal(refunded.amounts.dueCents, null)
  assert.deepEqual(refunded.cancellation, { at: '2026-11-05T08:00:00Z', origin: 'client' })

  const transferredAway = shapeAccountBooking(row({
    paid_cents: 0,
    entries: [
      { kind: 'arrhes', direction: 'income', method: 'paypal', gross_cents: 3000 },
      { kind: 'deposit_transfer', direction: 'refund', method: 'paypal', gross_cents: 3000 },
    ],
  }))
  assert.equal(transferredAway.amounts.depositPaidCents, 0)
})

test('mode de consultation : rien n’est inventé pour les anciens rendez-vous', () => {
  assert.equal(shapeAccountBooking(row()).videoChannel, 'whatsapp')
  assert.equal(shapeAccountBooking(row({ video_channel: 'facetime' })).videoChannel, 'facetime')
  assert.equal(shapeAccountBooking(row({ video_channel: 'a_preciser' })).videoChannel, null)
  assert.equal(shapeAccountBooking(row({ video_channel: 'meet' })).videoChannel, null)
  const inPerson = shapeAccountBooking(row({ modality: 'in-person', video_channel: 'whatsapp' }))
  assert.equal(inPerson.mode, 'in-person')
  assert.equal(inPerson.videoChannel, null)
  const unknown = shapeAccountBooking(row({ modality: null, video_channel: null, price_cents: null }))
  assert.equal(unknown.mode, null)
  assert.equal(unknown.amounts.priceCents, null)
  assert.equal(unknown.amounts.dueCents, null)
})

test('aucun champ interne ne sort, même si la base en renvoyait', () => {
  const booking = shapeAccountBooking(row({
    practitioner_notes: 'secret', customer_message: 'privé', google_meet_link: 'https://meet', cancel_reason: 'interne',
    balance_owner_decision_note: 'interne', entries: [{ kind: 'arrhes', direction: 'income', method: 'paypal', gross_cents: 3000, note: 'interne', external_payment_ref: 'PAYPAL-1' }],
  }))
  const json = JSON.stringify(booking)
  for (const leak of ['secret', 'privé', 'meet', 'interne', 'PAYPAL-1']) assert.equal(json.includes(leak), false, leak)
})

test('à venir et historique', () => {
  const { upcoming, past } = buildAccountOverview([
    row({ id: 'passé', starts_at: '2026-10-01T09:00:00Z', ends_at: '2026-10-01T10:00:00Z' }),
    row({ id: 'plus-tard', starts_at: '2027-01-10T09:00:00Z', ends_at: '2027-01-10T10:00:00Z' }),
    row({ id: 'bientôt' }),
    row({ id: 'annulé-futur', status: 'cancelled', starts_at: '2026-12-20T09:00:00Z', ends_at: '2026-12-20T10:00:00Z' }),
  ], NOW)
  assert.deepEqual(upcoming.map((b) => b.id), ['bientôt', 'plus-tard'])
  assert.deepEqual(past.map((b) => b.id), ['annulé-futur', 'passé'])
  assert.deepEqual(buildAccountOverview(null, NOW), { upcoming: [], past: [] })
})

test('l’action est branchée et les fonctions SQL restent réservées au serveur', () => {
  const api = readFileSync(new URL('../api/rdv-config.js', import.meta.url), 'utf8')
  assert.match(api, /req\.query\?\.accountAction/)
  for (const file of ['20261111100000_mediumia_account_foundation.sql', '20261111102000_mediumia_account_bookings_read.sql', '20261111103000_mediumia_marketing_consent.sql']) {
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    const created = [...sql.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1])
    assert.ok(created.length > 0)
    for (const name of created) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]*from public, anon, authenticated`), name)
    }
    assert.equal(/grant[^;]*to (anon|authenticated)/i.test(sql), false)
  }
})
