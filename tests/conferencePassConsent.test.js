/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { handleConferencePassPayPal, __conferencePassPayPalTest } from '../lib/conferencePassPayPal.js'
import { buildConferencePassEmail, buildConferencePassConfirmationEmail, PAYPAL_INSTALMENTS_NOTICE, NON_CUMULATIVE_NOTICE } from '../lib/conferencePassEmail.js'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const EVENT_ID = 'ev-1'
const ENDS_AT = '2026-10-22T18:00:00.000Z'

// ── Base simulée : uniquement les opérations utilisées par le serveur du Pass ────
function fakeDb(seed) {
  const tables = structuredClone(seed)
  const calls = { rpc: [] }
  const failInserts = new Set()
  let seq = 0
  function builder(table) {
    const filters = []
    let op = 'select'
    let payload = null
    const match = (row) => filters.every((f) => f(row))
    const run = () => {
      const rows = tables[table] || (tables[table] = [])
      if (op === 'insert') {
        if (failInserts.has(table)) return { data: null, error: { code: 'XX000' } }
        const row = { id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...payload }
        if (table === 'conference_passes' && rows.some((r) => r.event_id === row.event_id && r.registration_id === row.registration_id)) {
          return { data: null, error: { code: '23505' } }
        }
        if (table === 'mediumia_paypal_purchases' && rows.some((r) => r.paypal_order_id === row.paypal_order_id || r.paypal_capture_id === row.paypal_capture_id)) {
          return { data: null, error: { code: '23505' } }
        }
        rows.push(row)
        return { data: [{ ...row }], error: null }
      }
      if (op === 'update') {
        const hit = rows.filter(match)
        hit.forEach((row) => Object.assign(row, payload))
        return { data: hit.map((row) => ({ ...row })), error: null }
      }
      if (op === 'delete') {
        const keep = rows.filter((row) => !match(row))
        const removed = rows.length - keep.length
        tables[table] = keep
        return { data: removed, error: null }
      }
      return { data: rows.filter(match).map((row) => ({ ...row })), error: null }
    }
    const b = {
      select: () => b,
      insert: (row) => { op = 'insert'; payload = row; return b },
      update: (values) => { op = 'update'; payload = values; return b },
      delete: () => { op = 'delete'; return b },
      eq: (c, v) => { filters.push((r) => r[c] === v); return b },
      neq: (c, v) => { filters.push((r) => r[c] !== v); return b },
      is: (c, v) => { filters.push((r) => (r[c] ?? null) === v); return b },
      order: () => b,
      maybeSingle: async () => { const { data, error } = run(); return { data: Array.isArray(data) ? data[0] || null : data, error } },
      single: async () => { const { data, error } = run(); return { data: Array.isArray(data) ? data[0] || null : data, error } },
      then: (resolve) => resolve(run()),
    }
    return b
  }
  return {
    tables,
    calls,
    failInserts,
    from: builder,
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args })
      if (fn === 'validate_conference_pass') {
        const pass = tables.conference_passes.find((p) => p.token_hash === args.p_token_hash)
        if (!pass) return { data: { ok: false, reason: 'invalid_pass' }, error: null }
        return { data: { ok: true, passId: pass.id, offerEnabled: true, offerAmountCents: 49900, expiresAt: pass.expires_at }, error: null }
      }
      if (fn === 'reserve_conference_pass_checkout') return { data: { ok: true }, error: null }
      if (fn === 'mediumia_find_user_id_by_email') return { data: 'u-buyer', error: null }
      if (fn === 'mediumia_grant_purchase_atomic') {
        const existing = (tables.mediumia_entitlements ||= []).find((e) => e.origin_ref === args.p_origin_ref)
        if (existing) return { data: { status: 'already_granted', entitlement_id: existing.id, access_expires_at: existing.access_expires_at }, error: null }
        const start = new Date()
        // Valeurs par défaut de la table en Production : accès complet, module 25.
        const row = { id: `ent-${tables.mediumia_entitlements.length + 1}`, user_id: args.p_user_id, type: 'purchase', origin_ref: args.p_origin_ref, status: 'active', access_level: 'full', max_module: 25, access_started_at: start.toISOString(), access_expires_at: new Date(start.getTime() + args.p_duration_days * 86400000).toISOString() }
        tables.mediumia_entitlements.push(row)
        return { data: { status: 'granted', entitlement_id: row.id, access_expires_at: row.access_expires_at }, error: null }
      }
      if (fn === 'redeem_conference_pass_after_payment') {
        const pass = tables.conference_passes.find((p) => p.paypal_order_id === args.p_paypal_order_id)
        const already = !!pass.redeemed_at
        Object.assign(pass, { redeemed_at: pass.redeemed_at || new Date().toISOString(), paypal_capture_id: args.p_paypal_capture_id, status: 'redeemed', user_id: args.p_user_id, entitlement_id: args.p_entitlement_id })
        return { data: { ok: true, alreadyRedeemed: already }, error: null }
      }
      return { data: null, error: null }
    },
    auth: { getUser: async (token) => (token === 'admin' ? { data: { user: { id: 'u-admin' } }, error: null } : { data: null, error: new Error('no') }) },
  }
}

