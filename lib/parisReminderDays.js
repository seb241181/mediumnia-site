// Jours calendaires à Paris pour les rappels de rendez-vous.
// « J-3 » = le rendez-vous a lieu le troisième jour (date locale Europe/Paris)
// après le jour du passage de la tâche quotidienne, quelle que soit l'heure.
import { parisUTCOffsetMs } from './googleOAuth.js'

export function parisDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(date))
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Instant UTC du début (minuit) d'une date locale à Paris.
export function parisDayStart(dateStr) {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + parisUTCOffsetMs(dateStr))
}

// Rappel J-3 : [début de J+2, début de J+4[ en heure de Paris — J+3 est le jour
// visé, J+2 sert de rattrapage si l'envoi de la veille a échoué.
export function reminderWindow(now = new Date()) {
  const today = parisDate(now)
  return {
    targetDay: addDays(today, 3),
    catchUpDay: addDays(today, 2),
    from: parisDayStart(addDays(today, 2)),
    to: parisDayStart(addDays(today, 4)),
  }
}

// Rappel de solde : il doit pouvoir partir dès le matin de J-3, même à plus de
// 72 h du rendez-vous → jusqu'à la fin du jour J+3 à Paris (et jamais moins de 72 h).
export function balanceSweepUpperBound(now = new Date()) {
  const endOfTarget = parisDayStart(addDays(parisDate(now), 4))
  return new Date(Math.max(endOfTarget.getTime(), now.getTime() + 72 * 3_600_000))
}
