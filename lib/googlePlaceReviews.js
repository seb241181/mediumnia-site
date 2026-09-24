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
      console.error(`[google-reviews] Places HTTP ${response.status}`)
      return res.status(200).json({ available: false, ...links })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    return res.status(200).json(mapPlace(await response.json()))
  } catch {
    console.error('[google-reviews] Places request failed')
    return res.status(200).json({ available: false, ...links })
  }
}
