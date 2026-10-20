import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { patchMediumiaTeamDemoRoute } from '../scripts/apply-mediumia-team-direct-demo.mjs'

test('Vercel réécrit exactement le chemin démo vers la SPA', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const route = config.rewrites.filter(r => r.source === '/equipe-ia-demo')
  assert.equal(route.length, 1)
  assert.equal(route[0].destination, '/index.html')
  const position = config.rewrites.findIndex(r => r.source === '/equipe-ia-demo')
  assert.ok(position < config.rewrites.findIndex(r => r.source === '/rdv/:slug'))
})

test('la route front est limitée au Preview opt-in et affiche uniquement le composant de simulation', () => {
  const source = [
    "const RdvDashboard = lazy(() => import('./components/rdv/RdvDashboard'))",
    'function pathToView(p) {',
    "  return p === '/rdv/annuler' ? 'rdv-cancellation'",
    "    : p === '/rdv' ? 'rdv-dashboard'",
    "    : 'home'",
    '}',
    "  const isPrivate = view === 'rdv-dashboard' || view === 'rdv-cancellation' || view === 'rdv-lumia'",
    "  if (view === 'rdv-cancellation') return <RdvCancellation />",
  ].join('\n')
  const next = patchMediumiaTeamDemoRoute(source)
  assert.match(next, /p === '\/equipe-ia-demo' && import\.meta\.env\.VITE_MEDIUMIA_TEAM_PHASE0 === 'true'/)
  assert.match(next, /if \(view === 'team-demo' && import\.meta\.env\.VITE_MEDIUMIA_TEAM_PHASE0 === 'true'\)/)
  assert.match(next, /<MediumiaTeamDashboard \/>/)
  assert.doesNotMatch(next, /fetch\(|api\/rdv-admin|service_role|paypal\./)
})
