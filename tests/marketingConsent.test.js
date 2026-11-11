/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  MARKETING_CONSENT_SHA256,
  buildMarketingConfirmationEmail,
  handleMarketingApi,
  marketingConfirmUrl,
  recordBookingConsent,
  unsubscribeTokenFor,
} from '../lib/marketingConsent.js'
import { MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION, MARKETING_STATUS_LABELS } from '../lib/marketingConsentText.js'
import { readEmailLinkFragment } from '../src/components/account/emailLink.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sha = (value) => createHash('sha256').update(value).digest('hex')
const NOW = new Date('2026-11-11T10:00:00Z')
process.env.MARKETING_TOKEN_SECRET = 'secret-de-test'

// Faux Supabase : rejoue les règles utiles de record_mediumia_marketing_consent.
function fakeDb({ current = null, user = null, allowed = true } = {}) {
  const calls = []
  return {
    calls,
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: null, error: { message: 'no' } }) },
    from() {
      const api = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: current, error: null }) }
      return api
    },
    async rpc(name, params) {
      calls.push({ name, params })
      if (name === 'consume_api_rate_limit') return { data: { allowed }, error: null }
      if (name === 'record_mediumia_marketing_consent') {
        const before = current?.status || 'none'
        if (params.p_event === 'presented_not_given') return { data: { ok: true, outcome: 'unchanged', status: before } }
        if (params.p_event === 'withdrawn') return { data: { ok: true, outcome: 'unsubscribed', status: 'unsubscribed' } }
        if (before === 'unsubscribed' && !(params.p_source === 'account' && params.p_identity_verified)) return { data: { ok: true, outcome: 'blocked_unsubscribed', status: 'unsubscribed' } }
        if (before === 'subscribed') return { data: { ok: true, outcome: 'unchanged', status: 'subscribed' } }
        if (params.p_identity_verified) return { data: { ok: true, outcome: 'subscribed', status: 'subscribed' } }
        return { data: { ok: true, outcome: 'pending', status: 'pending' } }
      }
      if (name === 'confirm_mediumia_marketing_consent') return { data: params.p_confirm_token_hash === sha('a'.repeat(64)) ? { ok: true, status: 'subscribed' } : { ok: false, error: 'invalid_token' } }
      if (name === 'withdraw_mediumia_marketing_consent_by_token') return { data: { ok: true, status: 'unsubscribed' } }
      return { data: null, error: { message: 'unknown' } }
    },
  }
}

function fakeRes() {
  return { headers: {}, statusCode: null, payload: null, setHeader(k, v) { this.headers[k] = v }, status(code) { this.statusCode = code; return this }, json(body) { this.payload = body; return this } }
}
const recorded = (db) => db.calls.filter((c) => c.name === 'record_mediumia_marketing_consent')

test('case non présentée : rien n’est enregistré', async () => {
  const db = fakeDb()
  assert.deepEqual(await recordBookingConsent(db, { email: 'a@b.fr', optIn: undefined }), { outcome: 'skipped' })
  assert.deepEqual(await recordBookingConsent(db, { email: '', optIn: true }), { outcome: 'skipped' })
  assert.equal(db.calls.length, 0)
})

test('case laissée vide : simple trace, aucun e-mail, aucun abonnement', async () => {
  const db = fakeDb()
  const sent = []
  await recordBookingConsent(db, { email: ' Alice@Exemple.fr ', optIn: false, holdId: 'h1', send: async (m) => sent.push(m) })
  const [call] = recorded(db)
  assert.equal(call.params.p_event, 'presented_not_given')
  assert.equal(call.params.p_email, 'alice@exemple.fr')
  assert.equal(call.params.p_identity_verified, false)
  assert.equal(call.params.p_hold_id, 'h1')
  assert.equal(sent.length, 0)
})

