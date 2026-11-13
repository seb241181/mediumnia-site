import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleAccountApi, normalizePhone, shapeProfile, validateProfileInput } from '../lib/accountApiHandler.js'
import { bookingPrefill, fetchAccountProfile, profileErrorMessage, saveAccountProfile } from '../src/lib/accountProfile.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const USER = { id: 'u1', email: 'Alice@Exemple.fr', email_confirmed_at: '2026-01-01T00:00:00Z' }
const AUTH = { authorization: 'Bearer jeton' }

function fakeDb({ user = USER, row = null, bookings = [], allowed = true } = {}) {
  const writes = []
  return {
    writes,
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: null, error: { message: 'no' } }) },
    from(table) {
      let written = null
      const api = {
        select: () => api,
        eq: () => api,
        upsert(values, options) { written = values; writes.push({ table, values, options }); return api },
        maybeSingle: async () => ({ data: written || row, error: null }),
      }
      return api
    },
    async rpc(name) {
      if (name === 'consume_api_rate_limit') return { data: { allowed }, error: null }
      if (name === 'mediumia_account_sync_primary_email') return { data: { ok: true }, error: null }
      if (name === 'mediumia_account_bookings') return { data: bookings, error: null }
      return { data: null, error: { message: 'unknown' } }
    },
  }
}
function fakeRes() {
  return { statusCode: null, payload: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.payload = body; return this } }
}

test('téléphone : format international, numéros français convertis', () => {
  assert.deepEqual(normalizePhone('06 12 34 56 78'), { value: '+33612345678' })
  assert.deepEqual(normalizePhone('+32 470 12 34 56'), { value: '+32470123456' })
  assert.deepEqual(normalizePhone('0033 6 12 34 56 78'), { value: '+33612345678' })
  assert.deepEqual(normalizePhone(''), { value: null })
  assert.deepEqual(normalizePhone('12345'), { error: 'invalid_phone' })
  assert.deepEqual(normalizePhone('bonjour'), { error: 'invalid_phone' })
})

test('profil : seuls les champs autorisés sont retenus', () => {
  assert.deepEqual(validateProfileInput({ firstName: '  Alice ', lastName: 'Martin', phone: '0612345678', preferredVideoChannel: 'facetime', user_id: 'autre', full_name: 'x' }).values,
    { first_name: 'Alice', last_name: 'Martin', phone_e164: '+33612345678', preferred_video_channel: 'facetime' })
  assert.deepEqual(validateProfileInput({}).values, { first_name: null, last_name: null, phone_e164: null, preferred_video_channel: null })
  assert.equal(validateProfileInput({ firstName: 'a'.repeat(81) }).error, 'invalid_name')
  assert.equal(validateProfileInput({ preferredVideoChannel: 'zoom' }).error, 'invalid_video_channel')
  assert.equal(validateProfileInput({ phone: '12' }).error, 'invalid_phone')
})

test('profil vide : coordonnées du dernier rendez-vous proposées, sans être enregistrées', () => {
  const bookings = [
    { starts_at: '2026-01-01T10:00:00Z', customer_first_name: 'Ancien', customer_last_name: 'Nom', customer_phone: '+33600000000', video_channel: null },
    { starts_at: '2026-10-01T10:00:00Z', customer_first_name: 'Alice', customer_last_name: 'Martin', customer_phone: '+33612345678', video_channel: 'whatsapp' },
  ]
  assert.deepEqual(shapeProfile(null, bookings), { saved: false, firstName: 'Alice', lastName: 'Martin', phone: '+33612345678', preferredVideoChannel: 'whatsapp' })
  // Profil enregistré : il fait foi, même partiel.
  assert.deepEqual(shapeProfile({ first_name: 'Alicia', last_name: null, phone_e164: null, preferred_video_channel: null }, bookings),
    { saved: true, firstName: 'Alicia', lastName: null, phone: null, preferredVideoChannel: null })
  assert.deepEqual(shapeProfile(null, []), { saved: false, firstName: null, lastName: null, phone: null, preferredVideoChannel: null })
})