const seed = () => ({
  conference_events: [{ id: EVENT_ID, slug: 'premiere-conference-mediumia', title: 'Et si la médiumnité devenait accessible ?', ends_at: ENDS_AT, status: 'registration_open', pass_duration_hours: 720, pass_offer_enabled: true, pass_offer_amount_cents: 49900, pass_offer_currency: 'EUR', pass_offer_label: 'Tarif réservé aux participants de la conférence', pass_normal_amount_cents: 59700 }],
  conference_registrations: [
    { id: 'r-ada', event_id: EVENT_ID, email_normalized: 'ada@example.org', first_name: 'Ada', status: 'registered', created_at: '2026-10-20T10:00:00.000Z' },
    { id: 'r-bob', event_id: EVENT_ID, email_normalized: 'bob@example.org', first_name: 'Bob', status: 'registered', created_at: '2026-10-21T10:00:00.000Z' },
    { id: 'r-late', event_id: EVENT_ID, email_normalized: 'late@example.org', first_name: 'Late', status: 'registered', created_at: '2026-10-23T08:00:00.000Z' },
  ],
  conference_passes: [],
  conference_pass_events: [],
  conference_admins: [{ user_id: 'u-admin' }],
  mediumia_students: [{ user_id: 'u-buyer', license_number: 'MID-2026-000042', display_name: 'Ada' }],
  mediumia_paypal_purchases: [],
})

// ── Faux réseau : Resend et PayPal ─────────────────────────────────────────────
let mails = []
let paypalCalls = []
let resendStatus = 200
let resendThrows = false
const realFetch = globalThis.fetch
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (u.startsWith('https://api.resend.com/emails')) {
      if (resendThrows) throw new Error('network')
      mails.push({ body: JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] })
      return { ok: resendStatus === 200, status: resendStatus, json: async () => ({ id: `mail-${mails.length}` }) }
    }
    if (u.includes('paypal.com')) {
      paypalCalls.push(u)
      if (u.endsWith('/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
      if (u.endsWith('/v2/checkout/orders')) return { ok: true, status: 201, json: async () => ({ id: 'ORDER123' }) }
      if (u.endsWith('/v2/checkout/orders/ORDER123')) return { ok: true, status: 200, json: async () => ({ id: 'ORDER123', status: 'APPROVED' }) }
      if (u.endsWith('/v2/checkout/orders/ORDER123/capture')) {
        return { ok: true, status: 201, json: async () => ({
          id: 'ORDER123', status: 'COMPLETED', payer: { email_address: 'autre-compte-paypal@example.org', name: { given_name: 'Ada' } },
          purchase_units: [{ reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', custom_id: __conferencePassPayPalTest.TERMS_CUSTOM_ID, payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' }, create_time: '2026-10-24T10:00:00Z' }] } }],
        }) }
      }
    }
    throw new Error(`unexpected fetch ${u}`)
  }
}

function response() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}
async function call(db, action, { body = {}, method = 'POST', headers = {} } = {}) {
  const res = response()
  await handleConferencePassPayPal({ method, body, query: {}, headers }, res, action, { supabase: db })
  return res
}
const conferencesText = (source) => source.replace(/<[^>]+>/g, '')
const passLink = (mail) => decodeURIComponent(mail.body.text.match(/#pass=([^\s]+)/)[1])

test.beforeEach(() => {
  mails = []
  paypalCalls = []
  resendStatus = 200
  resendThrows = false
  process.env.RESEND_API_KEY = 'test-key'
  process.env.PAYPAL_CLIENT_ID = 'client'
  process.env.PAYPAL_CLIENT_SECRET = 'secret'
  delete process.env.VERCEL_ENV
  delete process.env.PAYPAL_CONFERENCE_PASS_ENABLED
  installFetch()
})
test.after(() => { globalThis.fetch = realFetch })

test('demande : accord explicite et e-mail valide obligatoires', async () => {
  const db = fakeDb(seed())
  assert.deepEqual([(await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'ada@example.org' } })).body.error], ['consent_required'])
  assert.equal((await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'pas-un-email', consent: true } })).statusCode, 400)
  assert.equal(mails.length, 0)
})

