import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
const {
  mapBusinessReviews, fetchBusinessReviews, originalComment, signBusinessState, verifyBusinessState,
  startConnect, completeConnect, disconnect, connectionStatus, handleGoogleBusinessAction, missingBusinessEnv,
  BUSINESS_SCOPE, MAX_PAGES,
} = await import('../lib/googleBusinessProfile.js')
const { handleGoogleReviews, mapPlace } = await import('../lib/googlePlaceReviews.js')
const { encrypt } = await import('../lib/googleOAuth.js')
const { findPossibleDuplicates, textOverlap } = await import('../src/lib/reviewDuplicates.js')
const { sortGoogleReviews, googleReviewDate, isFormationReview, SITE_OFFERINGS } = await import('../src/lib/googleReviewsDisplay.js')

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const ENV = {
  GOOGLE_BUSINESS_CLIENT_ID: 'business-client',
  GOOGLE_BUSINESS_CLIENT_SECRET: 'business-secret',
  GOOGLE_BUSINESS_REDIRECT_URI: 'https://mediumia-pr156.vercel.app/api/google-business/callback',
  CALENDAR_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  // Valeurs de l'agenda, qui ne doivent JAMAIS être utilisées ici.
  GOOGLE_CLIENT_ID: 'calendar-client',
  GOOGLE_CLIENT_SECRET: 'calendar-secret',
  GOOGLE_REDIRECT_URI: 'https://example.invalid/api/google-calendar/callback',
}

function fakeDb(initial = null) {
  const store = { row: initial ? { id: 1, ...initial } : null, writes: [] }
  const db = {
    store,
    from(table) {
      assert.equal(table, 'google_business_connection', 'only the dedicated table is touched')
      const q = { patch: null }
      const api = {
        select() { return api },
        eq() { return q.patch ? Promise.resolve(apply()) : api },
        maybeSingle() { return Promise.resolve({ data: store.row ? { ...store.row } : null, error: null }) },
        update(patch) { q.patch = patch; return api },
        upsert(row) { store.row = { ...(store.row || {}), ...row }; store.writes.push(row); return Promise.resolve({ error: null }) },
      }
      function apply() {
        if (store.row) store.row = { ...store.row, ...q.patch }
        store.writes.push(q.patch)
        return { error: null }
      }
      return api
    },
  }
  return db
}

const review = (id, created, updated = created, extra = {}) => ({
  name: `accounts/1/locations/2/reviews/${id}`, reviewId: id,
  reviewer: { displayName: `Auteur ${id}`, profilePhotoUrl: `https://lh3.googleusercontent.com/${id}` },
  starRating: 'FIVE', comment: `Texte de l'avis ${id}`, createTime: created, updateTime: updated, ...extra,
})

// ── Tri : date de publication, pas de modification ───────────────────────────

test('Business Profile reviews are ordered by publication date, not by edit date', () => {
  const pages = [{
    averageRating: 4.9, totalReviewCount: 82,
    // Ordre renvoyé par Google : updateTime desc. « old » a été modifié hier.
    reviews: [
      review('old', '2025-03-01T10:00:00Z', '2026-11-20T09:00:00Z'),
      review('delphine', '2026-11-20T08:00:00Z'),
      review('mid', '2026-10-10T08:00:00Z'),
    ],
  }]
  const out = mapBusinessReviews(pages)
  assert.equal(out.source, 'business_profile')
  assert.deepEqual(out.reviews.map((r) => r.author), ['Auteur delphine', 'Auteur mid', 'Auteur old'])
  assert.equal(out.reviews[2].updatedAt, '2026-11-20T09:00:00.000Z', 'the edit is disclosed')
  assert.equal(out.reviews[0].updatedAt, null)
  assert.equal(out.count, 82)
  assert.equal(out.rating, 4.9)
  assert.equal(googleReviewDate(out.reviews[2]), '1 mars 2025 · modifié le 20 novembre 2026')
})

