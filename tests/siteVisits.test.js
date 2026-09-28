import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isLikelyBot, summarizeSiteVisits } from '../lib/mediumiaAnalytics.js'
import { countSiteVisitOnce } from '../src/lib/siteVisit.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('public total: site visits, plus home visits only before the site counter existed', () => {
  const rows = [
    { event_date: '2026-09-06', event_name: 'home_view', event_count: 100 },
    { event_date: '2026-09-28', event_name: 'home_view', event_count: 40 },
    { event_date: '2026-09-29', event_name: 'home_view', event_count: 50 },
    { event_date: '2026-09-29', event_name: 'site_visit', event_count: 80 },
  ]
  assert.deepEqual(summarizeSiteVisits(rows), { visits: 100 + 40 + 80, since: '2026-09-06' })
  assert.deepEqual(summarizeSiteVisits(rows.filter((r) => r.event_name === 'home_view')), { visits: 190, since: '2026-09-06' })
  assert.deepEqual(summarizeSiteVisits([]), { visits: 0, since: null })
})

test('robots and scripts are not counted as visits', () => {
  assert.equal(isLikelyBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true)
  assert.equal(isLikelyBot('facebookexternalhit/1.1'), true)
  assert.equal(isLikelyBot(''), true)
  assert.equal(isLikelyBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'), false)
})

function fakeWindow(pathname = '/', { webdriver = false, storageBroken = false } = {}) {
  const store = new Map()
  return {
    navigator: { webdriver },
    location: { pathname },
    sessionStorage: {
      getItem(k) { if (storageBroken) throw new Error('blocked'); return store.get(k) || null },
      setItem(k, v) { if (storageBroken) throw new Error('blocked'); store.set(k, v) },
    },
  }
}

test('a visit is counted once per browsing session, never on management pages', () => {
  const sent = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (url, init) => { sent.push(JSON.parse(init.body)); return Promise.resolve({}) }
  try {
    const win = fakeWindow('/reseau/amandine-pouwels')
    assert.equal(countSiteVisitOnce(win), true)
    assert.equal(countSiteVisitOnce(win), false)
    assert.deepEqual(sent, [{ event: 'site_visit', source: 'site' }])
    assert.equal(countSiteVisitOnce(fakeWindow('/rdv')), false)
    assert.equal(countSiteVisitOnce(fakeWindow('/agents')), false)
    assert.equal(countSiteVisitOnce(fakeWindow('/', { webdriver: true })), false)
    assert.equal(countSiteVisitOnce(fakeWindow('/', { storageBroken: true })), false)
    assert.equal(sent.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the counter runs at start-up and shows on the Réseau page only above its threshold', () => {
  assert.match(read('src/main.jsx'), /countSiteVisitOnce\(\)/)
  const counter = read('src/components/SiteVisitsCounter.jsx')
  assert.match(counter, /PUBLIC_VISITS_THRESHOLD = 1000/)
  assert.match(counter, /Number\(stats\.visits \|\| 0\) < threshold\) return null/)
  assert.doesNotMatch(counter, /localStorage|document\.cookie/)
  assert.match(read('src/components/ReseauJoindre.jsx'), /<SiteVisitsCounter \/>/)
  assert.match(read('src/components/rdv/PilotageDashboard.jsx'), /<SiteVisitsPilotageCard \/>/)
  const analytics = read('lib/mediumiaAnalytics.js')
  assert.match(analytics, /if \(isSiteVisit && isLikelyBot/)
  assert.match(analytics, /action === 'public-stats'/)
})