test('demande : même réponse pour une adresse inconnue ou inscrite après la conférence, sans Pass ni e-mail', async () => {
  const db = fakeDb(seed())
  const unknown = await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'inconnu@example.org', consent: true } })
  const late = await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'late@example.org', consent: true } })
  const known = await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'ADA@example.org ', consent: true } })
  assert.deepEqual([unknown.statusCode, unknown.body], [202, { ok: true, message: 'request_received' }])
  assert.deepEqual(late.body, unknown.body)
  assert.deepEqual(known.body, unknown.body)
  assert.equal(mails.length, 1)
  assert.equal(mails[0].body.to, 'ada@example.org')
  assert.equal(db.tables.conference_registrations.find((r) => r.id === 'r-late').offer_consent_at, undefined)
})

test('demande : accord enregistré, Pass haché créé, lien personnel envoyé une seule fois', async () => {
  const db = fakeDb(seed())
  await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'ada@example.org', consent: true } })
  const reg = db.tables.conference_registrations.find((r) => r.id === 'r-ada')
  assert.ok(reg.offer_consent_at)
  assert.equal(reg.offer_consent_source, 'pass_request')
  assert.equal(reg.offer_consent_version, __conferencePassPayPalTest.OFFER_CONSENT_VERSION)
  const [pass] = db.tables.conference_passes
  const token = passLink(mails[0])
  assert.equal(pass.token_hash, sha(token))
  assert.equal(pass.send_count, 1)
  assert.equal(new Date(pass.expires_at) - new Date(pass.issued_at), 720 * 3600 * 1000)
  assert.equal(mails[0].idempotencyKey, 'conference-pass-r-ada-1')
  assert.match(mails[0].body.text, /499\s€/)
  assert.deepEqual(db.tables.conference_pass_events.map((e) => e.event_name), ['pass_requested', 'pass_issued'])
})

test('demande répétée : rien pendant 2 minutes, puis nouveau lien qui remplace l’ancien sans second Pass', async () => {
  const db = fakeDb(seed())
  const body = { slug: 'premiere-conference-mediumia', email: 'ada@example.org', consent: true }
  await call(db, 'request', { body })
  await call(db, 'request', { body })
  assert.equal(mails.length, 1)
  const pass = db.tables.conference_passes[0]
  const firstHash = pass.token_hash
  pass.last_sent_at = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  await call(db, 'request', { body })
  assert.equal(db.tables.conference_passes.length, 1)
  assert.equal(mails.length, 2)
  assert.notEqual(pass.token_hash, firstHash)
  assert.equal(pass.token_hash, sha(passLink(mails[1])))
  assert.equal(pass.send_count, 2)
  assert.equal(mails[1].idempotencyKey, 'conference-pass-r-ada-2')
  assert.equal(db.tables.conference_pass_events.at(-1).event_name, 'pass_resent')
})

test('échec d’envoi : Pass neuf supprimé, ancien lien restauré, envoi incertain conservé, tout est journalisé', async () => {
  const db = fakeDb(seed())
  const body = { slug: 'premiere-conference-mediumia', email: 'ada@example.org', consent: true }
  resendStatus = 500
  await call(db, 'request', { body })
  assert.equal(db.tables.conference_passes.length, 0)
  assert.equal(db.tables.conference_pass_events.at(-1).event_name, 'pass_email_failed')

  resendStatus = 200
  await call(db, 'request', { body })
  const pass = db.tables.conference_passes[0]
  const goodHash = pass.token_hash
  pass.last_sent_at = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  resendStatus = 500
  await call(db, 'request', { body })
  assert.equal(pass.token_hash, goodHash, 'le lien déjà reçu reste valable')
  assert.equal(pass.send_count, 1)

  pass.last_sent_at = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  resendThrows = true
  await call(db, 'request', { body })
  assert.notEqual(pass.token_hash, goodHash, 'envoi incertain : le nouveau lien a pu partir, il est conservé')
  assert.equal(db.tables.conference_pass_events.at(-1).metadata.uncertain, true)
})