test('API profil : identité du jeton uniquement, écriture limitée au compte connecté', async () => {
  const anonymous = fakeRes()
  await handleAccountApi({ method: 'GET', headers: {} }, anonymous, 'profile', { supabase: fakeDb() })
  assert.equal(anonymous.statusCode, 401)
  const unverified = fakeRes()
  await handleAccountApi({ method: 'POST', headers: AUTH, body: {} }, unverified, 'profile', { supabase: fakeDb({ user: { ...USER, email_confirmed_at: null } }) })
  assert.equal(unverified.statusCode, 403)

  const read1 = fakeRes()
  await handleAccountApi({ method: 'GET', headers: AUTH }, read1, 'profile', { supabase: fakeDb({ row: { first_name: 'Alice', last_name: 'Martin', phone_e164: '+33612345678', preferred_video_channel: 'whatsapp' } }) })
  assert.deepEqual(read1.payload, { email: 'alice@exemple.fr', profile: { saved: true, firstName: 'Alice', lastName: 'Martin', phone: '+33612345678', preferredVideoChannel: 'whatsapp' } })

  const db = fakeDb()
  const saved = fakeRes()
  await handleAccountApi({ method: 'POST', headers: AUTH, body: { firstName: 'Alice', phone: '06 12 34 56 78', user_id: 'pirate', email: 'pirate@exemple.fr' } }, saved, 'profile', { supabase: db })
  assert.equal(saved.statusCode, 200)
  assert.equal(db.writes.length, 1)
  const { table, values, options } = db.writes[0]
  assert.equal(table, 'mediumia_profiles')
  assert.equal(values.user_id, 'u1')
  assert.deepEqual(Object.keys(values).sort(), ['first_name', 'last_name', 'phone_e164', 'preferred_video_channel', 'updated_at', 'user_id'])
  assert.equal(values.phone_e164, '+33612345678')
  assert.deepEqual(options, { onConflict: 'user_id' })

  const invalid = fakeRes()
  const db2 = fakeDb()
  await handleAccountApi({ method: 'POST', headers: AUTH, body: { phone: '12' } }, invalid, 'profile', { supabase: db2 })
  assert.deepEqual([invalid.statusCode, invalid.payload.error, db2.writes.length], [400, 'invalid_phone', 0])
  const limited = fakeRes()
  await handleAccountApi({ method: 'GET', headers: AUTH }, limited, 'profile', { supabase: fakeDb({ allowed: false }) })
  assert.equal(limited.statusCode, 429)
  const method = fakeRes()
  await handleAccountApi({ method: 'DELETE', headers: AUTH }, method, 'profile', { supabase: fakeDb() })
  assert.equal(method.statusCode, 405)
})

test('client : lecture et enregistrement tolérants aux pannes', async () => {
  assert.equal(await fetchAccountProfile(null), null)
  assert.equal(await fetchAccountProfile('t', async () => { throw new Error('réseau') }), null)
  assert.equal(await fetchAccountProfile('t', async () => ({ ok: false })), null)
  const sent = []
  const ok = await saveAccountProfile('t', { firstName: 'A', lastName: 'B', phone: '06', preferredVideoChannel: '' }, async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ profile: { firstName: 'A' } }) } })
  assert.deepEqual(ok, { profile: { firstName: 'A' } })
  assert.equal(sent[0].init.headers.Authorization, 'Bearer t')
  assert.equal(JSON.parse(sent[0].init.body).preferredVideoChannel, null)
  assert.deepEqual(await saveAccountProfile('t', {}, async () => ({ ok: false, json: async () => ({ error: 'invalid_phone' }) })), { error: 'invalid_phone' })
  assert.match(profileErrorMessage('invalid_phone'), /indicatif/)
})

test('réservation : préremplissage proposé, canal seulement à distance', () => {
  const profile = { firstName: 'Alice', lastName: 'Martin', phone: '+33612345678', preferredVideoChannel: 'facetime' }
  assert.deepEqual(bookingPrefill(profile, true), { firstName: 'Alice', lastName: 'Martin', phone: '+33612345678', videoChannel: 'facetime' })
  assert.equal(bookingPrefill(profile, false).videoChannel, '')
  assert.deepEqual(bookingPrefill(null), {})
  const form = read('src/components/rdv/RdvPublic.jsx')
  assert.match(form, /prefill=\{accountUser \? bookingPrefill\(accountProfile, selectedModality === 'video'\) : null\}/)
  assert.match(form, /marketingOptIn: false, \.\.\.\(prefill \|\| \{\}\) \}\)/)
  // Le préremplissage ne touche jamais au consentement ni au choix de compte.
  assert.equal(/marketingOptIn|wantsAccount/.test(read('src/lib/accountProfile.js')), false)
})

test('changement d’e-mail : confirmé par lien, jamais appliqué directement', () => {
  const auth = read('src/lib/useAuth.js')
  assert.match(auth, /supabase\.auth\.updateUser\(\{ email:/)
  const profile = read('src/components/account/ProfileForm.jsx')
  assert.match(profile, /Le changement ne sera effectif qu’après votre clic/)
  assert.equal(/mediumia_account_emails|customer_email/.test(profile + read('src/lib/accountProfile.js')), false)
  assert.match(read('src/components/account/AccountPage.jsx'), /<ProfileForm token=\{token\} email=\{user\.email\} requestEmailChange=\{requestEmailChange\} setPassword=\{setPassword\} \/>/)
})
