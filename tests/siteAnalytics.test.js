import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  OPT_OUT_KEY, analyticsEnabled, sanitizeAnalyticsUrl, makeBeforeSend,
} from '../src/lib/siteAnalytics.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function storage() {
  const map = new Map()
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map }
}

function fakeWindow(href = 'https://mediumia.fr/', { local = storage() } = {}) {
  return {
    location: { href, hostname: new URL(href).hostname, pathname: new URL(href).pathname },
    localStorage: local,
    navigator: {},
  }
}

test('production uniquement : mediumia.fr et build de production, jamais preview ni local', () => {
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/'), { prodBuild: true }), true)
  assert.equal(analyticsEnabled(fakeWindow('https://www.mediumia.fr/formation'), { prodBuild: true }), true)
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia-site-git-x-seguins-projects.vercel.app/'), { prodBuild: true }), false)
  assert.equal(analyticsEnabled(fakeWindow('http://localhost:5173/'), { prodBuild: true }), false)
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/'), { prodBuild: false }), false)
})

test('mes visites : ?noanalytics=1 persistent, ?noanalytics=0 pour revenir', () => {
  const local = storage()
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/?noanalytics=1', { local }), { prodBuild: true }), false)
  assert.equal(local.getItem(OPT_OUT_KEY), '1')
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/formation', { local }), { prodBuild: true }), false, 'toujours exclu')
  assert.equal(makeBeforeSend(fakeWindow('https://mediumia.fr/', { local }))({ type: 'pageview', url: 'https://mediumia.fr/' }), null)
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/?noanalytics=0', { local }), { prodBuild: true }), true)
})

test('pages sensibles exclues : gestion, paiement du solde, annulation, espace pro, agents', () => {
  const before = makeBeforeSend(fakeWindow())
  // Pages sensibles : jamais comptées.
  for (const url of [
    'https://mediumia.fr/rdv',
    'https://mediumia.fr/rdv/',
    'https://mediumia.fr/rdv/annuler',
    'https://mediumia.fr/rdv/annuler/confirmation',
    'https://mediumia.fr/rdv/solde',
    'https://mediumia.fr/rdv/solde#token=secret',
    'https://mediumia.fr/pro',
    'https://mediumia.fr/pro/conference/abc',
    'https://mediumia.fr/agents/x',
  ]) assert.equal(before({ type: 'pageview', url }), null, `doit exclure ${url}`)
  // Pages publiques commerciales : toujours comptées.
  for (const url of [
    'https://mediumia.fr/',
    'https://mediumia.fr/rdv/sebastien-seguin',
    'https://mediumia.fr/formation',
    'https://mediumia.fr/formation/parcours',
    'https://mediumia.fr/chronosphere',
    'https://mediumia.fr/reseau',
    'https://mediumia.fr/carte-cadeau/MED-XY-123',
    'https://mediumia.fr/question',
  ]) assert.ok(before({ type: 'pageview', url }), `doit compter ${url}`)
})

test('confidentialite : fragments, parametres et codes personnels supprimes', () => {
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/rdv/solde#token=secret'), 'https://mediumia.fr/rdv/solde')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/rdv/sebastien-seguin?offre=TOKEN123&email=a@b.fr'), 'https://mediumia.fr/rdv/sebastien-seguin')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/?utm_source=instagram&fbclid=abc'), 'https://mediumia.fr/')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/carte-cadeau/MED-ABCD-1234'), 'https://mediumia.fr/carte-cadeau/[code]')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/x/a1b2c3d4e5f6g7h8i9j0k1'), 'https://mediumia.fr/x/[id]')
})

test('compteurs MediumIA internes : aucune modification, aucun pont vers siteAnalytics', () => {
  const metrics = read('src/lib/mediumiaMetrics.js')
  assert.doesNotMatch(metrics, /siteAnalytics/, 'pas de pont vers siteAnalytics')
  assert.match(metrics, /trackMediumiaMetric/, 'fonction principale toujours presente')
  assert.match(metrics, /\/api\/rdv-config\?analyticsAction=event/, 'endpoint interne inchange')
})

test('branchements : composant Analytics, pas de track(), pas de cookie, pas d UTM manuel', () => {
  const main = read('src/main.jsx')
  assert.match(main, /import \{ Analytics \} from '@vercel\/analytics\/react'/)
  assert.match(main, /\{vercelAnalytics && <Analytics mode="production" beforeSend=\{makeBeforeSend\(\)\} \/>\}/)
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['@vercel/analytics'], '2.0.1')
  const analytics = read('src/lib/siteAnalytics.js')
  assert.doesNotMatch(analytics, /document\.cookie/)
  assert.doesNotMatch(analytics, /import.*track/)
  assert.doesNotMatch(analytics, /captureUtm|storedUtm|withUtm/, 'pas de gestion UTM manuelle')
  assert.doesNotMatch(analytics, /sessionStorage/, 'rien en sessionStorage')
})
