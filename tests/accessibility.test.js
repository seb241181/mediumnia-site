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

// Petits textes dorés lisibles partout sur fond clair, jamais assombris sur fond
// bleu nuit (demande du 26/09).
test('small gold text uses the dark gold on light backgrounds only', () => {
  const css = read('src/index.css')
  assert.match(css, /:is\(\.text-gold, \.text-gold\\\/80, \.text-gold\\\/90\):is\(\.text-\\\[9px\\\], \.text-\\\[10px\\\], \.text-\\\[11px\\\], \.text-xs, \.text-sm\)/)
  assert.match(css, /:not\(:is\(\.bg-deep,[^)]*\.on-dark\) \*\)/)
  assert.match(css, /color: #9b640b;/)
  // Les blocs bleu nuit dont le fond vient d'un style en ligne sont marqués.
  assert.match(read('src/App.jsx'), /className="on-dark cosmic-card-lift/)
  assert.match(read('src/components/TrialChat.jsx'), /className="on-dark px-5 py-4/)
  assert.match(read('src/components/SiteGuardian.jsx'), /className="on-dark px-4 py-3/)
})
