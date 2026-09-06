import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const footerPath = new URL('../src/components/LegalFooter.jsx', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA conferences patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = replaceRequired(
  app,
  `const ChronosphereExamplePage = lazy(() => import('./components/ChronosphereExamplePage'))`,
  `const ChronosphereExamplePage = lazy(() => import('./components/ChronosphereExamplePage'))\nconst ConferencesPage = lazy(() => import('./components/ConferencesPage'))`,
  'lazy conference route',
)

app = replaceRequired(
  app,
  `function Nav({ onOpenPro, onOpenFormation, onOpenReseauDir }) {`,
  `function Nav({ onOpenPro, onOpenFormation, onOpenReseauDir, onOpenConferences }) {`,
  'Nav conference prop',
)

app = replaceRequired(
  app,
  `          <a href="#consulter" className="hover:text-gold transition-colors">Consulter</a>\n          <a href="#boutique" className="hover:text-gold transition-colors">Boutique</a>`,
  `          <a href="#consulter" className="hover:text-gold transition-colors">Consulter</a>\n          <button onClick={onOpenConferences} className="hover:text-gold transition-colors">Conférences</button>\n          <a href="#boutique" className="hover:text-gold transition-colors">Boutique</a>`,
  'desktop conference navigation',
)

app = replaceRequired(
  app,
  `function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenChronosphereExample, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {`,
  `function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenChronosphereExample, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onOpenConferences, onNavigate }) {`,
  'home conference prop',
)

app = replaceRequired(
  app,
  `      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenReseauDir={onOpenReseauDir} />`,
  `      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenReseauDir={onOpenReseauDir} onOpenConferences={onOpenConferences} />`,
  'home Nav wiring',
)

app = replaceRequired(
  app,
  `    : p.startsWith('/formation') ? 'formation'`,
  `    : p.startsWith('/conferences') ? 'conferences'\n    : p.startsWith('/formation') ? 'formation'`,
  'conference path',
)

app = replaceRequired(
  app,
  `  const openFormation  = () => nav('/formation',        'formation')`,
  `  const openFormation  = () => nav('/formation',        'formation')\n  const openConferences = () => nav('/conferences',       'conferences')`,
  'conference navigator',
)

app = replaceRequired(
  app,
  `    const viewMap = { '/mentions': 'mentions', '/confidentialite': 'confidentialite', '/cgv-oracle': 'cgv-oracle', '/retractation': 'retractation' }`,
  `    const viewMap = { '/mentions': 'mentions', '/confidentialite': 'confidentialite', '/cgv-oracle': 'cgv-oracle', '/retractation': 'retractation', '/conferences': 'conferences' }`,
  'footer conference navigation',
)

app = replaceRequired(
  app,
  `  if (view === 'formation')    return <DeferredRoute><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  `  if (view === 'formation')    return <DeferredRoute><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>\n  if (view === 'conferences')   return <DeferredRoute><ConferencesPage onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  'conference render route',
)

app = replaceRequired(
  app,
  `  return <><PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenChronosphere={openChronosphere} onOpenChronosphereExample={openChronosphereExample} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onNavigate={legalNav} />{guardian}</>`,
  `  return <><PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenChronosphere={openChronosphere} onOpenChronosphereExample={openChronosphereExample} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onOpenConferences={openConferences} onNavigate={legalNav} />{guardian}</>`,
  'home conference wiring',
)

await writeFile(appPath, app)

let footer = await readFile(footerPath, 'utf8')
footer = replaceRequired(
  footer,
  `        <a href="/retractation" onClick={go('/retractation')} className="hover:text-gold transition-colors">Rétractation</a>\n        <span className="hidden sm:inline">·</span>\n        <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors">Contact</a>`,
  `        <a href="/retractation" onClick={go('/retractation')} className="hover:text-gold transition-colors">Rétractation</a>\n        <span className="hidden sm:inline">·</span>\n        <a href="/conferences" onClick={go('/conferences')} className="hover:text-gold transition-colors">Conférences</a>\n        <span className="hidden sm:inline">·</span>\n        <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors">Contact</a>`,
  'footer conference link',
)
await writeFile(footerPath, footer)

let pilotage = await readFile(pilotagePath, 'utf8')
pilotage = replaceRequired(
  pilotage,
  `  chronosphere_payment_opened: 'Paiements Chronosphère ouverts',`,
  `  chronosphere_payment_opened: 'Paiements Chronosphère ouverts',\n  conference_page_view: 'Vues page Conférences',\n  conference_interest_click: 'Intérêt Conférences',`,
  'conference analytics labels',
)
await writeFile(pilotagePath, pilotage)

console.log('MediumIA conferences: public foundation applied')
