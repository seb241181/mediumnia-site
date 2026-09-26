import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// L'or de marque #C9A84C n'atteint que 2,3:1 sur fond clair : jamais pour du
// petit texte de la boutique (étiquettes, « Voir → »), qui utilise l'or foncé.
test('small shop labels use the accessible dark gold', () => {
  const src = read('src/components/BoutiqueEcommerce.jsx')
  assert.match(src, /const TEXT_GOLD = '#9b640b'/)
  assert.doesNotMatch(src, /text-\[10px\][^>]*style=\{\{ color: '#C9A84C' \}\}/)
  assert.doesNotMatch(src, /text-xs text-gold group-hover/)
})
