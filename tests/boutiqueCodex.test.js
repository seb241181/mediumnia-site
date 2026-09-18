import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('CODEX is public in the MediumIA boutique with its own cover and Amazon link', () => {
  const products = read('src/data/boutiqueProducts.js')
  assert.match(products, /id: 'le-codex'/)
  assert.match(products, /CODEX — Le Livre de l'Arche/)
  assert.match(products, /coverImage: '\/images\/boutique\/codex-cover\.jpg'/)
  assert.match(products, /availability: 'available'/)
  assert.match(products, /https:\/\/www\.amazon\.fr\/dp\/B0HJY4CFFD/)
  assert.doesNotMatch(products.match(/id: 'le-codex'[\s\S]*?\n  },/)?.[0] || '', /publicVisible: false/)
})

test('boutique supports external purchase products without fake local checkout copy', () => {
  const ecommerce = read('src/components/BoutiqueEcommerce.jsx')
  const detail = read('src/components/ProductDetail.jsx')
  assert.match(ecommerce, /window\.open\(product\.purchaseUrl/)
  assert.match(detail, /product\.coverImage/)
  assert.match(detail, /product\.purchaseLabel/)
  assert.match(detail, /Achat, paiement et livraison gérés sur le site du vendeur/)
})
