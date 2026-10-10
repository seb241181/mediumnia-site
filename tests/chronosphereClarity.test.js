import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)

async function pageSource() {
  return readFile(pagePath, 'utf8')
}

test('ChronoSphère présente sa valeur, les deux prix et un exemple avant le formulaire', async () => {
  const page = await pageSource()
  const heroStart = page.indexOf('data-chronosphere-ux="clair-v1"')
  const formStart = page.indexOf('id="chronosphere-start"')
  assert.ok(heroStart > 0 && formStart > heroStart)
  const hero = page.slice(heroStart, formStart)

  assert.match(hero, /Un éclairage sur vos choix/)
  assert.match(hero, /Ce que vous recevez/)
  assert.match(hero, /Deux chemins possibles/)
  assert.match(hero, /trois leviers/i)
  assert.match(hero, /singlePrice \|\| '5,00 € TTC'/)
  assert.match(hero, /packPrice \|\| '9,90 € TTC'/)
  assert.match(hero, /href="\/chronosphere\/exemple"/)
  assert.match(hero, /exemple fictif/i)
  assert.match(hero, /<details[\s\S]*Comment mon Oracle/)
  assert.match(hero, /les 58 cartes de l'Oracle des Lignes de Temps existent déjà/i)
  assert.match(hero, /l'IA ne les choisit pas/i)
})

test('les offres du premier écran présélectionnent sans contourner le formulaire ou le consentement', async () => {
  const page = await pageSource()
  assert.match(page, /function chooseOffer\(product\)[\s\S]*!offersVisible \|\| !paypalConfig\?\.products\?\.\[product\]/)
  assert.match(page, /setSelectedProduct\(product\)/)
  assert.match(page, /getElementById\('chronosphere-start'\)\?\.scrollIntoView/)
  assert.match(page, /onClick=\{\(\) => chooseOffer\('single'\)\}/)
  assert.match(page, /onClick=\{choosePack\}/)
  assert.match(page, /function choosePack\(\)[\s\S]*chooseOffer\('pack3'\)/)

  assert.match(page, /onSubmit=\{hasToken \? handleSubmit : handleValidateAndPay\}/)
  assert.match(page, /validateForm\(\)/)
  assert.match(page, /if \(!selectedProduct\)/)
  assert.match(page, /setShowPayment\(true\)/)
  assert.match(page, /checked=\{consentAccepted\}/)
  assert.match(page, /consentAccepted && \([\s\S]*paypalContainerRef/)
})

test('le fonctionnement des tirages est toujours expliqué sans promesse de résultat', async () => {
  const page = await pageSource()
  assert.match(page, /aucune heure approximative n’est inventée/)
  assert.match(page, /vérifiez votre acte de naissance/)
  assert.match(page, /trois nombres différents entre 1 et 58/)
  assert.match(page, /chaque nombre correspond à une carte existante de mon Oracle des Lignes de Temps/)
  assert.match(page, /l’e-mail contient votre lien personnel pour reprendre les tirages restants/)
  assert.match(page, /ChronoSphère propose une lecture symbolique et introspective/)
  assert.match(page, /ne remplace aucun conseil médical, juridique ou financier/)
})
