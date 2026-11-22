/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const issues = await import('../lib/paymentIssues.js')
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const NOW = new Date('2026-11-08T15:00:00Z')
const thenable = (value) => { const p = Promise.resolve(value); return { then: (a, b) => p.then(a, b) } }

function fakeDb({ submit = { ok: true, duplicate: false, id: '11111111-1111-4111-8111-111111111111', reference: 'PB-1A2B3C4D', ack_allowed: true }, admin = true, list = [] } = {}) {
  const calls = []
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'submit_payment_issue_report') return thenable({ data: submit, error: null })
      if (name === 'update_payment_issue_report') return thenable({ data: { ok: true, status: args.p_status }, error: null })
      return thenable({ data: true, error: null })
    },
    from(table) {
      const state = { table, filters: [] }
      const builder = {
        select() { return builder }, order() { return builder }, limit() { return builder },
        eq(c, v) { state.filters.push(['eq', c, v]); return builder },
        in(c, v) { state.filters.push(['in', c, v]); return builder },
        then(resolve) {
          calls.push({ from: table, filters: state.filters })
          if (table === 'booking_practitioners') return resolve({ data: admin ? [{ id: 'p' }] : [], error: null })
          return resolve({ data: list, error: null })
        },
      }
      return builder
    },
  }
}

