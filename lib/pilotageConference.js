// Pilotage MediumIA : inscriptions à la conférence, lues en direct dans
// conference_registrations (la même table que le formulaire et le cockpit).
// Aucun chiffre stocké ailleurs : chaque appel recompte depuis Supabase.
// Seuls des agrégats sortent d'ici, jamais un prénom ni une adresse.

export const PLATFORM_ADMIN_PRACTITIONER_SLUGS = ['sebastien-seguin']
export const CONFERENCE_FALLBACK_SLUG = 'premiere-conference-mediumia'
export const PARIS_TIME_ZONE = 'Europe/Paris'

const PAGE_SIZE = 1000
const DAILY_DAYS = 14
const VALID_STATUSES = new Set(['registered', 'attended', 'no_show'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Domaines réservés aux essais (RFC 2606 / 6761) : jamais une vraie personne.
const TEST_EMAIL_DOMAIN_RE = /@(?:[^@]+\.)?(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/
// Lien d'inscription marqué ?utm_source=test (ou demo) → source « conference_page:test ».
const TEST_SOURCE_RE = /(?:^|[:_-])(?:test|tests|demo)(?:[:_-]|$)/

const parisParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: PARIS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function partsOf(date) {
  const parts = {}
  for (const part of parisParts.formatToParts(date)) parts[part.type] = part.value
  return parts
}

// Jour civil à Paris (AAAA-MM-JJ) d'un instant.
export function parisDayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const p = partsOf(date)
  return `${p.year}-${p.month}-${p.day}`
}

function parisOffsetMs(date) {
  const p = partsOf(date)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

// Minuit à Paris (en instant UTC) pour le jour civil parisien de `now`,
// décalé de `shiftDays` jours. Gère les changements d'heure.
export function parisMidnight(now = new Date(), shiftDays = 0) {
  const [year, month, day] = parisDayKey(now).split('-').map(Number)
  const naive = Date.UTC(year, month - 1, day + shiftDays)
  let instant = naive - parisOffsetMs(new Date(naive))
  instant = naive - parisOffsetMs(new Date(instant))
  return new Date(instant)
}

export function isTestRegistration(row) {
  const email = String(row?.email_normalized || '').trim().toLowerCase()
  const source = String(row?.source || '').trim().toLowerCase()
  return TEST_EMAIL_DOMAIN_RE.test(email) || TEST_SOURCE_RE.test(source)
}

// « conference_page:facebook » → « facebook » ; sans lien suivi → « direct ».
export function registrationChannel(source) {
  const value = String(source || '').trim().toLowerCase()
  if (!value || value === 'conference_page' || value === 'conferences') return 'direct'
  if (value.startsWith('conference_page:')) return value.slice('conference_page:'.length) || 'direct'
  return value.slice(0, 40)
}

// Choisit la conférence suivie : la prochaine (ou celle en cours) qui n'est ni
// un brouillon ni annulée ; à défaut la plus récente ; à défaut la première.
export function pickCurrentEvent(events, now = new Date()) {
  const usable = (events || []).filter(event => event && !['draft', 'cancelled'].includes(event.status))
  const nowMs = now.getTime()
  const endOf = event => {
    const end = Date.parse(event.ends_at || '')
    if (Number.isFinite(end)) return end
    const start = Date.parse(event.starts_at || '')
    return Number.isFinite(start) ? start + 3 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY
  }
  const startOf = event => {
    const start = Date.parse(event.starts_at || '')
    return Number.isFinite(start) ? start : Number.POSITIVE_INFINITY
  }
  const upcoming = usable.filter(event => endOf(event) >= nowMs).sort((a, b) => startOf(a) - startOf(b))
  if (upcoming.length) return upcoming[0]
  const past = usable.slice().sort((a, b) => startOf(b) - startOf(a))
  if (past.length) return past[0]
  return (events || []).find(event => event?.slug === CONFERENCE_FALLBACK_SLUG) || null
}

export function summarizeConferenceRegistrations({ event, rows, now = new Date() }) {
  const todayStart = parisMidnight(now, 0).getTime()
  const yesterdayStart = parisMidnight(now, -1).getTime()
  const weekStart = parisMidnight(now, -6).getTime()

  const dailyKeys = []
  for (let offset = DAILY_DAYS - 1; offset >= 0; offset -= 1) {
    dailyKeys.push(parisDayKey(new Date(parisMidnight(now, -offset).getTime() + 12 * 60 * 60 * 1000)))
  }
  const dailyMap = new Map(dailyKeys.map(key => [key, 0]))
  const channels = new Map()

  const counts = {
    total: 0,
    today: 0,
    yesterday: 0,
    last_7_days: 0,
    cancelled: 0,
    excluded_tests: 0,
    excluded_invalid: 0,
    seats_taken: 0,
    preparation_sent: 0,
    preparation_missing: 0,
    zoom_sent: 0,
    attended: 0,
  }
  let lastRegistrationAt = null

  for (const row of rows || []) {
    const status = String(row?.status || '')
    if (status === 'cancelled') {
      counts.cancelled += 1
      continue
    }
    // Toute inscription non annulée occupe une place : c'est la règle exacte
    // appliquée par le formulaire (« La conférence est complète »).
    counts.seats_taken += 1

    if (isTestRegistration(row)) {
      counts.excluded_tests += 1
      continue
    }
    const createdMs = Date.parse(row?.created_at || '')
    if (!VALID_STATUSES.has(status) || !EMAIL_RE.test(String(row?.email_normalized || '')) || !Number.isFinite(createdMs)) {
      counts.excluded_invalid += 1
      continue
    }

    counts.total += 1
    if (createdMs >= todayStart) counts.today += 1
    else if (createdMs >= yesterdayStart) counts.yesterday += 1
    if (createdMs >= weekStart) counts.last_7_days += 1
    if (row.preparation_sent_at) counts.preparation_sent += 1
    else counts.preparation_missing += 1
    if (row.zoom_sent_at) counts.zoom_sent += 1
    if (row.attended_at || status === 'attended') counts.attended += 1

    const dayKey = parisDayKey(new Date(createdMs))
    if (dailyMap.has(dayKey)) dailyMap.set(dayKey, dailyMap.get(dayKey) + 1)
    const channel = registrationChannel(row.source)
    channels.set(channel, (channels.get(channel) || 0) + 1)
    if (!lastRegistrationAt || createdMs > Date.parse(lastRegistrationAt)) lastRegistrationAt = new Date(createdMs).toISOString()
  }

  const capacity = Number.isInteger(event?.capacity) && event.capacity > 0 ? event.capacity : null
  const remaining = capacity === null ? null : Math.max(0, capacity - counts.seats_taken)
  const fillRate = capacity === null ? null : Math.min(1, counts.seats_taken / capacity)

  return {
    event: event ? {
      slug: event.slug,
      title: event.title || null,
      starts_at: event.starts_at || null,
      status: event.status,
      registration_open: event.status === 'registration_open',
    } : null,
    ...counts,
    capacity,
    remaining,
    fill_rate: fillRate,
    last_registration_at: lastRegistrationAt,
    by_channel: [...channels.entries()]
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel)),
    daily: dailyKeys.map(date => ({ date, total: dailyMap.get(date) || 0 })),
    generated_at: now.toISOString(),
    time_zone: PARIS_TIME_ZONE,
  }
}

export function previewConferenceStats(now = new Date()) {
  const rows = []
  const channels = ['facebook', 'facebook', 'instagram', 'direct', 'tiktok', 'facebook', 'instagram', 'direct']
  let n = 0
  for (let offset = 13; offset >= 0; offset -= 1) {
    const perDay = offset === 0 ? 3 : (offset * 5) % 4
    for (let i = 0; i < perDay; i += 1) {
      const created = new Date(parisMidnight(now, -offset).getTime() + (9 + i * 3) * 60 * 60 * 1000)
      if (created > now) continue
      const channel = channels[n % channels.length]
      rows.push({
        status: n % 11 === 10 ? 'cancelled' : 'registered',
        email_normalized: `demo${n}@mediumia.fr`,
        source: channel === 'direct' ? 'conference_page' : `conference_page:${channel}`,
        created_at: created.toISOString(),
        preparation_sent_at: n % 9 === 4 ? null : created.toISOString(),
        zoom_sent_at: created.toISOString(),
      })
      n += 1
    }
  }
  const event = {
    slug: CONFERENCE_FALLBACK_SLUG,
    title: 'Et si la médiumnité devenait accessible ?',
    starts_at: '2026-10-22T17:00:00.000Z',
    status: 'registration_open',
    capacity: 100,
  }
  return { preview: true, ...summarizeConferenceRegistrations({ event, rows, now }) }
}

async function isPlatformAdmin(supabase, userId) {
  const { data, error } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('owner_id', userId)
    .in('slug', PLATFORM_ADMIN_PRACTITIONER_SLUGS)
    .limit(1)
  if (error) return { error: 'pilotage_access_error' }
  return { allowed: Boolean(data?.length) }
}

// Lit toutes les lignes de la conférence, page par page, jusqu'au nombre exact
// annoncé par Supabase : le plafond de lignes par requête ne tronque jamais le total.
async function loadRegistrations(supabase, eventId) {
  const rows = []
  let expected = null
  while (expected === null || rows.length < expected) {
    const from = rows.length
    const { data, error, count } = await supabase
      .from('conference_registrations')
      .select('id, status, email_normalized, source, created_at, preparation_sent_at, zoom_sent_at, attended_at', { count: 'exact' })
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { error }
    if (expected === null) expected = Number.isInteger(count) ? count : null
    rows.push(...(data || []))
    if (!data?.length || expected === null) break
  }
  if (expected !== null && rows.length !== expected) return { error: { code: 'incomplete_read' } }
  return { rows }
}

// Retourne { status, body } comme les autres actions de rdv-admin.
export async function getPilotageConferenceStats({ supabase, userId, method = 'GET', env = process.env, now = new Date() }) {
  if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }

  // En Preview, démonstration clairement signalée : aucune donnée réelle lue.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') {
    return { status: 200, body: previewConferenceStats(now) }
  }

  const access = await isPlatformAdmin(supabase, userId)
  if (access.error) return { status: 500, body: { error: access.error } }
  if (!access.allowed) return { status: 403, body: { error: 'pilotage_forbidden' } }

  const { data: events, error: eventsError } = await supabase
    .from('conference_events')
    .select('id, slug, title, starts_at, ends_at, status, capacity')
    .order('starts_at', { ascending: false, nullsFirst: false })
    .limit(50)
  if (eventsError) return { status: 500, body: { error: 'conference_data_error' } }

  const event = pickCurrentEvent(events, now)
  if (!event) return { status: 200, body: { preview: false, event: null, generated_at: now.toISOString() } }

  const { rows, error } = await loadRegistrations(supabase, event.id)
  if (error) return { status: 500, body: { error: 'conference_data_error' } }

  return { status: 200, body: { preview: false, ...summarizeConferenceRegistrations({ event, rows, now }) } }
}
