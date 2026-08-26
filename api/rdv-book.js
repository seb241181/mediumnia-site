/**
 * POST /api/rdv-book
 *
 * Crée une réservation après validation serveur exhaustive.
 * Ne retourne 201 QUE si l'INSERT dans bookings a réussi côté base.
 *
 * Body JSON :
 *   practitioner_slug  string        slug du praticien
 *   service_slug       string        slug du service
 *   date               "YYYY-MM-DD"  date locale (Paris)
 *   time               "HH:MM"       heure de début locale (Paris)
 *   customer           { firstName, lastName, email, phone?, message? }
 *
 * Flux serveur (dans l'ordre) :
 *   1.  Validation des champs
 *   2.  Chargement praticien (is_active, booking_enabled, horizon, buffers, advance)
 *   3.  Vérification is_active
 *   4.  Vérification booking_enabled
 *   5.  Chargement service (duration_min)
 *   6.  Calcul UTC des bornes du créneau
 *   7.  Vérification min_advance_hours
 *   8.  Vérification booking_horizon_days
 *   9.  Chargement exception du jour → refus si closed
 *   10. Chargement règles de disponibilité → vérification que le créneau
 *       tient ENTIÈREMENT dans une plage autorisée (exception.slots ou règles hebdo)
 *       Un POST à 03h00 ou hors plage est refusé ici, même par curl.
 *   11. Google FreeBusy — FAIL CLOSED : si la connexion Google existe et que
 *       FreeBusy échoue (token, réseau, timeout), la réservation est refusée.
 *       On ne crée jamais un RDV potentiellement en conflit avec l'agenda Google.
 *   12. INSERT atomique via RPC create_booking
 *       (pg_advisory_xact_lock + buffer + max_per_day en base)
 *   13. Retour { booking_id, starts_at, ends_at, practitioner, service }
 */
