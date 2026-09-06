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

test('other founders do not receive invented price or duration data', () => {
  const amandine = practitioner('amandine-pouwels')
  const willy = practitioner('willy-ryckebusch')
  const gilda = practitioner('gilda')

  assert.equal(amandine.practical.startingPrice, undefined)
  assert.equal(amandine.practical.duration, undefined)
  assert.equal(willy.practical.startingPrice, undefined)
  assert.equal(willy.practical.duration, undefined)
  assert.equal(gilda.practical.startingPrice, undefined)
  assert.equal(gilda.practical.duration, undefined)
})

test('Willy keeps verified Wormhout and distance modalities and animal support', () => {
  const willy = practitioner('willy-ryckebusch')
  assert.deepEqual(willy.practical.modalities, ['Cabinet à Wormhout', 'À distance'])
  assert.match(willy.practical.audience, /animaux/)
})

test('Gilda exposes consultation mode without inventing a target audience', () => {
  const gilda = practitioner('gilda')
  assert.equal(gilda.audience, '')
  assert.equal(gilda.practical.audience, undefined)
  assert.deepEqual(gilda.practical.modalities, ['Consultation individuelle'])
})

test('pricing section is conditional and includes a stale-price warning', () => {
  assert.match(profileSource, /Array\.isArray\(practitioner\.services\) && practitioner\.services\.length > 0/)
  assert.match(profileSource, /peuvent évoluer/)
  assert.match(profileSource, /Vérifiez-les au moment de réserver/)
})
