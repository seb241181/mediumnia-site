import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ChronoSphère page speaks to customers, not about unfinished features', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.doesNotMatch(page, /prochaine étape|branchement d’un moteur|rapport natal premium|futur thème astral/)
  assert.match(page, /ChronoSphère 999/)
  assert.match(page, /label: 'Énergie'/)
  assert.match(page, /Ce que vous recevez/)
  assert.match(page, /data-chronosphere-ux="clair-v1"/)
  assert.match(page, /Mon Oracle des Lignes de Temps contient 58 cartes déjà créées/)
  assert.match(page, /Mon Oracle des Lignes de Temps|mon Oracle des Lignes de Temps/)
  assert.match(page, /trois nombres, qui correspondent à trois cartes de mon Oracle/)
  assert.match(page, /Le site ne tire rien au hasard à votre place/)
  assert.match(page, /L’intelligence artificielle intervient ensuite comme outil d’interprétation/)
  assert.match(page, /lignes de temps possibles/)
  assert.match(page, /Elle n’établit pas de certitude/)
})

test('les trois offres sont visibles une seule fois avant le formulaire de naissance', () => {
  const page = read('src/components/ChronospherePage.jsx')
  const choices = page.indexOf('Choisissez votre formule')
  const form = page.indexOf('id="chronosphere-start"')
  const birth = page.indexOf('id="chrono-bplace"')
  const email = page.indexOf('type="email"')
  assert.ok(choices > 0 && form > choices && birth > form && email > birth)
  assert.equal(page.split('Choisissez votre formule').length - 1, 1)
  assert.equal(page.split('href="/chronosphere-max"').length - 1, 1)
  assert.doesNotMatch(page, /<fieldset ref=\{offersRef\}/)
})


test('MAX is offered next to the single draw and the pack, legal consent unchanged', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /href="\/chronosphere-max"[\s\S]*Découvrir MAX →/)
  assert.match(page, /products\?\.max3/)
  assert.match(page, /Je demande l'exécution immédiate du tirage numérique CHRONOSPHERE 999 et reconnais/)
  assert.match(page, /onClick=\{choosePack\}/)
})

test('only ChronoSphère reviews appear, and the free Oracle draw is offered', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /review\.offering === 'chronosphere'/)
  // Les avis Google portent sur les consultations de Sébastien : pas ici.
  assert.doesNotMatch(page, /useGoogleReviews|GoogleReviewCard/)
  assert.match(page, /<OracleInvite onOpenOracle=\{onOpenOracle\} \/>/)
  assert.match(page, /href="\/oracle"[\s\S]*Faire un tirage offert →/)
  assert.match(read('src/components/GiftChronosphereRedeem.jsx'), /underline decoration-gold\/40[\s\S]*J’ai une carte cadeau/)
  assert.match(read('src/App.jsx'), /view !== 'chronosphere'/)
})

test('la sélection des formules n’est active qu’après le choix du client', () => {
  const page = read('src/components/ChronospherePage.jsx')
  assert.match(page, /aria-pressed=\{selectedProduct === 'single'\}/)
  assert.match(page, /aria-pressed=\{selectedProduct === 'pack3'\}/)
  assert.match(page, /Formule sélectionnée/)
  assert.match(page, /3 tirages <strong>indépendants<\/strong>/)
  assert.match(page, /3 lectures <strong>reliées à la même situation<\/strong>/)
  assert.match(page, /Compte MediumIA requis/)
  assert.match(page, /maxPrice \|\| '19,90 € TTC'/)
})
