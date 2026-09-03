import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extractGoogleMeetLink, googleMeetRequestId } from '../lib/googleCalendarEvents.js'
import { buildPaidRdvConfirmation } from '../lib/rdvConfirmationEmail.js'

const root = new URL('..', import.meta.url)

test('Google Meet uses a deterministic request ID and accepts both link formats', () => {
  assert.equal(googleMeetRequestId('11111111-1111-4111-8111-111111111111'), 'mediumia-11111111111141118111111111111111')
  assert.equal(extractGoogleMeetLink({ hangoutLink: 'https://meet.google.com/a-b-c' }), 'https://meet.google.com/a-b-c')
  assert.equal(extractGoogleMeetLink({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/d-e-f' }] } }), 'https://meet.google.com/d-e-f')
})

test('paid confirmation shows the payment and never asks the client to pay within 48 hours', () => {
  const withMeet = buildPaidRdvConfirmation({ firstName: 'Marie', serviceTitle: 'Consultation', startsAt: '2026-09-15T12:00:00Z', durationMin: 60, timezone: 'Europe/Paris', amountCents: 9000, meetLink: 'https://meet.google.com/a-b-c', cancelUrl: 'https://mediumia.fr/rdv/annuler#token=test' })
  assert.match(withMeet.html, /Règlement reçu :<\/strong> 90,00 EUR/)
  assert.match(withMeet.html, /Rejoindre la visioconférence/)
  assert.doesNotMatch(withMeet.text, /48 h avant/)
  const withoutMeet = buildPaidRdvConfirmation({ firstName: 'Marie', serviceTitle: 'Consultation', startsAt: '2026-09-15T12:00:00Z', durationMin: 60, timezone: 'Europe/Paris', amountCents: 9000, meetLink: null, cancelUrl: 'https://mediumia.fr/rdv/annuler#token=test' })
  assert.match(withoutMeet.text, /lien de visioconférence est en cours de préparation/)
})

test('checkout UI and backend preserve the isolated sandbox flow', async () => {
  const [ui, api, google, rdvBook, vercel] = await Promise.all([
    readFile(new URL('src/components/rdv/RdvPublic.jsx', root), 'utf8'),
    readFile(new URL('lib/rdvPayPalApiHandler.js', root), 'utf8'),
    readFile(new URL('lib/googleCalendarEvents.js', root), 'utf8'),
    readFile(new URL('api/rdv-book.js', root), 'utf8'),
    readFile(new URL('vercel.json', root), 'utf8'),
  ])
  assert.match(ui, /crypto\.randomUUID\(\)/)
  assert.match(ui, /sessionStorage\.setItem/)
  assert.doesNotMatch(ui, /sessionStorage\.setItem\([^\n]+firstName/)
  assert.match(ui, /selected_modality: 'video'/)
  assert.doesNotMatch(ui, /client_checkout_id:[\s\S]{0,240}(price|amount|currency)/)
  assert.match(api, /finalizePaidBooking/)
  assert.match(api, /createConference: true/)
  assert.match(api, /confirmation_sent_at/)
  assert.match(google, /conferenceDataVersion=1/)
  assert.match(google, /conferenceSolutionKey: \{ type: 'hangoutsMeet' \}/)
  assert.match(rdvBook, /req\.query\?\.rdv_paypal === '1'/)
  assert.match(rdvBook, /handleRdvPayPalApi/)
  assert.match(vercel, /"source": "\/api\/rdv-paypal"/)
  assert.match(vercel, /"destination": "\/api\/rdv-book\?rdv_paypal=1"/)
})
