import { readFile, writeFile } from 'node:fs/promises'

const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)
const oraclePagePath = new URL('../src/components/OraclePage.jsx', import.meta.url)
const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)
const formationPath = new URL('../src/components/FormationPage.jsx', import.meta.url)
const trialPath = new URL('../src/components/TrialChat.jsx', import.meta.url)
const adminPath = new URL('../api/rdv-admin.js', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA funnel patch drift: ${label}`)
  return source.replace(before, after)
}

let analytics = await readFile(analyticsPath, 'utf8')
analytics = replaceRequired(
  analytics,
  `  'chronosphere_payment_opened',\n])`,
  `  'chronosphere_payment_opened',\n  'oracle_free_view',\n  'oracle_free_draw_started',\n  'oracle_free_draw_completed',\n  'formation_view',\n  'formation_proof_view',\n  'formation_assistant_started',\n  'formation_payment_started',\n  'formation_purchase_completed',\n  'conference_page_view',\n  'conference_interest_click',\n])`,
  'analytics allowlist',
)
analytics = replaceRequired(
  analytics,
  `const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example)(:(oracle|chronosphere|reseau|formation))?$/`,
  `const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|formation|conferences)(:(oracle|chronosphere|reseau|formation|notify))?$/`,
  'analytics sources',
)
await writeFile(analyticsPath, analytics)

let oraclePage = await readFile(oraclePagePath, 'utf8')
oraclePage = replaceRequired(
  oraclePage,
  `import OracleTest from './OracleTest'`,
  `import OracleTest from './OracleTest'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'Oracle metric import',
)
oraclePage = replaceRequired(
  oraclePage,
  `  }, [])\n\n  return (`,
  `  }, [])\n\n  useEffect(() => {\n    const node = document.getElementById('tirage-gratuit')\n    if (!node || typeof IntersectionObserver === 'undefined') return\n    let tracked = false\n    const observer = new IntersectionObserver((entries) => {\n      if (!tracked && entries.some(entry => entry.isIntersecting)) {\n        tracked = true\n        trackMediumiaMetric('oracle_free_view', 'oracle')\n        observer.disconnect()\n      }\n    }, { threshold: 0.35 })\n    observer.observe(node)\n    return () => observer.disconnect()\n  }, [])\n\n  return (`,
  'Oracle free-view metric',
)
await writeFile(oraclePagePath, oraclePage)

let oracleTest = await readFile(oracleTestPath, 'utf8')
oracleTest = replaceRequired(
  oracleTest,
  `import oracleCards from '../data/oracleCards.json'`,
  `import oracleCards from '../data/oracleCards.json'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'Oracle test metric import',
)
oracleTest = replaceRequired(
  oracleTest,
  `    const drawnCards = ids.map(id => oracleCards.find(c => c.id === id))\n    setLoading(true)`,
  `    const drawnCards = ids.map(id => oracleCards.find(c => c.id === id))\n    trackMediumiaMetric('oracle_free_draw_started', 'oracle')\n    setLoading(true)`,
  'Oracle draw started',
)
oracleTest = replaceRequired(
  oracleTest,
  `      setResult({ cards: drawnCards, interpretation })`,
  `      setResult({ cards: drawnCards, interpretation })\n      trackMediumiaMetric('oracle_free_draw_completed', 'oracle')`,
  'Oracle draw completed',
)
await writeFile(oracleTestPath, oracleTest)

let formation = await readFile(formationPath, 'utf8')
formation = replaceRequired(
  formation,
  `import TrialChat from './TrialChat'`,
  `import TrialChat from './TrialChat'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'Formation metric import',
)
formation = replaceRequired(
  formation,
  `          createOrder: async () => {\n            setStatus('Création sécurisée de la commande…')`,
  `          createOrder: async () => {\n            trackMediumiaMetric('formation_payment_started', 'formation')\n            setStatus('Création sécurisée de la commande…')`,
  'Formation payment started',
)
formation = replaceRequired(
  formation,
  `            if (!res.ok || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')\n            setSuccess(true)`,
  `            if (!res.ok || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')\n            trackMediumiaMetric('formation_purchase_completed', 'formation')\n            setSuccess(true)`,
  'Formation purchase completed',
)
formation = replaceRequired(
  formation,
  `  useEffect(() => {\n    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })\n  }, [])`,
  `  useEffect(() => {\n    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })\n    trackMediumiaMetric('formation_view', 'formation')\n\n    const proof = document.getElementById('formation-apercu-reel')\n    if (!proof || typeof IntersectionObserver === 'undefined') return\n    let tracked = false\n    const observer = new IntersectionObserver((entries) => {\n      if (!tracked && entries.some(entry => entry.isIntersecting)) {\n        tracked = true\n        trackMediumiaMetric('formation_proof_view', 'formation')\n        observer.disconnect()\n      }\n    }, { threshold: 0.35 })\n    observer.observe(proof)\n    return () => observer.disconnect()\n  }, [])`,
  'Formation view and proof metrics',
)
await writeFile(formationPath, formation)

