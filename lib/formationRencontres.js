/**
 * Rencontres pédagogiques en visio incluses dans la Formation complète (sans réseau ni base).
 *
 * Droits : l'élève a un accès complet actif (25 modules), qu'il vienne d'un achat en une
 * fois, du solde après la Découverte ou de la fin du parcours au mois ; la Découverte
 * seule n'y donne pas droit. Les droits durent 18 mois à partir de l'ouverture de cet
 * accès, indépendamment des 12 mois d'accès à l'application, et couvrent au minimum le
 * premier cycle pour les élèves déjà inscrits.
 */

export const RENCONTRES_RIGHTS_MONTHS = 18
export const RENCONTRES_CANCEL_HOURS = 24
export const RENCONTRES_INITIAL_CAPACITY = 5

// Heure de Paris : +01:00 en hiver, +02:00 à partir du 28 mars 2027.
export const RENCONTRES_CYCLE_1 = [
  { id: '2027-01-16', themeKey: 'premiers-apprentissages', label: 'Samedi 16 janvier 2027', theme: 'Premiers apprentissages', startsAt: '2027-01-16T10:00:00+01:00', endsAt: '2027-01-16T12:00:00+01:00' },
  { id: '2027-02-13', themeKey: 'perceptions-discernement', label: 'Samedi 13 février 2027', theme: 'Perceptions et discernement', startsAt: '2027-02-13T10:00:00+01:00', endsAt: '2027-02-13T12:00:00+01:00' },
  { id: '2027-03-13', themeKey: 'pratique-techniques', label: 'Samedi 13 mars 2027', theme: 'Pratique et techniques', startsAt: '2027-03-13T10:00:00+01:00', endsAt: '2027-03-13T12:00:00+01:00' },
  { id: '2027-04-10', themeKey: 'approfondissement', label: 'Samedi 10 avril 2027', theme: 'Approfondissement', startsAt: '2027-04-10T10:00:00+02:00', endsAt: '2027-04-10T12:00:00+02:00' },
  { id: '2027-05-22', themeKey: 'integration-autonomie', label: 'Samedi 22 mai 2027', theme: 'Intégration et autonomie', startsAt: '2027-05-22T10:00:00+02:00', endsAt: '2027-05-22T12:00:00+02:00' },
]

const FIRST_CYCLE_END = RENCONTRES_CYCLE_1[RENCONTRES_CYCLE_1.length - 1].endsAt

function addMonths(date, months) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

const isCompleteAccess = (e) => e?.status === 'active' && e.access_level === 'full' && Number(e.max_module) >= 25 && e.type !== 'trial' && e.access_started_at
// Accès ouverts par un paiement PayPal Sandbox (origin_ref « paypal:sandbox:… », « parcours:sandbox:… »).
const isSandboxAccess = (e) => /:sandbox(:|$)/i.test(String(e?.origin_ref || ''))

// entitlements : lignes de mediumia_entitlements de l'élève. En live (Production), les
// accès Sandbox ne donnent aucun droit ; en TEST (sandbox), ils servent aux essais.
export function rencontreRights(entitlements = [], { env = 'live' } = {}) {
  const starts = entitlements
    .filter(isCompleteAccess)
    .filter((e) => env !== 'live' || !isSandboxAccess(e))
    .map((e) => new Date(e.access_started_at))
    .filter((d) => !Number.isNaN(d.getTime()))
  if (!starts.length) return { eligible: false, reason: 'formation_incomplete', from: null, until: null }
  const from = new Date(Math.min(...starts))
  const until = new Date(Math.max(addMonths(from, RENCONTRES_RIGHTS_MONTHS).getTime(), new Date(FIRST_CYCLE_END).getTime()))
  return { eligible: true, reason: null, from: from.toISOString(), until: until.toISOString() }
}

// Ce que l'élève peut faire pour une rencontre (même logique que formation_rencontre_book).
export function rencontreAvailability({ rights, rencontre, bookedCount, myBooking, themeUsed, now = new Date() }) {
  const starts = new Date(rencontre.starts_at)
  if (myBooking?.status === 'booked') {
    const canCancel = starts.getTime() - now.getTime() >= RENCONTRES_CANCEL_HOURS * 3_600_000
    return { state: 'booked', canCancel }
  }
  if (rencontre.status !== 'scheduled') return { state: 'cancelled' }
  if (starts <= now) return { state: 'past' }
  if (!rights?.eligible) return { state: 'not_eligible' }
  if (starts < new Date(rights.from) || starts > new Date(rights.until)) return { state: 'outside_rights' }
  if (themeUsed) return { state: 'theme_used' }
  if (!rencontre.bookings_open) return { state: 'closed' }
  if (bookedCount >= rencontre.capacity) return { state: 'full' }
  return { state: 'open', placesLeft: rencontre.capacity - bookedCount }
}
