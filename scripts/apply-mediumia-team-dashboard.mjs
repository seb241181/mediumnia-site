import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exécuté APRÈS les patchs historiques de prebuild : ne pas modifier directement
// les ancres originales de RdvDashboard.jsx sur la branche de travail.
const dashboardPath = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)
const IMPORT_ANCHOR = "import DailyPayments from './DailyPayments.jsx'"
const TEAM_IMPORT = "import MediumiaTeamDashboard from './MediumiaTeamDashboard.jsx'"

const NAV_BEFORE = "                    ].filter(item => item.id !== 'email' || activePractitioner.slug === 'sebastien-seguin').map(item => ("
const NAV_AFTER = [
  "                      { id: 'equipe', title: 'Équipe IA', detail: 'Missions · simulation' },",
  "                    ].filter(item => (item.id !== 'email' && item.id !== 'equipe')",
  "                      || (activePractitioner.slug === 'sebastien-seguin'",
  "                        && (item.id !== 'equipe' || import.meta.env.VITE_MEDIUMIA_TEAM_PHASE0 === 'true'))).map(item => (",
].join('\n')

const BODY_BEFORE = [
  "                    {activePanel === 'email' && activePractitioner.slug === 'sebastien-seguin' && (",
  "                      <EmailQuestionsPanel session={session} />",
  "                    )}",
].join('\n')
const BODY_AFTER = [
  BODY_BEFORE,
  '',
  "                     {activePanel === 'equipe' && activePractitioner.slug === 'sebastien-seguin'",
  "                       && import.meta.env.VITE_MEDIUMIA_TEAM_PHASE0 === 'true' && (",
  "                         <MediumiaTeamDashboard />",
  "                      )}",
].join('\n')

function replaceOrFail(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error('MediumIA team dashboard patch drift: ' + label)
  return source.replace(before, after)
}

export function patchMediumiaTeamDashboard(source) {
  let next = replaceOrFail(source, IMPORT_ANCHOR, IMPORT_ANCHOR + '\n' + TEAM_IMPORT, 'component import')
  next = replaceOrFail(next, NAV_BEFORE, NAV_AFTER, 'navigation')
  next = replaceOrFail(next, BODY_BEFORE, BODY_AFTER, 'dashboard section')
  return next
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const original = await readFile(dashboardPath, 'utf8')
  const patched = patchMediumiaTeamDashboard(original)
  if (patched !== original) await writeFile(dashboardPath, patched)
  console.log('MediumIA team: owner-only TEST dashboard tab prepared; execution remains disabled')
}
