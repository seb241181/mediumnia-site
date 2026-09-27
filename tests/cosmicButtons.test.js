import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('only real filled buttons get the gold or deep cosmic style', () => {
  const css = read('src/styles/cosmic-design-system.css')
  // Une sous-chaîne comme « hover:bg-gold/10 » ou « bg-deep/20 » (désactivé)
  // ne doit plus transformer un bouton secondaire en bouton plein.
  assert.doesNotMatch(css, /:where\(button, a\)\[class\*='bg-(gold|deep)'\]/)
  assert.match(css, /\[class~='bg-gold'\]/)
  assert.match(css, /\[class~='bg-deep'\]/)
})

test('intentional gold buttons keep their look, the Réseau filter shows its state', () => {
  assert.match(read('src/components/SiteNav.jsx'), /className="site-nav__students /)
  assert.match(read('src/styles/cosmic-design-system.css'), /\.cosmic-page \.site-nav__students/)
  assert.match(read('src/components/rdv/RdvPublic.jsx'), /border border-gold\/40 bg-gold px-4 py-3/)
  assert.match(read('src/components/ReseauDirectory.jsx'), /\? 'border-deep bg-deep text-gold font-semibold'/)
  assert.equal((read('src/components/rdv/RdvPublic.jsx').match(/rounded-xl bg-gold text-mist/g) || []).length, 2)
  assert.match(read('src/components/ReseauJoindre.jsx'), /form\.distance === v \? 'border-deep bg-deep text-gold font-bold'/)
})
