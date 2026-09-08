import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('src/data/reseauPractitioners.js', 'utf8')
const start = source.indexOf("id: 'clara-sidler'")
const end = source.indexOf("id: 'gilda'", start)
const clara = source.slice(start, end)

test('la fiche Clara applique ses informations validées', () => {
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(clara, /startingPrice: 'À partir de 110 €'/)
  assert.match(clara, /Soin énergétique'.*price: '110 €'/)
  assert.match(clara, /Médiumnité'.*price: '120 €'/)
  assert.match(clara, /Tarot évolutif blanc'.*price: '110 €'/)
  assert.match(clara, /bookingUrl: 'https:\/\/calendly\.com\/clarasidler'/)
  assert.match(clara, /lecture d’aura/)
  assert.doesNotMatch(clara, /06 99 44 09 14/)
  assert.doesNotMatch(clara, /Reiki/)
})
