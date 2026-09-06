import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildChronosphereResumeUrl,
  chronosphereUrlWithoutFragment,
  parseChronosphereResumeHash,
  resolveChronosphereResumeStatus,
} from '../lib/chronosphereResume.js'

const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const paypalPath = new URL('../lib/chronospherePayPal.js', import.meta.url)
const emailPath = new URL('../lib/chronosphereEmail.js', import.meta.url)
const packToken = 'B'.repeat(43)

test('#resume accepte uniquement un packToken base64url plausible', () => {
  assert.equal(parseChronosphereResumeHash(`#resume=${packToken}`), packToken)
  assert.equal(parseChronosphereResumeHash(`#resume=${packToken}?extra=1`), null)
  assert.equal(parseChronosphereResumeHash(`?token=${packToken}`), null)
  assert.equal(parseChronosphereResumeHash('#resume=trop-court'), null)
  assert.equal(buildChronosphereResumeUrl(packToken), `https://mediumia.fr/chronosphere#resume=${packToken}`)
})

test('URL nettoyée conserve chemin et query sans transmettre le fragment', () => {
  const clean = chronosphereUrlWithoutFragment({ pathname: '/chronosphere', search: '?source=email', hash: `#resume=${packToken}` })
  assert.equal(clean, '/chronosphere?source=email')
  assert.doesNotMatch(clean, /resume|#|token/)
})

test('status valide restaure exactement 2 ou 1 crédits', () => {
  assert.deepEqual(
    resolveChronosphereResumeStatus(true, { valid: true, creditsRemaining: 2, creditsTotal: 3, status: 'active' }),
    { kind: 'active', creditsRemaining: 2, creditsTotal: 3, status: 'active' },
  )
  assert.deepEqual(
    resolveChronosphereResumeStatus(true, { valid: true, creditsRemaining: 1, creditsTotal: 3, status: 'active' }),
    { kind: 'active', creditsRemaining: 1, creditsTotal: 3, status: 'active' },
  )
})

test('status invalide ou pack épuisé ne restaure aucun crédit', () => {
  assert.deepEqual(resolveChronosphereResumeStatus(false, { valid: false }), { kind: 'invalid' })
  assert.deepEqual(
    resolveChronosphereResumeStatus(true, { valid: true, creditsRemaining: 0, creditsTotal: 3, status: 'exhausted' }),
    { kind: 'exhausted', creditsRemaining: 0, creditsTotal: 3, status: 'exhausted' },
  )
})

test('frontend retire le fragment avant status et ne stocke qu’un pack actif', async () => {
  const page = await readFile(pagePath, 'utf8')
  const resumeStart = page.indexOf('const hash = window.location.hash')
  const resumeEnd = page.indexOf('useEffect(() => {\n    if (!drawToken) return', resumeStart)
  const resumeFlow = page.slice(resumeStart, resumeEnd)
  const replaceIndex = resumeFlow.indexOf('window.history.replaceState')
  const fetchIndex = resumeFlow.indexOf("fetch('/api/rdv-config?chronospherePayPalAction=status'")
  const storeIndex = resumeFlow.indexOf('localStorage.setItem(PACK_TOKEN_KEY, packToken)')

  assert.ok(replaceIndex >= 0 && replaceIndex < fetchIndex)
  assert.ok(fetchIndex >= 0 && fetchIndex < storeIndex)
  assert.match(resumeFlow, /localStorage\.removeItem\(PACK_TOKEN_KEY\)/)
  assert.match(resumeFlow, /resume\.kind === 'active'[\s\S]*localStorage\.setItem/)
  assert.match(resumeFlow, /resume\.kind === 'exhausted'[\s\S]*Ce pack a déjà été entièrement utilisé/)
  assert.match(resumeFlow, /Ce lien de reprise n\\'est plus valide/)
})

test('pack restauré masque PayPal et affiche le solde serveur', async () => {
  const page = await readFile(pagePath, 'utf8')
  assert.match(page, /showPayment && !hasToken && !result/)
  assert.match(page, /!result && drawToken && creditState\?\.creditsRemaining >= 1/)
  assert.match(page, /Votre pack Chronosphère a été retrouvé\./)
  assert.match(page, /\{creditsLabel\}/)
})

test('packToken brut reste hors result_json et des écritures Supabase', async () => {
  const [timeline, paypal] = await Promise.all([
    readFile(timelinePath, 'utf8'),
    readFile(paypalPath, 'utf8'),
  ])
  const payload = timeline.slice(timeline.indexOf('const responsePayload = {'), timeline.indexOf('const { data: completeResult'))
  assert.doesNotMatch(payload, /packToken/)
  assert.match(payload, /\.\.\.credits/)
  assert.match(timeline, /p_pack_token_hash: tokenHash/)
  assert.doesNotMatch(timeline, /p_pack_token:\s*packToken/)
  assert.match(paypal, /pack_token_hash: token\.hash/)
  assert.doesNotMatch(paypal, /pack_token:\s*token\.token/)
})

test('retry email conserve le solde du résultat et ne modifie aucun crédit', async () => {
  const [timeline, email] = await Promise.all([
    readFile(timelinePath, 'utf8'),
    readFile(emailPath, 'utf8'),
  ])
  const delivery = timeline.slice(timeline.indexOf('async function deliverCompletedTimeline'), timeline.indexOf('function validateNumbers'))
  assert.match(timeline, /tokenResult\.result_json\?\.creditsRemaining/)
  assert.match(timeline, /pack: isPack \? \{ packToken, creditsRemaining: credits\.creditsRemaining \} : null/)
  assert.doesNotMatch(delivery, /credits_remaining|creditsRemaining\s*:/)
  assert.match(email, /idempotencyKey: `chronosphere-result-\$\{drawId\}`/)
})