const body = (extra = {}) => ({ email: 'Cliente@Example.org ', reason: 'charged_no_service', journey: 'chronosphere_max', step: 'confirmation_failed', attempt_ref: '5O190127TN364715T', attempt_at: '2026-11-08T13:39:00Z', page_path: '/chronosphere-max?token=abc', comment: 'Débitée 19,90 €', elapsed_ms: 12000, ...extra })
const req = (b, headers = {}) => ({ body: b, headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (iPhone)', ...headers } })

test('données bancaires et jetons masqués avant tout enregistrement', () => {
  const r = issues.redactSensitive
  assert.equal(r('ma carte 4970 1012 3456 7890 a été débitée'), 'ma carte [numéro masqué] a été débitée')
  assert.equal(r('4970-1012-3456-7890'), '[numéro masqué]')
  assert.equal(r('IBAN FR76 3000 6000 0112 3456 7890 189 merci'), 'IBAN [IBAN masqué] merci')
  assert.equal(r('code: 1234 et token=abcdef'), 'code=[masqué] et token=[masqué]')
  assert.equal(r('voir https://mediumia.fr/rdv/solde?token=secret#x'), 'voir https://mediumia.fr/rdv/solde')
  assert.equal(r('commande 5O190127TN364715T'), 'commande 5O190127TN364715T', 'identifiant PayPal conservé')
  assert.equal(issues.safePagePath('/rdv/solde?token=secret#t'), '/rdv/solde')
  assert.equal(issues.safePagePath('/carte-cadeau/AbCdEf123'), '/carte-cadeau/[masqué]')
  assert.equal(issues.safePagePath('https://autre.site/x'), null)
})

test('validation : e-mail, motif, parcours, tentative, piège à robots, rapidité', () => {
  const n = (b) => issues.normalizeIssueInput(b, { now: NOW })
  assert.equal(n(body({ website: 'http://spam' })).error, 'spam_detected')
  assert.equal(n(body({ elapsed_ms: 800 })).error, 'too_fast')
  assert.equal(n(body({ email: 'pas-un-email' })).error, 'invalid_email')
  assert.equal(n(body({ reason: 'refund_me' })).error, 'invalid_reason')
  assert.equal(n(body({ comment: 'x'.repeat(5000) })).error, 'payload_too_large')
  const ok = n(body({ journey: 'inconnu', attempt_ref: '<script>', step: 'DROP TABLE', attempt_at: '2030-01-01T00:00:00Z' })).input
  assert.equal(ok.journey, 'other')
  assert.equal(ok.attemptRef, null)
  assert.equal(ok.step, null)
  assert.equal(ok.attemptAt, null, 'heure de tentative future ignorée')
  const good = n(body()).input
  assert.deepEqual([good.email, good.journey, good.step, good.attemptRef, good.pagePath], ['cliente@example.org', 'chronosphere_max', 'confirmation_failed', '5O190127TN364715T', '/chronosphere-max'])
})

test('signalement : enregistré, propriétaire prévenu, accusé client sobre, aucun appel PayPal', async () => {
  const db = fakeDb()
  const sent = []
  const fetchCalls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { fetchCalls.push(args); throw new Error('aucun appel réseau attendu') }
  try {
    const result = await issues.submitPaymentIssue({
      supabase: db, req: req(body({ comment: 'Carte 4970 1012 3456 7890 débitée' })), now: NOW,
      env: { VERCEL_ENV: 'production', RDV_RATE_LIMIT_SECRET: 'k'.repeat(40), RDV_BALANCE_ALERT_EMAIL: 'owner@example.org' },
      send: async (message) => { sent.push(message); return { status: 'sent' } },
    })
    assert.deepEqual(result, { status: 201, body: { ok: true, reference: 'PB-1A2B3C4D' } })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(fetchCalls.length, 0, 'aucune requête PayPal ni autre')
  const args = db.calls.find(c => c.name === 'submit_payment_issue_report').args
  assert.match(args.p_ip_hash, /^[0-9a-f]{64}$/, 'adresse IP hachée, jamais stockée en clair')
  assert.ok(!JSON.stringify(args).includes('203.0.113.7'))
  assert.equal(args.p_comment, 'Carte [numéro masqué] débitée')
  assert.equal(args.p_client_kind, 'mobile')
  const [owner, ack] = sent
  assert.equal(owner.to, 'owner@example.org')
  assert.equal(owner.replyTo, 'cliente@example.org')
  assert.match(owner.subject, /ChronoSphère MAX \(PB-1A2B3C4D\)/)
  assert.match(owner.text, /5O190127TN364715T/)
  assert.ok(!owner.text.includes('4970'), 'jamais de numéro de carte dans l’alerte')
  assert.equal(ack.to, 'cliente@example.org')
  assert.ok(!ack.text.includes('Carte') && !ack.html.includes('Carte'), 'l’accusé ne reprend pas le texte saisi')
  assert.match(ack.text, /ne refaites pas de paiement/)
  assert.deepEqual(db.calls.filter(c => c.name === 'mark_payment_issue_notified').map(c => c.args.p_kind), ['owner', 'ack'])
})

test('doublon, limite de débit et robot : aucun e-mail envoyé', async () => {
  const env = { VERCEL_ENV: 'production', RDV_RATE_LIMIT_SECRET: 'k'.repeat(40), RDV_BALANCE_ALERT_EMAIL: 'owner@example.org' }
  let sent = 0
  const send = async () => { sent += 1; return { status: 'sent' } }
  const dup = await issues.submitPaymentIssue({ supabase: fakeDb({ submit: { ok: true, duplicate: true, reference: 'PB-1A2B3C4D' } }), req: req(body()), env, send, now: NOW })
  assert.deepEqual(dup, { status: 200, body: { ok: true, reference: 'PB-1A2B3C4D', duplicate: true } })
  const limited = await issues.submitPaymentIssue({ supabase: fakeDb({ submit: { ok: false, error: 'rate_limited' } }), req: req(body()), env, send, now: NOW })
  assert.deepEqual(limited, { status: 429, body: { error: 'rate_limited' } })
  const robotDb = fakeDb()
  const robot = await issues.submitPaymentIssue({ supabase: robotDb, req: req(body({ website: 'x' })), env, send, now: NOW })
  assert.deepEqual(robot, { status: 200, body: { ok: true, reference: null } }, 'réponse identique, rien enregistré')
  assert.equal(robotDb.calls.length, 0)
  assert.equal(sent, 0)
})

test('accusé client au plus une fois par jour et par adresse', async () => {
  const sent = []
  await issues.submitPaymentIssue({
    supabase: fakeDb({ submit: { ok: true, duplicate: false, id: '11111111-1111-4111-8111-111111111111', reference: 'PB-00000001', ack_allowed: false } }),
    req: req(body()), now: NOW, env: { RDV_BALANCE_ALERT_EMAIL: 'owner@example.org' },
    send: async (m) => { sent.push(m.to); return { status: 'sent' } },
  })
  assert.deepEqual(sent, ['owner@example.org'])
})

test('Production sans clé de limitation : signalement refusé proprement (échec fermé)', async () => {
  const result = await issues.submitPaymentIssue({ supabase: fakeDb(), req: req(body()), env: { VERCEL_ENV: 'production' }, send: async () => ({ status: 'sent' }), now: NOW })
  assert.deepEqual(result, { status: 503, body: { error: 'reporting_unavailable' } })
})

test('administration : réservée, filtres et traitement historisé', async () => {
  const denied = await issues.handlePaymentIssuesAdmin({ supabase: fakeDb({ admin: false }), userId: 'u', method: 'GET' })
  assert.equal(denied.status, 403)
  const db = fakeDb({ list: [{ id: 'x' }] })
  const listed = await issues.handlePaymentIssuesAdmin({ supabase: db, userId: 'u', method: 'GET', query: { status: 'open' } })
  assert.deepEqual(listed, { status: 200, body: { issues: [{ id: 'x' }] } })
  assert.deepEqual(db.calls.find(c => c.from === 'payment_issue_reports').filters, [['in', 'status', ['new', 'in_progress']]])
  const bad = await issues.handlePaymentIssuesAdmin({ supabase: db, userId: 'u', method: 'POST', input: { op: 'update', id: '11111111-1111-4111-8111-111111111111', status: 'deleted' } })
  assert.equal(bad.status, 400)
  const ok = await issues.handlePaymentIssuesAdmin({ supabase: db, userId: 'u', method: 'POST', input: { op: 'update', id: '11111111-1111-4111-8111-111111111111', status: 'resolved', owner_note: 'Remboursé ; carte 4970101234567890' } })
  assert.equal(ok.status, 200)
  const args = db.calls.find(c => c.name === 'update_payment_issue_report').args
  assert.equal(args.p_owner_note, 'Remboursé ; carte [numéro masqué]')
})

test('branchement : public sans connexion, administration protégée, aucun code PayPal', () => {
  const config = read('api/rdv-config.js')
  assert.match(config, /paymentIssueAction/)
  assert.ok(config.indexOf('paymentIssueAction') < config.indexOf('questionAction'), 'traité avant les autres actions')
  assert.match(read('api/rdv-admin.js'), /case 'payment-issues':/)
  const lib = read('lib/paymentIssues.js')
  assert.doesNotMatch(lib, /paypal\.com|captureOrder|checkout\/orders/i, 'aucun appel PayPal possible')
  assert.match(lib, /isPlatformAdmin\(supabase, userId\)/)
})

test('migration : protections dans la base et aucune donnée bancaire', () => {
  const sql = read('supabase/migrations/20261108140000_payment_issue_reports.sql')
  assert.match(sql, /comment !~ '\\d\(\?:\[ -\]\?\\d\)\{12,18\}'/, 'suite de 13 à 19 chiffres refusée')
  assert.match(sql, /page_path !~ '\[\?#\]'/, 'aucun paramètre d’URL stocké')
  assert.match(sql, />= 5 THEN/)
  assert.match(sql, />= 3 THEN/)
  assert.match(sql, />= 60 THEN/)
  assert.match(sql, /INTERVAL '24 hours'/)
  assert.match(sql, /REVOKE ALL ON public\.payment_issue_reports, public\.payment_issue_events FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(sql, /\b(mediumia_entitlements|formation_[a-z_]+|parcours_[a-z_]+)\b/i, 'parcours Formation non touché')
  assert.equal(typeof process.env, 'object')
})
