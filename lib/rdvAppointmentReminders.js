/**
 * Rappel de rendez-vous par e-mail à J-3 — étape de la tâche quotidienne
 * (api/rdv-balance-cron → handleRdvBalanceDailyCron, chaque matin).
 *
 * Un seul e-mail par rendez-vous, le matin du jour J-3 (date locale à Paris,
 * quelle que soit l'heure du rendez-vous ; J-2 en rattrapage si l'envoi a échoué) :
 * - visio avec un solde à régler : c'est le rappel de solde existant
 *   (rdvBalanceCronHandler / buildRdvBalanceReminder : montant, lien de
 *   règlement, échéance H-48) qui fait office de rappel ; on n'en envoie pas
 *   un second ici ;
 * - visio réglée : rappel + lien Meet ;
 * - présentiel, et anciens rendez-vous sans montants enregistrés : rappel simple.
 * La ligne est réservée (appointment_reminder_sent_at) avant l'envoi : jamais
 * deux rappels. Aucune donnée personnelle n'est loguée.
 */
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { parisDate, reminderWindow } from './parisReminderDays.js'

// Un rendez-vous réservé il y a moins de 6 h vient de recevoir sa confirmation.
const FRESH_BOOKING_MS = 6 * 3_600_000

function missingColumn(error) {
  return error && (error.code === '42703' || /appointment_reminder_sent_at/.test(error.message || ''))
}

// Même règle que le rappel de solde (rdvBalanceCronHandler.loadSweepCandidates) :
// ces visios reçoivent l'e-mail de solde, qui sert de rappel J-3.
export function handledByBalanceReminder({ booking, service, paidCents }) {
  const dueCents = Math.max(0, Number(booking.booked_price_cents || 0) - Number(paidCents || 0))
  return Boolean(service?.modality?.includes('video')
    && Number(booking.reservation_payment_cents || 0) > 0
    && Number(paidCents || 0) > 0
    && dueCents > 0
    && !booking.balance_paid_at)
}

function formatWhen(startsAt, timezone) {
  const zone = timezone || 'Europe/Paris'
  const start = new Date(startsAt)
  return {
    day: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(start),
    time: new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(start).replace(':', ' h '),
  }
}

