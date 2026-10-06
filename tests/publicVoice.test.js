import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('public commercial copy uses Sebastian first-person voice', () => {
  const hero = read('src/components/CosmicLibraryHero.jsx')
  const guidance = read('src/components/QuestionPage.jsx')
  const conference = read('src/components/ConferencesPage.jsx')
  const live = read('src/components/ConferenceLivePage.jsx')
  const interview = read('src/components/VideoInterview.jsx')
  const booking = read('src/components/rdv/RdvPublic.jsx')
  const oracle = read('src/components/OraclePage.jsx')
  const home = read('src/components/HomeGrowthPath.jsx')
  const consultations = read('src/data/consultationServices.js')
  const shop = read('src/data/boutiqueProducts.js')

  assert.match(hero, /J’ai créé MediumIA/)
  assert.match(guidance, /Je prends personnellement connaissance de votre demande/)
  assert.match(guidance, /Réponse que j’écris personnellement/)
  assert.match(conference, /Je vous propose une heure en direct/)
  assert.match(live, /POSEZ-MOI VOTRE QUESTION/)
  assert.match(interview, /Mon interview/)
  assert.match(interview, /Écoutez-moi parler de la médiumnité/)
  assert.match(booking, /Je vous recontacterai/)
  assert.match(booking, /Je vous ai proposé ce créneau/)
  assert.match(oracle, /Ma création originale/)
  assert.match(home, /J’ai écrit L’Arche/)
  assert.match(consultations, /Je suis médium professionnel depuis plus de douze ans/)
  assert.match(shop, /J’ai construit cette formation/)
  assert.match(shop, /Je relie mon Oracle des Lignes de Temps/)
  assert.match(shop, /J’y développe ma lecture de l’Arche/)
})

test('old third-person sales phrases do not return', () => {
  const sources = [
    read('src/components/CosmicLibraryHero.jsx'),
    read('src/components/QuestionPage.jsx'),
    read('src/components/ConferencesPage.jsx'),
    read('src/components/ConferenceLivePage.jsx'),
    read('src/components/VideoInterview.jsx'),
    read('src/components/rdv/RdvPublic.jsx'),
    read('src/components/OraclePage.jsx'),
    read('src/components/HomeGrowthPath.jsx'),
    read('src/data/consultationServices.js'),
    read('src/data/boutiqueProducts.js'),
  ].join('\n')

  for (const phrase of [
    'Formation MediumIA de Sébastien Seguin',
    'Sébastien prend personnellement connaissance',
    'Sébastien vous répond personnellement',
    'Une heure avec Sébastien Seguin',
    'Écoutez Sébastien parler de la médiumnité',
    'Prendre rendez-vous avec Sébastien',
    'Ils ont consulté Sébastien',
    'Sébastien vous recontactera',
    'Proposé par Sébastien',
    'L’Arche est l’œuvre de Sébastien Seguin',
    'Médium professionnel depuis plus de douze ans, Sébastien accompagne',
    'Un ouvrage de Sébastien Seguin',
  ]) {
    assert.equal(sources.includes(phrase), false, phrase)
  }
})

test('attribution and legal identity may still use Sebastian name', () => {
  const formation = read('src/components/FormationPage.jsx')
  const quiz = read('src/components/QuizSensibilitePage.jsx')
  const products = read('src/data/boutiqueProducts.js')
  const legal = read('public/cgv-formation.html')

  assert.match(formation, /Je m'appelle <strong[^>]*>Sébastien Seguin/)
  assert.match(quiz, /Sébastien Seguin, Module 2 de la Formation MediumIA/)
  assert.match(products, /Auteur : Sébastien Seguin/)
  assert.match(legal, /Sébastien Seguin, entrepreneur individuel/)
})
