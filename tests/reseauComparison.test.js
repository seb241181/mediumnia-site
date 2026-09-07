import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reseauPractitioners } from '../src/data/reseauPractitioners.js'

const profileSource = fs.readFileSync(new URL('../src/components/PractitionerProfile.jsx', import.meta.url), 'utf8')

function practitioner(id) {
  return reseauPractitioners.find((item) => item.id === id)
}

test('practitioner profiles expose practical details only when verified', () => {
  assert.match(profileSource, /Repères pratiques/)
  assert.match(profileSource, /\.filter\(\(item\) => Boolean\(item\.value\)\)/)
  assert.doesNotMatch(profileSource, /Non renseigné/i)
})

test('Lydie has public comparable price and duration markers from her own site', () => {
  const lydie = practitioner('lydie-lesaffre')
  assert.equal(lydie.practical.startingPrice, 'À partir de 65 €')
  assert.match(lydie.practical.duration, /1 h/)
  assert.deepEqual(lydie.practical.modalities, ['Cabinet à Arras', 'Cabinet à Annezin', 'Téléconsultation'])
  assert.equal(lydie.practical.sourceUrl, 'https://www.mots-pour-maux.com/tarifs-contact')
  assert.ok(lydie.services.length >= 4)
  assert.deepEqual(lydie.services[0], { name: 'Médiumnité', duration: '1 h', price: '65 €' })
})

test('founders without verified pricing do not receive invented price or duration data', () => {
  const amandine = practitioner('amandine-pouwels')
  const willy = practitioner('willy-ryckebusch')

  assert.equal(amandine.practical.startingPrice, undefined)
  assert.equal(amandine.practical.duration, undefined)
  assert.equal(willy.practical.startingPrice, undefined)
  assert.equal(willy.practical.duration, undefined)
})

test('Willy keeps verified Wormhout and distance modalities and animal support', () => {
  const willy = practitioner('willy-ryckebusch')
  assert.deepEqual(willy.practical.modalities, ['Cabinet à Wormhout', 'À distance'])
  assert.match(willy.practical.audience, /animaux/)
})

test('Gilda exposes only the consultation details she confirmed', () => {
  const gilda = practitioner('gilda')
  assert.equal(gilda.audience, '')
  assert.equal(gilda.practical.audience, undefined)
  assert.deepEqual(gilda.practical.modalities, ['Consultation individuelle'])
  assert.equal(gilda.practical.startingPrice, '40 €')
  assert.equal(gilda.practical.duration, '1 h')
  assert.deepEqual(gilda.practical.phones, ['06 79 36 16 07', '03 28 21 89 83'])
  assert.deepEqual(gilda.services[0], { name: 'Consultation de cartomancie', duration: '1 h', price: '40 €' })
  assert.equal(gilda.portrait, '/images/reseau/gilda-cartomancie.jpg')
})

test('pricing section is conditional and includes a stale-price warning', () => {
  assert.match(profileSource, /Array\.isArray\(practitioner\.services\) && practitioner\.services\.length > 0/)
  assert.match(profileSource, /peuvent évoluer/)
  assert.match(profileSource, /Vérifiez-les au moment de réserver/)
})
