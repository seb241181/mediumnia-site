import { readFile, writeFile } from 'node:fs/promises'

/**
 * Dernier patch de la chaîne PREBUILD, après apply-lumia-assistant-console.
 *
 * Dans ce dépôt, plusieurs scripts historiques réécrivent la navigation de
 * RdvDashboard.jsx lors du build. Il est donc plus sûr d'insérer l'onglet de
 * présentation ici qu'en modifiant directement ce fichier comme source.
 *
 * Phase 0 uniquement : affiche AgentTeamConsole, sans API ni effet externe.
 */

const target = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)
let dashboard = await readFile(target, 'utf8')

function insertAfter(needle, addition, label) {
  if (dashboard.includes(addition.trim())) return
  const pos = dashboard.indexOf(needle)
  if (pos < 0 || dashboard.indexOf(needle, pos + needle.length) >= 0) {
    throw new Error('Agent team console patch drift: ' + label)
  }
  dashboard = dashboard.slice(0, pos + needle.length) + addition + dashboard.slice(pos + needle.length)
}

function replaceRequired(before, after, label) {
  if (dashboard.includes(after)) return
  const pos = dashboard.indexOf(before)
  if (pos < 0 || dashboard.indexOf(before, pos + before.length) >= 0) {
    throw new Error('Agent team console patch drift: ' + label)
  }
  dashboard = dashboard.slice(0, pos) + after + dashboard.slice(pos + before.length)
}

insertAfter(
  "import DailyPayments from './DailyPayments.jsx'",
  "\nimport AgentTeamConsole from './AgentTeamConsole.jsx'",
  'component import',
)

insertAfter(
  "                        detail: 'Demandes et réponses écrites',\n                      },",
  "\n                      {\n                        id: 'team',\n                        title: 'Équipe IA',\n                        detail: 'Planifier les missions · Simulation',\n                      },",
  'Coulisses navigation',
)

replaceRequired(
  "].filter(item => item.id !== 'email' || activePractitioner.slug === 'sebastien-seguin').map(item => (",
  "].filter(item => !['email', 'team'].includes(item.id) || activePractitioner.slug === 'sebastien-seguin').map(item => (",
  'specialized sections restriction',
)

insertAfter(
  "                    {activePanel === 'email' && activePractitioner.slug === 'sebastien-seguin' && (\n                      <EmailQuestionsPanel session={session} />\n                    )}",
  "\n                    {activePanel === 'team' && activePractitioner.slug === 'sebastien-seguin' && (\n                      <AgentTeamConsole />\n                    )}",
  'team panel',
)

await writeFile(target, dashboard)
console.log('MediumIA team Phase 0: private planning-only tab registered (no agent execution)')
