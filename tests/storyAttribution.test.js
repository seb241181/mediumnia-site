import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { storyAttributionUrl } from '../src/lib/mediumiaAttribution.js'
import { oracleStoryText } from '../src/lib/oracleShareImage.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('story links carry an anonymous source without personal data', () => {
  assert.equal(storyAttributionUrl('oracle'), 'https://mediumia.fr/oracle?src=story-oracle')
  assert.equal(storyAttributionUrl('quiz'), 'https://mediumia.fr/quiz-sensibilite?src=story-quiz')
  const text = oracleStoryText([{ name: 'A' }, { name: 'B' }, { name: 'C' }])
  assert.match(text, /src=story-oracle/)
  assert.doesNotMatch(text, /email|phone|visitor|session/i)
})

test('client metrics duplicate attributed steps without replacing product metrics', () => {
  const metrics = read('src/lib/mediumiaMetrics.js')
  const attribution = read('src/lib/mediumiaAttribution.js')
  assert.match(metrics, /sendMetric\(event, eventSource\)/)
  assert.match(metrics, /sendMetric\('story_visit', attribution\)/)
  assert.match(metrics, /sendMetric\('story_attributed',/)
  assert.match(attribution, /sessionStorage/)
  assert.match(attribution, /VALID = new Set\(\['story-oracle', 'story-quiz'\]\)/)
})

test('analytics accepts story attribution and Pilotage computes visits through purchases', () => {
  const analytics = read('lib/mediumiaAnalytics.js')
  const funnel = read('scripts/apply-funnel-measurement.mjs')
  const home = read('scripts/apply-home-growth-path.mjs')
  assert.match(analytics, /'story_visit'/)
  assert.match(analytics, /'story_attributed'/)
  assert.match(analytics, /STORY_SOURCE_RE/)
  assert.match(funnel, /'story_visit'/)
  assert.match(home, /Visites ramenées/)
  assert.match(home, /Achats attribués/)
  assert.match(home, /story_attribution/)
  assert.match(home, /chronosphere_purchase_completed/)
})

test('Chronosphere emits a completed purchase metric after a successful capture', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /trackMediumiaMetric\('chronosphere_purchase_completed', 'chronosphere'\)/)
})
