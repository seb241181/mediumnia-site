import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  OPT_OUT_KEY, analyticsEnabled, captureUtm, storedUtm, sanitizeAnalyticsUrl, makeBeforeSend,
} from '../src/lib/siteAnalytics.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function storage() {
  const map = new Map()
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map }
}

function fakeWindow(href = 'https://mediumia.fr/', { local = storage(), session = storage() } = {}) {
  return {
    location: { href, hostname: new URL(href).hostname, pathname: new URL(href).pathname },
    localStorage: local,
    sessionStorage: session,
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

test('mes visites : ?noanalytics=1 mémorisé (localStorage), ?noanalytics=0 pour réactiver', () => {
  const local = storage()
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/?noanalytics=1', { local }), { prodBuild: true }), false)
  assert.equal(local.getItem(OPT_OUT_KEY), '1')
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/formation', { local }), { prodBuild: true }), false, 'toujours exclu sans le paramètre')
  assert.equal(makeBeforeSend(fakeWindow('https://mediumia.fr/', { local }))({ type: 'pageview', url: 'https://mediumia.fr/' }), null)
  assert.equal(analyticsEnabled(fakeWindow('https://mediumia.fr/?noanalytics=0', { local }), { prodBuild: true }), true)
})

test('campagne : utm_* lus à l’arrivée, conservés pendant la visite, ajoutés aux pages vues', () => {
  const session = storage()
  const win = fakeWindow('https://mediumia.fr/?utm_source=instagram&utm_medium=social&utm_campaign=octobre&fbclid=abc', { session })
  assert.deepEqual(captureUtm(win), { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'octobre' })
  const later = fakeWindow('https://mediumia.fr/rdv/sebastien-seguin', { session })
  assert.deepEqual(storedUtm(later), { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'octobre' })
  const view = makeBeforeSend(later)({ type: 'pageview', url: later.location.href })
  assert.equal(view.url, 'https://mediumia.fr/rdv/sebastien-seguin?utm_source=instagram&utm_medium=social&utm_campaign=octobre')
})

test('confidentialité UTM : valeurs personnelles rejetées (e-mail, téléphone, identifiant long)', () => {
  const session = storage()
  // Valeur qui contient un e-mail → rejetée.
  const winEmail = fakeWindow('https://mediumia.fr/?utm_source=alice@example.com', { session })
  assert.equal(captureUtm(winEmail), null)
  // Valeur qui contient un numéro de téléphone → rejetée.
  const winPhone = fakeWindow('https://mediumia.fr/?utm_source=0612345678', { session: storage() })
  assert.equal(captureUtm(winPhone), null)
  // Identifiant long opaque → rejeté.
  const winId = fakeWindow('https://mediumia.fr/?utm_source=a1b2c3d4e5f6g7h8i9j0k1', { session: storage() })
  assert.equal(captureUtm(winId), null)
  // Valeur trop longue → rejetée.
  const winLong = fakeWindow(`https://mediumia.fr/?utm_source=${'a'.repeat(51)}`, { session: storage() })
  assert.equal(captureUtm(winLong), null)
  // Valeur valide courte → acceptée.
  const winOk = fakeWindow('https://mediumia.fr/?utm_source=insta.2024', { session: storage() })
  assert.deepEqual(captureUtm(winOk), { utm_source: 'insta.2024' })
})

test('confidentialité : adresses envoyées sans jeton, sans fragment, sans paramètre personnel ; pages de gestion exclues', () => {
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/rdv/solde#token=secret'), 'https://mediumia.fr/rdv/solde')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/rdv/sebastien-seguin?offre=TOKEN123&email=a@b.fr'), 'https://mediumia.fr/rdv/sebastien-seguin')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/carte-cadeau/MED-ABCD-1234'), 'https://mediumia.fr/carte-cadeau/[code]')
  assert.equal(sanitizeAnalyticsUrl('https://mediumia.fr/x/a1b2c3d4e5f6g7h8i9j0k1'), 'https://mediumia.fr/x/[id]')
  const before = makeBeforeSend(fakeWindow())
  for (const url of ['https://mediumia.fr/rdv', 'https://mediumia.fr/pro', 'https://mediumia.fr/agents/x']) assert.equal(before({ type: 'pageview', url }), null, url)
  assert.ok(before({ type: 'pageview', url: 'https://mediumia.fr/rdv/sebastien-seguin' }))
})

test('confidentialité UTM dans les liens : valeurs personnelles jamais transmises', () => {
  // Même si un utm a été stocké, une valeur contenant un e-mail n’est pas envoyée.
  const session = storage()
  session.setItem('mediumia_utm', JSON.stringify({ utm_source: 'alice@example.com', utm_campaign: 'test' }))
  const win = fakeWindow('https://mediumia.fr/', { session })
  const view = makeBeforeSend(win)({ type: 'pageview', url: 'https://mediumia.fr/' })
  assert.ok(view)
  assert.doesNotMatch(view.url, /alice/)
  assert.match(view.url, /utm_campaign=test/)
})

test('branchements : composant Analytics à la racine en mode production, dépendance unique, pas de cookie', () => {
  const main = read('src/main.jsx')
  assert.match(main, /import \{ Analytics \} from '@vercel\/analytics\/react'/)
  assert.match(main, /\{vercelAnalytics && <Analytics mode="production" beforeSend=\{makeBeforeSend\(\)\} \/>\}/)
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['@vercel/analytics'], '2.0.1')
  assert.doesNotMatch(read('src/lib/siteAnalytics.js'), /document\.cookie/)
  // Pas d'import de track() : les événements personnalisés ne sont pas utilisés (plan Hobby).
  assert.doesNotMatch(read('src/lib/siteAnalytics.js'), /import.*track/)
  // Aucun pont vers les compteurs internes : les compteurs MediumIA restent indépendants.
  assert.doesNotMatch(read('src/lib/mediumiaMetrics.js'), /siteAnalytics/)
})
