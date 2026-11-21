/**
 * Note et avis Google de la fiche MediumIA.
 * Appelé par api/rdv-config.js?reviewsAction=google.
 *
 * Sources, dans l'ordre :
 *   1. Google Business Profile (lib/googleBusinessProfile.js) : tous les avis
 *      de notre fiche, du plus récent au plus ancien (date de publication).
 *   2. Repli : Google Places API (New), 5 avis choisis par Google, sans ordre
 *      chronologique garanti (fonctionnement historique).
 *   3. Sinon : { available: false } et le site n'affiche que les liens Google.
 *
 * Variables Places (jamais dans le dépôt) :
 *   GOOGLE_PLACES_API_KEY  clé restreinte à « Places API (New) »
 *   GOOGLE_PLACE_ID        identifiant de la fiche Google
 * Rien n'est stocké : la réponse est mise en cache par Vercel (1 h Business
 * Profile, 6 h Places).
 */
import process from 'node:process'
import { GOOGLE_REVIEW_PROFILES } from './googleReviews.js'
import { fetchBusinessReviews } from './googleBusinessProfile.js'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const PROFILE = GOOGLE_REVIEW_PROFILES['sebastien-seguin']
const FIELDS = 'rating,userRatingCount,reviews,googleMapsUri'

const time = (value) => Date.parse(value || '') || 0

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
      publishedAt: time(r.publishTime) ? new Date(time(r.publishTime)).toISOString() : null,
      updatedAt: null,
      // Texte d'origine de l'auteur d'abord, plutôt qu'une traduction.
      text: (r.originalText?.text || r.text?.text || '').slice(0, 700),
    }))
    // Même règle que Business Profile : du plus récent au plus ancien quand la date est connue.
    .sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
  return {
    available: true,
    source: 'places',
    rating: Number(place?.rating) || null,
    count: Number(place?.userRatingCount) || 0,
    mapsUrl: place?.googleMapsUri || PROFILE.profileUrl,
    writeUrl: PROFILE.writeUrl,
    reviews,
  }
}

const LINKS = { mapsUrl: PROFILE.profileUrl, writeUrl: PROFILE.writeUrl }

export async function fetchPlaceReviews({ env = process.env, fetchImpl = fetch } = {}) {
  const key = env.GOOGLE_PLACES_API_KEY
  const placeId = env.GOOGLE_PLACE_ID
  if (!key || !placeId) return null
  try {
    const response = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    })
    if (!response.ok) {
      console.error(`[google-reviews] Places HTTP ${response.status}`)
      return null
    }
    return mapPlace(await response.json())
  } catch {
    console.error('[google-reviews] Places request failed')
    return null
  }
}

export async function handleGoogleReviews(req, res, deps = {}) {
  const env = deps.env || process.env
  const fetchImpl = deps.fetchImpl || fetch
  const db = deps.db || (isSupabaseConfigured() ? getSupabaseAdmin() : null)

  if (db) {
    try {
      const business = await (deps.fetchBusiness || fetchBusinessReviews)({ db, env, fetchImpl })
      if (business) {
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
        return res.status(200).json(business)
      }
    } catch {
      // Déjà journalisé (code seul) : on passe au repli Places.
    }
  }

  const places = await fetchPlaceReviews({ env, fetchImpl })
  if (places) {
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    return res.status(200).json(places)
  }
  return res.status(200).json({ available: false, ...LINKS })
}

// Ancien nom, conservé pour compatibilité.
export const handleGooglePlaceReviews = handleGoogleReviews
