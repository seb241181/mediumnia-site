import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronospherePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const examplePath = new URL('../src/components/ChronosphereExamplePage.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA performance patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = replaceRequired(
  app,
  `import { useState, useEffect } from 'react'`,
  `import { lazy, Suspense, useState, useEffect } from 'react'`,
  'React lazy imports',
)

for (const eagerImport of [
  `import FormationPage from './components/FormationPage'\n`,
  `import OraclePage from './components/OraclePage'\n`,
  `import ProWaitlistPage from './components/ProWaitlistPage'\n`,
  `import ReseauDirectory from './components/ReseauDirectory'\n`,
  `import ReseauJoindre from './components/ReseauJoindre'\n`,
  `import RdvDashboard from './components/rdv/RdvDashboard'\n`,
  `import RdvPublic from './components/rdv/RdvPublic'\n`,
  `import RdvCancellation from './components/rdv/RdvCancellation'\n`,
  `import ChronospherePage from './components/ChronospherePage'\n`,
  `import ChronosphereExamplePage from './components/ChronosphereExamplePage'\n`,
]) {
  app = app.replace(eagerImport, '')
}

const lazyBlock = `import { trackMediumiaMetric } from './lib/mediumiaMetrics.js'

const FormationPage = lazy(() => import('./components/FormationPage'))
const OraclePage = lazy(() => import('./components/OraclePage'))
const ProWaitlistPage = lazy(() => import('./components/ProWaitlistPage'))
const ReseauDirectory = lazy(() => import('./components/ReseauDirectory'))
const ReseauJoindre = lazy(() => import('./components/ReseauJoindre'))
const RdvDashboard = lazy(() => import('./components/rdv/RdvDashboard'))
const RdvPublic = lazy(() => import('./components/rdv/RdvPublic'))
const RdvCancellation = lazy(() => import('./components/rdv/RdvCancellation'))
const ChronospherePage = lazy(() => import('./components/ChronospherePage'))
const ChronosphereExamplePage = lazy(() => import('./components/ChronosphereExamplePage'))

function DeferredRoute({ children }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-cream px-6 pt-32 text-center font-georgia text-sm text-mist">Chargement…</div>}>
      {children}
    </Suspense>
  )
}`

app = replaceRequired(
  app,
  `import EcosystemNextSteps from './components/EcosystemNextSteps'`,
  `import EcosystemNextSteps from './components/EcosystemNextSteps'\n${lazyBlock}`,
  'lazy route block',
)

app = replaceRequired(
  app,
  `function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenChronosphereExample, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {\n  return (`,
  `function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenChronosphereExample, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('home_view', 'home') }, [])\n\n  return (`,
  'home view metric',
)

const routeReplacements = [
  [
    `  if (view === 'pro')           return <><ProWaitlistPage onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'pro')           return <DeferredRoute><ProWaitlistPage onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'formation')    return <><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'formation')    return <DeferredRoute><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'oracle')       return <><OraclePage onBack={backHome} onNavigate={legalNav} onOpenChronosphere={openChronosphere} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</>`,
    `  if (view === 'oracle')       return <DeferredRoute><OraclePage onBack={backHome} onNavigate={legalNav} onOpenChronosphere={openChronosphere} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'chronosphere') return <><ChronospherePage onBack={backHome} onNavigate={legalNav} onOpenOracle={openOracle} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</>`,
    `  if (view === 'chronosphere') return <DeferredRoute><ChronospherePage onBack={backHome} onNavigate={legalNav} onOpenOracle={openOracle} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'chronosphere-example') return <><ChronosphereExamplePage onBack={backHome} onOpenChronosphere={openChronosphere} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'chronosphere-example') return <DeferredRoute><ChronosphereExamplePage onBack={backHome} onOpenChronosphere={openChronosphere} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'reseau-dir')   return <><ReseauDirectory onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'reseau-dir')   return <DeferredRoute><ReseauDirectory onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'reseau-form')  return <><ReseauJoindre onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'reseau-form')  return <DeferredRoute><ReseauJoindre onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} />`,
    `  if (view === 'rdv-dashboard') return <DeferredRoute><RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} /></DeferredRoute>`,
  ],
  [
    `  if (view === 'rdv-cancellation') return <><RdvCancellation onBack={backHome} />{guardian}</>`,
    `  if (view === 'rdv-cancellation') return <DeferredRoute><RdvCancellation onBack={backHome} />{guardian}</DeferredRoute>`,
  ],
  [
    `  if (view === 'rdv-public')   return <><RdvPublic onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
    `  if (view === 'rdv-public')   return <DeferredRoute><RdvPublic onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  ],
]

for (const [before, after] of routeReplacements) {
  app = replaceRequired(app, before, after, `deferred route ${before.slice(15, 40)}`)
}

await writeFile(appPath, app)

let chronosphere = await readFile(chronospherePath, 'utf8')
chronosphere = replaceRequired(
  chronosphere,
  `import EcosystemNextSteps from './EcosystemNextSteps'`,
  `import EcosystemNextSteps from './EcosystemNextSteps'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'Chronosphere metric import',
)
chronosphere = replaceRequired(
  chronosphere,
  `  const launchRef = useRef(null)`,
  `  const launchRef = useRef(null)\n\n  useEffect(() => {\n    if (showPayment) trackMediumiaMetric('chronosphere_payment_opened', 'chronosphere')\n  }, [showPayment])`,
  'Chronosphere payment-open metric',
)
await writeFile(chronospherePath, chronosphere)

let example = await readFile(examplePath, 'utf8')
example = replaceRequired(
  example,
  `import LegalFooter from './LegalFooter'`,
  `import { useEffect } from 'react'\nimport LegalFooter from './LegalFooter'\nimport { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  'example metric imports',
)
example = replaceRequired(
  example,
  `export default function ChronosphereExamplePage({ onBack, onOpenChronosphere, onNavigate }) {\n  return (`,
  `export default function ChronosphereExamplePage({ onBack, onOpenChronosphere, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('chronosphere_example_view', 'chronosphere-example') }, [])\n\n  return (`,
  'example view metric',
)
example = replaceRequired(
  example,
  `<button onClick={onOpenChronosphere} className="rounded-xl bg-gold px-7 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90">Faire mon tirage — dès 5 € →</button>`,
  `<button onClick={() => { trackMediumiaMetric('chronosphere_example_cta', 'chronosphere-example:chronosphere'); onOpenChronosphere() }} className="rounded-xl bg-gold px-7 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90">Faire mon tirage — dès 5 € →</button>`,
  'example CTA metric',
)
await writeFile(examplePath, example)

console.log('MediumIA performance: lazy routes and aggregate metrics applied')
