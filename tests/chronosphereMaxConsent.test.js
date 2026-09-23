import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pagePath = new URL('../src/components/ChronosphereMaxPage.jsx', import.meta.url)
const paypalPath = new URL('../lib/chronospherePayPal.js', import.meta.url)

test('MAX checkout consent includes the digital-content withdrawal waiver', async () => {
  const page = await readFile(pagePath, 'utf8')
  assert.match(page, /Je demande l’exécution immédiate du service numérique ChronoSphère MAX/)
  assert.match(page, /ne peut faire l’objet d’un droit de rétractation/)
  assert.match(page, /L221-28 du Code de la consommation/)
})

test('MAX consent version is bumped and pending v1 orders can still be captured', async () => {
  const paypal = await readFile(paypalPath, 'utf8')
  assert.match(paypal, /const MAX_CONSENT_VERSION = 'chronosphere-max-2026-09-23-v2'/)
  assert.match(paypal, /MAX_ACCEPTED_CONSENT_VERSIONS = new Set\(\[MAX_CONSENT_VERSION, 'chronosphere-max-2026-09-23-v1'\]\)/)
  assert.match(paypal, /consent_version: product === 'max3' \? MAX_CONSENT_VERSION/)
})
