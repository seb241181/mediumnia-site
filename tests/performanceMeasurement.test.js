import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronoPath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const examplePath = new URL('../src/components/ChronosphereExamplePage.jsx', import.meta.url)
const ecosystemPath = new URL('../src/components/EcosystemNextSteps.jsx', import.meta.url)
const clientMetricsPath = new URL('../src/lib/mediumiaMetrics.js', import.meta.url)
const serverMetricsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)
const apiPath = new URL('../api/rdv-config.js', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260906102000_mediumia_event_daily_counts.sql', import.meta.url)

async function readAll() {
  const [app, chrono, example, ecosystem, clientMetrics, serverMetrics, api, migration] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(chronoPath, 'utf8'),
    readFile(examplePath, 'utf8'),
    readFile(ecosystemPath, 'utf8'),
    readFile(clientMetricsPath, 'utf8'),
    readFile(serverMetricsPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(migrationPath, 'utf8'),
  ])
  return { app, chrono, example, ecosystem, clientMetrics, serverMetrics, api, migration }
}

test('heavy product routes are lazy-loaded behind Suspense', async () => {
  const { app } = await readAll()
  assert.match(app, /import \{ lazy, Suspense, useState, useEffect \} from 'react'/)
  assert.match(app, /const ChronospherePage = lazy\(\(\) => import\('\.\/components\/ChronospherePage'\)\)/)
  assert.match(app, /const OraclePage = lazy\(\(\) => import\('\.\/components\/OraclePage'\)\)/)
  assert.match(app, /const FormationPage = lazy\(\(\) => import\('\.\/components\/FormationPage'\)\)/)
  assert.doesNotMatch(app, /import ChronospherePage from '\.\/components\/ChronospherePage'/)
  assert.match(app, /function DeferredRoute/)
})

test('product funnel metrics cover the key MediumIA entry and payment steps', async () => {
  const { app, chrono, example, ecosystem } = await readAll()
  assert.match(app, /trackMediumiaMetric\('home_view', 'home'\)/)
  assert.match(ecosystem, /trackMediumiaMetric\(context === 'home' \? 'home_door_click' : 'ecosystem_door_click'/)
  assert.match(example, /chronosphere_example_view/)
  assert.match(example, /chronosphere_example_cta/)
  assert.match(chrono, /chronosphere_payment_opened/)
})

test('metrics are aggregate-only and do not store personal identifiers', async () => {
  const { clientMetrics, serverMetrics, migration } = await readAll()
  assert.match(clientMetrics, /credentials: 'omit'/)
  assert.doesNotMatch(clientMetrics, /localStorage|sessionStorage|document\.cookie/)
  assert.match(serverMetrics, /Preview\/dev traffic must never pollute production product metrics/)
  assert.match(migration, /mediumia_event_daily_counts/)
  assert.match(migration, /event_count bigint/)
  assert.match(migration, /primary key \(event_date, event_name, source\)/)
  assert.doesNotMatch(migration, /user_id|email|ip_address|session_id|visitor_id|cookie/i)
})

test('metrics reuse rdv-config and keep the Vercel function count unchanged', async () => {
  const { api, serverMetrics } = await readAll()
  assert.match(api, /analyticsAction/)
  assert.match(api, /handleMediumiaAnalytics/)
  assert.match(serverMetrics, /increment_mediumia_event/)
})
