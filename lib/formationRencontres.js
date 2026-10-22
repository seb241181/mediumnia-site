/**
 * Rencontres pédagogiques en visio incluses dans la Formation complète (sans réseau ni base).
 *
 * Éligibilité : le total payé pour la formation, net des remboursements, atteint
 * 597 € TTC (achat en une fois, solde « Tout débloquer » ou dernière échéance du
 * parcours au mois). La rencontre doit commencer avant la fin des 12 mois d'accès
 * ouverts par le paiement qui a complété la formation. Cette règle n'est branchée
 * sur aucune réservation : les réservations ne sont pas ouvertes.
 */
import { summarize, CAP_CENTS } from './formationProgression.js'

export const RENCONTRES_BOOKING_OPEN = false

// Heure de Paris : +01:00 en hiver, +02:00 à partir du 28 mars 2027.
export const RENCONTRES_CYCLE_1 = [
  { id: '2027-01-16', label: 'Samedi 16 janvier 2027', theme: 'Premiers apprentissages', startsAt: '2027-01-16T10:00:00+01:00', endsAt: '2027-01-16T12:00:00+01:00' },
  { id: '2027-02-13', label: 'Samedi 13 février 2027', theme: 'Perceptions et discernement', startsAt: '2027-02-13T10:00:00+01:00', endsAt: '2027-02-13T12:00:00+01:00' },
  { id: '2027-03-13', label: 'Samedi 13 mars 2027', theme: 'Pratique et techniques', startsAt: '2027-03-13T10:00:00+01:00', endsAt: '2027-03-13T12:00:00+01:00' },
  { id: '2027-04-10', label: 'Samedi 10 avril 2027', theme: 'Approfondissement', startsAt: '2027-04-10T10:00:00+02:00', endsAt: '2027-04-10T12:00:00+02:00' },
  { id: '2027-05-22', label: 'Samedi 22 mai 2027', theme: 'Intégration et autonomie', startsAt: '2027-05-22T10:00:00+02:00', endsAt: '2027-05-22T12:00:00+02:00' },
]

// payments : même format que formationProgression.summarize().
export function rencontreEligibility(payments, rencontre) {
  const summary = summarize(payments)
  if (summary.paidCents < CAP_CENTS) {
    return { eligible: false, reason: 'formation_incomplete', remainingCents: CAP_CENTS - summary.paidCents, accessUntil: null }
  }
  const accessUntil = summary.coachUntil
  if (!accessUntil) return { eligible: false, reason: 'access_unknown', remainingCents: 0, accessUntil: null }
  if (new Date(rencontre.startsAt) > new Date(accessUntil)) {
    return { eligible: false, reason: 'access_expired', remainingCents: 0, accessUntil }
  }
  return { eligible: true, reason: 'formation_complete', remainingCents: 0, accessUntil }
}
