import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('owner-only attention counts exclude historical and unpaid guidance requests', async () => {
  const api = await readFile(new URL('../api/rdv-admin.js', import.meta.url), 'utf8')
  const section = api.split('async function handleAttention(')[1]?.split('// ── action=services')[0]
  assert.ok(section)
  assert.match(section, /req\.method !== 'GET'/)
  assert.match(section, /\.eq\('owner_id', userId\)/)
  assert.match(section, /select\('id', \{ count: 'exact', head: true \}\)/)
  assert.match(section, /'paid', 'in_progress', 'manual_review', 'refund_pending'/)
  assert.match(section, /\.eq\('status', 'pending'\)/)
  assert.doesNotMatch(section, /payment_pending|answered|refunded|customer_email|customer_phone/)
  assert.match(api, /case 'attention':\s+return handleAttention/)
})

test('badge is visible on home navigation and reflects server counts rather than click state', async () => {
  const dash = await readFile(new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url), 'utf8')
  const email = await readFile(new URL('../src/components/rdv/EmailQuestionsPanel.jsx', import.meta.url), 'utf8')
  assert.match(dash, /action=attention/)
  assert.match(dash, /attention\.rdv_pending\?\.\[activePractitioner\.id\]/)
  assert.match(dash, /attention\.email_pending/)
  assert.match(dash, /bg-red-600/)
  assert.match(dash, /setInterval\(refresh, 60_000\)/)
  assert.match(dash, /visibilitychange/)
  assert.match(dash, /loadAttention\(session\)/)
  assert.match(email, /onChanged\?\.\(\)/)
  assert.doesNotMatch(dash, /setAttention\([^)]*activePanel/)
})
