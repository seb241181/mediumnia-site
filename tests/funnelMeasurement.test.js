import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('analytics accepts the new aggregate funnel events without adding visitor identifiers', () => {
  const analytics = read('lib/mediumiaAnalytics.js')
  for (const event of [
    'oracle_free_view',
    'oracle_free_draw_started',
    'oracle_free_draw_completed',
    'formation_view',
    'formation_proof_view',
    'formation_assistant_started',
    'formation_payment_started',
    'formation_purchase_completed',
    'conference_page_view',
    'conference_interest_click',
  ]) {
    assert.match(analytics, new RegExp(`'${event}'`))
  }
  assert.match(analytics, /formation\|conferences/)
  assert.doesNotMatch(analytics, /visitor_id|session_id|email|user_id/)
})

test('Oracle free funnel counts view, qualified start and completed result', () => {
  const page = read('src/components/OraclePage.jsx')
  const testComponent = read('src/components/OracleTest.jsx')
  assert.match(page, /oracle_free_view/)
  assert.match(page, /IntersectionObserver/)
  assert.match(testComponent, /oracle_free_draw_started/)
  assert.match(testComponent, /oracle_free_draw_completed/)
})

test('Formation funnel counts proof, assistant start, payment start and provisioned access', () => {
  const formation = read('src/components/FormationPage.jsx')
  const trial = read('src/components/TrialChat.jsx')
  assert.match(formation, /formation_view/)
  assert.match(formation, /formation_proof_view/)
  assert.match(formation, /formation_payment_started/)
  assert.match(formation, /formation_purchase_completed/)
  assert.match(trial, /formation_assistant_started/)
  assert.match(trial, /userCount === 0/)
})

test('private pilotage exposes Oracle and Formation funnels plus Oracle next steps', () => {
  const pilotage = read('src/components/rdv/PilotageDashboard.jsx')
  const admin = read('api/rdv-admin.js')
  assert.match(pilotage, /ORACLE GRATUIT/)
  assert.match(pilotage, /FORMATION 597 €/)
  assert.match(pilotage, /Aperçu réel du Module 1 vu/)
  assert.match(pilotage, /Accès Formation activé/)
  assert.match(admin, /oracle_next_steps/)
  assert.match(admin, /row\.source\?\.startsWith\('oracle:'\)/)
})
