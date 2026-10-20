import test from 'node:test'
import assert from 'node:assert/strict'
import { patchMediumiaTeamDemoRoute } from '../scripts/apply-mediumia-team-direct-demo.mjs'

const SAMPLE = [
  "const RdvDashboard = lazy(() => import('./components/rdv/RdvDashboard'))",
  'function pathToView(p) {',
  "  return p === '/rdv/annuler' ? 'rdv-cancellation'",
  "    : p === '/rdv' ? 'rdv-dashboard'",
  "    : 'home'",
  '}',
  "  const isPrivate = view === 'rdv-dashboard' || view === 'rdv-cancellation' || view === 'rdv-lumia'",
  "  if (view === 'rdv-cancellation') return <RdvCancellation />",
].join('\n')

test('la route TEST est idempotente et masquée sans le drapeau actif', () => {
  const once = patchMediumiaTeamDemoRoute(SAMPLE)
  const twice = patchMediumiaTeamDemoRoute(once)
  assert.equal(twice, once)
  assert.match(once, /p === '\/equipe-ia-demo' && import\.meta\.env\.VITE_MEDIUMIA_TEAM_PHASE0 === 'true'/)
  assert.match(once, /if \(view === 'team-demo' && import\.meta\.env\.VITE_MEDIUMIA_TEAM_PHASE0 === 'true'\)/)
  assert.match(once, /<MediumiaTeamDashboard \/>/)
  assert.match(once, /view === 'team-demo'/)
})

test('aucun endpoint, secret ou changement d accès métier sur cette page', () => {
  const result = patchMediumiaTeamDemoRoute(SAMPLE)
  assert.doesNotMatch(result, /fetch\(|api\/|service_role|localStorage|supabase|PayPal/)
  assert.match(result, /lazy\(\(\) => import\('\.\/components\/rdv\/MediumiaTeamDashboard\.jsx'\)\)/)
})

test('l insertion échoue en cas de dérive des ancres', () => {
  assert.throws(() => patchMediumiaTeamDemoRoute(''), /lazy component import/)
  assert.throws(() => patchMediumiaTeamDemoRoute("const RdvDashboard = lazy(() => import('./components/rdv/RdvDashboard'))"), /route gate/)
})
