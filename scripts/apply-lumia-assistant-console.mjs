import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const dashboardPath = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)

function insertAfter(source, needle, addition, label) {
  if (source.includes(addition.trim())) return source
  const index = source.indexOf(needle)
  if (index < 0) throw new Error(`Lumia assistant patch drift: ${label}`)
  return source.slice(0, index + needle.length) + addition + source.slice(index + needle.length)
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Lumia assistant patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = insertAfter(
  app,
  "import RdvDashboard from './components/rdv/RdvDashboard'",
  "\nimport LumiaAssistantPage from './components/rdv/LumiaAssistantPage'",
  'App import',
)

app = replaceRequired(
  app,
  "  return p === '/rdv/annuler' ? 'rdv-cancellation'\n    : p.startsWith('/rdv/') ? 'rdv-public'",
  "  return p === '/rdv/annuler' ? 'rdv-cancellation'\n    : p === '/rdv/lumia' ? 'rdv-lumia'\n    : p.startsWith('/rdv/') ? 'rdv-public'",
  'route priority',
)

app = insertAfter(
  app,
  "  const openRdvDashboard = () => nav('/rdv',             'rdv-dashboard')",
  "\n  const openLumia        = () => nav('/rdv/lumia',       'rdv-lumia')",
  'Lumia navigation',
)

app = replaceRequired(
  app,
  "  const showGuardian = view !== 'rdv-dashboard' && view !== 'rdv-public' && view !== 'chronosphere'",
  "  const showGuardian = view !== 'rdv-dashboard' && view !== 'rdv-lumia' && view !== 'rdv-public' && view !== 'chronosphere'",
  'guardian exclusion',
)

app = replaceRequired(
  app,
  "  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} />",
  "  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} onOpenLumia={openLumia} />\n  if (view === 'rdv-lumia') return <LumiaAssistantPage onBack={openRdvDashboard} />",
  'route render',
)

await writeFile(appPath, app)

let dashboard = await readFile(dashboardPath, 'utf8')

dashboard = replaceRequired(
  dashboard,
  "export default function RdvDashboard({ onBack, onOpenPublic }) {",
  "export default function RdvDashboard({ onBack, onOpenPublic, onOpenLumia }) {",
  'dashboard prop',
)

dashboard = replaceRequired(
  dashboard,
  `        {/* Page heading */}
        <div className="mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">MediumIA Rendez-vous</h1>
          <p className="font-georgia text-mist">Votre pratique. Votre agenda. Vos rendez-vous réunis.</p>
        </div>`,
  `        {/* Page heading */}
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
            <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">MediumIA Rendez-vous</h1>
            <p className="font-georgia text-mist">Votre pratique. Votre agenda. Vos rendez-vous réunis.</p>
          </div>
          <button
            type="button"
            onClick={onOpenLumia}
            className="shrink-0 rounded-xl border border-gold/40 bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold shadow-sm transition-colors hover:bg-deep/90"
          >
            Parler à Lumia
          </button>
        </div>`,
  'dashboard Lumia button',
)

await writeFile(dashboardPath, dashboard)

console.log('Lumia assistant console: private RDV route and button applied')
