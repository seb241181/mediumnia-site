import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Phase 0 — accès direct au tableau de simulation sur Preview TEST uniquement.
 * Route non activée sans VITE_MEDIUMIA_TEAM_PHASE0='true'.
 * Ne charge aucun client, aucune base, aucun outil ou paiement.
 *
 * Exécuté à la FIN des scripts historiques de navigation.
 */
const appPath = new URL('../src/App.jsx', import.meta.url)
const LAZY = "const MediumiaTeamDashboard = lazy(() => import('./components/rdv/MediumiaTeamDashboard.jsx'))"
const RDV_LAZY = "const RdvDashboard = lazy(() => import('./components/rdv/RdvDashboard'))"
const ROUTE_BASE = "  return p === '/rdv/annuler' ? 'rdv-cancellation'"
const ROUTE_NEW = "  return p === '/equipe-ia-demo' && import.meta.env.VITE_MEDIUMIA_TEAM_PHASE0 === 'true' ? 'team-demo'\n    : p === '/rdv/annuler' ? 'rdv-cancellation'"
const VIEW_ANCHOR = "  if (view === 'rdv-cancellation')"
const VIEW_NEW = [
  "  if (view === 'team-demo' && import.meta.env.VITE_MEDIUMIA_TEAM_PHASE0 === 'true') return (",
  "    <DeferredRoute>",
  '      <main className="min-h-screen bg-cream px-4 py-8 sm:px-8">',
  '        <div className="mx-auto max-w-6xl">',
  "          <MediumiaTeamDashboard />",
  "        </div>",
  "      </main>",
  "    </DeferredRoute>",
  "  )",
  "",
].join('\n')
const NOINDEX_BASE = "view === 'rdv-dashboard' || view === 'rdv-cancellation' || view === 'rdv-lumia'"
const NOINDEX_NEW = NOINDEX_BASE + " || view === 'team-demo'"

function insertAfter(source, needle, addition, label) {
  if (source.includes(addition.trim())) return source
  const i = source.indexOf(needle)
  if (i < 0 || source.indexOf(needle, i + needle.length) >= 0) {
    throw new Error('MediumIA team demo route patch drift: ' + label)
  }
  return source.slice(0, i + needle.length) + '\n' + addition + source.slice(i + needle.length)
}
function replaceStrict(source, before, after, label) {
  if (source.includes(after)) return source
  const i = source.indexOf(before)
  if (i < 0 || source.indexOf(before, i + before.length) >= 0) {
    throw new Error('MediumIA team demo route patch drift: ' + label)
  }
  return source.slice(0, i) + after + source.slice(i + before.length)
}

export function patchMediumiaTeamDemoRoute(source) {
  let next = insertAfter(source, RDV_LAZY, LAZY, 'lazy component import')
  next = replaceStrict(next, ROUTE_BASE, ROUTE_NEW, 'route gate')
  next = replaceStrict(next, VIEW_ANCHOR, VIEW_NEW + VIEW_ANCHOR, 'render page')
  if (next.includes(NOINDEX_BASE)) {
    next = replaceStrict(next, NOINDEX_BASE, NOINDEX_NEW, 'private meta')
  }
  return next
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const original = await readFile(appPath, 'utf8')
  const patched = patchMediumiaTeamDemoRoute(original)
  if (patched !== original) await writeFile(appPath, patched)
  console.log('MediumIA team: direct Preview-only demo route prepared (no authenticated business APIs)')
}
