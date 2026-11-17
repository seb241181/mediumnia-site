import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import {
  buildDeliveryAlert, handleEmailCheck, handleEmailDeliveryAdmin, handleResendWebhook,
  parseResendEvent, redactSubject, verifySvixSignature,
} from '../lib/emailDelivery.js'
import { checkEmailDelivery } from '../src/lib/emailDeliveryCheck.js'
import { deliveryProblemMessage, emailCodeErrorMessage, EMAIL_SEND_FAILED_MESSAGE } from '../src/lib/accountView.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const KEY = Buffer.from('mediumia-test-webhook-secret-32-bytes!!').toString('base64')
const SECRET = `whsec_${KEY}`
const NOW = Date.parse('2026-11-17T10:00:00Z')
const TS = String(Math.floor(NOW / 1000))

function sign(body, { id = 'msg_1', ts = TS, key = KEY } = {}) {
  return `v1,${createHmac('sha256', Buffer.from(key, 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`
}

function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

function fakeReq(body, headers = {}, method = 'POST') {
  const req = Readable.from([Buffer.from(body)])
  req.method = method
  req.headers = headers
  return req
}

const bounced = (to = 'Client.Test@Example.org') => JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-11-17T09:59:00.000Z',
  data: {
    email_id: 'em_123', to: [to], subject: 'Votre code MediumIA : 482915',
    created_at: '2026-11-17T09:58:58.000Z',
    bounce: { type: 'Permanent', subType: 'General', message: '550 5.1.1 <client.test@example.org> user unknown' },
  },
})

function fakeDb({ record = { recorded: true, issue_opened: true, alert_due: true, status: 'bounced', severity: 'blocking', first_seen_at: '2026-11-17T10:00:00Z' }, claim = true, recordError = null } = {}) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'record_email_delivery_event') return recordError ? { data: null, error: recordError } : { data: record, error: null }
      if (name === 'claim_email_delivery_alert') return { data: claim, error: null }
      return { data: null, error: null }
    },
    from: () => ({
      select() { return this }, ilike() { return this }, order() { return this }, limit() { return this },
      then(resolve) { resolve({ data: [{ starts_at: '2026-11-20T09:00:00Z', customer_phone: '+33600000001', status: 'confirmed' }], error: null }) },
    }),
  }
}

// ── Signature ────────────────────────────────────────────────────────────────

test('signature Svix : valide, falsifiée, périmée, rotation de clé, secret absent', () => {
  const body = bounced()
  assert.equal(verifySvixSignature({ id: 'msg_1', timestamp: TS, signatureHeader: sign(body), body, secret: SECRET, now: NOW }).ok, true)
  assert.equal(verifySvixSignature({ id: 'msg_1', timestamp: TS, signatureHeader: sign(body), body: body.replace('Permanent', 'Transient'), secret: SECRET, now: NOW }).reason, 'signature')
  assert.equal(verifySvixSignature({ id: 'msg_2', timestamp: TS, signatureHeader: sign(body), body, secret: SECRET, now: NOW }).ok, false, 'identifiant lié à la signature')
  assert.equal(verifySvixSignature({ id: 'msg_1', timestamp: TS, signatureHeader: sign(body), body, secret: SECRET, now: NOW + 6 * 60_000 }).reason, 'timestamp')
  const other = Buffer.from('autre-cle-autre-cle-autre-cle-1234').toString('base64')
  assert.equal(verifySvixSignature({ id: 'msg_1', timestamp: TS, signatureHeader: `v1,${sign(body, { key: other }).slice(3)} ${sign(body)}`, body, secret: SECRET, now: NOW }).ok, true)
  assert.equal(verifySvixSignature({ id: 'msg_1', timestamp: TS, signatureHeader: sign(body), body, secret: '', now: NOW }).ok, false)
})

test('caviardage : ni code OTP, ni lien, ni jeton dans ce qui est stocké ou envoyé à Sébastien', () => {
  assert.equal(redactSubject('Votre code MediumIA : 482915'), 'Votre code MediumIA : ••••')
  assert.equal(redactSubject('Code 482 915 à usage unique'), 'Code •••• à usage unique')
  assert.equal(redactSubject('Lien https://x.supabase.co/auth/v1/verify?token=abc'), 'Lien [lien]')
  const [entry] = parseResendEvent(JSON.parse(bounced()), 'msg_1').entries
  assert.equal(entry.recipient, 'client.test@example.org')
  assert.equal(entry.subject_redacted, 'Votre code MediumIA : ••••')
  assert.ok(!JSON.stringify(entry).includes('482915'))
  assert.equal(entry.reason, '550 5.1.1 <[adresse]> user unknown')
  assert.equal(entry.bounce_type, 'Permanent')
})

