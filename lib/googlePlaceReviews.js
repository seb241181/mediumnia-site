/**
 * Note et derniers avis Google de la fiche MediumIA, via Google Places API (New).
 * Appelé par api/rdv-config.js?reviewsAction=google.
 *
 * Variables d'environnement (ajoutées par le propriétaire, jamais dans le dépôt) :
 *   GOOGLE_PLACES_API_KEY  clé restreinte à « Places API (New) »
 *   GOOGLE_PLACE_ID        identifiant de la fiche Google
 * Sans elles, la réponse est { available: false } et le site n'affiche que les liens.
 * Rien n'est stocké : la réponse est mise en cache 6 h par Vercel (conditions Google).
 */
import { GOOGLE_REVIEW_PROFILES } from './googleReviews.js'

const PROFILE = GOOGLE_REVIEW_PROFILES['sebastien-seguin']
const FIELDS = 'rating,userRatingCount,reviews,googleMapsUri'

export function mapPlace(place) {
  const reviews = (place?.reviews || [])
    .filter(r => r?.text?.text || r?.originalText?.text)
    .slice(0, 5)
    .map(r => ({
      author: r.authorAttribution?.displayName || 'Avis Google',
      authorUrl: r.authorAttribution?.uri || null,
      photoUrl: r.authorAttribution?.photoUri || null,
      rating: Number(r.rating) || null,
      when: r.relativePublishTimeDescription || '',
      text: (r.text?.text || r.originalText?.text || '').slice(0, 700),
    }))
  return {
    available: true,
    rating: Number(place?.rating) || null,
    count: Number(place?.userRatingCount) || 0,
    mapsUrl: place?.googleMapsUri || PROFILE.profileUrl,
    writeUrl: PROFILE.writeUrl,
    reviews,
  }
}

// Temporary diagnostic: why Google refuses the request (PERMISSION_DENIED,
// SERVICE_DISABLED, API_KEY_HTTP_REFERRER_BLOCKED, API_KEY_SERVICE_BLOCKED,
// BILLING_DISABLED…). Only Google's error fields are logged, never the API key
// (any key-looking string is masked) nor any personal data.
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g
const clean = (value, max = 300) => String(value ?? '').replace(KEY_PATTERN, '[clé masquée]').replace(/\s+/g, ' ').slice(0, max)

export function describePlacesError(status, body) {
  const error = body?.error || {}
  const details = Array.isArray(error.details) ? error.details : []
  const info = details.find((d) => String(d?.['@type'] || '').endsWith('ErrorInfo')) || {}
  const meta = info.metadata || {}
  return {
    http: status,
    code: Number(error.code) || null,
    status: clean(error.status, 60) || null,
    reason: clean(info.reason, 80) || null,
    service: clean(meta.service, 80) || null,
    consumer: clean(meta.consumer, 80) || null,
    message: clean(error.message) || null,
  }
}

export async function handleGooglePlaceReviews(req, res) {
  const key = process.env.GOOGLE_PLACES_API_KEY
  const placeId = process.env.GOOGLE_PLACE_ID
  const links = { mapsUrl: PROFILE.profileUrl, writeUrl: PROFILE.writeUrl }
  if (!key || !placeId) return res.status(200).json({ available: false, ...links })
  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      console.error(`[google-reviews] Places HTTP ${response.status} ${JSON.stringify(describePlacesError(response.status, body))}`)
      return res.status(200).json({ available: false, ...links })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    return res.status(200).json(mapPlace(await response.json()))
  } catch {
    console.error('[google-reviews] Places request failed')
    return res.status(200).json({ available: false, ...links })
  }
}