test('reviews keep the author’s own words and attribution; anonymous and empty reviews are handled', () => {
  const out = mapBusinessReviews([{ reviews: [
    review('a', '2026-11-01T00:00:00Z', undefined, { reviewer: { isAnonymous: true, displayName: 'X' } }),
    review('b', '2026-11-02T00:00:00Z', undefined, { comment: '' }),
    review('c', '2026-11-03T00:00:00Z', undefined, { comment: 'Great session (Translated by Google)\n\n(Original)\nSéance magnifique, merci.' }),
    review('c', '2026-11-03T00:00:00Z'),
    review('d', '2026-11-04T00:00:00Z', undefined, { starRating: 'THREE' }),
  ] }])
  assert.deepEqual(out.reviews.map((r) => r.author), ['Auteur d', 'Auteur c', 'Utilisateur Google'])
  assert.equal(out.reviews[0].rating, 3, 'no filtering by rating')
  assert.equal(out.reviews[1].text, 'Séance magnifique, merci.')
  assert.equal(out.reviews[2].photoUrl, null)
  assert.equal(originalComment('Texte simple'), 'Texte simple')
})

test('all pages are read (updateTime desc, 50 per page) with the dedicated client, up to a limit', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'access-1' }), { status: 200 })
    }
    const page = Number(new URL(url).searchParams.get('pageToken') || 0)
    return new Response(JSON.stringify({ averageRating: 4.9, totalReviewCount: 500, reviews: [review(`r${page}`, `2026-0${(page % 9) + 1}-01T00:00:00Z`)], nextPageToken: String(page + 1) }), { status: 200 })
  }
  const db = fakeDb({ refresh_token_enc: encrypt('refresh-1'), account_name: 'accounts/1', location_name: 'locations/2' })
  const out = await fetchBusinessReviews({ db, env: ENV, fetchImpl })
  const tokenCall = calls[0]
  assert.match(tokenCall.init.body.toString(), /client_id=business-client/)
  assert.doesNotMatch(tokenCall.init.body.toString(), /calendar-client|calendar-secret/)
  const reviewCalls = calls.filter((c) => c.url.includes('mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews'))
  assert.equal(reviewCalls.length, MAX_PAGES)
  assert.match(reviewCalls[0].url, /pageSize=50/)
  assert.match(reviewCalls[0].url, /orderBy=updateTime\+desc/)
  assert.equal(reviewCalls[0].init.headers.Authorization, 'Bearer access-1')
  assert.equal(out.reviews.length, MAX_PAGES)
  assert.ok(db.store.row.last_success_at)
})

test('without a ready connection Business Profile returns nothing, so Places is used', async () => {
  assert.equal(await fetchBusinessReviews({ db: fakeDb(), env: ENV }), null)
  assert.equal(await fetchBusinessReviews({ db: fakeDb({ refresh_token_enc: 'x' }), env: ENV }), null, 'no location yet')
  assert.equal(await fetchBusinessReviews({ db: fakeDb(), env: {} }), null, 'not configured')
})

// ── Repli ────────────────────────────────────────────────────────────────────

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  return res
}

const placeResponse = { rating: 4.9, userRatingCount: 81, reviews: [{ rating: 5, text: { text: 'Places' }, publishTime: '2026-10-01T00:00:00Z', authorAttribution: { displayName: 'Sylvie' } }] }
const placesFetch = async () => new Response(JSON.stringify(placeResponse), { status: 200 })
const PLACES_ENV = { GOOGLE_PLACES_API_KEY: 'k', GOOGLE_PLACE_ID: 'p' }

test('the site uses Business Profile when ready, and falls back to Places when it fails or is not ready', async () => {
  const ok = fakeRes()
  await handleGoogleReviews({}, ok, { db: {}, env: PLACES_ENV, fetchImpl: placesFetch, fetchBusiness: async () => ({ available: true, source: 'business_profile', reviews: [] }) })
  assert.equal(ok.body.source, 'business_profile')
  assert.match(ok.headers['Cache-Control'], /s-maxage=3600/)

  const failed = fakeRes()
  await handleGoogleReviews({}, failed, { db: {}, env: PLACES_ENV, fetchImpl: placesFetch, fetchBusiness: async () => { throw Object.assign(new Error('x'), { code: 'api_quota_zero_or_exceeded' }) } })
  assert.equal(failed.body.source, 'places')
  assert.equal(failed.body.reviews[0].author, 'Sylvie')

  const notReady = fakeRes()
  await handleGoogleReviews({}, notReady, { db: {}, env: PLACES_ENV, fetchImpl: placesFetch, fetchBusiness: async () => null })
  assert.equal(notReady.body.source, 'places')

  const nothing = fakeRes()
  await handleGoogleReviews({}, nothing, { db: {}, env: {}, fetchBusiness: async () => null })
  assert.deepEqual(nothing.body, { available: false, mapsUrl: 'https://g.page/r/CbFv2pHpBKtYEBM', writeUrl: 'https://g.page/r/CbFv2pHpBKtYEBM/review' })
})

