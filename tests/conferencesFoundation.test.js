import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pagePath = new URL('../src/components/ConferencesPage.jsx', import.meta.url)
const apiPath = new URL('../api/conferences.js', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260914142000_conference_launch_foundation.sql', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const footerPath = new URL('../src/components/LegalFooter.jsx', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)

async function readSources() {
  const [page, api, migration, app, footer, pilotage, vercel] = await Promise.all([pagePath, apiPath, migrationPath, appPath, footerPath, pilotagePath, vercelPath].map((path) => readFile(path, 'utf8')))
  return { page, api, migration, app, footer, pilotage, vercel }
}

test('conference registration stays closed until the server event explicitly opens it', async () => {
  const { page, api } = await readSources()
  assert.match(page, /registrationOpen/)
  assert.match(page, /Ouverture prochaine/)
  assert.match(page, /<form onSubmit=/)
  assert.match(api, /event\.status !== 'registration_open'/)
  assert.match(api, /Les inscriptions ne sont pas ouvertes/)
  assert.doesNotMatch(page, /2026-\d{2}-\d{2}|\b\d{1,3}\s?€\b/)
})

test('conference data model protects PII and temporary passes server-side', async () => {
  const { migration } = await readSources()
  assert.match(migration, /create table if not exists public\.conference_events/)
  assert.match(migration, /create table if not exists public\.conference_registrations/)
  assert.match(migration, /create table if not exists public\.conference_questions/)
  assert.match(migration, /create table if not exists public\.conference_passes/)
  assert.match(migration, /token_hash text not null unique/)
  assert.match(migration, /revoke all on public\.conference_registrations from anon, authenticated/)
})

test('conference route is lazy and reachable directly', async () => {
  const { app, footer, vercel } = await readSources()
  const config = JSON.parse(vercel)
  assert.match(app, /const ConferencesPage = lazy/)
  assert.match(app, /p\.startsWith\('\/conferences'\)/)
  assert.match(app, /openConferences/)
  assert.match(footer, /href="\/conferences"/)
  assert.ok(config.rewrites.some((rule) => rule.source === '/conferences' && rule.destination === '/index.html'))
})

test('conference funnel is measured with aggregate MediumIA metrics', async () => {
  const { page, pilotage } = await readSources()
  assert.match(page, /trackMediumiaMetric\('conference_page_view'/)
  assert.match(page, /trackMediumiaMetric\('conference_interest_click'/)
  assert.match(page, /trackMediumiaMetric\('conference_registration_success'/)
  assert.match(pilotage, /conference_page_view/)
  assert.match(pilotage, /conference_interest_click/)
})
