import test from 'node:test'
import assert from 'node:assert/strict'
import { patchMediumiaTeamDashboard } from '../scripts/apply-mediumia-team-dashboard.mjs'

const ORIGINAL = [
  "import DailyPayments from './DailyPayments.jsx'",
  "export function Example() {",
  "  return <>",
  "                    ].filter(item => item.id !== 'email' || activePractitioner.slug === 'sebastien-seguin').map(item => (",
  "                     {activePanel === 'email' && activePractitioner.slug === 'sebastien-seguin' && (",
  "                       <EmailQuestionsPanel session={session} />",
  "                     )}",
  "  </>",
  "}",
].join('\n')

test('le patch de l équipe IA est idempotent', () => {
  const once = patchMediumiaTeamDashboard(ORIGINAL)
  const twice = patchMediumiaTeamDashboard(once)
  assert.equal(once, twice)
  assert.match(once, /import MediumiaTeamDashboard from/)
  assert.match(once, /<MediumiaTeamDashboard \/>/)
})

test('l onglet est caché par défaut et visible seulement pour le praticien autorisé', () => {
  const patched = patchMediumiaTeamDashboard(ORIGINAL)
  assert.match(patched, /item\.id !== 'equipe'/)
  assert.match(patched, /activePractitioner\.slug === 'sebastien-seguin'/)
  assert.match(patched, /VITE_MEDIUMIA_TEAM_PHASE0 === 'true'/)
  assert.match(patched, /activePanel === 'equipe'/)
})

test('le patch refuse les dérives au lieu de modifier un autre écran', () => {
  assert.throws(() => patchMediumiaTeamDashboard(''), /component import/)
  assert.throws(() => patchMediumiaTeamDashboard("import DailyPayments from './DailyPayments.jsx'"), /navigation/)
  assert.throws(() => patchMediumiaTeamDashboard(ORIGINAL.replace('activePanel ===', 'wrongPanel ===')), /dashboard section/)
})

test('le tableau de bord ne peut pas appeler un service ou modifier des données', () => {
  const patched = patchMediumiaTeamDashboard(ORIGINAL)
  assert.doesNotMatch(patched, /fetch\(|\.update\(|\.insert\(|\.delete\(/)
})
