import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('RDV dashboard exposes a protected accounting section', () => {
  const dashboard = read('src/components/rdv/RdvDashboard.jsx')
  const component = read('src/components/rdv/AccountingSection.jsx')
  assert.match(dashboard, /AccountingSection/)
  assert.match(component, /action: 'finance'/)
  assert.match(component, /practitioner_id: practitionerId/)
  assert.match(component, /Télécharger CSV \(Excel\)/)
  assert.match(component, /TTC encaissé/)
  assert.match(component, /HT/)
  assert.match(component, /TVA/)
})

test('accounting API is owner-scoped, period-bounded and read-only', () => {
  const api = read('api/rdv-admin.js')
  assert.match(api, /async function handleFinance/)
  assert.match(api, /verifyOwner\(supabase, userId, pid\)/)
  assert.match(api, /rdv_financial_entries/)
  assert.match(api, /\.gte\('occurred_at'/)
  assert.match(api, /\.lt\('occurred_at'/)
  assert.match(api, /periode_trop_longue/)
  assert.match(api, /case 'finance'/)
})

test('CSV export contains accountant-friendly columns and French Excel separator', () => {
  const component = read('src/components/rdv/AccountingSection.jsx')
  assert.match(component, /Date encaissement/)
  assert.match(component, /Prestation/)
  assert.match(component, /Moyen de paiement/)
  assert.match(component, /Référence paiement/)
  assert.match(component, /join\(';\'\)/)
  assert.match(component, /\\uFEFF/)
})
