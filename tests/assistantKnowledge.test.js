import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const apiPath = new URL('../api/mediumia-trial.js', import.meta.url)
const guardianPath = new URL('../lib/guardianKnowledge.js', import.meta.url)
const catalogPath = new URL('../lib/mediumiaPublicCatalog.js', import.meta.url)

async function readSources() {
  const [api, guardian, catalog] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(guardianPath, 'utf8'),
    readFile(catalogPath, 'utf8'),
  ])
  return { api, guardian, catalog }
}

test('public assistants share the current MediumIA commercial truth', async () => {
  const { api, guardian, catalog } = await readSources()

  assert.ok(api.includes("import { MEDIUMIA_PUBLIC_CATALOG } from '../lib/mediumiaPublicCatalog.js'"))
  assert.ok(guardian.includes("import { MEDIUMIA_PUBLIC_CATALOG } from './mediumiaPublicCatalog.js'"))
  assert.ok(api.includes('${MEDIUMIA_PUBLIC_CATALOG}'))
  assert.ok(guardian.includes('${MEDIUMIA_PUBLIC_CATALOG}'))

  assert.ok(catalog.includes('CHRONOSPHÈRE'))
  assert.ok(catalog.includes('/rdv/sebastien-seguin'))
  assert.ok(catalog.includes('/conferences'))
  assert.ok(catalog.includes('/oracle#tirage-gratuit'))
  assert.ok(catalog.includes('Lydie Lesaffre'))

  assert.ok(!api.includes('Consultations individuelles disponibles via Reservio.'))
  assert.ok(!guardian.includes('les premiers profils arrivent bientôt'))
})
