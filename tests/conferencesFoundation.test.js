import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pagePath = new URL('../src/components/ConferencesPage.jsx', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const footerPath = new URL('../src/components/LegalFooter.jsx', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)

async function readSources() {
  const [page, app, footer, pilotage, vercel] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(footerPath, 'utf8'),
    readFile(pilotagePath, 'utf8'),
    readFile(vercelPath, 'utf8'),
  ])
  return { page, app, footer, pilotage, vercel }
}

test('conferences page is a truthful public foundation without invented event details', async () => {
  const { page } = await readSources()
  assert.match(page, /Programmation en préparation/)
  assert.match(page, /La prochaine conférence sera annoncée ici/)
  assert.match(page, /réservation, le paiement et l’envoi automatique du lien de direct viendront s’y brancher ensuite/)
  assert.doesNotMatch(page, /2026-\d{2}-\d{2}|\b\d{1,3}\s?€\b/)
})

test('conference route is lazy, reachable from navigation and kept outside the home clutter', async () => {
  const { app, footer, vercel } = await readSources()
  assert.match(app, /const ConferencesPage = lazy/)
  assert.match(app, /p\.startsWith\('\/conferences'\)/)
  assert.match(app, /openConferences/)
  assert.match(app, />Conférences<\/button>/)
  assert.match(footer, /href="\/conferences"/)
  assert.match(vercel, /"source": "\/conferences"[\s\S]*?"destination": "\/index\.html"/)
  assert.doesNotMatch(app, /UniverseCard[^\n]+Conférences/)
})

test('conference interest is measured with aggregate MediumIA metrics', async () => {
  const { page, pilotage } = await readSources()
  assert.match(page, /trackMediumiaMetric\('conference_page_view'/)
  assert.match(page, /trackMediumiaMetric\('conference_interest_click'/)
  assert.match(pilotage, /conference_page_view/)
  assert.match(pilotage, /conference_interest_click/)
})
