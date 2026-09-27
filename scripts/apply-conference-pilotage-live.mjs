import { readFile, writeFile } from 'node:fs/promises'

const adminPath = new URL('../api/rdv-admin.js', import.meta.url)
const pilotagePath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)

function replaceOneRequired(source, candidates, after, label) {
  if (source.includes(after)) return source
  for (const before of candidates) {
    if (source.includes(before)) return source.replace(before, after)
  }
  throw new Error(`Conference live pilotage patch drift: ${label}`)
}

let admin = await readFile(adminPath, 'utf8')

const conferenceQuery = `  let conference = { total: 0, capacity: null, remaining: null, fill_rate: null }
  const { data: conferenceEvent, error: conferenceEventError } = await supabase
    .from('conference_events')
    .select('id, capacity')
    .eq('slug', 'premiere-conference-mediumia')
    .maybeSingle()

  if (!conferenceEventError && conferenceEvent?.id) {
    const { count: conferenceTotal, error: conferenceCountError } = await supabase
      .from('conference_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', conferenceEvent.id)
      .neq('status', 'cancelled')

    if (!conferenceCountError) {
      const total = Number(conferenceTotal || 0)
      const capacity = conferenceEvent.capacity ? Number(conferenceEvent.capacity) : null
      conference = {
        total,
        capacity,
        remaining: capacity ? Math.max(0, capacity - total) : null,
        fill_rate: capacity ? Math.round((total / capacity) * 100) : null,
      }
    }
  }

`

if (!admin.includes("const { data: conferenceEvent, error: conferenceEventError }")) {
  const liveReturnCandidates = [
    "  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, daily })",
    "  return res.status(200).json({ preview: false, days, totals, home_doors, daily })",
  ]
  let found = false
  for (const marker of liveReturnCandidates) {
    if (admin.includes(marker)) {
      admin = admin.replace(marker, conferenceQuery + marker)
      found = true
      break
    }
  }
  if (!found) throw new Error('Conference live pilotage patch drift: live analytics insertion')
}

admin = replaceOneRequired(
  admin,
  [
    "  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, daily })",
    "  return res.status(200).json({ preview: false, days, totals, home_doors, daily })",
  ],
  "  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, daily, conference })",
  'live analytics return',
)

admin = replaceOneRequired(
  admin,
  [
    "  return { preview: true, days, totals, home_doors, oracle_next_steps, daily }",
    "  return { preview: true, days, totals, home_doors, daily }",
  ],
  "  return { preview: true, days, totals, home_doors, oracle_next_steps, daily, conference: { total: 21, capacity: null } }",
  'server preview conference',
)

await writeFile(adminPath, admin)

let pilotage = await readFile(pilotagePath, 'utf8')

pilotage = replaceOneRequired(
  pilotage,
  [
    "  return { preview: true, days, totals, home_doors, oracle_next_steps, daily }",
    "  return { preview: true, days, totals, home_doors, daily }",
  ],
  "  return { preview: true, days, totals, home_doors, oracle_next_steps, daily, conference: { total: 21, capacity: null } }",
  'client preview conference',
)

const pollingBlock = `  useEffect(() => {
    if (demoMode || !session) return undefined

    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      fetch(\`/api/rdv-admin?action=analytics&days=\${days}\`, { headers: authHeader(session) })
        .then(async res => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || 'pilotage_indisponible')
          return body
        })
        .then(body => setData(body))
        .catch(() => {})
    }

    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [session, days, demoMode])

`

if (!pilotage.includes('const timer = window.setInterval(refresh, 15000)')) {
  const anchor = "  const totals = data?.totals || {}"
  if (!pilotage.includes(anchor)) throw new Error('Conference live pilotage patch drift: polling anchor')
  pilotage = pilotage.replace(anchor, pollingBlock + anchor)
}

const conferenceValues = `  const conference = data?.conference || {}
  const conferenceTotal = Number(conference.total || 0)
  const conferenceCapacity = Number(conference.capacity || 0)
  const conferenceNote = conferenceCapacity > 0
    ? \`${conferenceTotal.toLocaleString('fr-FR')} / ${conferenceCapacity.toLocaleString('fr-FR')} · ${Math.max(0, conferenceCapacity - conferenceTotal).toLocaleString('fr-FR')} places restantes · actualisation ~15 s\`
    : 'Conférence du 22 octobre · actualisation automatique ~15 s'
`

if (!pilotage.includes('const conferenceTotal = Number(conference.total || 0)')) {
  const anchor = "  const homeViews = Number(totals.home_view || 0)"
  if (!pilotage.includes(anchor)) throw new Error('Conference live pilotage patch drift: conference values anchor')
  pilotage = pilotage.replace(anchor, anchor + '\n' + conferenceValues)
}

pilotage = pilotage.replace(
  '      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">',
  '      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">',
)

if (!pilotage.includes('eyebrow="Inscriptions conférence"')) {
  const accueilCard = '        <MetricCard eyebrow="Accueil" value={homeViews} note={\`Sur les \${days} derniers jours\`} />'
  if (!pilotage.includes(accueilCard)) throw new Error('Conference live pilotage patch drift: KPI card anchor')
  pilotage = pilotage.replace(
    accueilCard,
    accueilCard + '\n        <MetricCard eyebrow="Inscriptions conférence" value={conferenceTotal} note={conferenceNote} />',
  )
}

await writeFile(pilotagePath, pilotage)

console.log('MediumIA pilotage: conference registrations live counter applied')
