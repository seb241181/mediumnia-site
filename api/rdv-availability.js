/**
 * MediumIA Rendez-vous — disponibilités d'un praticien.
 *
 * Paramètres attendus (query string) :
 *   practitioner_id  UUID du praticien dans booking_practitioners
 *   service_id       UUID de la prestation
 *   date             YYYY-MM-DD
 *
 * Retourne les créneaux disponibles après calcul :
 *   - règles hebdomadaires du praticien
 *   - durée + tampon de la prestation
 *   - événements Google Agenda existants
 *   - réservations MediumIA existantes
 *
 * Variables d'environnement requises (côté serveur Vercel) :
 *   GOOGLE_CLIENT_ID           OAuth 2.0 client Google
 *   GOOGLE_CLIENT_SECRET       Secret OAuth
 *   SUPABASE_URL               URL Supabase (service role)
 *   SUPABASE_SERVICE_ROLE_KEY  Clé service role pour lecture des tokens chiffrés
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const missing = []
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')

  if (missing.length > 0) {
    return res.status(503).json({
      error: 'Google Calendar integration not configured',
      missing_env_vars: missing,
      message:
        'Configurez ces variables dans Vercel (Settings → Environment Variables) pour activer les disponibilités réelles.',
    })
  }

  // TODO: implémenter le moteur de disponibilités réel
  // 1. Charger les règles hebdomadaires depuis booking_availability_rules
  // 2. Récupérer le token Google chiffré depuis booking_calendar_connections
  // 3. Appeler Google Calendar API pour lire les événements du jour
  // 4. Charger les réservations MediumIA existantes depuis bookings
  // 5. Calculer les créneaux libres (durée prestation + tampon)
  // 6. Valider le délai minimum de réservation
  // 7. Retourner { slots: [{ time: "HH:MM", available: true }] }

  return res.status(501).json({ error: 'Not implemented — see TODO in this file.' })
}
