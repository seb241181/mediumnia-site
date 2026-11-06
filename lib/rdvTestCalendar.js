/* global process */
// Agenda fictif réservé aux essais (TEST) : un praticien dont la connexion porte cet
// identifiant n'appelle jamais Google (aucune lecture, aucune écriture d'événement).
// Double garde : ignoré en Production, et cet identifiant n'existe pas dans la base de
// Production.
export const TEST_FAKE_CALENDAR_ID = 'mediumia-test-agenda-fictif'

export function isTestFakeCalendar(connection, env = process.env) {
  return env.VERCEL_ENV !== 'production' && connection?.google_calendar_id === TEST_FAKE_CALENDAR_ID
}