test('Production : aucun Pass émis ni demandé tant que le paiement Pass n’est pas activé', async () => {
  process.env.VERCEL_ENV = 'production'
  const db = fakeDb(seed())
  const request = await call(db, 'request', { body: { slug: 'premiere-conference-mediumia', email: 'ada@example.org', consent: true } })
  const batch = await call(db, 'issue-batch', { body: { slug: 'premiere-conference-mediumia' }, headers: { authorization: 'Bearer admin' } })
  assert.deepEqual([request.statusCode, request.body.error], [409, 'pass_payment_disabled'])
  assert.deepEqual([batch.statusCode, batch.body.error], [409, 'pass_payment_disabled'])
  assert.equal(mails.length, 0)
  assert.equal(db.tables.conference_passes.length, 0)
})

test('lot : seuls les inscrits ayant donné leur accord reçoivent un Pass, les autres sont comptés', async () => {
  const s = seed()
  s.conference_registrations[1].offer_consent_at = '2026-10-23T09:00:00.000Z'
  s.conference_registrations[0].offer_consent_at = '2026-10-23T09:00:00.000Z'
  s.conference_registrations[0].offer_consent_withdrawn_at = '2026-10-23T10:00:00.000Z'
  const db = fakeDb(s)
  assert.equal((await call(db, 'issue-batch', { body: {} })).statusCode, 401)
  const res = await call(db, 'issue-batch', { body: { slug: 'premiere-conference-mediumia' }, headers: { authorization: 'Bearer admin' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual({ issued: res.body.issued, remaining: res.body.remaining, totalConsented: res.body.totalConsented, withoutConsent: res.body.withoutConsent }, { issued: 1, remaining: 0, totalConsented: 1, withoutConsent: 2 })
  assert.deepEqual(mails.map((m) => m.body.to), ['bob@example.org'])
  const again = await call(db, 'issue-batch', { body: { slug: 'premiere-conference-mediumia' }, headers: { authorization: 'Bearer admin' } })
  assert.equal(again.body.issued, 0)
  assert.equal(mails.length, 1, 'pas de doublon au second passage')
})

test('paiement : CGV et accès immédiat obligatoires et enregistrés avant toute commande PayPal', async () => {
  const s = seed()
  s.conference_passes.push({ id: 'p-1', event_id: EVENT_ID, registration_id: 'r-ada', token_hash: sha('T'.repeat(43)), status: 'issued', expires_at: '2026-11-21T00:00:00.000Z', redeemed_at: null })
  const db = fakeDb(s)
  const refused = await call(db, 'create', { body: { passToken: 'T'.repeat(43) } })
  assert.deepEqual([refused.statusCode, refused.body.error], [400, 'consent_required'])
  assert.equal(paypalCalls.length, 0)
  const ok = await call(db, 'create', { body: { passToken: 'T'.repeat(43), termsAccepted: true, immediateAccessAccepted: true } })
  assert.equal(ok.statusCode, 201)
  const pass = db.tables.conference_passes[0]
  assert.ok(pass.terms_accepted_at && pass.immediate_access_accepted_at)
  assert.equal(pass.terms_version, __conferencePassPayPalTest.TERMS_VERSION)
  assert.ok(db.tables.conference_pass_events.some((e) => e.event_name === 'terms_accepted'))
})

test('capture : refusée si les accords n’ont pas été enregistrés', async () => {
  const s = seed()
  s.conference_passes.push({ id: 'p-1', event_id: EVENT_ID, registration_id: 'r-ada', token_hash: 'x', status: 'reserved', paypal_order_id: 'ORDER123', expires_at: '2026-11-21T00:00:00.000Z', redeemed_at: null })
  const res = await call(fakeDb(s), 'capture', { body: { orderId: 'ORDER123' } })
  assert.deepEqual([res.statusCode, res.body.error], [409, 'consent_missing'])
  assert.equal(paypalCalls.length, 0)
})

test('e-mail : 499 € au lieu de 597 €, 4 fois sans garantie, lien en fragment, signature et opposition', () => {
  const email = buildConferencePassEmail({
    firstName: 'Ada', eventTitle: 'Et si la médiumnité devenait accessible ?', expiresAt: '2026-11-22T09:00:00.000Z',
    passUrl: 'https://mediumia.fr/pass/mediumia/premiere-conference-mediumia#pass=TOKEN', offerLabel: 'Tarif réservé aux participants de la conférence',
    amountCents: 49900, normalAmountCents: 59700, consentAt: '2026-10-23T09:00:00.000Z',
  })
  for (const part of [email.html, email.text]) {
    assert.match(part, /499\s€/)
    assert.match(part, /597\s€/)
    assert.ok(part.includes(PAYPAL_INSTALMENTS_NOTICE))
    assert.match(part, /Économie : 98\s€/)
    assert.match(part, /Paiement en 4X PayPal : 4 échéances de 124,75\s€, sous réserve d’acceptation par PayPal/)
    assert.match(part, /leur coût éventuel, vous sont présentées par PayPal avant que vous validiez/)
    assert.match(part, /Lien personnel valable jusqu’au/)
    assert.doesNotMatch(part.replace(/<[^>]+>/g, ' '), /sans frais|0\s?%|garanti(?!e\b)|6, 12|24 (fois|mois)/i)
    assert.match(part, /Votre PDF complet personnel, envoyé après le paiement/)
    assert.ok(part.includes(NON_CUMULATIVE_NOTICE))
    assert.match(part, /#pass=TOKEN/)
    assert.match(part, /Sébastien Seguin — MediumIA/)
    assert.match(part, /répondez simplement « STOP »/)
    assert.match(part, /vous avez demandé votre Pass participant sur mediumia\.fr le 23 octobre 2026/)
    assert.match(part, /365 jours d’accès/)
  }
  assert.doesNotMatch(email.html, /\?pass=/)
  assert.match(email.subject, /Pass Conférence MediumIA : la formation complète à 499\s€ au lieu de 597\s€/)
})

test('page Pass : formulaire de demande sans lien, accords avant les boutons PayPal, envoyés au serveur', async () => {
  const page = await readFile(new URL('../src/components/ConferencePassPage.jsx', import.meta.url), 'utf8')
  const form = await readFile(new URL('../src/components/ConferencePassRequest.jsx', import.meta.url), 'utf8')
  assert.match(page, /setState\('request'\)/)
  assert.match(page, /<ConferencePassRequest api=\{API\} \/>/)
  assert.match(form, /fetch\(`\$\{api\}request`/)
  assert.match(form, /J’accepte de recevoir par e-mail mon Pass personnel et l’offre réservée aux participants de la conférence/)
  assert.match(form, /consent: true/)
  assert.match(page, /conditions générales de vente de l’accompagnement MediumIA/)
  assert.match(page, /Je demande expressément la fourniture immédiate des contenus numériques de la formation dès la confirmation du paiement, et je renonce expressément à mon droit de rétractation pour ces contenus/)
  assert.match(page, /components=buttons,messages/)
  assert.match(page, /window\.paypal\.Messages\(\{/)
  assert.match(page, /Économie :/)
  assert.match(page, /Lien valable jusqu’au/)
  assert.ok(page.includes(PAYPAL_INSTALMENTS_NOTICE))
  assert.ok(form.includes(PAYPAL_INSTALMENTS_NOTICE))
  assert.match(form, /fetch\(`\$\{api\}offer&slug=/)
  assert.doesNotMatch(page + form, /sans frais|6, 12|24X/i)
  assert.ok(page.includes(NON_CUMULATIVE_NOTICE) && form.includes(NON_CUMULATIVE_NOTICE))
  assert.match(page, /Votre PDF complet personnel, envoyé après le paiement/)
  assert.match(page, /consentsOk\s*\n\s*\? <div ref=\{paypalRef\}/)
  assert.match(page, /body: JSON\.stringify\(\{ passToken, termsAccepted: true, immediateAccessAccepted: true \}\)/)
})

test('offre publique : prix, économie, date limite du 21 novembre et Pass de 30 jours ; demandes refusées après', async () => {
  const s = seed()
  s.conference_events[0].pass_request_deadline = '2026-11-21T22:59:59.000Z'
  const db = fakeDb(s)
  const res = response()
  await handleConferencePassPayPal({ method: 'GET', query: { slug: 'premiere-conference-mediumia' }, headers: {} }, res, 'offer', { supabase: db })
  assert.deepEqual(res.body, { eventTitle: 'Et si la médiumnité devenait accessible ?', amountCents: 49900, normalAmountCents: 59700, savingsCents: 9800, currency: 'EUR', requestDeadline: '2026-11-21T22:59:59.000Z', open: true, passValidityDays: 30, pdfHost: 'espace.mediumia.fr' })
  s.conference_events[0].pass_request_deadline = '2026-10-24T00:00:00.000Z'
  const late = await call(fakeDb(s), 'request', { body: { slug: 'premiere-conference-mediumia', email: 'ada@example.org', consent: true } })
  assert.deepEqual([late.statusCode, late.body.error], [410, 'offer_closed'])
  assert.equal(mails.length, 0)
})

test('parcours Sandbox à 1 € : capture, accès complet 25 modules pendant 365 jours, confirmation envoyée une seule fois', async () => {
  const s = seed()
  s.conference_passes.push({ id: 'p-1', event_id: EVENT_ID, registration_id: 'r-ada', token_hash: sha('T'.repeat(43)), status: 'issued', expires_at: '2026-11-22T00:00:00.000Z', redeemed_at: null })
  const db = fakeDb(s)
  const created = await call(db, 'create', { body: { passToken: 'T'.repeat(43), termsAccepted: true, immediateAccessAccepted: true } })
  assert.equal(created.statusCode, 201)
  Object.assign(db.tables.conference_passes[0], { paypal_order_id: 'ORDER123', paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR', reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', status: 'reserved' })

  const captured = await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  assert.equal(captured.statusCode, 200)
  assert.equal(captured.body.access.status, 'provisioned')
  const [ent] = db.tables.mediumia_entitlements
  assert.deepEqual([ent.access_level, ent.max_module, ent.origin_ref], ['full', 25, 'conference-pass:sandbox:CAP-1'])
  assert.equal(Math.round((new Date(ent.access_expires_at) - new Date(ent.access_started_at)) / 86400000), 365)
  const confirmation = mails.find((m) => m.idempotencyKey === 'conference-pass-confirmation-CAP-1')
  assert.equal(confirmation.body.to, 'ada@example.org', 'accès et confirmation sur l’adresse d’inscription, pas celle du compte PayPal')
  assert.match(confirmation.body.text, /Montant payé : 1\s€ TTC/)
  assert.match(confirmation.body.text, /renoncé expressément à votre droit de rétractation pour ces contenus/)
  assert.ok(db.tables.conference_pass_events.some((e) => e.event_name === 'confirmation_sent' && e.metadata.pdfLink === true))
  // PDF personnel : même circuit qu'un achat à 597 €, enregistré comme Formation complète.
  const [purchase] = db.tables.mediumia_paypal_purchases
  assert.deepEqual(
    [purchase.product_code, purchase.access_level, purchase.max_module, purchase.amount_cents, purchase.paypal_env, purchase.status, purchase.user_id, purchase.paypal_capture_id],
    ['full', 'full', 25, 100, 'sandbox', 'provisioned', 'u-buyer', 'CAP-1'],
  )
  const pdfToken = decodeURIComponent(confirmation.body.text.match(/\/api\/purchase-pdf\?token=([^\s]+)/)[1])
  assert.equal(purchase.pdf_download_token_hash, sha(pdfToken))
  assert.equal(Math.round((new Date(purchase.pdf_download_expires_at) - Date.now()) / 86400000), 30)
  assert.match(confirmation.body.text, /numéro de licence MID-2026-000042/)
  assert.ok(purchase.terms_accepted_at && purchase.immediate_access_accepted_at)

  const replay = await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  assert.deepEqual([replay.statusCode, replay.body.alreadyProvisioned], [200, true])
  assert.equal(db.tables.mediumia_entitlements.length, 1)
  assert.equal(db.tables.mediumia_paypal_purchases.length, 1)
  assert.equal(mails.filter((m) => m.idempotencyKey?.startsWith('conference-pass-confirmation')).length, 1)
})

test('confirmation de commande : prix, accès, référence PayPal, accords datés et lien vers les CGV', () => {
  const email = buildConferencePassConfirmationEmail({
    firstName: 'Ada', eventTitle: 'Et si la médiumnité devenait accessible ?', amount: '499.00', normalAmountCents: 59700, capturedAt: '2026-10-24T10:00:00Z',
    accessExpiresAt: '2027-10-24T10:00:00Z', captureId: 'CAP-1', termsVersion: 'conference-pass-2026-10-23-v2', termsAcceptedAt: '2026-10-24T09:58:00Z', immediateAccessAcceptedAt: '2026-10-24T09:58:00Z',
  })
  for (const part of [email.html, email.text]) {
    assert.match(part, /499\s€ TTC \(prix habituel : 597\s€\)/)
    assert.match(part, /CAP-1/)
    assert.match(part, /24 octobre 2027/)
    assert.match(part, /conditions générales de vente \(version conference-pass-2026-10-23-v2\)/)
    assert.match(part, /https:\/\/mediumia\.fr\/cgv-formation\.html/)
  }
})

test('CGV et page Conférences : offre à 499 € encadrée, renonciation jamais automatique, demande publique', async () => {
  const cgv = await readFile(new URL('../public/cgv-formation.html', import.meta.url), 'utf8')
  assert.match(cgv, /<strong>499 € TTC<\/strong> au lieu de 597 €, soit 98 € de réduction/)
  assert.match(cgv, /jusqu’au 21 novembre 2026 à 23 h 59 \(heure de Paris\)/)
  assert.match(cgv, /valable 30 jours à compter de son envoi/)
  assert.match(cgv, /ne se cumule ni avec la déduction de la Découverte MediumIA ni avec le parcours au mois/)
  assert.match(cgv, /Cette renonciation n’est jamais automatique : elle est recueillie au moyen d’une case distincte de celle d’acceptation des CGV, non cochée par défaut/)
  assert.match(cgv, /l’accès est activé sur l’adresse e-mail d’inscription à la conférence/)
  assert.doesNotMatch(cgv, /6, 12 ou 24/)
  assert.match(conferencesText(await readFile(new URL('../src/components/ConferencesPage.jsx', import.meta.url), 'utf8')), /n’est pas cumulable avec la Découverte à 29 € ni avec le parcours au mois/)
  const conferences = await readFile(new URL('../src/components/ConferencesPage.jsx', import.meta.url), 'utf8')
  assert.match(conferences, /href="\/pass\/mediumia\/premiere-conference-mediumia"/)
  assert.ok(conferences.includes(PAYPAL_INSTALMENTS_NOTICE))
})

// ── Reprise du PDF d'un paiement déjà confirmé ──────────────────────────────────
async function paidPass(db) {
  db.tables.conference_passes.push({ id: 'p-1', event_id: EVENT_ID, registration_id: 'r-ada', token_hash: sha('T'.repeat(43)), status: 'reserved', expires_at: '2026-11-22T00:00:00.000Z', redeemed_at: null, paypal_order_id: 'ORDER123', paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR', reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', terms_version: __conferencePassPayPalTest.TERMS_VERSION, terms_accepted_at: '2026-10-24T09:58:00Z', immediate_access_accepted_at: '2026-10-24T09:58:00Z' })
  const captured = await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  assert.equal(captured.statusCode, 200)
  return db.tables.conference_passes[0]
}
const pdfMails = () => mails.filter((m) => m.idempotencyKey?.startsWith('conference-pass-pdf-'))
const pdfTokenOf = (mail) => decodeURIComponent(mail.body.text.match(/\/api\/purchase-pdf\?token=([^\s]+)/)[1])
const admin = { authorization: 'Bearer admin' }

test('reprise PDF : achat non enregistré à la capture, PDF remis plus tard sans PayPal, sans second achat ni nouveaux droits', async () => {
  const db = fakeDb(seed())
  db.failInserts.add('mediumia_paypal_purchases')
  const pass = await paidPass(db)
  db.failInserts.clear()
  const confirmation = mails.find((m) => m.idempotencyKey === 'conference-pass-confirmation-CAP-1')
  assert.doesNotMatch(confirmation.body.text, /purchase-pdf/)
  assert.match(confirmation.body.text, /prochain e-mail/)
  assert.equal(db.tables.mediumia_paypal_purchases.length, 0)
  const paypalAfterCapture = paypalCalls.length
  const grantsAfterCapture = db.calls.rpc.filter((c) => c.fn === 'mediumia_grant_purchase_atomic').length

  // Juste après la capture, la reprise attend que la capture d'origine ait fini.
  await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  assert.equal(pdfMails().length, 0)

  pass.redeemed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const replay = await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  assert.deepEqual([replay.statusCode, replay.body.alreadyProvisioned], [200, true])
  assert.equal(db.tables.mediumia_paypal_purchases.length, 1)
  const [purchase] = db.tables.mediumia_paypal_purchases
  assert.deepEqual(
    [purchase.paypal_order_id, purchase.paypal_capture_id, purchase.product_code, purchase.max_module, purchase.amount_cents, purchase.user_id, purchase.entitlement_id, purchase.status],
    ['ORDER123', 'CAP-1', 'full', 25, 100, 'u-buyer', 'ent-1', 'provisioned'],
  )
  const [pdfMail] = pdfMails()
  assert.equal(pdfMail.body.to, 'ada@example.org')
  assert.equal(pdfMail.idempotencyKey, 'conference-pass-pdf-CAP-1-1')
  assert.equal(purchase.pdf_download_token_hash, sha(pdfTokenOf(pdfMail)))
  assert.match(pdfMail.body.text, /numéro de licence MID-2026-000042/)
  assert.equal(paypalCalls.length, paypalAfterCapture, 'aucun appel PayPal pendant la reprise')
  assert.equal(db.calls.rpc.filter((c) => c.fn === 'mediumia_grant_purchase_atomic').length, grantsAfterCapture, 'aucune nouvelle attribution')
  assert.equal(db.tables.mediumia_entitlements.length, 1)
  assert.equal(db.tables.conference_pass_events.at(-1).event_name, 'pdf_sent')

  // PDF déjà remis : ni nouvel envoi par la capture rejouée, ni par le cockpit.
  await call(db, 'capture', { body: { orderId: 'ORDER123' } })
  const batch = await call(db, 'repair-pdf', { body: { slug: 'premiere-conference-mediumia' }, headers: admin })
  assert.deepEqual([batch.body.sent, batch.body.alreadyDelivered], [0, 1])
  assert.equal(pdfMails().length, 1)
  assert.equal(db.tables.mediumia_paypal_purchases.length, 1)
})

test('reprise PDF (cockpit) : confirmation non partie, nouveau lien sur l’achat existant, aucun doublon', async () => {
  const db = fakeDb(seed())
  resendStatus = 500
  const pass = await paidPass(db)
  resendStatus = 200
  assert.ok(db.tables.conference_pass_events.some((e) => e.event_name === 'confirmation_failed' && e.metadata.pdfLink === true))
  const [purchase] = db.tables.mediumia_paypal_purchases
  const firstHash = purchase.pdf_download_token_hash

  assert.equal((await call(db, 'repair-pdf', { body: {} })).statusCode, 401)
  const early = await call(db, 'repair-pdf', { body: { slug: 'premiere-conference-mediumia' }, headers: admin })
  assert.deepEqual([early.body.sent, early.body.pending], [0, 1])

  pass.redeemed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const paypalBefore = paypalCalls.length
  const res = await call(db, 'repair-pdf', { body: { slug: 'premiere-conference-mediumia' }, headers: admin })
  assert.deepEqual([res.statusCode, res.body.sent, res.body.failed], [200, 1, 0])
  assert.equal(db.tables.mediumia_paypal_purchases.length, 1)
  assert.notEqual(purchase.pdf_download_token_hash, firstHash)
  assert.equal(db.tables.mediumia_paypal_purchases[0].pdf_download_token_hash, sha(pdfTokenOf(pdfMails()[0])))
  assert.equal(paypalCalls.length, paypalBefore)
  assert.equal(db.tables.mediumia_entitlements.length, 1)

  const again = await call(db, 'repair-pdf', { body: { slug: 'premiere-conference-mediumia' }, headers: admin })
  assert.deepEqual([again.body.sent, again.body.alreadyDelivered], [0, 1])
  assert.equal(pdfMails().length, 1)
})

test('reprise PDF : refusée si l’achat existant ne correspond pas à la capture du Pass', async () => {
  const db = fakeDb(seed())
  const pass = await paidPass(db)
  db.tables.conference_pass_events = db.tables.conference_pass_events.filter((e) => e.event_name !== 'confirmation_sent')
  db.tables.mediumia_paypal_purchases[0].paypal_capture_id = 'CAP-AUTRE'
  pass.redeemed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const hash = db.tables.mediumia_paypal_purchases[0].pdf_download_token_hash
  const res = await call(db, 'repair-pdf', { body: { slug: 'premiere-conference-mediumia' }, headers: admin })
  assert.equal(res.body.failed, 1)
  assert.equal(db.tables.mediumia_paypal_purchases[0].pdf_download_token_hash, hash)
  assert.equal(pdfMails().length, 0)
})
