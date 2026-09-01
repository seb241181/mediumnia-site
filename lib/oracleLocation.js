import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tzLookup = require('@photostructure/tz-lookup')

function cleanPlace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160)
}

export async function resolveBirthLocation(placeValue) {
  const place = cleanPlace(placeValue)
  if (place.length < 2) throw new Error('invalid_birth_place')

  // Public Nominatim is deliberately preview-only. Before production, configure
  // a dedicated/commercial geocoder and keep this server-side contract.
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('birth_geocoding_not_configured')
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('q', place)

  let response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr',
        'User-Agent': 'MediumIA-CHRONOSPHERE-Preview/1.0 (https://mediumia.fr)',
      },
    })
  } catch {
    throw new Error('birth_geocoding_unavailable')
  }

  if (!response.ok) {
    console.error('[oracle-location] geocoder http:', response.status)
    throw new Error('birth_geocoding_unavailable')
  }

  const data = await response.json().catch(() => null)
  const result = Array.isArray(data) ? data[0] : null
  const latitude = Number(result?.lat)
  const longitude = Number(result?.lon)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('birth_place_not_found')
  }

  let timeZone
  try {
    timeZone = tzLookup(latitude, longitude)
  } catch (error) {
    console.error('[oracle-location] timezone lookup failed:', error?.name || 'error')
    throw new Error('birth_timezone_unavailable')
  }

  if (!timeZone || typeof timeZone !== 'string') {
    throw new Error('birth_timezone_unavailable')
  }

  return {
    query: place,
    label: String(result?.display_name || place).slice(0, 220),
    countryCode: String(result?.address?.country_code || '').toUpperCase() || null,
    latitude,
    longitude,
    timeZone,
    source: 'openstreetmap-nominatim-preview',
  }
}