test('case cochée : « à confirmer » et e-mail de double confirmation', async () => {
  const db = fakeDb()
  const sent = []
  const result = await recordBookingConsent(db, { email: 'alice@exemple.fr', optIn: true, holdId: 'h1', now: NOW, send: async (m) => { sent.push(m); return { status: 'sent' } } })
  assert.deepEqual(result, { outcome: 'pending', email: 'sent' })
  const { params } = recorded(db)[0]
  assert.equal(params.p_event, 'opt_in')
  assert.equal(params.p_source, 'booking')
  assert.equal(params.p_identity_verified, false)
  assert.equal(params.p_text_version, MARKETING_CONSENT_VERSION)
  assert.equal(params.p_text_sha256, sha(MARKETING_CONSENT_TEXT))
  assert.equal(params.p_confirm_token_expires_at, '2026-11-18T10:00:00.000Z')
  assert.equal(params.p_unsubscribe_token_hash, sha(unsubscribeTokenFor('alice@exemple.fr')))
  // Le jeton en clair n'existe que dans l'e-mail ; la base ne reçoit que son hachage.
  const token = sent[0].text.match(/#confirmer=([0-9a-f]{64})/)[1]
  assert.equal(sha(token), params.p_confirm_token_hash)
  assert.equal(sent[0].to, 'alice@exemple.fr')
  assert.match(sent[0].subject, /Confirmez votre inscription/)
})

test('désinscrit : jamais réabonné par une réservation, aucun e-mail', async () => {
  const db = fakeDb({ current: { status: 'unsubscribed' } })
  const sent = []
  const result = await recordBookingConsent(db, { email: 'alice@exemple.fr', optIn: true, send: async (m) => sent.push(m) })
  assert.deepEqual(result, { outcome: 'blocked_unsubscribed' })
  assert.equal(sent.length, 0)
})

test('déjà abonné ou demande toute récente : pas de second e-mail', async () => {
  const sent = []
  const send = async (m) => sent.push(m)
  assert.deepEqual(await recordBookingConsent(fakeDb({ current: { status: 'subscribed' } }), { email: 'a@b.fr', optIn: true, send }), { outcome: 'unchanged' })
  const recent = fakeDb({ current: { status: 'pending', requested_at: '2026-11-11T09:30:00Z' } })
  assert.deepEqual(await recordBookingConsent(recent, { email: 'a@b.fr', optIn: true, now: NOW, send }), { outcome: 'pending_recent' })
  assert.equal(recorded(recent).length, 0)
  const old = fakeDb({ current: { status: 'pending', requested_at: '2026-11-10T09:30:00Z' } })
  assert.equal((await recordBookingConsent(old, { email: 'a@b.fr', optIn: true, now: NOW, send })).outcome, 'pending')
  assert.equal(sent.length, 1)
})

test('panne de la base ou de l’e-mail : jamais d’exception pendant la réservation', async () => {
  const broken = { from() { throw new Error('indisponible') }, rpc: async () => { throw new Error('indisponible') } }
  assert.deepEqual(await recordBookingConsent(broken, { email: 'a@b.fr', optIn: true }), { outcome: 'error' })
  assert.deepEqual(await recordBookingConsent(broken, { email: 'a@b.fr', optIn: false }), { outcome: 'error' })
  const result = await recordBookingConsent(fakeDb(), { email: 'a@b.fr', optIn: true, send: async () => { throw new Error('resend') } })
  assert.deepEqual(result, { outcome: 'error' })
})

test('jeton de désinscription : stable par adresse, lien dans le fragment', () => {
  assert.equal(unsubscribeTokenFor('Alice@Exemple.fr '), unsubscribeTokenFor('alice@exemple.fr'))
  assert.notEqual(unsubscribeTokenFor('alice@exemple.fr'), unsubscribeTokenFor('bob@exemple.fr'))
  assert.match(unsubscribeTokenFor('alice@exemple.fr'), /^[0-9a-f]{64}$/)
  assert.match(marketingConfirmUrl('a'.repeat(64)), /\/preferences-email#confirmer=a{64}$/)
  const email = buildMarketingConfirmationEmail({ confirmUrl: 'https://mediumia.fr/preferences-email#confirmer=abc' })
  assert.match(email.html, /Confirmer mon inscription/)
  assert.match(email.text, /rendez-vous ne dépendent pas/)
  assert.equal(MARKETING_CONSENT_SHA256, sha(MARKETING_CONSENT_TEXT))
})

test('API : confirmation et désinscription par lien, uniquement en POST', async () => {
  const get = fakeRes()
  await handleMarketingApi({ method: 'GET', headers: {} }, get, 'confirm', { supabase: fakeDb() })
  assert.equal(get.statusCode, 405)

  const ok = fakeRes()
  const db = fakeDb()
  await handleMarketingApi({ method: 'POST', headers: {}, body: { token: 'A'.repeat(64) } }, ok, 'confirm', { supabase: db })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(ok.payload, { status: 'subscribed' })
  assert.equal(ok.headers['Cache-Control'], 'no-store')

  const bad = fakeRes()
  await handleMarketingApi({ method: 'POST', headers: {}, body: { token: 'court' } }, bad, 'confirm', { supabase: fakeDb() })
  assert.equal(bad.statusCode, 400)
  const unknown = fakeRes()
  await handleMarketingApi({ method: 'POST', headers: {}, body: { token: 'b'.repeat(64) } }, unknown, 'confirm', { supabase: fakeDb() })
  assert.deepEqual([unknown.statusCode, unknown.payload.error], [400, 'invalid_token'])

  const out = fakeRes()
  await handleMarketingApi({ method: 'POST', headers: {}, body: JSON.stringify({ token: 'c'.repeat(64) }) }, out, 'unsubscribe', { supabase: fakeDb() })
  assert.deepEqual(out.payload, { status: 'unsubscribed' })

  const limited = fakeRes()
  await handleMarketingApi({ method: 'POST', headers: {}, body: { token: 'c'.repeat(64) } }, limited, 'unsubscribe', { supabase: fakeDb({ allowed: false }) })
  assert.equal(limited.statusCode, 429)
  const nope = fakeRes()
  await handleMarketingApi({ method: 'POST', headers: {} }, nope, 'autre', { supabase: fakeDb() })
  assert.equal(nope.statusCode, 404)
})

test('API compte : identité du jeton de session, jamais de la requête', async () => {
  const user = { id: 'u1', email: 'Alice@Exemple.fr', email_confirmed_at: '2026-01-01T00:00:00Z' }
  const headers = { authorization: 'Bearer jeton' }

  const anonymous = fakeRes()
  await handleMarketingApi({ method: 'GET', headers: {} }, anonymous, 'preferences', { supabase: fakeDb({ user }) })
  assert.equal(anonymous.statusCode, 401)
  const unverified = fakeRes()
  await handleMarketingApi({ method: 'GET', headers }, unverified, 'preferences', { supabase: fakeDb({ user: { ...user, email_confirmed_at: null } }) })
  assert.equal(unverified.statusCode, 403)

  const prefs = fakeRes()
  await handleMarketingApi({ method: 'GET', headers }, prefs, 'preferences', { supabase: fakeDb({ user, current: { status: 'unsubscribed' } }) })
  assert.deepEqual(prefs.payload, { status: 'unsubscribed', consentVersion: MARKETING_CONSENT_VERSION })
  const none = fakeRes()
  await handleMarketingApi({ method: 'GET', headers }, none, 'preferences', { supabase: fakeDb({ user }) })
  assert.equal(none.payload.status, 'none')

  // Désinscrit : seul l'espace personnel (adresse prouvée) peut réabonner.
  const db = fakeDb({ user, current: { status: 'unsubscribed' } })
  const sub = fakeRes()
  await handleMarketingApi({ method: 'POST', headers, body: { email: 'pirate@exemple.fr' } }, sub, 'subscribe', { supabase: db })
  assert.deepEqual(sub.payload, { status: 'subscribed' })
  const { params } = recorded(db)[0]
  assert.deepEqual([params.p_email, params.p_user_id, params.p_source, params.p_identity_verified, params.p_event], ['alice@exemple.fr', 'u1', 'account', true, 'opt_in'])

  const db2 = fakeDb({ user, current: { status: 'subscribed' } })
  const off = fakeRes()
  await handleMarketingApi({ method: 'POST', headers }, off, 'withdraw', { supabase: db2 })
  assert.deepEqual(off.payload, { status: 'unsubscribed' })
  assert.equal(recorded(db2)[0].params.p_event, 'withdrawn')
  const wrongMethod = fakeRes()
  await handleMarketingApi({ method: 'GET', headers }, wrongMethod, 'subscribe', { supabase: fakeDb({ user }) })
  assert.equal(wrongMethod.statusCode, 405)
})

test('formulaire : case décochée, facultative, séparée ; branchée dans les trois parcours', () => {
  const form = read('src/components/rdv/RdvPublic.jsx')
  const choices = read('src/components/rdv/RdvContactChoices.jsx')
  assert.match(form, /wantsAccount: '', marketingOptIn: false,/)
  assert.match(form, /marketingOptIn: contactForm\.marketingOptIn === true/)
  assert.match(choices, /type="checkbox" name="rdv-marketing-opt-in" checked=\{checked\}/)
  assert.equal(/required/.test(choices), false)
  const validate = form.slice(form.indexOf('function validate() {'), form.indexOf('return e', form.indexOf('function validate() {')))
  assert.equal(/marketingOptIn/.test(validate), false)
  for (const file of ['lib/rdvDepositApiHandler.js', 'lib/rdvFullPaymentApiHandler.js', 'api/rdv-book.js']) {
    assert.match(read(file), /await recordBookingConsent\(supabase, \{ email: customer\.email, optIn: customer\.marketingOptIn,/, file)
  }
  assert.match(read('api/rdv-config.js'), /handleMarketingApi\(req, res, marketingAction\)/)
})

test('statuts et pages : libellés, lien d’e-mail sans action automatique', () => {
  assert.deepEqual(MARKETING_STATUS_LABELS, { subscribed: 'Abonné', none: 'Non-abonné', unsubscribed: 'Désinscrit', pending: 'À confirmer' })
  assert.deepEqual(readEmailLinkFragment(`#confirmer=${'A'.repeat(64)}`), { kind: 'confirmer', token: 'a'.repeat(64) })
  assert.deepEqual(readEmailLinkFragment(`#desinscription=${'b'.repeat(64)}`), { kind: 'desinscription', token: 'b'.repeat(64) })
  assert.equal(readEmailLinkFragment('#confirmer=abc'), null)
  assert.equal(readEmailLinkFragment(''), null)
  const page = read('src/components/account/EmailPreferencesPage.jsx')
  // Aucun appel au chargement : seulement sur clic.
  assert.equal(/useEffect\(\(\) => \{[^}]*fetch/.test(page), false)
  assert.match(page, /onClick=\{submit\}/)
  assert.match(read('src/main.jsx'), /pathname === '\/preferences-email'/)
  assert.ok(JSON.parse(read('vercel.json')).rewrites.some((r) => r.source === '/preferences-email' && r.destination === '/index.html'))
  assert.match(read('src/components/account/AccountPage.jsx'), /<EmailPreferences token=\{token\} email=\{user\.email\} \/>/)
})
