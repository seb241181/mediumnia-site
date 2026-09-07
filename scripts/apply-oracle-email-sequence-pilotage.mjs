import { readFile, writeFile } from 'node:fs/promises'

const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Oracle email pilotage patch drift: ${label}`)
  return source.replace(before, after)
}

let pilotage = await readFile(pilotagePath, 'utf8')

pilotage = replaceRequired(
  pilotage,
  `  conference_interest_click: 'Intérêt Conférences',`,
  `  conference_interest_click: 'Intérêt Conférences',\n  oracle_email_optin_view: 'Propositions 3 exercices vues',\n  oracle_email_optin_completed: 'Séquences 3 exercices demandées',\n  oracle_email_unsubscribed: 'Désinscriptions séquence 3 exercices',`,
  'pilotage labels',
)

pilotage = replaceRequired(
  pilotage,
  `    conference_interest_click: round(11),\n  }`,
  `    conference_interest_click: round(11),\n    oracle_email_optin_view: round(34),\n    oracle_email_optin_completed: round(18),\n    oracle_email_unsubscribed: round(2),\n  }`,
  'pilotage preview totals',
)

pilotage = replaceRequired(
  pilotage,
  `  const oracleDrawCompleted = Number(totals.oracle_free_draw_completed || 0)\n  const oracleNextClicks`,
  `  const oracleDrawCompleted = Number(totals.oracle_free_draw_completed || 0)\n  const oracleEmailOptinView = Number(totals.oracle_email_optin_view || 0)\n  const oracleEmailOptinCompleted = Number(totals.oracle_email_optin_completed || 0)\n  const oracleNextClicks`,
  'pilotage opt-in values',
)

pilotage = replaceRequired(
  pilotage,
  `            <FunnelRow label="Résultat obtenu" value={oracleDrawCompleted} reference={oracleFreeViews} detail={pct(oracleDrawCompleted, oracleDrawStarted)} />\n            <FunnelRow label="Action suivante choisie" value={oracleNextClicks} reference={oracleFreeViews} detail={pct(oracleNextClicks, oracleDrawCompleted)} />`,
  `            <FunnelRow label="Résultat obtenu" value={oracleDrawCompleted} reference={oracleFreeViews} detail={pct(oracleDrawCompleted, oracleDrawStarted)} />\n            <FunnelRow label="Proposition des 3 exercices vue" value={oracleEmailOptinView} reference={oracleFreeViews} detail={pct(oracleEmailOptinView, oracleDrawCompleted)} />\n            <FunnelRow label="Séquence 3 exercices demandée" value={oracleEmailOptinCompleted} reference={oracleFreeViews} detail={pct(oracleEmailOptinCompleted, oracleEmailOptinView)} />\n            <FunnelRow label="Autre action suivante choisie" value={oracleNextClicks} reference={oracleFreeViews} detail={pct(oracleNextClicks, oracleDrawCompleted)} />`,
  'Oracle opt-in funnel rows',
)

await writeFile(pilotagePath, pilotage)
console.log('MediumIA Oracle email sequence: pilotage funnel extended')
