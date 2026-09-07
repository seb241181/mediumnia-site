import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const apiPath = new URL('../api/mediumia-trial.js', import.meta.url)
const guardianPath = new URL('../lib/guardianKnowledge.js', import.meta.url)
const catalogPath = new URL('../lib/mediumiaPublicCatalog.js', import.meta.url)
const trialChatPath = new URL('../src/components/TrialChat.jsx', import.meta.url)

async function readSources() {
  const [api, guardian, catalog, trialChat] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(guardianPath, 'utf8'),
    readFile(catalogPath, 'utf8'),
    readFile(trialChatPath, 'utf8'),
  ])
  return { api, guardian, catalog, trialChat }
}

test('public assistants share the current MediumIA commercial truth', async () => {
  const { api, guardian, catalog } = await readSources()

  assert.ok(api.includes("import { MEDIUMIA_PUBLIC_CATALOG } from '../lib/mediumiaPublicCatalog.js'"))
  assert.ok(guardian.includes("import { MEDIUMIA_PUBLIC_CATALOG } from './mediumiaPublicCatalog.js'"))
  assert.ok(api.includes('${MEDIUMIA_PUBLIC_CATALOG}'))
  assert.ok(guardian.includes('${MEDIUMIA_PUBLIC_CATALOG}'))

  assert.ok(catalog.includes('CHRONOSPHÈRE'))
  assert.ok(catalog.includes('https://mediumia.fr/rdv/sebastien-seguin'))
  assert.ok(catalog.includes('https://mediumia.fr/conferences'))
  assert.ok(catalog.includes('https://mediumia.fr/oracle#tirage-gratuit'))
  assert.ok(catalog.includes('Lydie Lesaffre'))

  assert.ok(!api.includes('Consultations individuelles disponibles via Reservio.'))
  assert.ok(!guardian.includes('les premiers profils arrivent bientôt'))
})

test('assistants know the three free exercises and never invent audio', async () => {
  const { catalog } = await readSources()
  assert.ok(catalog.includes('SÉQUENCE GRATUITE — 3 EXERCICES MEDIUMIA'))
  assert.ok(catalog.includes("L'Intention quotidienne"))
  assert.ok(catalog.includes('Le Souffle de vérité'))
  assert.ok(catalog.includes('Feu Rouge / Feu Vert'))
  assert.ok(catalog.includes('deuxième à J+2, troisième à J+4'))
  assert.ok(catalog.includes("n'inscrit pas automatiquement à une newsletter générale"))
  assert.ok(catalog.includes("Aucun format audio n'est actuellement promis"))
})

test('Formation public trial permits a representative short practice and renders MediumIA URLs as links', async () => {
  const { catalog, trialChat } = await readSources()
  assert.ok(catalog.includes('peut proposer une courte démonstration pédagogique'))
  assert.ok(catalog.includes('Il ne réalise pas de consultation médiumnique, de prédiction, de contact défunt ni de tirage personnalisé.'))
  assert.ok(trialChat.includes('LinkedMessage'))
  assert.ok(trialChat.includes('https://mediumia.fr'))
  assert.ok(trialChat.includes('demandez-moi une courte pratique de découverte'))
})
