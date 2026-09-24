/**
 * Demande d'avis Google après une consultation — étape de la tâche quotidienne
 * (api/rdv-balance-cron → handleRdvBalanceDailyCron).
 *
 * Chaque rendez-vous confirmé terminé depuis 12 h à 4 jours reçoit une seule
 * demande : la ligne est réservée (review_request_sent_at) avant l'envoi. Tous
 * les clients reçoivent la même demande (pas de tri des clients satisfaits) et
 * rien n'est offert en échange d'un avis. Aucune donnée personnelle n'est loguée.
 */
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { googleReviewProfile } from './googleReviews.js'

const MIN_DELAY_MS = 12 * 3_600_000
const MAX_DELAY_MS = 4 * 24 * 3_600_000

function missingColumn(error) {
  return error && (error.code === '42703' || /review_request_sent_at/.test(error.message || ''))
}

export function buildReviewRequestEmail({ firstName, serviceTitle, startsAt, timezone, writeUrl }) {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone || 'Europe/Paris' }).format(new Date(startsAt))
  const name = String(firstName || '').trim()
  const hello = name ? `Bonjour ${name},` : 'Bonjour,'
  const session = serviceTitle ? `votre séance « ${serviceTitle} » du ${date}` : `votre séance du ${date}`
  const subject = 'Merci pour votre confiance'
  const text = `${hello}

Merci pour ${session}.

Si cette rencontre vous a apporté quelque chose, votre avis sur Google aide énormément d’autres personnes à trouver un accompagnement en confiance. Cela prend une minute :
${writeUrl}

Vous pouvez aussi partager votre expérience sur https://mediumia.fr/avis

Merci du fond du cœur,
Sébastien · MediumIA

Vous ne recevrez pas d’autre message à ce sujet.`
  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fffdf8"><tr><td style="padding:34px 32px;color:#4a4356;font-size:16px;line-height:1.65">
<p style="margin:0 0 6px;color:#b98a2e;font-size:12px;letter-spacing:2px">MEDIUMIA</p>
<p>${escapeHtml(hello)}</p>
<p>Merci pour ${escapeHtml(session)}.</p>
<p>Si cette rencontre vous a apporté quelque chose, votre avis sur Google aide énormément d’autres personnes à trouver un accompagnement en confiance. Cela prend une minute.</p>
<p style="text-align:center;margin:28px 0"><a href="${escapeHtml(writeUrl)}" style="display:inline-block;background:#1a1535;color:#e4c77a;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Laisser un avis sur Google</a></p>
<p style="font-size:14px">Vous pouvez aussi partager votre expérience sur <a href="https://mediumia.fr/avis" style="color:#b98a2e">mediumia.fr/avis</a>.</p>
<p>Merci du fond du cœur,<br><strong>Sébastien · MediumIA</strong></p>
<p style="margin-top:26px;font-size:12px;color:#8a8294">Vous ne recevrez pas d’autre message à ce sujet.</p>
</td></tr></table></td></tr></table></body></html>`
  return { subject, html, text }
}

export async function sendReviewRequests(supabase, now = new Date()) {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_email, starts_at, ends_at, timezone')
    .eq('status', 'confirmed')
    .is('review_request_sent_at', null)
    .lte('ends_at', new Date(now.getTime() - MIN_DELAY_MS).toISOString())
    .gte('ends_at', new Date(now.getTime() - MAX_DELAY_MS).toISOString())
    .limit(200)
  if (missingColumn(error)) return { skipped: 'migration_pending', sent: 0 }
  if (error) throw new Error('review_request_lookup_failed')
  if (!bookings?.length) return { sent: 0 }

  const practitionerIds = [...new Set(bookings.map(b => b.practitioner_id))]
  const serviceIds = [...new Set(bookings.map(b => b.service_id).filter(Boolean))]
  const [{ data: practitioners }, { data: services }] = await Promise.all([
    supabase.from('booking_practitioners').select('id, slug').in('id', practitionerIds),
    serviceIds.length ? supabase.from('booking_services').select('id, title').in('id', serviceIds) : Promise.resolve({ data: [] }),
  ])
  const slugById = new Map((practitioners || []).map(p => [p.id, p.slug]))
  const titleById = new Map((services || []).map(s => [s.id, s.title]))

  let sent = 0
  let failed = 0
  for (const booking of bookings) {
    const profile = googleReviewProfile(slugById.get(booking.practitioner_id))
    if (!profile || !booking.customer_email) continue

    // Reserve the booking first: a request is never sent twice.
    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ review_request_sent_at: now.toISOString() })
      .eq('id', booking.id)
      .is('review_request_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) continue

    const message = buildReviewRequestEmail({
      firstName: booking.customer_first_name,
      serviceTitle: titleById.get(booking.service_id),
      startsAt: booking.starts_at,
      timezone: booking.timezone,
      writeUrl: profile.writeUrl,
    })
    const result = await sendEmail({ to: booking.customer_email, ...message, idempotencyKey: `rdv-review-request/${booking.id}` })
    if (result.status === 'sent') sent += 1
    else failed += 1
  }
  return { sent, failed }
}