test('Places reviews are dated and ordered newest first when Google gives a date', () => {
  const out = mapPlace({ reviews: [
    { rating: 5, text: { text: 'ancien' }, publishTime: '2026-09-01T00:00:00Z' },
    { rating: 5, text: { text: 'récent' }, publishTime: '2026-11-01T00:00:00Z' },
  ] })
  assert.deepEqual(out.reviews.map((r) => r.text), ['récent', 'ancien'])
  assert.equal(out.reviews[0].publishedAt, '2026-11-01T00:00:00.000Z')
})

// ── Connexion OAuth séparée de Google Agenda ─────────────────────────────────

test('connecting asks only for business.manage, offline, with the dedicated client and a single-use state', async () => {
  assert.deepEqual(missingBusinessEnv({ CALENDAR_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REDIRECT_URI: 'z' }),
    ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET', 'GOOGLE_BUSINESS_REDIRECT_URI'], 'calendar credentials are never reused')
  const db = fakeDb()
  const out = await startConnect({ db, env: ENV, userId: '00000000-0000-0000-0000-000000000001' })
  assert.equal(out.status, 200)
  const url = new URL(out.body.url)
  assert.equal(url.searchParams.get('client_id'), 'business-client')
  assert.equal(url.searchParams.get('scope'), BUSINESS_SCOPE)
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('include_granted_scopes'), null, 'calendar scopes are never merged in')
  assert.equal(url.searchParams.get('redirect_uri'), ENV.GOOGLE_BUSINESS_REDIRECT_URI)
  assert.match(db.store.row.pending_state_hash, /^[0-9a-f]{64}$/)
  assert.equal(db.store.row.refresh_token_enc, undefined, 'nothing stored before consent')

  const preview = await startConnect({ db, env: { ...ENV, VERCEL_ENV: 'preview', GOOGLE_BUSINESS_REDIRECT_URI: 'https://mediumia.fr/api/google-business/callback' } })
  assert.equal(preview.body.error, 'redirect_uri_not_preview', 'a preview never sends Google back to production')
})

test('the callback stores an encrypted token, finds the profile, and cannot be replayed', async () => {
  const db = fakeDb()
  const start = await startConnect({ db, env: ENV, userId: 'u1' })
  const state = new URL(start.body.url).searchParams.get('state')
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      assert.match(init.body.toString(), /client_id=business-client/)
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'refresh-secret', scope: BUSINESS_SCOPE }), { status: 200 })
    }
    if (u.includes('/v1/accounts?')) return new Response(JSON.stringify({ accounts: [{ name: 'accounts/11' }] }), { status: 200 })
    if (u.includes('/v1/accounts/11/locations')) {
      assert.match(u, /readMask=name,title/)
      return new Response(JSON.stringify({ locations: [{ name: 'locations/22', title: 'Sébastien Seguin' }] }), { status: 200 })
    }
    throw new Error(`unexpected ${u}`)
  }
  assert.equal(await completeConnect({ db, env: ENV, query: { code: 'c', state }, fetchImpl }), 'connected')
  assert.notEqual(db.store.row.refresh_token_enc, 'refresh-secret')
  assert.doesNotMatch(JSON.stringify(db.store.row), /refresh-secret/)
  assert.equal(db.store.row.location_name, 'locations/22')
  assert.equal(db.store.row.connected_by, 'u1')
  assert.equal(db.store.row.pending_state_hash, null)
  assert.equal(await completeConnect({ db, env: ENV, query: { code: 'c', state }, fetchImpl }), 'invalid_state', 'replay refused')

  const status = await connectionStatus({ db, env: ENV })
  assert.equal(status.ready, true)
  assert.doesNotMatch(JSON.stringify(status), /refresh|token_enc|secret/i, 'status never exposes the token')
})

test('before Google grants API access, the token is kept and the site stays on Places', async () => {
  const db = fakeDb()
  const state = new URL((await startConnect({ db, env: ENV })).body.url).searchParams.get('state')
  const fetchImpl = async (url) => String(url).startsWith('https://oauth2.googleapis.com/token')
    ? new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: BUSINESS_SCOPE }), { status: 200 })
    : new Response('{}', { status: 429 })
  assert.equal(await completeConnect({ db, env: ENV, query: { code: 'c', state }, fetchImpl }), 'pending_access')
  assert.equal(db.store.row.last_error, 'api_quota_zero_or_exceeded')
  assert.equal(db.store.row.location_name, null)
  assert.equal(await fetchBusinessReviews({ db, env: ENV }), null)
})