let trial = await readFile(trialPath, 'utf8')
trial = replaceRequired(
  trial,
  `import { useState, useRef, useEffect } from 'react'`,
  `import { useState, useRef, useEffect } from 'react'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'Trial metric import',
)
trial = replaceRequired(
  trial,
  `    if (!text || loading || exhausted) return\n\n    const userMessage`,
  `    if (!text || loading || exhausted) return\n\n    if (userCount === 0) trackMediumiaMetric('formation_assistant_started', 'formation')\n\n    const userMessage`,
  'Formation assistant started',
)
await writeFile(trialPath, trial)

let admin = await readFile(adminPath, 'utf8')
admin = replaceRequired(
  admin,
  `    chronosphere_payment_opened: round(24),\n  }`,
  `    chronosphere_payment_opened: round(24),\n    oracle_free_view: round(71),\n    oracle_free_draw_started: round(48),\n    oracle_free_draw_completed: round(39),\n    formation_view: round(52),\n    formation_proof_view: round(31),\n    formation_assistant_started: round(18),\n    formation_payment_started: round(7),\n    formation_purchase_completed: round(3),\n    conference_page_view: round(28),\n    conference_interest_click: round(11),\n  }`,
  'server preview funnel totals',
)
admin = replaceRequired(
  admin,
  `  const home_doors = {\n    oracle: round(58),\n    chronosphere: round(67),\n    reseau: round(24),\n    formation: round(24),\n  }\n  const daily = []`,
  `  const home_doors = {\n    oracle: round(58),\n    chronosphere: round(67),\n    reseau: round(24),\n    formation: round(24),\n  }\n  const oracle_next_steps = {\n    chronosphere: round(12),\n    reseau: round(7),\n    formation: round(9),\n  }\n  const daily = []`,
  'server preview Oracle next steps',
)
admin = replaceRequired(
  admin,
  `  return { preview: true, days, totals, home_doors, daily }`,
  `  return { preview: true, days, totals, home_doors, oracle_next_steps, daily }`,
  'server preview return',
)
admin = replaceRequired(
  admin,
  `  const home_doors = { oracle: 0, chronosphere: 0, reseau: 0, formation: 0 }\n  const dailyMap = new Map()`,
  `  const home_doors = { oracle: 0, chronosphere: 0, reseau: 0, formation: 0 }\n  const oracle_next_steps = { chronosphere: 0, reseau: 0, formation: 0 }\n  const dailyMap = new Map()`,
  'live Oracle next-step accumulator',
)
admin = replaceRequired(
  admin,
  `    if (row.event_name === 'home_door_click' && row.source?.startsWith('home:')) {\n      const target = row.source.slice(5)\n      if (target in home_doors) home_doors[target] += count\n    }\n    dailyMap.set`,
  `    if (row.event_name === 'home_door_click' && row.source?.startsWith('home:')) {\n      const target = row.source.slice(5)\n      if (target in home_doors) home_doors[target] += count\n    }\n    if (row.event_name === 'ecosystem_door_click' && row.source?.startsWith('oracle:')) {\n      const target = row.source.slice(7)\n      if (target in oracle_next_steps) oracle_next_steps[target] += count\n    }\n    dailyMap.set`,
  'live Oracle next-step aggregation',
)
admin = replaceRequired(
  admin,
  `  return res.status(200).json({ preview: false, days, totals, home_doors, daily })`,
  `  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, daily })`,
  'live analytics return',
)
await writeFile(adminPath, admin)

let pilotage = await readFile(pilotagePath, 'utf8')
pilotage = replaceRequired(
  pilotage,
  `  chronosphere_payment_opened: 'Paiements Chronosphère ouverts',`,
  `  chronosphere_payment_opened: 'Paiements Chronosphère ouverts',\n  oracle_free_view: 'Vues tirage Oracle offert',\n  oracle_free_draw_started: 'Tirages Oracle lancés',\n  oracle_free_draw_completed: 'Tirages Oracle obtenus',\n  formation_view: 'Vues Formation',\n  formation_proof_view: 'Aperçus Module 1 vus',\n  formation_assistant_started: 'Essais assistant commencés',\n  formation_payment_started: 'Paiements Formation lancés',\n  formation_purchase_completed: 'Accès Formation activés',\n  conference_page_view: 'Vues page Conférences',\n  conference_interest_click: 'Intérêt Conférences',`,
  'pilotage labels',
)
pilotage = replaceRequired(
  pilotage,
  `    chronosphere_payment_opened: round(24),\n  }`,
  `    chronosphere_payment_opened: round(24),\n    oracle_free_view: round(71),\n    oracle_free_draw_started: round(48),\n    oracle_free_draw_completed: round(39),\n    formation_view: round(52),\n    formation_proof_view: round(31),\n    formation_assistant_started: round(18),\n    formation_payment_started: round(7),\n    formation_purchase_completed: round(3),\n    conference_page_view: round(28),\n    conference_interest_click: round(11),\n  }`,
  'client preview funnel totals',
)
pilotage = replaceRequired(
  pilotage,
  `  const home_doors = {\n    oracle: round(58),\n    chronosphere: round(67),\n    reseau: round(24),\n    formation: round(24),\n  }\n  const daily = []`,
  `  const home_doors = {\n    oracle: round(58),\n    chronosphere: round(67),\n    reseau: round(24),\n    formation: round(24),\n  }\n  const oracle_next_steps = {\n    chronosphere: round(12),\n    reseau: round(7),\n    formation: round(9),\n  }\n  const daily = []`,
  'client preview Oracle next steps',
)
pilotage = replaceRequired(
  pilotage,
  `  return { preview: true, days, totals, home_doors, daily }`,
  `  return { preview: true, days, totals, home_doors, oracle_next_steps, daily }`,
  'client preview return',
)
pilotage = replaceRequired(
  pilotage,
  `  const homeDoors = data?.home_doors || {}\n  const daily = data?.daily || []`,
  `  const homeDoors = data?.home_doors || {}\n  const oracleNextSteps = data?.oracle_next_steps || {}\n  const daily = data?.daily || []`,
  'pilotage Oracle next steps data',
)
pilotage = replaceRequired(
  pilotage,
  `  const homeViews = Number(totals.home_view || 0)\n\n  const keyRows`,
  `  const homeViews = Number(totals.home_view || 0)\n  const oracleFreeViews = Number(totals.oracle_free_view || 0)\n  const oracleDrawStarted = Number(totals.oracle_free_draw_started || 0)\n  const oracleDrawCompleted = Number(totals.oracle_free_draw_completed || 0)\n  const oracleNextClicks = Object.values(oracleNextSteps).reduce((sum, value) => sum + Number(value || 0), 0)\n  const formationViews = Number(totals.formation_view || 0)\n  const formationProofViews = Number(totals.formation_proof_view || 0)\n  const formationAssistantStarted = Number(totals.formation_assistant_started || 0)\n  const formationPaymentStarted = Number(totals.formation_payment_started || 0)\n  const formationPurchaseCompleted = Number(totals.formation_purchase_completed || 0)\n\n  const keyRows`,
  'pilotage funnel values',
)
pilotage = replaceRequired(
  pilotage,
  `              Des compteurs agrégés pour comprendre les portes qui attirent, les passages vers Chronosphère et les étapes qui méritent d’être améliorées.`,
  `              Des compteurs agrégés pour comprendre les portes qui attirent, les parcours gratuits, la Formation et les étapes qui méritent d’être améliorées.`,
  'pilotage intro',
)
const activityAnchor = `      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">\n        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">\n          <div className="flex items-end justify-between gap-4">`
const funnelSection = `      <section className="grid gap-5 lg:grid-cols-2">\n        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">\n          <div className="mb-6">\n            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">ORACLE GRATUIT</p>\n            <h3 className="mt-1 font-georgia text-xl font-medium text-deep">De l’expérience offerte à la suite du parcours</h3>\n            <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">Aucun visiteur n’est suivi individuellement : seules les étapes agrégées sont comptées.</p>\n          </div>\n          <div className="space-y-5">\n            <FunnelRow label="Zone du tirage offerte vue" value={oracleFreeViews} reference={oracleFreeViews} />\n            <FunnelRow label="Tirage lancé" value={oracleDrawStarted} reference={oracleFreeViews} detail={pct(oracleDrawStarted, oracleFreeViews)} />\n            <FunnelRow label="Résultat obtenu" value={oracleDrawCompleted} reference={oracleFreeViews} detail={pct(oracleDrawCompleted, oracleDrawStarted)} />\n            <FunnelRow label="Action suivante choisie" value={oracleNextClicks} reference={oracleFreeViews} detail={pct(oracleNextClicks, oracleDrawCompleted)} />\n          </div>\n        </article>\n\n        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">\n          <div className="mb-6">\n            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">FORMATION 597 €</p>\n            <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Preuve → essai → achat</h3>\n            <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">Le but est de voir précisément où la confiance monte — ou où elle casse — avant le paiement.</p>\n          </div>\n          <div className="space-y-5">\n            <FunnelRow label="Page Formation vue" value={formationViews} reference={formationViews} />\n            <FunnelRow label="Aperçu réel du Module 1 vu" value={formationProofViews} reference={formationViews} detail={pct(formationProofViews, formationViews)} />\n            <FunnelRow label="Essai assistant commencé" value={formationAssistantStarted} reference={formationViews} detail={pct(formationAssistantStarted, formationProofViews)} />\n            <FunnelRow label="Paiement PayPal lancé" value={formationPaymentStarted} reference={formationViews} detail={pct(formationPaymentStarted, formationAssistantStarted || formationProofViews)} />\n            <FunnelRow label="Accès Formation activé" value={formationPurchaseCompleted} reference={formationViews} detail={pct(formationPurchaseCompleted, formationPaymentStarted)} />\n          </div>\n        </article>\n      </section>\n\n`
if (!pilotage.includes('FORMATION 597 €')) {
  if (!pilotage.includes(activityAnchor)) throw new Error('MediumIA funnel patch drift: activity section anchor')
  pilotage = pilotage.replace(activityAnchor, funnelSection + activityAnchor)
}
await writeFile(pilotagePath, pilotage)

console.log('MediumIA funnels: Oracle free, Formation and conference metrics extended')