export function buildAppointmentReminderEmail({ firstName, serviceTitle, startsAt, timezone = 'Europe/Paris', meetLink = null }) {
  const when = formatWhen(startsAt, timezone)
  const name = String(firstName || '').trim()
  const hello = name ? `Bonjour ${name},` : 'Bonjour,'
  const service = String(serviceTitle || 'Votre séance').trim()
  const subject = `Rappel : votre rendez-vous du ${when.day} à ${when.time}`

  const text = [
    hello,
    '',
    `Petit rappel : vous avez rendez-vous avec Sébastien le ${when.day} à ${when.time}.`,
    '',
    service,
    `Date : ${when.day}`,
    `Heure : ${when.time}`,
    ...(meetLink ? [`Lien de visioconférence : ${meetLink}`] : []),
    '',
    'Un empêchement ? Merci de prévenir Sébastien au plus vite.',
    '',
    'À très bientôt,',
    'Sébastien · MediumIA',
  ].join('\n')

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:580px;margin:0 auto;padding:40px 24px;">
  <p style="font-size:20px;font-weight:700;letter-spacing:.12em;color:#C9A84C;margin:0 0 26px;">✦ MEDIUMIA</p>
  <h1 style="font-size:24px;margin:0 0 18px;">Votre rendez-vous approche</h1>
  <p style="font-size:15px;line-height:1.7;">${escapeHtml(hello)}</p>
  <p style="font-size:15px;line-height:1.7;">Petit rappel : vous avez rendez-vous avec Sébastien le <strong>${escapeHtml(when.day)} à ${escapeHtml(when.time)}</strong>.</p>
  <div style="background:#F0EDE8;border-radius:12px;padding:20px 24px;margin:22px 0;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:bold;">${escapeHtml(service)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Date :</strong> ${escapeHtml(when.day)}</p>
    <p style="margin:4px 0;font-size:14px;color:#4A3F6B;"><strong>Heure :</strong> ${escapeHtml(when.time)}</p>
  </div>
  ${meetLink ? `<p style="margin:22px 0;"><a href="${escapeHtml(meetLink)}" style="display:inline-block;background:#1A1535;color:#C9A84C;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:bold;">Rejoindre la visioconférence</a></p>` : ''}
  <p style="font-size:14px;line-height:1.7;color:#4A3F6B;">Un empêchement ? Merci de prévenir Sébastien au plus vite.</p>
  <p style="font-size:15px;line-height:1.7;">À très bientôt,<br><strong>Sébastien · MediumIA</strong></p>
</div></body></html>`
  return { subject, html, text }
}

export async function sendAppointmentReminders(supabase, now = new Date()) {
  const days = reminderWindow(now)
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, service_id, customer_first_name, customer_email, starts_at, timezone, google_meet_link, created_at, booked_price_cents, reservation_payment_cents, balance_paid_at, balance_reminder_sent_at, balance_reminder_claimed_at')
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .is('appointment_reminder_sent_at', null)
    .gte('starts_at', days.from.toISOString())
    .lt('starts_at', days.to.toISOString())
    .limit(200)
  if (missingColumn(error)) return { skipped: 'migration_pending', sent: 0 }
  if (error) throw new Error('appointment_reminder_lookup_failed')
  const candidates = (bookings || []).filter((b) => b.customer_email
    && [days.targetDay, days.catchUpDay].includes(parisDate(b.starts_at))
    && (!b.created_at || new Date(b.created_at).getTime() <= now.getTime() - FRESH_BOOKING_MS))
  if (!candidates.length) return { sent: 0 }

  const serviceIds = [...new Set(candidates.map((b) => b.service_id).filter(Boolean))]
  const [{ data: services }, { data: entries }] = await Promise.all([
    serviceIds.length ? supabase.from('booking_services').select('id, title, modality').in('id', serviceIds) : Promise.resolve({ data: [] }),
    supabase.from('rdv_financial_entries').select('booking_id, direction, gross_cents').eq('source', 'mediumia').in('booking_id', candidates.map((b) => b.id)),
  ])
  const serviceById = new Map((services || []).map((s) => [s.id, s]))
  const paidById = new Map()
  for (const entry of entries || []) {
    const delta = entry.direction === 'refund' ? -Number(entry.gross_cents || 0) : Number(entry.gross_cents || 0)
    paidById.set(entry.booking_id, (paidById.get(entry.booking_id) || 0) + delta)
  }

  let sent = 0
  let failed = 0
  let balance = 0
  let uncertain = 0
  for (const booking of candidates) {
    const service = serviceById.get(booking.service_id)
    // Un rappel de solde déjà envoyé (ou dont l'envoi est en cours / incertain)
    // fait office de rappel J-3, même si le client a payé depuis.
    if (booking.balance_reminder_sent_at || booking.balance_reminder_claimed_at
      || handledByBalanceReminder({ booking, service, paidCents: paidById.get(booking.id) || 0 })) {
      balance += 1
      continue
    }

    // Réservation de la ligne d'abord : un rappel n'est jamais envoyé deux fois.
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ appointment_reminder_sent_at: now.toISOString() })
      .eq('id', booking.id)
      .is('appointment_reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) continue

    const isVideo = Boolean(service?.modality?.includes('video'))
    const message = buildAppointmentReminderEmail({
      firstName: booking.customer_first_name,
      serviceTitle: service?.title,
      startsAt: booking.starts_at,
      timezone: booking.timezone,
      meetLink: isVideo ? booking.google_meet_link || null : null,
    })
    const result = await sendEmail({ to: booking.customer_email, ...message, idempotencyKey: `rdv-appointment-reminder/${booking.id}` })
    if (result.status === 'sent') sent += 1
    else if (result.uncertain) {
      // Réponse ambiguë : l'e-mail a pu partir. On garde la marque : jamais de
      // second rappel.
      uncertain += 1
    } else {
      failed += 1
      // Échec certain : on libère la ligne pour réessayer au prochain passage.
      await supabase.from('bookings').update({ appointment_reminder_sent_at: null }).eq('id', booking.id)
    }
  }
  return { sent, failed, balance, ...(uncertain ? { uncertain } : {}) }
}
