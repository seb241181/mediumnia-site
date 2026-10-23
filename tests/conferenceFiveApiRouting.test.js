import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const code = file => readFile(new URL(file, import.meta.url), 'utf8')

test('conference 5x reuses the existing rdv-config serverless function (no thirteenth function)', async () => {
  const [api, backend, page, vercel] = await Promise.all([
    code('../api/rdv-config.js'),
    code('../lib/conferenceFiveSandboxPayPal.js'),
    code('../src/components/ConferenceFiveTestPage.jsx'),
    code('../vercel.json'),
  ])
  assert.match(api, /handleConferenceFiveSandbox/)
  assert.match(api, /conferenceFiveAction/)
  assert.match(page, /\/api\/rdv-config\?conferenceFiveAction=/)
  assert.doesNotMatch(page, /\/api\/conference-five-test/)
  assert.match(backend, /CONFERENCE_FIVE_SANDBOX_ENABLED/)
  assert.match(backend, /VERCEL_ENV !== 'production'/)
  assert.match(backend, /wnbwhnqiulsdjcvkuwos/)
  assert.doesNotMatch(backend, /api-m\.paypal\.com/)
  assert.ok(JSON.parse(vercel).rewrites.some(r => r.source === '/formation/conference-5x-test' && r.destination === '/index.html'))
})

test('conference 5x never provisions complete training rights or sends email', async () => {
  const backend = await code('../lib/conferenceFiveSandboxPayPal.js')
  assert.doesNotMatch(backend, /from\('mediumia_entitlements'\)/)
  assert.doesNotMatch(backend, /sendEmail\(|sendConferencePassEmail\(/)
  assert.match(backend, /return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
})

test('5x SQL tables are server-only with a UNIQUE provider reference', async () => {
  const sql = await code('../supabase/migrations/20261023170000_conference_five_sandbox_foundation.sql')
  for (const table of ['conference_five_contracts', 'conference_five_transactions', 'conference_five_audit']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`))
  }
  assert.match(sql, /provider_id text not null unique/)
  assert.match(sql, /check \(paypal_env = 'sandbox'\)/)
})
