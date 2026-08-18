/**
 * MediumIA Rendez-vous — création d'une réservation.
 *
 * Body attendu (JSON) :
 *   practitioner_id     UUID du praticien
 *   service_id          UUID de la prestation
 *   starts_at           ISO 8601 (date + heure + timezone)
 *   timezone            ex. "Europe/Paris"
 *   customer_first_name string
 *   customer_last_name  string
 *   customer_email      string
 *   customer_phone      string | null
 *   customer_message    string | null
 *
 * Flux côté serveur :
 *   1. Valider tous les champs requis
 *   2. Calculer ends_at = starts_at + durée prestation
 *   3. Re-vérifier la disponibilité côté serveur (anti-double-booking)
 *   4. Insérer dans booking_bookings avec status = 'confirmed'
 *   5. Créer l'événement dans Google Agenda du praticien
 *   6. Envoyer email de confirmation au client et au praticien
 *   7. Retourner { booking_id, google_event_id }
 *
 * Variables d'environnement requises :
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EMAIL_FROM              ex. "MediumIA <rdv@mediumia.com>"
 *   EMAIL_API_KEY           Clé Resend (ou autre provider)
 *
 * Sécurité avant Production :
 *   - Rate limiting par IP (Upstash Redis ou Vercel KV)
 *   - Honeypot anti-spam dans le formulaire
 *   - Validation stricte de l'email client (format + MX lookup)
 *   - RGPD : consentement explicite + durée de conservation dans la réponse
 *   - Les tokens OAuth Google doivent être chiffrés au repos (AES-256)
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const missing = []
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM')
  if (!process.env.EMAIL_API_KEY) missing.push('EMAIL_API_KEY')

  if (missing.length > 0) {
    return res.status(503).json({
      error: 'Booking API not configured',
      missing_env_vars: missing,
      message:
        'Configurez ces variables dans Vercel pour activer la création de réservations.',
    })
  }

  // TODO: implémenter la création de réservation réelle
  return res.status(501).json({ error: 'Not implemented — see TODO in this file.' })
}
