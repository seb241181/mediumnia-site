import { LUMIA_ALLOWED_ACTIONS } from './lumiaPolicy.js'
import { LUMIA_BOOKING_CANCEL_ACTION } from './lumiaBookingCancel.js'
import { handleLumiaBookingCancelApi } from './lumiaBookingCancelApi.js'

const TZ = 'Europe/Paris'
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function localParts(value) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return {
    weekday: normalize(get('weekday')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function parisDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function nextParisDayKey(now, days) {
  return parisDateKey(new Date(now.getTime() + days * 86_400_000))
}

export function parseBookingCancelChatCommand(message, now = new Date()) {
  const raw = String(message || '').trim()
  const n = normalize(raw).replace(/[’']/g, ' ')
  const go = n.match(/^go(?:\s+(#[a-z0-9]{6}))?[\s.!]*$/i)
  if (go) return { kind: 'approve', shortCode: go[1] ? go[1].toUpperCase() : null }

  const cancellation = /\b(annule|annuler|supprime|supprimer)\b/.test(n)
    && /\b(rdv|rendez[- ]?vous)\b/.test(n)
  if (!cancellation) return { kind: 'none' }

  const time = n.match(/\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/)
  const weekday = WEEKDAYS.find((day) => new RegExp(`\\b${day}\\b`).test(n)) || null
  const numericDate = n.match(/\b([0-3]?\d)[\/-]([01]?\d)(?:[\/-](20\d{2}))?\b/)
  let date = null
  if (/\baujourd hui\b/.test(n)) date = parisDateKey(now)
  else if (/\bdemain\b/.test(n)) date = nextParisDayKey(now, 1)
  else if (numericDate) {
    const year = numericDate[3] || parisDateKey(now).slice(0, 4)
    date = `${year}-${numericDate[2].padStart(2, '0')}-${numericDate[1].padStart(2, '0')}`
  }

  return {
    kind: 'cancel',
    weekday,
    date,
    hour: time ? Number(time[1]) : null,
    minute: time ? Number(time[2] || 0) : null,
  }
}

function formatBooking(booking) {
  const when = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(booking.starts_at))
  const client = [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ') || 'client'
  return { client, when }
}

async function findCandidates(db, userId, parsed, now) {
  const horizon = new Date(now.getTime() + 60 * 86_400_000).toISOString()
  const { data, error } = await db.from('bookings').select(`
    id, practitioner_id, customer_first_name, customer_last_name, starts_at, ends_at,
    status, booking_source, updated_at, google_event_id,
    service:booking_services(title, modality),
    practitioner:booking_practitioners!inner(id, owner_id)
  `)
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .eq('booking_practitioners.owner_id', userId)
    .gte('starts_at', now.toISOString())
    .lte('starts_at', horizon)
    .order('starts_at', { ascending: true })
    .limit(100)

  if (error) return { error: 'booking_lookup_failed', rows: [] }
  const rows = (data || []).filter((booking) => {
    const local = localParts(booking.starts_at)
    if (parsed.date && local.date !== parsed.date) return false
    if (!parsed.date && parsed.weekday && local.weekday !== parsed.weekday) return false
    if (parsed.hour != null && (local.hour !== parsed.hour || local.minute !== parsed.minute)) return false
    return true
  })
  return { error: null, rows }
}

async function activeIntent(db, userId, conversationId, shortCode = null) {
  let query = db.from('lumia_action_intents')
    .select('id, short_code, status, preview, preview_expires_at, created_at')
    .eq('owner_id', userId)
    .eq('conversation_id', conversationId)
    .eq('action_type', LUMIA_BOOKING_CANCEL_ACTION)
    .eq('target_source', 'mediumia_booking')
    .order('created_at', { ascending: false })
    .limit(shortCode ? 1 : 3)

  if (shortCode) query = query.eq('short_code', shortCode)
  else query = query.in('status', ['preview', 'approved', 'executing']).gt('preview_expires_at', new Date().toISOString())

  const { data, error } = await query
  if (error) return { error: 'intent_lookup_failed', intent: null, count: 0 }
  const rows = data || []
  return { error: null, intent: rows[0] || null, count: rows.length }
}

export async function maybeHandleLumiaBookingCancelChat({
  db,
  userId,
  conversationId,
  message,
  now = new Date(),
}) {
  if (!LUMIA_ALLOWED_ACTIONS.includes(LUMIA_BOOKING_CANCEL_ACTION)) return null

  const parsed = parseBookingCancelChatCommand(message, now)
  if (parsed.kind === 'none') return null

  if (parsed.kind === 'approve') {
    const found = await activeIntent(db, userId, conversationId, parsed.shortCode)
    if (found.error) return { handled: true, reply: 'Je ne peux pas vérifier l’action à valider pour le moment.' }
    if (!found.intent) return { handled: true, reply: 'Je n’ai aucune annulation active à valider dans cette conversation.' }
    if (!parsed.shortCode && found.count !== 1) {
      return { handled: true, reply: 'J’ai plusieurs actions en attente. Donne-moi le code exact, par exemple « GO #A1B2C3 ».' }
    }

    if (found.intent.status === 'preview') {
      const approved = await handleLumiaBookingCancelApi({
        db, userId,
        input: { op: 'approve', conversation_id: conversationId, intent_id: found.intent.id },
      })
      if (approved.status !== 200) {
        return { handled: true, reply: 'Je n’ai pas pu valider cette annulation. Le rendez-vous n’a pas été modifié.' }
      }
    }

    const executed = await handleLumiaBookingCancelApi({
      db, userId,
      input: { op: 'execute', conversation_id: conversationId, intent_id: found.intent.id },
    })
    const body = executed.body || {}
    if (executed.status !== 200 || body.status !== 'succeeded') {
      const reason = body.reason || body.error || 'refus_de_securite'
      return { handled: true, reply: `Annulation non exécutée (${reason}). Le rendez-vous reste inchangé.` }
    }

    const google = body.google_sync
    const suffix = google === 'done'
      ? ' L’événement Google associé a également été supprimé.'
      : google === 'not_required'
        ? ''
        : ' Le rendez-vous MediumIA est annulé ; la synchronisation Google reste en attente et sera retentée automatiquement.'

    return { handled: true, reply: `C’est fait. Le rendez-vous MediumIA a été annulé une seule fois.${suffix}` }
  }

  if (parsed.hour == null && !parsed.date && !parsed.weekday) {
    return { handled: true, reply: 'Précise-moi au moins le jour ou l’heure du rendez-vous à annuler.' }
  }

  const candidates = await findCandidates(db, userId, parsed, now)
  if (candidates.error) return { handled: true, reply: 'Je ne peux pas vérifier les rendez-vous pour le moment. Aucune action n’a été créée.' }
  if (!candidates.rows.length) {
    return { handled: true, reply: 'Je n’ai trouvé aucun rendez-vous MediumIA confirmé correspondant. Je n’ai rien modifié.' }
  }
  if (candidates.rows.length > 1) {
    const choices = candidates.rows.slice(0, 5).map((booking) => {
      const { client, when } = formatBooking(booking)
      return `- ${client} — ${when}`
    }).join('\n')
    return { handled: true, reply: `J’ai trouvé plusieurs rendez-vous possibles. Je ne touche à rien tant que tu ne précises pas lequel :\n${choices}` }
  }

  const booking = candidates.rows[0]
  const previewResult = await handleLumiaBookingCancelApi({
    db, userId,
    input: {
      op: 'preview',
      conversation_id: conversationId,
      booking_id: booking.id,
      practitioner_id: booking.practitioner_id,
    },
  })
  if (previewResult.status !== 201) {
    return { handled: true, reply: 'Je n’ai pas pu préparer l’annulation. Le rendez-vous n’a pas été modifié.' }
  }

  const action = previewResult.body || {}
  const preview = action.preview || {}
  const { client, when } = formatBooking({ ...booking, ...preview })
  const service = preview.prestation || booking.service?.title || 'Rendez-vous'
  const google = preview.effects?.google_projection === 'cancel_projection_pending'
    ? 'La projection Google sera supprimée après validation.'
    : 'Aucune projection Google n’est liée à ce rendez-vous.'

  return {
    handled: true,
    reply: [
      'Annulation prête — rien n’a encore été modifié.',
      `Client : ${client}`,
      `Rendez-vous : ${when}`,
      `Prestation : ${service}`,
      'Aucun remboursement automatique ne sera effectué.',
      google,
      `Pour confirmer, réponds : GO ${action.short_code}`,
    ].join('\n'),
  }
}
