/* global process */
/**
 * SMS de rappel J-1 — architecture prête, AUCUN prestataire branché.
 *
 * Tant qu'aucun prestataire n'est configuré (variable SMS_PROVIDER absente, ou
 * prestataire non implémenté ci-dessous), l'étape ne lit rien, ne marque rien
 * et n'envoie rien. Brancher un prestataire = ajouter son adaptateur dans
 * SMS_PROVIDERS et définir ses clés dans Vercel (jamais dans le code).
 *
 * Un seul SMS par rendez-vous : la ligne est réservée
 * (appointment_sms_reminder_sent_at, distincte du rappel e-mail J-3) avant
 * l'envoi. Aucun numéro ni message n'est logué.
 */

// Adaptateurs de prestataires : { name: async ({ to, text, env }) => ({ status }) }.
// Vide volontairement : aucun prestataire n'est branché pour l'instant.
export const SMS_PROVIDERS = {}

export function smsProvider(env = process.env) {
  const name = String(env.SMS_PROVIDER || '').trim().toLowerCase()
  return name && SMS_PROVIDERS[name] ? { name, send: SMS_PROVIDERS[name] } : null
}

// Numéro français (06 12 34 56 78, +33 6…, 0033 6…) → +33612345678.
// Mobiles uniquement (06 / 07) : un SMS vers un fixe n'arriverait pas.
export function normalizeFrenchMobile(phone) {
  let digits = String(phone || '').replace(/[\s.\-()]/g, '')
  if (digits.startsWith('+33')) digits = `0${digits.slice(3)}`
  else if (digits.startsWith('0033')) digits = `0${digits.slice(4)}`
  if (!/^0[67]\d{8}$/.test(digits)) return null
  return `+33${digits.slice(1)}`
}

function parisDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date)
}

// Prénom en ASCII (Éléa → Elea, Maëlys → Maelys) : un seul caractère accentué
// ferait passer le SMS en Unicode (70 caractères par segment au lieu de 160).
export function asciiFirstName(firstName) {
  const first = String(firstName || '').trim().split(/\s+/)[0] || ''
  return first
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Ææ]/g, 'ae').replace(/[Œœ]/g, 'oe').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z'-]/g, '')
    .slice(0, 30)
}

// Court, sans lien ni caractère spécial coûteux : tient en un seul SMS.
export function buildAppointmentSms({ firstName, startsAt, timezone = 'Europe/Paris' }) {
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone || 'Europe/Paris' })
    .format(new Date(startsAt)).replace(':', 'h')
  const name = asciiFirstName(firstName)
  return `Bonjour${name ? ` ${name}` : ''}, petit rappel de votre rendez-vous MediumIA demain a ${time} avec Sebastien. A bientot.`
}

export async function sendAppointmentSmsReminders(supabase, { now = new Date(), env = process.env } = {}) {
  const provider = smsProvider(env)
  if (!provider) return { skipped: 'provider_not_configured', sent: 0 }

  const tomorrow = parisDay(new Date(now.getTime() + 86_400_000))
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_first_name, customer_phone, starts_at, timezone')
    .eq('status', 'confirmed')
    .eq('booking_source', 'mediumia')
    .is('appointment_sms_reminder_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + 48 * 3_600_000).toISOString())
    .limit(200)
  if (error) return { skipped: 'lookup_failed', sent: 0 }

  let sent = 0
  let failed = 0
  let noMobile = 0
  for (const booking of bookings || []) {
    if (parisDay(new Date(booking.starts_at)) !== tomorrow) continue
    const to = normalizeFrenchMobile(booking.customer_phone)
    if (!to) { noMobile += 1; continue }

    const { data: claimed, error: claimError } = await supabase
      .from('bookings')
      .update({ appointment_sms_reminder_sent_at: now.toISOString() })
      .eq('id', booking.id)
      .is('appointment_sms_reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) continue

    const result = await provider.send({ to, text: buildAppointmentSms(booking), env }).catch(() => ({ status: 'error' }))
    if (result?.status === 'sent') sent += 1
    else {
      failed += 1
      await supabase.from('bookings').update({ appointment_sms_reminder_sent_at: null }).eq('id', booking.id)
    }
  }
  return { sent, failed, noMobile }
}
