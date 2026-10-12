/* global process */
// Alertes internes au propriétaire avant toute annulation automatique d'une
// visio dont le solde est impayé (issue #147). Une alerte par rendez-vous et
// par type, réservée en base avant l'envoi : jamais de doublon, même si le
// cron est relancé. Un envoi incertain n'est jamais renvoyé (on garde la
// réservation) ; seul un échec certain est retenté, au plus une fois par heure.
// Tant qu'aucune alerte « pre_cancel » n'est enregistrée comme envoyée, la base
// refuse l'annulation automatique (rdv_balance_cancel_blocker).
import { sendEmail } from './transactionalEmail.js'
import { buildRdvBalanceOwnerAlert } from './rdvBalanceEmail.js'

export function ownerAlertRecipient(env = process.env) {
  const value = String(env.RDV_BALANCE_ALERT_EMAIL || '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

export async function sendOwnerBalanceAlert({
  supabase,
  item,
  kind,
  reason,
  now = new Date(),
  send = sendEmail,
  env = process.env,
}) {
  const recipient = ownerAlertRecipient(env)
  if (!recipient) return { status: 'not_configured' }
  const { booking, service, dueCents } = item

  const { data: claimed, error: claimError } = await supabase.rpc('claim_rdv_balance_owner_alert', {
    p_booking_id: booking.id,
    p_kind: kind,
    p_reason: reason,
    p_now: now.toISOString(),
  })
  if (claimError) return { status: 'claim_failed' }
  if (!claimed) return { status: 'already_handled' }

  const deadlineAt = new Date(new Date(booking.starts_at).getTime() - 48 * 3_600_000)
  const message = buildRdvBalanceOwnerAlert({
    customerName: `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Client',
    serviceTitle: service?.title || 'Visio',
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
    dueCents,
    deadlineAt,
    reminderSentAt: booking.balance_reminder_sent_at,
    reason,
  })

  let sent
  try {
    sent = await send({ to: recipient, ...message, idempotencyKey: `rdv-balance-owner-alert/${booking.id}/${kind}` })
  } catch {
    sent = { status: 'error', uncertain: true }
  }
  if (sent.status !== 'sent' && sent.uncertain) return { status: 'uncertain' }

  const status = sent.status === 'sent' ? 'sent' : 'failed'
  await supabase.rpc('finalize_rdv_balance_owner_alert', {
    p_booking_id: booking.id,
    p_kind: kind,
    p_status: status,
    p_email_id: sent.id || null,
    p_now: new Date().toISOString(),
  })
  return { status }
}
