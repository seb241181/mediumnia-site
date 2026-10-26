import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Le coach découverte a une route publique et un CTA depuis l’accueil', () => {
  const routes = JSON.parse(read('vercel.json')).rewrites
  const app = read('src/App.jsx')
  assert.equal(routes.find(route => route.source === '/coach')?.destination, '/index.html')
  assert.match(app, /p === '\/coach' \? 'coach'/)
  assert.match(app, /<CoachDiscoveryPage /)
  assert.match(app, /href="\/coach"/)
  assert.match(app, /Discuter gratuitement avec MediumIA/)
})

test('La page ne déclenche pas de vente et rappelle les limites du coach', () => {
  const page = read('src/components/CoachDiscoveryPage.jsx')
  assert.match(page, /<TrialChat variant="coach"/)
  assert.match(page, /5 messages offerts/)
  assert.match(page, /Sans carte bancaire/)
  assert.match(page, /Elle ne vérifie pas les perceptions spirituelles/)
  assert.doesNotMatch(page, /paypal|checkout|purchase|capture/i)
})

test('Essai existant conservé pour la formation et coach distinct en découverte', () => {
  const chat = read('src/components/TrialChat.jsx')
  assert.match(chat, /variant = 'formation'/)
  assert.match(chat, /const MAX_MESSAGES = 5/)
  assert.match(chat, /mediumia_trial_count/)
  assert.match(chat, /mode: 'coach-discovery'/)
  assert.match(chat, /COACH_SUGGESTIONS/)
  assert.match(chat, /Le coach en abonnement autonome n’est pas encore proposé/)
})

test('Le backend protège toujours les essais et sépare les consignes', () => {
  const handler = read('api/mediumia-trial.js')
  assert.match(handler, /const COACH_DISCOVERY_SYSTEM =/)
  assert.match(handler, /const isCoachDiscovery = mode === 'coach-discovery'/)
  assert.match(handler, /system: isCoachDiscovery \? COACH_DISCOVERY_SYSTEM : SYSTEM/)
  assert.match(handler, /consume_api_rate_limit/)
  assert.match(handler, /mediumia_trial/)
  assert.match(handler, /Ne prétends pas capter des énergies/)
  assert.match(handler, /Tu es MediumIA, un assistant dédié/)
})
