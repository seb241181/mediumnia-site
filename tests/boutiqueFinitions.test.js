import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { boutiqueProducts } from '../src/data/boutiqueProducts.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const visible = boutiqueProducts.filter((p) => p.publicVisible !== false)

test('ChronoSphère has its card with real prices and its own visual', () => {
  const chrono = visible.find((p) => p.id === 'chronosphere-999')
  assert.ok(chrono)
  assert.equal(chrono.href, '/chronosphere')
  assert.equal(chrono.priceLabel, 'Dès 5 €')
  assert.match(chrono.summary, /5 €[\s\S]*9,90 €[\s\S]*19,90 €/)
  assert.ok(existsSync(new URL(`../public${chrono.coverImage}`, import.meta.url)))
})

test('the Oracle card announces delivery and is a real link', () => {
  const oracle = visible.find((p) => p.id === 'oracle-au-dela-ame')
  assert.equal(oracle.priceLabel, '29,90 € + livraison')
  assert.equal(oracle.href, '/oracle')
  assert.match(read('src/components/BoutiqueEcommerce.jsx'), /internalLink \? \{ href: product\.href, onClick: openInApp \}/)
})

test('one card per row on phones, filters only for a real catalogue, readable badge', () => {
  const ui = read('src/components/BoutiqueEcommerce.jsx')
  assert.match(ui, /grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4/)
  assert.match(ui, /showFilters = publicProducts\.length >= 6/)
  assert.doesNotMatch(ui, /color: '#C9A84C', letterSpacing: '0\.12em', fontSize: 9/)
  assert.match(ui, /<BoutiqueProductArt variant=\{product\.artwork\} \/>/)
})
