/* global process */
/**
 * Défi Intuition — api/rdv-config.js?defiAction=<action>
 *
 *   POST event        compte une partie, un nouveau joueur ou un partage (compteurs du jour)
 *   POST subscribe    rappel quotidien par e-mail, facultatif (consentement explicite)
 *   POST unsubscribe  désinscription en un clic (lien signé reçu dans chaque e-mail)
 *   GET  stats        suivi pour le propriétaire (onglet Pilotage du tableau de bord)
 *
 * Les compteurs réutilisent mediumia_event_daily_counts (aucune donnée personnelle).
 * L'IP n'est jamais stockée : seule une empreinte HMAC sert à limiter les inscriptions.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'

const SITE = 'https://mediumia.fr'
const GAME_URL = `${SITE}/defi-intuition`
const OWNER_SLUG = 'sebastien-seguin'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Resend : on reste sous le quota journalier de l'offre gratuite.
export const REMINDERS_PER_DAY = 90
export const SHARE_CHANNELS = ['image', 'facebook', 'whatsapp', 'copy', 'native']
export const DEFI_EVENTS = new Set(['defi_new_player', 'defi_played', ...SHARE_CHANNELS.map((c) => `defi_share_${c}`)])

function secret() {
  const value = String(process.env.RDV_RATE_LIMIT_SECRET || '').trim()
  return /^[0-9a-fA-F]{64}$/.test(value) ? value : null
}

export function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// Unsubscribe link: "<id>.<signature>", nothing stored, cannot be forged.
export function unsubscribeToken(id, key = secret()) {
  if (!key) return null
  return `${id}.${createHmac('sha256', key).update(`defi-unsubscribe:${id}`).digest('base64url')}`
}

export function verifyUnsubscribeToken(token, key = secret()) {
  const [id, sig] = String(token || '').split('.')
  if (!key || !/^[0-9a-f-]{36}$/i.test(id || '') || !sig) return null
  const expected = unsubscribeToken(id, key).split('.')[1]
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b) ? id : null
}

async function rateLimited(req, supabase) {
  const key = secret()
  if (!key) return true
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim().toLowerCase() || 'unknown'
  const { data } = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: createHmac('sha256', key).update(`defi-subscribe:${ip}`).digest('hex'),
    p_endpoint: 'defi_subscribe',
    p_hourly_limit: 5,
    p_daily_limit: 20,
  })
  return data?.allowed === false
}

function emailFrame(title, bodyHtml, unsubscribeUrl) {
  return `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fffdf8">
<tr><td style="background:#1a1535;padding:28px 32px;color:#fffaf0"><p style="margin:0;color:#e4c77a;font-size:12px;letter-spacing:2px">MEDIUMIA · DÉFI INTUITION</p><h1 style="margin:12px 0 0;font-size:24px;font-weight:normal">${escapeHtml(title)}</h1></td></tr>
<tr><td style="padding:28px 32px;color:#4a4356;font-size:16px;line-height:1.65">${bodyHtml}
<p style="text-align:center;margin:28px 0"><a href="${GAME_URL}" style="display:inline-block;background:#1a1535;color:#e4c77a;text-decoration:none;padding:14px 26px;border-radius:8px;font-weight:bold">Faire l’exercice du jour</a></p>
<p style="font-size:12px;color:#8a8190">Vous recevez cet e-mail car vous avez demandé le rappel du Défi Intuition sur mediumia.fr. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8190">Ne plus recevoir ce rappel</a>.</p>
</td></tr></table></td></tr></table></body></html>`
}

export function buildReminderEmail(unsubscribeUrl, welcome = false) {
  const subject = welcome ? 'Votre rappel du Défi Intuition est activé' : 'Votre Défi Intuition du jour vous attend 🔮'
  const intro = welcome
    ? 'C’est noté : chaque matin, un petit e-mail vous rappellera votre défi du jour. Trois cartes, une minute d’exercice.'
    : 'Trois Étoiles se cachent aujourd’hui. Prenez une minute, respirez, et écoutez votre premier ressenti.'
  const text = `${intro}\n\nFaire l’exercice : ${GAME_URL}\n\nNe plus recevoir ce rappel : ${unsubscribeUrl}\n\nSébastien · MediumIA`
  return { subject, text, html: emailFrame(welcome ? 'Rappel activé ✦' : 'Votre défi du jour', `<p>${escapeHtml(intro)}</p>`, unsubscribeUrl) }
}

async function isOwner(req, supabase) {
  const match = String(req.headers?.authorization || '').trim().match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  const { data, error } = await supabase.auth.getUser(match[1])
  if (error || !data?.user?.id) return false
  const { data: owned } = await supabase.from('booking_practitioners').select('id').eq('owner_id', data.user.id).eq('slug', OWNER_SLUG).limit(1)
  return Boolean(owned?.length)
}

export async function defiStats(supabase, days = 30, now = new Date()) {
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const startDate = start.toISOString().slice(0, 10)
  const { data: rows, error } = await supabase.from('mediumia_event_daily_counts')
    .select('event_date, event_name, event_count')
    .gte('event_date', startDate)
    .like('event_name', 'defi_%')
  if (error) throw new Error('defi_stats_failed')
  const totals = { newPlayers: 0, plays: 0, shareTotal: 0 }
  const shares = Object.fromEntries(SHARE_CHANNELS.map((c) => [c, 0]))
  const daily = new Map()
  for (const row of rows || []) {
    const count = Number(row.event_count || 0)
    if (row.event_name === 'defi_new_player') totals.newPlayers += count
    if (row.event_name === 'defi_played') {
      totals.plays += count
      daily.set(row.event_date, (daily.get(row.event_date) || 0) + count)
    }
    if (row.event_name.startsWith('defi_share_')) {
      const channel = row.event_name.slice('defi_share_'.length)
      if (channel in shares) shares[channel] += count
      totals.shareTotal += count
    }
  }
  const { count: subscribers } = await supabase.from('defi_reminders').select('id', { count: 'exact', head: true }).is('unsubscribed_at', null)
  const series = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const key = d.toISOString().slice(0, 10)
    series.push({ date: key, plays: daily.get(key) || 0 })
  }
  return { days, ...totals, shares, subscribers: subscribers || 0, series }
}

export async function handleDefi(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'defi_unavailable' })
  const supabase = getSupabaseAdmin()

  if (action === 'event') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const event = String(req.body?.event || '')
    if (!DEFI_EVENTS.has(event)) return res.status(400).json({ error: 'invalid_event' })
    // Preview traffic never counts in the real figures.
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return res.status(204).end()
    const { error } = await supabase.rpc('increment_mediumia_event', { p_event_name: event, p_source: 'defi' })
    return error ? res.status(500).json({ error: 'event_failed' }) : res.status(204).end()
  }

  if (action === 'subscribe') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'invalid_email' })
    if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' })
    if (await rateLimited(req, supabase)) return res.status(429).json({ error: 'too_many_attempts' })
    const { data: row, error } = await supabase.from('defi_reminders')
      .upsert({ email, consent_at: new Date().toISOString(), unsubscribed_at: null }, { onConflict: 'email' })
      .select('id').single()
    if (error || !row) return res.status(500).json({ error: 'subscribe_failed' })
    const token = unsubscribeToken(row.id)
    if (token) {
      const message = buildReminderEmail(`${GAME_URL}?stop=${encodeURIComponent(token)}`, true)
      await sendEmail({ to: email, ...message, idempotencyKey: `defi-welcome/${row.id}/${parisDay()}` }).catch(() => null)
    }
    if (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production') {
      await supabase.rpc('increment_mediumia_event', { p_event_name: 'defi_reminder_signup', p_source: 'defi' })
    }
    return res.status(200).json({ ok: true })
  }

  if (action === 'unsubscribe') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const id = verifyUnsubscribeToken(req.body?.token)
    if (!id) return res.status(400).json({ error: 'invalid_token' })
    const { error } = await supabase.from('defi_reminders').update({ unsubscribed_at: new Date().toISOString() }).eq('id', id).is('unsubscribed_at', null)
    return error ? res.status(500).json({ error: 'unsubscribe_failed' }) : res.status(200).json({ ok: true })
  }

  if (action === 'stats') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    if (!(await isOwner(req, supabase))) return res.status(403).json({ error: 'forbidden' })
    try {
      return res.status(200).json(await defiStats(supabase, 30))
    } catch {
      return res.status(500).json({ error: 'defi_stats_failed' })
    }
  }

  return res.status(400).json({ error: 'unknown_action' })
}

// Daily job: one reminder per subscriber and per day, claimed before sending.
export async function sendDefiReminders(supabase, now = new Date()) {
  const today = parisDay(now)
  const { data: rows, error } = await supabase.from('defi_reminders')
    .select('id, email, last_sent_on')
    .is('unsubscribed_at', null)
    .or(`last_sent_on.is.null,last_sent_on.lt.${today}`)
    .order('last_sent_on', { ascending: true, nullsFirst: true })
    .limit(REMINDERS_PER_DAY)
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { skipped: 'migration_pending', sent: 0 }
  if (error) throw new Error('defi_reminder_lookup_failed')
  let sent = 0
  for (const row of rows || []) {
    const token = unsubscribeToken(row.id)
    if (!token) return { skipped: 'secret_missing', sent }
    let claim = supabase.from('defi_reminders').update({ last_sent_on: today }).eq('id', row.id).is('unsubscribed_at', null)
    claim = row.last_sent_on ? claim.eq('last_sent_on', row.last_sent_on) : claim.is('last_sent_on', null)
    const { data: claimed } = await claim.select('id').maybeSingle()
    if (!claimed) continue
    const message = buildReminderEmail(`${GAME_URL}?stop=${encodeURIComponent(token)}`)
    const result = await sendEmail({ to: row.email, ...message, idempotencyKey: `defi-reminder/${row.id}/${today}` })
    if (result?.status === 'sent') sent += 1
  }
  return { sent }
}
