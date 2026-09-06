import { readFile, writeFile } from 'node:fs/promises'

const adminPath = new URL('../api/rdv-admin.js', import.meta.url)
const dashboardPath = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA pilotage patch drift: ${label}`)
  return source.replace(before, after)
}

let admin = await readFile(adminPath, 'utf8')

const analyticsHandler = `// ── action=analytics ──────────────────────────────────────────────────────────

const PLATFORM_ADMIN_PRACTITIONER_SLUGS = ['sebastien-seguin']

function previewAnalytics(days) {
  const factor = days === 7 ? 0.28 : days === 90 ? 2.7 : 1
  const round = value => Math.max(0, Math.round(value * factor))
  const totals = {
    home_view: round(428),
    home_door_click: round(173),
    ecosystem_door_click: round(61),
    chronosphere_example_view: round(96),
    chronosphere_example_cta: round(41),
    chronosphere_payment_opened: round(24),
  }
  const home_doors = {
    oracle: round(58),
    chronosphere: round(67),
    reseau: round(24),
    formation: round(24),
  }
  const daily = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - offset)
    const wave = 9 + ((offset * 7 + days) % 11)
    daily.push({ date: date.toISOString().slice(0, 10), total: wave })
  }
  return { preview: true, days, totals, home_doors, daily }
}

async function handleAnalytics(req, res, supabase, userId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const requestedDays = Number(req.query.days || 30)
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30

  // Preview shows a clearly labelled demo so the private interface can be reviewed
  // without reading or polluting production analytics.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return res.status(200).json(previewAnalytics(days))
  }

  const { data: ownedAdmins, error: adminError } = await supabase
    .from('booking_practitioners')
    .select('id, slug')
    .eq('owner_id', userId)
    .in('slug', PLATFORM_ADMIN_PRACTITIONER_SLUGS)
    .limit(1)

  if (adminError) return res.status(500).json({ error: 'pilotage_access_error' })
  if (!ownedAdmins?.length) return res.status(403).json({ error: 'pilotage_forbidden' })

  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const startDate = start.toISOString().slice(0, 10)

  const { data: rows, error } = await supabase
    .from('mediumia_event_daily_counts')
    .select('event_date, event_name, source, event_count')
    .gte('event_date', startDate)
    .order('event_date')

  if (error) return res.status(500).json({ error: 'pilotage_data_error', code: error.code })

  const totals = {}
  const home_doors = { oracle: 0, chronosphere: 0, reseau: 0, formation: 0 }
  const dailyMap = new Map()

  for (const row of rows || []) {
    const count = Number(row.event_count || 0)
    totals[row.event_name] = (totals[row.event_name] || 0) + count
    if (row.event_name === 'home_door_click' && row.source?.startsWith('home:')) {
      const target = row.source.slice(5)
      if (target in home_doors) home_doors[target] += count
    }
    dailyMap.set(row.event_date, (dailyMap.get(row.event_date) || 0) + count)
  }

  const daily = []
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + offset)
    const key = date.toISOString().slice(0, 10)
    daily.push({ date: key, total: dailyMap.get(key) || 0 })
  }

  return res.status(200).json({ preview: false, days, totals, home_doors, daily })
}

`

admin = replaceRequired(
  admin,
  `// ── Router principal ──────────────────────────────────────────────────────────`,
  `${analyticsHandler}// ── Router principal ──────────────────────────────────────────────────────────`,
  'analytics handler',
)

admin = replaceRequired(
  admin,
  `    case 'bookings':     return handleBookings(req, res, supabase, userId)`,
  `    case 'bookings':     return handleBookings(req, res, supabase, userId)\n    case 'analytics':    return handleAnalytics(req, res, supabase, userId)`,
  'analytics route',
)

await writeFile(adminPath, admin)

let dashboard = await readFile(dashboardPath, 'utf8')

dashboard = replaceRequired(
  dashboard,
  `import { useAuth } from '../../lib/useAuth'`,
  `import { useAuth } from '../../lib/useAuth'\nimport PilotageDashboard from './PilotageDashboard'`,
  'pilotage import',
)

dashboard = replaceRequired(
  dashboard,
  `  const [activeSlug, setActiveSlug] = useState(null)`,
  `  const [activeSlug, setActiveSlug] = useState(null)\n  const [workspace, setWorkspace] = useState('rdv')`,
  'workspace state',
)

dashboard = replaceRequired(
  dashboard,
  `  const activePractitioner = practitioners.find(p => p.slug === activeSlug)`,
  `  const activePractitioner = practitioners.find(p => p.slug === activeSlug)\n  const canSeePilotage = practitioners.some(p => p.slug === 'sebastien-seguin') || window.location.hostname.endsWith('.vercel.app')`,
  'pilotage access visibility',
)

const headingEnd = `        <div className="mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">MediumIA Rendez-vous</h1>
          <p className="font-georgia text-mist">Votre pratique. Votre agenda. Vos rendez-vous réunis.</p>
        </div>

        {/* Loading */}`

const headingWithTabs = `        <div className="mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">{workspace === 'pilotage' ? 'Pilotage MediumIA' : 'MediumIA Rendez-vous'}</h1>
          <p className="font-georgia text-mist">{workspace === 'pilotage' ? 'Comprendre les parcours pour décider quoi améliorer.' : 'Votre pratique. Votre agenda. Vos rendez-vous réunis.'}</p>
        </div>

        {canSeePilotage && (
          <div className="mb-8 inline-flex rounded-xl border border-gold/25 bg-white/55 p-1">
            <button
              onClick={() => setWorkspace('rdv')}
              className={\`rounded-lg px-4 py-2.5 font-georgia text-xs transition-colors \${workspace === 'rdv' ? 'bg-deep text-gold' : 'text-mist hover:text-deep'}\`}
            >
              Rendez-vous
            </button>
            <button
              onClick={() => setWorkspace('pilotage')}
              className={\`rounded-lg px-4 py-2.5 font-georgia text-xs transition-colors \${workspace === 'pilotage' ? 'bg-deep text-gold' : 'text-mist hover:text-deep'}\`}
            >
              Pilotage MediumIA
            </button>
          </div>
        )}

        {workspace === 'pilotage' && canSeePilotage ? (
          <PilotageDashboard session={session} />
        ) : (
          <>
        {/* Loading */}`

dashboard = replaceRequired(dashboard, headingEnd, headingWithTabs, 'pilotage tabs')

dashboard = replaceRequired(
  dashboard,
  `          </>\n        )}\n      </main>`,
  `          </>\n        )}\n          </>\n        )}\n      </main>`,
  'pilotage workspace close',
)

await writeFile(dashboardPath, dashboard)

console.log('MediumIA pilotage: private analytics dashboard applied')