test('state is signed, expires, and refusals or missing scope store nothing', async () => {
  const state = signBusinessState('n1', Date.now() + 60_000, ENV)
  assert.equal(verifyBusinessState(state, ENV), 'n1')
  assert.equal(verifyBusinessState(`${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}`, ENV), null)
  assert.equal(verifyBusinessState(signBusinessState('n1', Date.now() - 1, ENV), ENV), null)
  assert.equal(await completeConnect({ db: fakeDb(), env: ENV, query: { error: 'access_denied' } }), 'refused')

  const db = fakeDb()
  const s = new URL((await startConnect({ db, env: ENV })).body.url).searchParams.get('state')
  const fetchImpl = async () => new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'https://www.googleapis.com/auth/calendar.events' }), { status: 200 })
  assert.equal(await completeConnect({ db, env: ENV, query: { code: 'c', state: s }, fetchImpl }), 'scope_missing')
  assert.equal(db.store.row.refresh_token_enc, undefined)
})

test('disconnecting revokes only the Business token and clears the dedicated row', async () => {
  const db = fakeDb({ refresh_token_enc: encrypt('business-refresh'), account_name: 'accounts/1', location_name: 'locations/2' })
  const calls = []
  const out = await disconnect({ db, fetchImpl: async (url, init) => { calls.push({ url: String(url), body: init.body.toString() }); return new Response('', { status: 200 }) } })
  assert.equal(out.body.revoked, true)
  assert.deepEqual(calls.map((c) => c.url), ['https://oauth2.googleapis.com/revoke'])
  assert.equal(calls[0].body, 'token=business-refresh')
  assert.equal(db.store.row.refresh_token_enc, null)
})

test('owner-only actions; the callback redirects back to moderation', async () => {
  const denied = fakeRes()
  await handleGoogleBusinessAction({ method: 'GET', query: {} }, denied, 'status', { db: fakeDb(), env: ENV, requireOwner: async () => ({ status: 403, error: 'forbidden' }) })
  assert.equal(denied.statusCode, 403)

  const callback = fakeRes()
  await handleGoogleBusinessAction({ method: 'GET', query: { error: 'access_denied' } }, callback, 'callback', { db: fakeDb(), env: ENV })
  assert.equal(callback.statusCode, 302)
  assert.equal(callback.headers.Location, '/avis/moderation?google=refused')
})

// ── Google Agenda intact, pas de nouvelle fonction Vercel ────────────────────

