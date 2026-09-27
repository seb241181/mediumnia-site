import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { commonDepositCents, groupServices, serviceGroupKey, variantLabel } from '../src/lib/rdvServiceGroups.js'

const svc = (id, title, modality, extra = {}) => ({
  id, slug: id, title, modality, booking_mode: 'instant', reservation_payment_kind: 'arrhes', reservation_payment_cents: 2000, ...extra,
})

// Les 8 prestations publiées de Sébastien au 27/09/2026.
const LIVE = [
  svc('d1', 'desenvoutement par visioconférence', ['video']),
  svc('d2', 'Désenvoûtement — En présence', ['in-person']),
  svc('l1', 'Dégagement d’un lieu — En présence', ['in-person'], { booking_mode: 'request', reservation_payment_kind: 'none', reservation_payment_cents: 0 }),
  svc('m1', 'Comprendre et développer sa médiumnité — En présence', ['in-person']),
  svc('m2', 'Comprendre et développer sa médiumnité — Visio', ['video']),
  svc('g1', 'Guidance de chemin de vie — En présence', ['in-person']),
  svc('g2', 'Guidance de chemin de vie — Visio', ['video']),
  svc('l2', 'Dégagement d’un lieu — À distance', ['video']),
]

test('the 8 live services become 4 cards with their formats', () => {
  const groups = groupServices(LIVE)
  assert.deepEqual(groups.map(g => g.title), [
    'Désenvoûtement',
    'Dégagement d’un lieu',
    'Comprendre et développer sa médiumnité',
    'Guidance de chemin de vie',
  ])
  assert.deepEqual(groups.map(g => g.variants.map(v => v.variantLabel)), [
    ['En présence', 'Visio'],
    ['En présence', 'À distance'],
    ['En présence', 'Visio'],
    ['En présence', 'Visio'],
  ])
  // Chaque déclinaison garde sa prestation d'origine (slug, mode de réservation).
  const lieu = groups[1].variants
  assert.equal(lieu[0].slug, 'l1')
  assert.equal(lieu[0].booking_mode, 'request')
  assert.equal(lieu[1].slug, 'l2')
  assert.equal(groups[0].variants[1].displayTitle, 'Désenvoûtement — Visio')
})

test('grouping keys ignore case, accents and the format suffix', () => {
  assert.equal(serviceGroupKey('desenvoutement par visioconférence'), serviceGroupKey('Désenvoûtement — En présence'))
  assert.notEqual(serviceGroupKey('Guidance de chemin de vie — Visio'), serviceGroupKey('Désenvoûtement — Visio'))
  assert.equal(variantLabel({ title: 'Consultation', modality: ['phone'] }), 'Téléphone')
})

test('a single service stays one card with its own title', () => {
  const [group] = groupServices([svc('x', 'Tirage de cartes', ['video'])])
  assert.equal(group.title, 'Tirage de cartes')
  assert.equal(group.variants[0].displayTitle, 'Tirage de cartes')
})

test('the deposit is announced once only when every online service shares it', () => {
  assert.equal(commonDepositCents(LIVE), 2000)
  assert.equal(commonDepositCents([...LIVE, svc('z', 'Autre', ['video'], { reservation_payment_cents: 3000 })]), null)
})

test('booking page uses grouped cards, real Google reviews and no floating bubbles', async () => {
  const [page, app, account] = await Promise.all([
    readFile(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/GlobalAccount.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(page, /groupServices\(services\)/)
  assert.match(page, /role="radiogroup"/)
  assert.match(page, /useGoogleReviews\(\)/)
  assert.match(page, /Comment ça se passe/)
  assert.match(page, /jusqu’à 48 h avant/)
  assert.match(app, /view !== 'rdv-public'/)
  assert.match(account, /pathname\.startsWith\('\/rdv\/'\)/)
})
