import { createTeamDemoProvider, formatMediumiaTeamDemoReply, resolveTeamDemoConfiguration } from './mediumiaTeamLiveDemo.js'

const TEST_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
const TEST_BRANCH = 'codex/mediumia-agent-team-phase0'
const RPC_URL = TEST_URL + '/rest/v1/rpc/mediumia_team_test_read_v1'

export function isMediumiaTeamTestAnalysisEnabled(env = process.env) {
  return env.VERCEL_ENV === 'preview' &&
    env.VERCEL_GIT_COMMIT_REF === TEST_BRANCH &&
    env.MEDIUMIA_TEAM_READ_TEST_ENABLED === 'true' &&
    env.VITE_MEDIUMIA_TEAM_TEST_URL === TEST_URL &&
    typeof env.VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY === 'string' &&
    env.VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY.startsWith('sb_publishable_') &&
    resolveTeamDemoConfiguration(env).available
}

function isJWT(value) {
  return typeof value === 'string' && value.length > 90 && value.length < 4096 &&
    /^[a-zA-Z0-9._-]+$/.test(value) && value.split('.').length === 3
}

const validNumber = n => Number.isSafeInteger(n) && n >= 0

export function sanitizeTeamTestAnalysis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.source !== 'mediumia_test' || raw.environment !== 'TEST' ||
      raw.practitioner !== 'seb-test' || raw.contains_client_identity !== false ||
      raw.provider_verified !== false) return null

  const b = raw.bookings, p = raw.payments, r = raw.refunds
  const values = [
    b?.confirmed, b?.future_confirmed, p?.captured, p?.records,
    p?.captured_total_cents, r?.completed,
  ]
  if (!values.every(validNumber) || b.future_confirmed > b.confirmed ||
      p.captured > p.records) return null

  const slots = raw.upcoming_slots
  if (!Array.isArray(slots) || slots.length > 5 ||
      slots.some(slot => !slot || !Number.isFinite(Date.parse(slot.starts_at)) ||
        typeof slot.starts_at !== 'string')) return null

  // Only these six counts and the first future date can reach the LLM.
  return Object.freeze({
    confirmed: b.confirmed,
    upcoming: b.future_confirmed,
    paymentRecords: p.records,
    captured: p.captured,
    capturedCents: p.captured_total_cents,
    refundsCompleted: r.completed,
    firstUpcomingAt: slots[0]?.starts_at || null,
  })
}

export async function readVerifiedTeamTestAnalysis({ jwt, env = process.env, fetchImpl = fetch }) {
  if (!isMediumiaTeamTestAnalysisEnabled(env)) throw new Error('reader_off')
  if (!isJWT(jwt)) throw new Error('not_authenticated')

  let response
  try {
    response = await fetchImpl(RPC_URL, {
      method: 'POST',
      headers: {
        apikey: env.VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + jwt,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    })
  } catch { throw new Error('read_failed') }

  if (response.status === 401 || response.status === 403) throw new Error('not_authenticated')
  if (!response.ok) throw new Error('read_failed')
  let raw
  try { raw = await response.json() } catch { throw new Error('read_failed') }
  const data = sanitizeTeamTestAnalysis(raw)
  if (!data) throw new Error('invalid_snapshot')
  return data
}

export function formatTeamTestAppointmentParis(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone:'Europe/Paris',
    weekday:'long', day:'numeric', month:'long', year:'numeric',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).format(new Date(value))
}

export function formatTeamTestAmountEuro(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null
  return new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'}).format(cents / 100)
}

const ROLE_PROMPTS = Object.freeze({
  rdv: [
    'Tu es Lumia Rendez-vous. Tu travailles sur une synthèse ANONYME de Supabase TEST.',
    'En deux phrases naturelles, indique les réservations confirmées et à venir et le premier horaire exprimé en heure française (Europe/Paris).',
    "Tu n'as pas interrogé Google Agenda et tu ne dois pas prétendre qu'un créneau est disponible.",
  ].join(' '),
  finance: [
    'Tu es le spécialiste Finances. Tu reçois des compteurs ANONYMES de Supabase TEST.',
    'En deux phrases, résume les paiements marqués capturés et les remboursements terminés dans la base TEST. Affiche les montants en euros, pas en centimes.',
    "Tu ne contactes pas PayPal ; ces chiffres n'attestent pas un versement réel.",
  ].join(' '),
})