test('Google Calendar code and credentials are untouched, and the Vercel function count stays at 12', () => {
  const connect = read('api/google-calendar/connect.js')
  assert.match(connect, /'https:\/\/www\.googleapis\.com\/auth\/calendar\.events'/)
  assert.doesNotMatch(connect, /business/i)
  assert.doesNotMatch(read('lib/googleOAuth.js'), /business/i)
  const lib = read('lib/googleBusinessProfile.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(lib, /GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_REDIRECT_URI|refreshGoogleToken|booking_calendar_connections/)
  const files = fs.readdirSync(new URL('../api', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.js'))
  assert.ok(files.length <= 12, `${files.length} Vercel functions`)
  // vercel.json est compacté pendant le build Vercel : on lit le JSON, pas sa mise en forme.
  const rewrites = JSON.parse(read('vercel.json')).rewrites || []
  assert.ok(rewrites.some((r) => r.source === '/api/google-business/callback' && r.destination === '/api/rdv-config?googleBusinessAction=callback'))
  assert.match(read('api/rdv-config.js'), /handleGoogleBusinessAction\(req, res, googleBusinessAction\)/)
})

test('no Google secret or token handling reaches the browser bundle', () => {
  const sources = ['src/components/ReviewsPage.jsx', 'src/lib/reviewDuplicates.js', 'src/lib/googleReviewsDisplay.js', 'src/components/rdv/RdvPublic.jsx'].map(read).join('\n')
  assert.doesNotMatch(sources, /GOOGLE_BUSINESS_CLIENT_SECRET|GOOGLE_PLACES_API_KEY|CALENDAR_TOKEN_ENCRYPTION_KEY|\brefresh_token|googleBusinessProfile\.js|googleOAuth\.js/)
})

test('migration: dedicated table, server-only access, encrypted token, no review content stored', () => {
  const sql = read('supabase/migrations/20261121120000_google_business_connection.sql')
  assert.match(sql, /create table if not exists public\.google_business_connection/)
  assert.match(sql, /force row level security/)
  assert.match(sql, /revoke all on table public\.google_business_connection from public, anon, authenticated/)
  assert.doesNotMatch(sql, /comment text|review_text|body text/)
})

// ── Doublons : signalés, jamais masqués, jamais sur le seul prénom ───────────

test('possible duplicates are based on the text only, never on a first name or initial', () => {
  const google = [{ author: 'Delphine Martin', publishedAt: '2026-11-20T08:00:00Z', text: 'Une séance lumineuse, Sébastien a su capter mon énergie et me guider avec beaucoup de douceur et de justesse sur mon chemin.' }]
  const sameNameDifferentText = { id: 'dénie', display_name: 'Dénie', body: 'Consultation rassurante, des réponses précises concernant ma famille et mon travail, je recommande vivement.' }
  const sameTextOtherName = { id: 'copie', display_name: 'D.', body: 'Une séance lumineuse : Sébastien a su capter mon énergie et me guider avec douceur et justesse sur mon chemin !' }
  const flags = findPossibleDuplicates([sameNameDifferentText, sameTextOtherName], google)
  assert.equal(flags['dénie'], undefined, 'a name or initial alone never makes a duplicate')
  assert.equal(flags.copie[0].author, 'Delphine Martin')
  assert.ok(textOverlap(sameTextOtherName.body, google[0].text) >= 0.6)
  assert.equal(textOverlap('Merci beaucoup', 'Merci beaucoup'), 0, 'very short texts are never flagged')
})

test('duplicates are only flagged in moderation: public lists never filter on them', () => {
  const page = read('src/components/ReviewsPage.jsx')
  const publicPart = page.slice(page.indexOf('export default function ReviewsPage'))
  assert.doesNotMatch(publicPart, /findPossibleDuplicates/)
  assert.doesNotMatch(page.slice(page.indexOf('export function ReviewsHighlight'), page.indexOf('function ReviewForm')), /findPossibleDuplicates/)
  assert.match(page, /rien n’est masqué ni retiré automatiquement/)
})

// ── Organisation des avis ────────────────────────────────────────────────────

test('home and /avis exclude formation testimonials; the Formation page shows only them, with its own form', () => {
  assert.equal(isFormationReview({ offering: 'formation' }), true)
  assert.equal(SITE_OFFERINGS.includes('formation'), false)
  const page = read('src/components/ReviewsPage.jsx')
  const home = page.slice(page.indexOf('export function ReviewsHighlight'), page.indexOf('export function FormationReviewsBlock'))
  assert.match(home, /reviews\.filter\(\(review\) => !isFormationReview\(review\)\)/)
  assert.ok(home.indexOf('<GoogleReviewsBlock') < home.indexOf('siteReviews.slice'), 'Google reviews first on the home page')
  const formation = page.slice(page.indexOf('export function FormationReviewsBlock'), page.indexOf('function ReviewForm'))
  assert.match(formation, /reviews\.filter\(isFormationReview\)/)
  assert.match(formation, /<ReviewForm fixedOffering="formation"/)
  assert.doesNotMatch(formation, /\/avis\?prestation=formation/)
  const reviewsPage = page.slice(page.indexOf('export default function ReviewsPage'))
  assert.match(reviewsPage, /Avis Google<\/h2>/)
  assert.match(reviewsPage, /Avis déposés sur MediumIA<\/h2>/)
  assert.ok(reviewsPage.indexOf('<GoogleReviewButton') < reviewsPage.indexOf('<ReviewForm'), 'Google is the main path')
  assert.match(page, /Pour une consultation, votre avis est encore plus utile sur Google/)
  assert.match(read('src/components/rdv/RdvPublic.jsx'), /href=\{google\.writeUrl\}[^>]*>Laisser un avis sur Google/)
})

test('Google reviews without a date keep Google’s order; dated ones come newest first', () => {
  const sorted = sortGoogleReviews([
    { author: 'a', publishedAt: '2026-01-01T00:00:00Z' }, { author: 'b' }, { author: 'c', publishedAt: '2026-11-20T00:00:00Z' }, { author: 'd' },
  ])
  assert.deepEqual(sorted.map((r) => r.author), ['c', 'a', 'b', 'd'])
  assert.equal(googleReviewDate({ when: 'il y a un mois' }), 'il y a un mois')
})