// ── Webhook ──────────────────────────────────────────────────────────────────

test('webhook : sans secret configuré, rien n’est accepté (503)', async () => {
  const res = fakeRes()
  await handleResendWebhook(fakeReq(bounced(), {}), res, { db: fakeDb(), env: {}, now: NOW })
  assert.equal(res.statusCode, 503)
})

test('webhook : signature invalide ou absente → 401, aucune écriture', async () => {
  const db = fakeDb()
  const res = fakeRes()
  await handleResendWebhook(fakeReq(bounced(), { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': 'v1,AAAA' }), res, { db, env: { RESEND_WEBHOOK_SECRET: SECRET }, now: NOW })
  assert.equal(res.statusCode, 401)
  const res2 = fakeRes()
  await handleResendWebhook(fakeReq(bounced(), {}), res2, { db, env: { RESEND_WEBHOOK_SECRET: SECRET }, now: NOW })
  assert.equal(res2.statusCode, 401)
  assert.equal(db.calls.length, 0)
  const res3 = fakeRes()
  await handleResendWebhook(fakeReq('', {}, 'GET'), res3, { db, env: { RESEND_WEBHOOK_SECRET: SECRET }, now: NOW })
  assert.equal(res3.statusCode, 405)
})

test('webhook : rejet signé → enregistré caviardé, une seule alerte à Sébastien, sans code', async () => {
  const body = bounced()
  const db = fakeDb()
  const sent = []
  const res = fakeRes()
  await handleResendWebhook(fakeReq(body, { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': sign(body) }), res, {
    db, env: { RESEND_WEBHOOK_SECRET: SECRET, RDV_BALANCE_ALERT_EMAIL: 'seb@example.org' }, now: NOW,
    send: async (message) => { sent.push(message); return { status: 'sent' } },
  })
  assert.equal(res.statusCode, 200)
  const record = db.calls.find((c) => c.name === 'record_email_delivery_event')
  assert.equal(record.args.p_event.webhook_id, 'msg_1')
  assert.equal(record.args.p_event.recipient, 'client.test@example.org')
  assert.ok(db.calls.some((c) => c.name === 'claim_email_delivery_alert'))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'seb@example.org')
  assert.match(sent[0].text, /client\.test@example\.org/)
  assert.match(sent[0].text, /rejet par la messagerie du client/)
  assert.match(sent[0].text, /1 rendez-vous MediumIA, le prochain le/)
  assert.match(sent[0].text, /\+33600000001/)
  assert.ok(!sent[0].text.includes('482915') && !sent[0].html.includes('482915'), 'jamais le code OTP')
  assert.match(sent[0].idempotencyKey, /^email-delivery-alert\/[0-9a-f]{24}\//)
})

test('webhook : événement en double (retry Resend) → aucune seconde alerte', async () => {
  const body = bounced()
  const db = fakeDb({ record: { recorded: false, duplicate: true } })
  const sent = []
  const res = fakeRes()
  await handleResendWebhook(fakeReq(body, { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': sign(body) }), res, {
    db, env: { RESEND_WEBHOOK_SECRET: SECRET, RDV_BALANCE_ALERT_EMAIL: 'seb@example.org' }, now: NOW, send: async (m) => { sent.push(m); return { status: 'sent' } },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.results[0].duplicate, true)
  assert.equal(sent.length, 0)
  assert.ok(!db.calls.some((c) => c.name === 'claim_email_delivery_alert'))
})

test('webhook : alerte déjà réservée par un autre appel → pas d’envoi ; échec d’envoi → réservation libérée', async () => {
  const body = bounced()
  const env = { RESEND_WEBHOOK_SECRET: SECRET, RDV_BALANCE_ALERT_EMAIL: 'seb@example.org' }
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': sign(body) }
  const raced = fakeDb({ claim: false })
  const sent = []
  await handleResendWebhook(fakeReq(body, headers), fakeRes(), { db: raced, env, now: NOW, send: async (m) => { sent.push(m); return { status: 'sent' } } })
  assert.equal(sent.length, 0)
  const failing = fakeDb()
  const res = fakeRes()
  await handleResendWebhook(fakeReq(body, headers), res, { db: failing, env, now: NOW, send: async () => ({ status: 'error' }) })
  assert.equal(res.body.results[0].alert, 'alert_failed')
  assert.ok(failing.calls.some((c) => c.name === 'release_email_delivery_alert'))
})

test('webhook : panne base → 500 pour que Resend renvoie (idempotent) ; événement non suivi → 200 ignoré', async () => {
  const body = bounced()
  const res = fakeRes()
  await handleResendWebhook(fakeReq(body, { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': sign(body) }), res, {
    db: fakeDb({ recordError: { code: '42P01' } }), env: { RESEND_WEBHOOK_SECRET: SECRET }, now: NOW,
  })
  assert.equal(res.statusCode, 500)
  const other = JSON.stringify({ type: 'domain.updated', data: {} })
  const res2 = fakeRes()
  await handleResendWebhook(fakeReq(other, { 'svix-id': 'msg_9', 'svix-timestamp': TS, 'svix-signature': sign(other, { id: 'msg_9' }) }), res2, {
    db: fakeDb(), env: { RESEND_WEBHOOK_SECRET: SECRET }, now: NOW,
  })
  assert.equal(res2.body.ignored, true)
})

test('alerte : plainte → consigne explicite de ne pas débloquer sans accord', () => {
  const alert = buildDeliveryAlert({ recipient: 'a@b.fr', status: 'complained', severity: 'blocking', subject: null, occurredAt: null, reason: null, client: { bookings: 0 } })
  assert.match(alert.text, /ne retirez PAS la suppression chez Resend sans l’accord explicite du client/)
  assert.match(alert.text, /Aucun rendez-vous MediumIA/)
})

// ── Vérification avant envoi ─────────────────────────────────────────────────

function checkDb({ allowed = true, delivery = { delivery: 'ok' }, error = null } = {}) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'consume_api_rate_limit') return { data: { allowed }, error: null }
      if (name === 'email_delivery_check') return error ? { data: null, error } : { data: delivery, error: null }
      return { data: null, error: null }
    },
    from: () => { throw new Error('aucune lecture de compte') },
  }
}

test('email-check : bloqué / ok / panne → unknown ; aucune lecture de compte (anti-énumération)', async () => {
  const run = async (db, body = { email: ' Client@Example.org ' }) => {
    const res = fakeRes()
    await handleEmailCheck({ method: 'POST', body, headers: { 'x-forwarded-for': '1.2.3.4' } }, res, { db })
    return res
  }
  const blocked = await run(checkDb({ delivery: { delivery: 'blocked', since: '2026-11-17T09:00:00Z' } }))
  assert.deepEqual(blocked.body, { delivery: 'blocked', since: '2026-11-17T09:00:00Z' })
  const ok = checkDb()
  assert.deepEqual((await run(ok)).body, { delivery: 'ok' })
  assert.equal(ok.calls.find((c) => c.name === 'email_delivery_check').args.p_email, 'client@example.org')
  assert.deepEqual((await run(checkDb({ error: { code: '42P01' } }))).body, { delivery: 'unknown' })
  assert.equal((await run(checkDb({ allowed: false }))).statusCode, 429)
  assert.equal((await run(checkDb(), { email: 'pas-une-adresse' })).statusCode, 400)
  const get = fakeRes()
  await handleEmailCheck({ method: 'GET', headers: {} }, get, { db: checkDb() })
  assert.equal(get.statusCode, 405)
})

test('client : checkEmailDelivery ne bloque jamais sur une panne ; messages honnêtes sans révéler un compte', async () => {
  assert.equal(await checkEmailDelivery('a@b.fr', { fetchImpl: async () => ({ ok: true, json: async () => ({ delivery: 'blocked' }) }) }), 'blocked')
  assert.equal(await checkEmailDelivery('a@b.fr', { fetchImpl: async () => ({ ok: false }) }), 'unknown')
  assert.equal(await checkEmailDelivery('a@b.fr', { fetchImpl: async () => { throw new Error('réseau') } }), 'unknown')
  const message = deliveryProblemMessage('blocked', 'a@b.fr')
  assert.match(message, /refusé nos précédents messages/)
  assert.match(message, /contact@mediumia\.fr/)
  assert.doesNotMatch(message, /compte|espace existe|inscrit/i)
  assert.equal(emailCodeErrorMessage({ message: 'Error sending magic link email' }), EMAIL_SEND_FAILED_MESSAGE)
  assert.match(emailCodeErrorMessage({ message: 'For security purposes, you can only request this after 52 seconds.' }), /Patientez une minute/)
})

// ── Administration ───────────────────────────────────────────────────────────

test('administration : réservée au propriétaire ; résoudre ne touche pas à Resend', async () => {
  const ownerDb = (owner) => ({
    calls: [],
    from() { return { select() { return this }, eq() { return this }, limit() { return this }, is() { return this }, order() { return this }, then: (r) => r({ data: owner ? [{ id: 'p' }] : [], error: null }) } },
    async rpc(name, args) { this.calls.push({ name, args }); return { data: { resolved: true, status: 'bounced' }, error: null } },
  })
  assert.equal((await handleEmailDeliveryAdmin({ db: ownerDb(false), userId: 'u', method: 'GET' })).status, 403)
  const db = ownerDb(true)
  const resolved = await handleEmailDeliveryAdmin({ db, userId: 'u', method: 'POST', input: { op: 'resolve', recipient: 'A@B.fr', note: 'adresse corrigée' } })
  assert.equal(resolved.status, 200)
  assert.deepEqual(db.calls[0], { name: 'resolve_email_delivery_issue', args: { p_recipient: 'a@b.fr', p_actor: 'u', p_note: 'adresse corrigée' } })
  assert.doesNotMatch(read('lib/emailDelivery.js'), /api\.resend\.com\/(suppressions|contacts)|DELETE/)
})

// ── Garde-fous de structure ──────────────────────────────────────────────────

test('structure : webhook avant toute lecture du corps ; identité toujours vérifiée ; pré-contrôle avant envoi', () => {
  const router = read('api/rdv-config.js')
  const handler = router.slice(router.indexOf('export default async function handler'))
  assert.match(handler, /^export default async function handler\(req, res\) \{\n(\s*\/\/.*\n)*\s*if \(req\.query\?\.emailWebhook === 'resend'\) return handleResendWebhook\(req, res\)/)
  // vercel.json peut être réécrit (compacté) pendant le build Vercel : on lit
  // le JSON plutôt que sa mise en forme.
  const rewrites = JSON.parse(read('vercel.json')).rewrites || []
  assert.ok(rewrites.some((r) => r.source === '/api/resend-webhook' && r.destination === '/api/rdv-config?emailWebhook=resend'), 'réécriture du webhook Resend')
  // Relais TEST (Supabase) : même gestionnaire, verrouillé sur le projet TEST.
  const relay = read('supabase/functions/resend-webhook-test/index.ts')
  assert.match(relay, /import \{ handleResendWebhook \} from "\.\.\/\.\.\/\.\.\/lib\/emailDelivery\.js"/)
  assert.match(relay, /const TEST_PROJECT_REF = "wnbwhnqiulsdjcvkuwos"/)
  assert.ok(relay.indexOf('test_only') < relay.indexOf('handleResendWebhook(req, res'), 'garde TEST avant tout traitement')
  assert.doesNotMatch(relay, /uotkpygeqqnekpolezts/)
  const account = read('lib/accountApiHandler.js')
  assert.match(account, /if \(!user\.email \|\| !user\.email_confirmed_at\) return \{ status: 403, error: 'email_not_verified' \}/)
  assert.match(account, /if \(action === 'email-check'\) return handleEmailCheck/)
  const page = read('src/components/account/AccountPage.jsx')
  const request = page.slice(page.indexOf('async function requestCode'), page.indexOf('async function submitCode'))
  assert.ok(request.indexOf("checkEmailDelivery(address) === 'blocked'") < request.indexOf('sendEmailCode('), 'pré-contrôle avant envoi')
  assert.match(page, /Renvoyer mon code \(dans \$\{resendIn\} s\)/)
  const invite = read('src/components/account/AccountInvite.jsx')
  assert.ok(invite.indexOf("checkEmailDelivery(address) === 'blocked'") < invite.indexOf('sendEmailCode(address'))
})

test('SQL : idempotence, plainte jamais résolue automatiquement, aucun déblocage, droits serveur seulement', () => {
  const sql = read('supabase/migrations/20261117100000_email_delivery_tracking.sql')
  assert.match(sql, /CONSTRAINT email_delivery_events_once UNIQUE \(provider, webhook_id, recipient\)/)
  assert.match(sql, /ON CONFLICT ON CONSTRAINT email_delivery_events_once DO NOTHING/)
  assert.match(sql, /v_issue\.status <> 'complained' AND v_occurred > v_issue\.last_event_at/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.email_delivery_events FROM PUBLIC, anon, authenticated/)
  for (const fn of ['record_email_delivery_event(JSONB)', 'claim_email_delivery_alert(TEXT)', 'email_delivery_check(TEXT)', 'resolve_email_delivery_issue(TEXT, UUID, TEXT)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated`), fn)
  }
  assert.doesNotMatch(sql, /message_text|html|otp_code|token_hash/i)
})

test('revérification après envoi : jamais d’envoi de code (seulement email-check)', () => {
  const hook = read('src/lib/emailDeliveryCheck.js')
  assert.doesNotMatch(hook, /sendEmailCode|signInWithOtp|signUp|resetPasswordForEmail/)
  assert.match(hook, /export function useDeliveryRecheck/)
  const invite = read('src/components/account/AccountInvite.jsx')
  assert.match(invite, /useDeliveryRecheck\(stage === 'code', address, setDeliveryIssue\)/)
  assert.equal(/useEffect/.test(invite), false, 'invariant existant : aucun envoi automatique')
})
