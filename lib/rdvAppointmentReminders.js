/**
 * Rappel de rendez-vous par e-mail — étape de la tâche quotidienne
 * (api/rdv-balance-cron → handleRdvBalanceDailyCron, chaque matin).
 *
 * Un seul rappel par rendez-vous confirmé MediumIA, la veille (ou le matin
 * même si le rendez-vous est pris tard), indépendant du paiement : il sert
 * aussi aux anciens rendez-vous sans arrhes. La ligne est réservée
 * (appointment_reminder_sent_at) avant l'envoi : jamais deux rappels.
 * Aucune donnée personnelle n'est loguée.
 */
import { escapeHtml, sendEmail } from './transactionalEmail.js'

// La tâche passe vers 9 h (Paris) : tout rendez-vous des ~40 prochaines heures
// (demain, et aujourd'hui s'il n'a pas encore eu de rappel) est concerné.
const WINDOW_MS = 40 * 3_600_000
// Un rendez-vous réservé il y a moins de 6 h vient de recevoir sa confirmation.
const FRESH_BOOKING_MS = 6 * 3_600_000

function missingColumn(error) {
  return error && (error.code === '42703' || /appointment_reminder_sent_at/.test(error.message || ''))
}

function parisDay(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Europe/Paris' }).format(date)
}

export function reminderDayLabel(startsAt, now, timezone = 'Europe/Paris') {
  const day = parisDay(new Date(startsAt), timezone)
  if (day === parisDay(now, timezone)) return 'aujourd’hui'
  if (day === parisDay(new Date(now.getTime() + 86_400_000), timezone)) return 'demain'
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone || 'Europe/Paris' }).format(new Date(startsAt))
}

export function buildAppointmentReminderEmail({ firstName, serviceTitle, startsAt, timezone = 'Europe/Paris', meetLink = null, now = new Date() }) {
  const zone = timezone || 'Europe/Paris'
  const start = new Date(startsAt)
  const dayLabel = reminderDayLabel(start, now, zone)
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(start).replace(':', ' h ')
  const fullDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(start)
  const name = String(firstName || '').trim()
  const hello = name ? `Bonjour ${name},` : 'Bonjour,'
  const service = String(serviceTitle || 'Votre séance').trim()
  const subject = `Rappel : votre rendez-vous ${dayLabel} à ${time}`

  const text = [
    hello,
    '',
    `Petit rappel : vous avez rendez-vous avec Sébastien ${dayLabel} à ${time}.`,
    '',
    `${service}`,
    `Date : ${fullDate}`,
    `Heure : ${time}`,
    ...(meetLink ? [`Lien de visioconférence : ${meetLink}`] : []),
    '',
    'Un empêchement ? Merci de prévenir Sébastien au plus vite.',
    '',
    'À très bientôt,',
    'Sébastien · MediumIA',
    '',
    'Vous ne recevrez qu’un seul rappel pour ce rendez-vous.',
  ].join('\n')

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:580px;margin:0 auto;padding:40px 24px;">
  <p style="font-size:20px;font-weight:700;letter-spacing:.12em;color:#C9A84C;margin:0 0 26px;">✦ MEDIUMIA</p>
  <h1 style="font-size:24px;margin:0 0 18px;">Votre rendez-vous ${escapeHtml(dayLabel)}</h1>
  <p style="font-size:15px;line-height:1.7;">${escapeHtml(hello)}</p>
  <p style="font-size:15px;line-height:1.7;">Petit rappel : vous avez rendez-vous avec Sébastien <strong>${escapeHtml(dayLabel)} à ${escapeHtml(time)}</strong>.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:bold;">${escapeHtml(service)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Date :</strong> ${escapeHtml(fullDate)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(time)}</p>
  </div>
  ${meetLink ? `<p style="margin:22px 0;"><a href="${escapeHtml(meetLink)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;">Rejoindre la visioconférence</a></p>` : ''}
  <p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Un empêchement ? Merci de prévenir Sébastien au plus vite.</p>
  <p style="font-size:15px;line-height:1.7;">À très bientôt,<br><strong>Sébastien · MediumIA</strong></p>
  <p style="margin-top:26px;font-size:12px;color:#8a8294;">Vous ne recevrez qu’un seul rappel pour ce rendez-vous.</p>
</div></body></html>`
  return { subject, html, text }
}

export async function sendAppointmentReminders(supabase, now = new Date()) {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, service_id, customer_first_name, customer_email, starts_at, timezone, google_meet_link, created_at')
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .is('appointment_reminder_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + WINDOW_MS).toISOString())
    .limit(200)
  if (missingColumn(error)) return { skipped: 'migration_pending', sent: 0 }
  if (error) throw new Error('appointment_reminder_lookup_failed')
  const due = (bookings || []).filter((b) => b.customer_email
    && (!b.created_at || new Date(b.created_at).getTime() <= now.getTime() - FRESH_BOOKING_MS))
  if (!due.length) return { sent: 0 }

  const serviceIds = [...new Set(due.map((b) => b.service_id).filter(Boolean))]
  const { data: services } = serviceIds.length
    ? await supabase.from('booking_services').select('id, title').in('id', serviceIds)
    : { data: [] }
  const titleById = new Map((services || []).map((s) => [s.id, s.title]))

  let sent = 0
  let failed = 0
  for (const booking of due) {
    // Réservation de la ligne d'abord : un rappel n'est jamais envoyé deux fois.
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ appointment_reminder_sent_at: now.toISOString() })
      .eq('id', booking.id)
      .is('appointment_reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) continue

    const message = buildAppointmentReminderEmail({
      firstName: booking.customer_first_name,
      serviceTitle: titleById.get(booking.service_id),
      startsAt: booking.starts_at,
      timezone: booking.timezone,
      meetLink: booking.google_meet_link || null,
      now,
    })
    const result = await sendEmail({ to: booking.customer_email, ...message, idempotencyKey: `rdv-appointment-reminder/${booking.id}` })
    if (result.status === 'sent') sent += 1
    else {
      failed += 1
      // Échec d'envoi : on libère la ligne pour réessayer au prochain passage.
      await supabase.from('bookings').update({ appointment_reminder_sent_at: null }).eq('id', booking.id)
    }
  }
  return { sent, failed }
}
