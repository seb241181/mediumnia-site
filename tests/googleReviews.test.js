import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.RESEND_API_KEY = ''
const { buildReviewRequestEmail, sendReviewRequests } = await import('../lib/rdvReviewRequests.js')
const { mapPlace } = await import('../lib/googlePlaceReviews.js')
const { googleReviewProfile } = await import('../lib/googleReviews.js')

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the review request is honest, personal and points to the Google review form', () => {
  const email = buildReviewRequestEmail({ firstName: 'Marie', serviceTitle: 'Guidance', startsAt: '2026-09-23T08:00:00Z', timezone: 'Europe/Paris', writeUrl: googleReviewProfile('sebastien-seguin').writeUrl })
  assert.match(email.text, /Bonjour Marie,/)
  assert.match(email.text, /« Guidance » du mercredi 23 septembre/)
  assert.match(email.text, /https:\/\/g\.page\/r\/CbFv2pHpBKtYEBM\/review/)
  assert.match(email.text, /Vous ne recevrez pas d’autre message à ce sujet\./)
  // No incentive, no filtering of happy customers.
  assert.doesNotMatch(email.text, /réduction|offert|cadeau|satisfait/i)
  const xss = buildReviewRequestEmail({ firstName: '<b>x</b>', serviceTitle: 'A', startsAt: '2026-09-23T08:00:00Z', writeUrl: 'https://g.page/r/x/review' })
  assert.doesNotMatch(xss.html, /<b>x<\/b>/)
})

function fakeSupabase({ bookings, missingColumn = false }) {
  const updates = []
  const table = (name) => {
    const q = { filters: [], _update: null }
    const api = {
      select() { return api }, eq(k, v) { q.filters.push([k, v]); return api }, is() { return api }, lte() { return api }, gte() { return api }, limit() { return api }, in() { return api },
      update(values) { q._update = values; return api },
      maybeSingle() {
        const id = q.filters.find(([k]) => k === 'id')?.[1]
        updates.push({ id, ...q._update })
        return Promise.resolve({ data: { id }, error: null })
      },
      then(resolve) {
        if (name === 'bookings') return resolve(missingColumn ? { data: null, error: { code: '42703', message: 'column review_request_sent_at does not exist' } } : { data: bookings, error: null })
        if (name === 'booking_practitioners') return resolve({ data: [{ id: 'p1', slug: 'sebastien-seguin' }, { id: 'p2', slug: 'autre-praticien' }], error: null })
        return resolve({ data: [{ id: 's1', title: 'Guidance' }], error: null })
      },
    }
    return api
  }
  return { from: table, updates }
}

test('each finished appointment is claimed once, only for practitioners with a Google profile', async () => {
  const supabase = fakeSupabase({ bookings: [
    { id: 'b1', practitioner_id: 'p1', service_id: 's1', customer_first_name: 'Marie', customer_email: 'marie@exemple.fr', starts_at: '2026-09-23T08:00:00Z', ends_at: '2026-09-23T09:00:00Z' },
    { id: 'b2', practitioner_id: 'p2', service_id: 's1', customer_first_name: 'Paul', customer_email: 'paul@exemple.fr', starts_at: '2026-09-23T08:00:00Z', ends_at: '2026-09-23T09:00:00Z' },
    { id: 'b3', practitioner_id: 'p1', service_id: 's1', customer_first_name: 'Sans', customer_email: '', starts_at: '2026-09-23T08:00:00Z', ends_at: '2026-09-23T09:00:00Z' },
  ] })
  const result = await sendReviewRequests(supabase, new Date('2026-09-24T07:00:00Z'))
  assert.deepEqual(supabase.updates.map((u) => u.id), ['b1'])
  assert.equal(result.failed, 1, 'Resend not configured in tests: counted as not sent')
})

test('the daily job skips quietly until the migration is applied', async () => {
  assert.deepEqual(await sendReviewRequests(fakeSupabase({ bookings: [], missingColumn: true })), { skipped: 'migration_pending', sent: 0 })
  assert.match(read('lib/rdvBalanceCronHandler.js'), /reviews = await sendReviewRequests\(supabase\)/)
  const sql = read('supabase/migrations/20260924100000_rdv_review_requests.sql')
  assert.match(sql, /add column if not exists review_request_sent_at timestamptz/)
})

test('Google reviews keep author attribution and never expose more than 5', () => {
  const place = mapPlace({
    rating: 4.9, userRatingCount: 37, googleMapsUri: 'https://maps.google.com/?cid=1',
    reviews: Array.from({ length: 8 }, (_, i) => ({ rating: 5, text: { text: `Avis ${i}` }, relativePublishTimeDescription: 'il y a 1 mois', authorAttribution: { displayName: `Auteur ${i}`, uri: 'https://www.google.com/maps/contrib/1' } })),
  })
  assert.equal(place.reviews.length, 5)
  assert.equal(place.reviews[0].author, 'Auteur 0')
  assert.equal(place.count, 37)
  assert.equal(place.writeUrl, 'https://g.page/r/CbFv2pHpBKtYEBM/review')
  const page = read('src/components/ReviewsPage.jsx')
  assert.match(page, /Avis Google/)
  assert.match(page, /Laisser un avis sur Google/)
  assert.match(read('lib/customerReviews.js'), /action === 'google'/)
})
