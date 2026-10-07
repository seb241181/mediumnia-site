import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('home consultation block makes Sebastian appointments concrete', () => {
  const section = read('src/components/ConsultationSection.jsx')
  assert.match(section, /Mes consultations · agenda ouvert/)
  assert.match(section, /Je vous reçois en consultation/)
  assert.match(section, /Guidance/)
  assert.match(section, />70 €</)
  assert.match(section, /Désenvoûtement/)
  assert.match(section, />80 €</)
  assert.match(section, /Voir mes disponibilités/)
  assert.match(section, /home-consultations/)
})

test('appointment funnel keeps anonymous source attribution', () => {
  const page = read('src/components/rdv/RdvPublic.jsx')
  const analytics = read('lib/mediumiaAnalytics.js')
  assert.match(page, /rdv_view/)
  assert.match(page, /rdv_booking_started/)
  assert.match(page, /rdv_booking_completed/)
  assert.match(page, /rdv_request_sent/)
  assert.match(page, /home-hero/)
  assert.match(page, /home-consultations/)
  assert.match(page, /home-interview/)
  assert.match(analytics, /RDV_SOURCE_RE/)
  assert.match(analytics, /rdv_booking_completed/)
})

test('pilotage shows the appointment conversion funnel', () => {
  const pilotage = read('src/components/rdv/PilotageDashboard.jsx')
  assert.match(pilotage, /RENDEZ-VOUS/)
  assert.match(pilotage, /De la visite à la réservation/)
  assert.match(pilotage, /Réservation confirmée/)
  assert.match(pilotage, /rdvCompleted/)
})
