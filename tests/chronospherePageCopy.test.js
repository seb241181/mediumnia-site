import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ChronoSphère page speaks to customers, not about unfinished features', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.doesNotMatch(page, /prochaine étape|branchement d’un moteur|rapport natal premium|futur thème astral/)
  assert.match(page, /ChronoSphère 999\n/)
  assert.match(page, /label: 'Énergie'/)
  assert.match(page, /Ce que vous recevez/)
  assert.match(page, /Elle n’établit pas de certitude/)
})

test('e-mail is asked after the birth data and the numbers, just before the offers', () => {
  const page = read('src/components/ChronospherePage.jsx')
  const place = page.indexOf('id="chrono-bplace"')
  const numbers = page.indexOf("['Carte principale', 'Résonance I', 'Résonance II']")
  const email = page.indexOf('type="email"')
  const offers = page.indexOf('Choisissez votre offre')
  assert.ok(place > 0 && numbers > place && email > numbers && offers > email)
})

test('MAX is offered next to the single draw and the pack, legal consent unchanged', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /href="\/chronosphere-max"[\s\S]*Découvrir MAX →/)
  assert.match(page, /products\?\.max3/)
  assert.match(page, /Je demande l'exécution immédiate du tirage numérique CHRONOSPHERE 999 et reconnais/)
  assert.match(page, /onClick=\{choosePack\}/)
})

test('reviews are real and labelled for what they are', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /review\.offering === 'chronosphere'/)
  assert.match(page, /avis sur Google, pour ses consultations/)
  assert.match(read('src/components/GiftChronosphereRedeem.jsx'), /underline decoration-gold\/40[\s\S]*J’ai une carte cadeau/)
  assert.match(read('src/App.jsx'), /view !== 'chronosphere'/)
})
