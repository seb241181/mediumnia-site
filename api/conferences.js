/* global process */
import { createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max)
}

function publicEvent(event) {
  if (!event) return null
  return {
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    status: event.status,
    capacity: event.capacity,
    registrationOpen: event.status === 'registration_open',
  }
}

export default async function handler(req, res) {
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'Service indisponible.' })
  const supabase = getSupabaseAdmin()

  if (req.method === 'GET') {
    const slug = clean(req.query?.slug || 'premiere-conference-mediumia', 120)
    const { data, error } = await supabase
      .from('conference_events')
      .select('slug,title,subtitle,starts_at,ends_at,timezone,status,capacity')
      .eq('slug', slug)
      .maybeSingle()
    if (error) return res.status(500).json({ error: 'Impossible de charger la conférence.' })
    return res.status(200).json({ event: publicEvent(data) })
  }

  if (req.method === 'POST') {
    const firstName = clean(req.body?.firstName, 80)
    const email = clean(req.body?.email, 254).toLowerCase()
    const slug = clean(req.body?.slug || 'premiere-conference-mediumia', 120)
    const source = clean(req.body?.source || 'conferences', 120)
    if (!firstName || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Prénom et e-mail valides requis.' })

    const { data: event, error: eventError } = await supabase
      .from('conference_events')
      .select('id,status,capacity')
      .eq('slug', slug)
      .maybeSingle()
    if (eventError) return res.status(500).json({ error: 'Impossible de vérifier la conférence.' })
    if (!event || event.status !== 'registration_open') return res.status(409).json({ error: 'Les inscriptions ne sont pas ouvertes.' })

    if (event.capacity) {
      const { count, error: countError } = await supabase
        .from('conference_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .neq('status', 'cancelled')
      if (countError) return res.status(500).json({ error: 'Impossible de vérifier les places.' })
      if ((count || 0) >= event.capacity) return res.status(409).json({ error: 'La conférence est complète.' })
    }

    const { data: existing } = await supabase
      .from('conference_registrations')
      .select('id,status')
      .eq('event_id', event.id)
      .eq('email_normalized', email)
      .maybeSingle()
    if (existing && existing.status !== 'cancelled') return res.status(200).json({ ok: true, alreadyRegistered: true })

    if (existing?.status === 'cancelled') {
      const { error } = await supabase.from('conference_registrations').update({ first_name: firstName, status: 'registered', source, updated_at: new Date().toISOString() }).eq('id', existing.id)
      if (error) return res.status(500).json({ error: 'Inscription impossible.' })
      return res.status(200).json({ ok: true, restored: true })
    }

    const { error } = await supabase.from('conference_registrations').insert({ event_id: event.id, first_name: firstName, email, source })
    if (error) {
      // Do not leak database details; a concurrent duplicate is equivalent to success.
      const fingerprint = createHash('sha256').update(`${event.id}:${email}`).digest('hex').slice(0, 12)
      console.error('conference_registration_failed', fingerprint)
      return res.status(500).json({ error: 'Inscription impossible pour le moment.' })
    }
    return res.status(201).json({ ok: true })
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Méthode non autorisée.' })
}