import { decrypt, refreshGoogleToken, encrypt, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { escapeHtml, sendEmail } from '../lib/transactionalEmail.js'
import { syncBookingToGoogleCalendar } from '../lib/googleCalendarEvents.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE  = /^\d{2}:\d{2}$/

function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [h, m] = timeStr.split(':').map(Number)
  const parisMidnightUTC = new Date(dateStr + 'T00:00:00Z').getTime() + offsetMs
  return new Date(parisMidnightUTC + h * 3600_000 + m * 60_000)
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildClientEmailHtml(firstName, svcTitle) {
  const BASE = 'font-family:Georgia,serif;color:#1A1535;'
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Votre demande MediumIA</title></head>
<body style="margin:0;padding:0;background:#FAFAF7;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;${BASE}">
  <p style="font-size:20px;font-weight:700;margin:0 0 32px;letter-spacing:0.12em;color:#C9A84C;">✦ MEDIUMIA</p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 16px;">Bonjour ${firstName},</p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 16px;">
    Votre demande pour <strong>« ${svcTitle} »</strong> a bien été reçue.
  </p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 16px;">
    Sébastien va prendre connaissance de votre demande et vous recontactera afin de convenir avec vous de la date et de l'heure de l'intervention.
  </p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 16px;">
    Le tarif de base de la prestation est celui indiqué lors de votre demande. Si des frais de déplacement sont nécessaires, le montant total vous sera confirmé avant la validation définitive du rendez-vous.
  </p>
  <p style="font-size:15px;line-height:1.75;margin:0 0 32px;">
    Vous n'avez rien d'autre à faire pour le moment.
  </p>
  <p style="font-size:15px;line-height:1.75;margin:0;">À bientôt,<br><strong>Sébastien</strong><br>MediumIA</p>
</div>
</body></html>`
}

function buildClientEmailText(firstName, svcTitle) {
  return `Bonjour ${firstName},

Votre demande pour « ${svcTitle} » a bien été reçue.

Sébastien va prendre connaissance de votre demande et vous recontactera afin de convenir avec vous de la date et de l'heure de l'intervention.

Le tarif de base de la prestation est celui indiqué lors de votre demande. Si des frais de déplacement sont nécessaires, le montant total vous sera confirmé avant la validation définitive du rendez-vous.

Vous n'avez rien d'autre à faire pour le moment.

À bientôt,
Sébastien
MediumIA`
}

function buildPractitionerEmailHtml({ firstName, lastName, emailDisplay, phoneDisplay, addr1, addr2, cpDisplay, cityDisplay, periodDisplay, msgDisplay, svcTitle, requestId }) {
  const row = (label, value) =>
    `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#4A3F6B;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:#1A1535;">${value}</td></tr>`

  const addrLines = addr2
    ? `${addr1}<br>${addr2}<br>${cpDisplay} ${cityDisplay}`
    : `${addr1}<br>${cpDisplay} ${cityDisplay}`

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nouvelle demande MediumIA</title></head>
<body style="margin:0;padding:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
  <p style="font-size:20px;font-weight:700;margin:0 0 8px;letter-spacing:0.12em;color:#C9A84C;">✦ MEDIUMIA</p>
  <h1 style="font-size:18px;font-weight:600;margin:0 0 28px;color:#1A1535;">Nouvelle demande reçue</h1>
  <table style="border-collapse:collapse;width:100%;">
    ${row('Client', `${firstName} ${lastName}`)}
    ${row('Téléphone', phoneDisplay)}
    ${row('Email', emailDisplay)}
    ${row('Lieu', addrLines)}
    ${row('Prestation', `<strong>${svcTitle}</strong>`)}
    ${row('Préférence', periodDisplay)}
    ${row('Message', msgDisplay.replace(/\n/g, '<br>'))}
    ${row('Identifiant', `<span style="font-size:12px;font-family:monospace;">${escapeHtml(requestId)}</span>`)}
  </table>
</div>
</body></html>`
}

function buildPractitionerEmailText({ firstName, lastName, email, phone, addr1, addr2, postalCode, city, period, msg, svcTitle, requestId }) {
  const addrLines = [addr1, addr2, `${postalCode} ${city}`].filter(Boolean).join('\n')
  return `Nouvelle demande reçue

Client :
${firstName} ${lastName}

Téléphone :
${phone}

Email :
${email}

Lieu :
${addrLines}

Prestation :
${svcTitle}

Préférence :
${period}

Message :
${msg}

Identifiant demande :
${requestId}`
}

// ── handleBookingRequest ──────────────────────────────────────────────────────

async function handleBookingRequest(req, res, supabase, practitioner, service, customer) {
  const { phone, address_line1, address_line2, postal_code, city, preferred_period, message } = customer
  if (!phone?.trim()) return res.status(400).json({ error: 'Téléphone requis pour cette prestation' })
  if (!address_line1?.trim()) return res.status(400).json({ error: 'Adresse requise pour cette prestation en présentiel' })
  if (!postal_code?.trim()) return res.status(400).json({ error: 'Code postal requis' })
  if (!city?.trim()) return res.status(400).json({ error: 'Ville requise' })

  // ── 1. INSERT booking_request ─────────────────────────────────────────────

  const { data, error } = await supabase.from('booking_requests').insert({
    practitioner_id:     practitioner.id,
    service_id:          service.id,
    customer_first_name: customer.firstName.trim(),
    customer_last_name:  customer.lastName.trim(),
    customer_email:      customer.email.trim().toLowerCase(),
    customer_phone:      phone.trim(),
    address_line1:       address_line1.trim(),
    address_line2:       address_line2?.trim() || null,
    postal_code:         postal_code.trim(),
    city:                city.trim(),
    customer_message:    message?.trim() || null,
    preferred_period:    preferred_period?.trim() || null,
    status:              'pending',
  }).select('id').single()

  if (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ error: 'Table booking_requests non créée — appliquez la migration docs/rdv-requests-migration.sql.' })
    }
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la demande." })
  }

  const requestId = data.id

  // ── 2. Emails transactionnels (après INSERT réussi) ───────────────────────
  // Une panne Resend ne doit jamais masquer le succès de l'enregistrement.

  try {
    // Adresse du praticien : variable d'env en priorité, sinon google_email
    let practitionerTo = process.env.BOOKING_NOTIFICATION_EMAIL || null
    if (!practitionerTo) {
      const { data: conn } = await supabase
        .from('booking_calendar_connections')
        .select('google_email')
        .eq('practitioner_id', practitioner.id)
        .eq('is_active', true)
        .maybeSingle()
      practitionerTo = conn?.google_email || null
    }
    if (!practitionerTo) {
      console.warn(`[rdv-book] Aucune adresse praticien pour la demande ${requestId} — email praticien ignoré.`)
    }

    // Données échappées pour le HTML
    const firstName    = escapeHtml(customer.firstName.trim())
    const lastName     = escapeHtml(customer.lastName.trim())
    const emailDisplay = escapeHtml(customer.email.trim().toLowerCase())
    const phoneDisplay = escapeHtml(phone.trim())
    const addr1        = escapeHtml(address_line1.trim())
    const addr2        = address_line2?.trim() ? escapeHtml(address_line2.trim()) : null
    const cpDisplay    = escapeHtml(postal_code.trim())
    const cityDisplay  = escapeHtml(city.trim())
    const periodDisplay = preferred_period?.trim() ? escapeHtml(preferred_period.trim()) : 'Non précisée'
    const msgDisplay   = message?.trim() ? escapeHtml(message.trim()) : 'Aucun message'
    const svcTitle     = escapeHtml(service.title)

    const emailTasks = [
      sendEmail({
        to:             customer.email.trim().toLowerCase(),
        subject:        'MediumIA — Votre demande a bien été reçue',
        html:           buildClientEmailHtml(firstName, svcTitle),
        text:           buildClientEmailText(customer.firstName.trim(), service.title),
        idempotencyKey: `booking-request-client/${requestId}`,
      }),
    ]

    if (practitionerTo) {
      emailTasks.push(sendEmail({
        to:             practitionerTo,
        subject:        `Nouvelle demande MediumIA — ${service.title}`,
        html:           buildPractitionerEmailHtml({ firstName, lastName, emailDisplay, phoneDisplay, addr1, addr2, cpDisplay, cityDisplay, periodDisplay, msgDisplay, svcTitle, requestId }),
        text:           buildPractitionerEmailText({ firstName: customer.firstName.trim(), lastName: customer.lastName.trim(), email: customer.email.trim().toLowerCase(), phone: phone.trim(), addr1: address_line1.trim(), addr2: address_line2?.trim() || null, postalCode: postal_code.trim(), city: city.trim(), period: preferred_period?.trim() || 'Non précisée', msg: message?.trim() || 'Aucun message', svcTitle: service.title, requestId }),
        idempotencyKey: `booking-request-practitioner/${requestId}`,
      }))
    }

    const results = await Promise.allSettled(emailTasks)
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(`[rdv-book] Email rejeté (inattendu) pour la demande ${requestId}:`, r.reason)
      } else if (r.value?.status === 'error') {
        console.error(`[rdv-book] Échec email pour la demande ${requestId}:`, r.value.httpStatus ?? r.value.message)
      }
    }
  } catch (emailErr) {
    console.error(`[rdv-book] Exception bloc emails pour la demande ${requestId}:`, emailErr?.message)
  }

  return res.status(202).json({ request_id: requestId })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  // ── 1. Validation des champs ──────────────────────────────────────────────

  const { practitioner_slug, service_slug, date, time, customer } = req.body || {}

  if (!practitioner_slug || !service_slug || !customer) {
    return res.status(400).json({ error: 'Champs requis : practitioner_slug, service_slug, customer' })
  }
  if (!customer.firstName?.trim()) return res.status(400).json({ error: 'customer.firstName requis' })
  if (!customer.lastName?.trim())  return res.status(400).json({ error: 'customer.lastName requis' })
  if (!EMAIL_RE.test(customer.email?.trim())) return res.status(400).json({ error: 'customer.email invalide' })

  const supabase = getSupabaseAdmin()

  // ── 2. Praticien ──────────────────────────────────────────────────────────

  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id, name, timezone, is_active, booking_enabled, booking_horizon_days, min_advance_hours, buffer_before_min, buffer_after_min, max_per_day')
    .eq('slug', practitioner_slug)
    .single()

  if (practErr || !practitioner) {
    return res.status(404).json({ error: 'Praticien introuvable' })
  }

  // ── 3. is_active ──────────────────────────────────────────────────────────
  // Obligatoire pour tous les modes — un profil inactif ne reçoit rien.

  if (!practitioner.is_active) {
    return res.status(409).json({ error: 'Ce profil praticien n\'est pas actif.' })
  }

  // ── 4. Service ────────────────────────────────────────────────────────────
  // Chargé avant booking_enabled : le mode (instant/request) détermine
  // si booking_enabled est pertinent.

  const { data: service, error: svcErr } = await supabase
    .from('booking_services')
    .select('id, title, duration_min, booking_mode')
    .eq('slug', service_slug)
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (svcErr || !service) {
    return res.status(404).json({ error: 'Service introuvable ou inactif' })
  }

  // ── 4b. Mode "request" : formulaire de demande (booking_enabled ignoré) ──
  // Les demandes sur site ne dépendent pas du calendrier en ligne.
  if (service.booking_mode === 'request') {
    return handleBookingRequest(req, res, supabase, practitioner, service, customer)
  }

  // ── 4c. booking_enabled — réservations instantanées uniquement ───────────

  if (!practitioner.booking_enabled) {
    return res.status(409).json({ error: 'Les réservations sont actuellement fermées pour ce praticien.' })
  }

  // ── 4d. Mode "instant" : valider date/time ────────────────────────────────
  if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: 'date invalide (YYYY-MM-DD)' })
  if (!time || !TIME_RE.test(time)) return res.status(400).json({ error: 'time invalide (HH:MM)' })

  // ── 6. Calcul des bornes UTC ──────────────────────────────────────────────

  const offsetMs   = parisUTCOffsetMs(date)
  const startsAtUTC = parisTimeToUTC(date, time, offsetMs)
  const endsAtUTC   = new Date(startsAtUTC.getTime() + service.duration_min * 60_000)

  // ── 7. min_advance_hours ──────────────────────────────────────────────────

  const minAdvanceMs = (practitioner.min_advance_hours ?? 0) * 3600_000
  if (startsAtUTC.getTime() < Date.now() + minAdvanceMs) {
    const h = practitioner.min_advance_hours ?? 0
    return res.status(409).json({
      error: `Ce créneau est trop proche. Réservation minimum ${h}h à l'avance.`,
    })
  }

  // ── 8. booking_horizon_days ───────────────────────────────────────────────

  if (practitioner.booking_horizon_days) {
    const maxDate = new Date()
    maxDate.setDate(maxDate.getDate() + practitioner.booking_horizon_days)
    if (startsAtUTC > maxDate) {
      return res.status(409).json({
        error: `Ce créneau dépasse l'horizon de réservation (${practitioner.booking_horizon_days} jours).`,
      })
    }
  }

  // ── 9. Exception du jour ──────────────────────────────────────────────────

  const { data: exception } = await supabase
    .from('booking_exceptions')
    .select('exception_type, slots')
    .eq('practitioner_id', practitioner.id)
    .eq('exception_date', date)
    .maybeSingle()

  if (exception?.exception_type === 'closed') {
    return res.status(409).json({ error: 'Le praticien n\'est pas disponible ce jour (fermeture exceptionnelle).' })
  }

  // ── 10. Validation que le créneau tient dans les plages autorisées ─────────
  // On lit les règles effectives du jour (exception.slots si modified, sinon DB).
  // Le créneau doit tenir ENTIÈREMENT dans une seule plage — pas de fractionnement.
  // Cela empêche tout POST manuel hors horaires, même sans passer par l'UI.

  let effectiveRules
  if (exception?.exception_type === 'modified' && exception.slots?.length) {
    effectiveRules = exception.slots
  } else {
    const jsDay = new Date(date + 'T12:00:00Z').getDay() // 0=Dim en JS
    const dbDay = (jsDay + 6) % 7                        // 0=Lun en base

    const { data: dbRules, error: rulesErr } = await supabase
      .from('booking_availability_rules')
      .select('start_time, end_time')
      .eq('practitioner_id', practitioner.id)
      .eq('day_of_week', dbDay)
      .order('start_time')

    if (rulesErr || !dbRules?.length) {
      return res.status(409).json({ error: 'Aucune disponibilité configurée pour ce jour.' })
    }
    effectiveRules = dbRules
  }

  const fitsInRule = effectiveRules.some(rule => {
    const ruleStart = parisTimeToUTC(date, rule.start_time, offsetMs)
    const ruleEnd   = parisTimeToUTC(date, rule.end_time,   offsetMs)
    return startsAtUTC >= ruleStart && endsAtUTC <= ruleEnd
  })

  if (!fitsInRule) {
    return res.status(409).json({ error: 'Ce créneau ne correspond pas aux horaires de disponibilité.' })
  }

  // ── 11. Google FreeBusy — FAIL CLOSED ─────────────────────────────────────
  // Une connexion Google active EST OBLIGATOIRE pour confirmer une réservation.
  // Cohérence avec rdv-config et rdv-availability : si Google n'est pas connecté,
  // aucun créneau n'est affiché → aucune réservation ne doit pouvoir aboutir.
  // Toute erreur (token, réseau, timeout, refresh) → refus. Jamais de fallback silencieux.

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
    return res.status(503).json({
      error: 'Réservations temporairement indisponibles — Google Agenda n\'est pas connecté.',
    })
  }

  {
    let accessToken
    try {
      const expiry = new Date(conn.token_expiry).getTime()
      if (Date.now() > expiry - 60_000) {
        const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
        accessToken = refreshed.access_token
        await supabase.from('booking_calendar_connections').update({
          access_token_enc: encrypt(accessToken),
          token_expiry: refreshed.expires_at,
          updated_at: new Date().toISOString(),
        }).eq('practitioner_id', practitioner.id)
      } else {
        accessToken = decrypt(conn.access_token_enc)
      }
    } catch {
      return res.status(503).json({
        error: 'Impossible de confirmer la disponibilité Google pour le moment. Réessayez dans quelques instants.',
      })
    }

    // Fenêtre de vérification = créneau + buffers des deux côtés
    const bufferBeforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
    const bufferAfterMs  = (practitioner.buffer_after_min  ?? 0) * 60_000
    const checkStart = new Date(startsAtUTC.getTime() - bufferBeforeMs).toISOString()
    const checkEnd   = new Date(endsAtUTC.getTime()   + bufferAfterMs).toISOString()

    let freeBusyData
    try {
      const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: checkStart,
          timeMax: checkEnd,
          timeZone: 'Europe/Paris',
          items: [{ id: conn.google_calendar_id || 'primary' }],
        }),
      })

      if (!freeBusyRes.ok) {
        return res.status(503).json({
          error: 'Impossible de confirmer la disponibilité Google pour le moment. Réessayez dans quelques instants.',
        })
      }
      freeBusyData = await freeBusyRes.json()
    } catch {
      return res.status(503).json({
        error: 'Impossible de confirmer la disponibilité Google pour le moment. Réessayez dans quelques instants.',
      })
    }

    const calKey = conn.google_calendar_id || 'primary'
    const busy   = freeBusyData.calendars?.[calKey]?.busy ?? []
    if (busy.length > 0) {
      return res.status(409).json({ error: 'Ce créneau est déjà occupé dans votre Google Agenda.' })
    }
  }

  // ── 12. INSERT atomique via RPC (anti-double-booking, buffers, max_per_day) ─
  // La fonction create_booking utilise pg_advisory_xact_lock(hashtext(practitioner_id))
  // et vérifie buffers + max_per_day côté base sous le même verrou.

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_booking', {
    p_practitioner_id:      practitioner.id,
    p_service_id:           service.id,
    p_starts_at:            startsAtUTC.toISOString(),
    p_ends_at:              endsAtUTC.toISOString(),
    p_customer_first_name:  customer.firstName.trim(),
    p_customer_last_name:   customer.lastName.trim(),
    p_customer_email:       customer.email.trim().toLowerCase(),
    p_customer_phone:       customer.phone?.trim() || null,
    p_customer_message:     customer.message?.trim() || null,
    p_timezone:             practitioner.timezone || 'Europe/Paris',
  })

  if (rpcErr) {
    if (rpcErr.code === 'PGRST202') {
      return res.status(503).json({
        error: 'La fonction create_booking n\'existe pas encore — appliquez la migration docs/rdv-migration-v2.sql.',
      })
    }
    return res.status(500).json({ error: 'Erreur lors de la création de la réservation.', code: rpcErr.code })
  }

  if (!rpcResult || rpcResult.conflict) {
    return res.status(409).json({ error: rpcResult?.error || 'Ce créneau vient d\'être réservé. Choisissez un autre horaire.' })
  }

  // ── 13. Succès — INSERT confirmé ──────────────────────────────────────────

  // Sync Google Calendar (fail open — ne bloque pas la réponse 201)
  const instantBookingId = rpcResult.booking_id
  const googleSync = await syncBookingToGoogleCalendar({
    supabase,
    practitionerId:       practitioner.id,
    bookingId:            instantBookingId,
    currentGoogleEventId: null,
    event: {
      title:       `${service.title} — ${customer.firstName.trim()} ${customer.lastName.trim()}`,
      startsAt:    startsAtUTC.toISOString(),
      endsAt:      endsAtUTC.toISOString(),
      timezone:    practitioner.timezone || 'Europe/Paris',
      description: [
        'MediumIA Rendez-vous', '',
        `Client : ${customer.firstName.trim()} ${customer.lastName.trim()}`,
        `Téléphone : ${customer.phone?.trim() || 'Non renseigné'}`,
        `Email : ${customer.email.trim()}`,
        `Prestation : ${service.title}`,
        `Identifiant MediumIA : ${instantBookingId}`,
      ].join('\n'),
    },
  })

  const gStatus = (googleSync.status === 'synced' || googleSync.status === 'already_synced')
    ? 'synced' : googleSync.status

  return res.status(201).json({
    booking_id:      instantBookingId,
    starts_at:       startsAtUTC.toISOString(),
    ends_at:         endsAtUTC.toISOString(),
    practitioner:    practitioner.name,
    service:         service.title,
    google_sync:     gStatus,
    google_event_id: googleSync.google_event_id,
  })
}