export async function analyzeVerifiedTeamTest(data, callModel) {
  if (!sanitizeTeamTestAnalysis({
    source:'mediumia_test',environment:'TEST',practitioner:'seb-test',
    contains_client_identity:false,provider_verified:false,
    bookings:{confirmed:data?.confirmed,future_confirmed:data?.upcoming},
    payments:{captured:data?.captured,records:data?.paymentRecords,
      captured_total_cents:data?.capturedCents},
    refunds:{completed:data?.refundsCompleted},
    upcoming_slots:data?.firstUpcomingAt?[{starts_at:data.firstUpcomingAt}]:[],
  })) throw new Error('invalid_snapshot')
  if (typeof callModel !== 'function') throw new Error('provider_unavailable')

  const facts = [
    {role:'rdv',data:{
      confirmed:data.confirmed,upcoming:data.upcoming,firstUpcomingParis:formatTeamTestAppointmentParis(data.firstUpcomingAt),
    }},
    {role:'finance',data:{
      paymentRecords:data.paymentRecords,captured:data.captured,
      capturedEuros:formatTeamTestAmountEuro(data.capturedCents),refundsCompleted:data.refundsCompleted,
    }},
  ]
  const reports = []
  for (const item of facts) {
    const answer = formatMediumiaTeamDemoReply(await callModel({
      role:item.role,
      systemPrompt:ROLE_PROMPTS[item.role] +
        ' Réponds en français. Ne demande pas de validation pour une lecture. Ne propose aucune action.',
      userText:JSON.stringify({source:'Supabase TEST',verified_by:'owner_scoped_rpc',
        paypal_verified:false,data:item.data}),
    }))
    if (!answer) throw new Error('provider_unavailable')
    reports.push(Object.freeze({role:item.role,answer,source:'TEST'}))
  }
  return Object.freeze(reports)
}

export async function handleTeamTestAnalysis(req,res,{env=process.env,fetchImpl=fetch,makeModel=createTeamDemoProvider}={}) {
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Robots-Tag','noindex, nofollow')
  if (req.method !== 'POST') return res.status(405).json({error:'method_not_allowed'})
  if (!isMediumiaTeamTestAnalysisEnabled(env)) return res.status(503).json({error:'test_reader_off'})
  const host = String(req.headers.host || '').toLowerCase()
  if (!host.endsWith('-seguins-projects-a1d4673f.vercel.app') ||
      req.headers.origin !== 'https://' + host) return res.status(403).json({error:'preview_only'})
  if (!String(req.headers['content-type'] || '').startsWith('application/json') ||
      !req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 0) return res.status(400).json({error:'invalid_request'})
  const auth = String(req.headers.authorization || '')
  if (!auth.startsWith('Bearer ')) return res.status(401).json({error:'test_auth_required'})

  let data
  try { data = await readVerifiedTeamTestAnalysis({jwt:auth.slice(7),env,fetchImpl}) }
  catch(err) { return res.status(err.message === 'not_authenticated' ? 401 : 503)
    .json({error:err.message === 'not_authenticated' ? 'test_auth_required' : 'test_read_failed'}) }

  const summary = {
    appointments:data.confirmed,upcoming:data.upcoming,captured:data.captured,
    capturedCents:data.capturedCents,refundsCompleted:data.refundsCompleted,
  }
  try {
    const reports = await analyzeVerifiedTeamTest(data,makeModel({env}))
    return res.status(200).json({
      ok:true,mode:'test_read_only',summary,reports,aiStatus:'ready',
      clientIdentityIncluded:false,providerVerified:false,actionsExecuted:0,
    })
  } catch {
    return res.status(200).json({
      ok:true,mode:'test_read_only',summary,reports:[],aiStatus:'unavailable',
      clientIdentityIncluded:false,providerVerified:false,actionsExecuted:0,
    })
  }
}
