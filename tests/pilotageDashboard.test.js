import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dashboardPath = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)
const adminPath = new URL('../api/rdv-admin.js', import.meta.url)

async function readSources() {
  const [dashboard, pilotage, admin] = await Promise.all([
    readFile(dashboardPath, 'utf8'),
    readFile(pilotagePath, 'utf8'),
    readFile(adminPath, 'utf8'),
  ])
  return { dashboard, pilotage, admin }
}

function analyticsSection(admin) {
  const start = admin.indexOf('// ── action=analytics')
  const end = admin.indexOf('// ── Router principal', start)
  assert.ok(start >= 0 && end > start)
  return admin.slice(start, end)
}

test('private pro space exposes a dedicated MediumIA pilotage workspace', async () => {
  const { dashboard } = await readSources()
  assert.match(dashboard, /PilotageDashboard/)
  assert.match(dashboard, /Pilotage MediumIA/)
  assert.match(dashboard, /workspace === 'pilotage'/)
  assert.match(dashboard, /sebastien-seguin/)
})

test('pilotage UI provides useful ranges, funnel and privacy explanation', async () => {
  const { pilotage } = await readSources()
  assert.match(pilotage, /RANGE_OPTIONS = \[7, 30, 90\]/)
  assert.match(pilotage, /Entonnoir de découverte/)
  assert.match(pilotage, /Ce que les visiteurs recherchent/)
  assert.match(pilotage, /Évolution quotidienne/)
  assert.match(pilotage, /ne permettent? pas d’identifier|ne permet pas d’identifier/)
  assert.match(pilotage, /Aperçu Preview · données de démonstration/)
})

test('analytics dashboard reuses authenticated rdv-admin and protects production access', async () => {
  const { admin } = await readSources()
  assert.match(admin, /async function handleAnalytics/)
  assert.match(admin, /VERCEL_ENV[^\n]+production/)
  assert.match(admin, /PLATFORM_ADMIN_PRACTITIONER_SLUGS = \['sebastien-seguin'\]/)
  assert.match(admin, /\.eq\('owner_id', userId\)/)
  assert.match(admin, /mediumia_event_daily_counts/)
  assert.match(admin, /case 'analytics':\s+return handleAnalytics/)
})

test('pilotage returns aggregate counters rather than visitor records', async () => {
  const { admin, pilotage } = await readSources()
  const analytics = analyticsSection(admin)
  assert.doesNotMatch(analytics, /customer_email|customer_phone|ip_address|visitor_id|session_id/)
  assert.doesNotMatch(pilotage, /localStorage|sessionStorage|document\.cookie/)
  assert.match(analytics, /event_date, event_name, source, event_count/)
})

test('preview demo can be reviewed without Supabase credentials and never exposes live data', async () => {
  const { dashboard, pilotage } = await readSources()
  assert.match(dashboard, /pilotage_demo/)
  assert.match(dashboard, /hostname\.endsWith\('\.vercel\.app'\)/)
  assert.match(dashboard, /<PilotageDashboard demoMode \/>/)
  assert.match(pilotage, /demoMode = false/)
  assert.match(pilotage, /makePreviewData/)
  assert.match(pilotage, /Démonstration|données de démonstration/)
})
