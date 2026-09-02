import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const require = createRequire(import.meta.url)
const tzLookup = require('@photostructure/tz-lookup')

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1100

function cleanPlace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160)
}

function hashPlace(normalized) {
  return createHash('sha256').update(normalized.toLowerCase()).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function lookupCache(supabase, placeHash) {
  const { data } = await supabase
    .from('geocoding_cache')
    .select('lat, lon, display_name, country_code, timezone')
    .eq('place_hash', placeHash)
    .maybeSingle()
  return data || null
}

async function writeCache(supabase, placeHash, geo) {
  try {
    await supabase.from('geocoding_cache').upsert({
      place_hash: placeHash,
      lat: geo.latitude,
      lon: geo.longitude,
      display_name: geo.label,
      country_code: geo.countryCode,
      timezone: geo.timeZone,
    })
  } catch {
    // cache write is best-effort
  }
}

async function claimSlot(supabase) {
  const { data, error } = await supabase.rpc('claim_geocoding_slot')
  if (error) return false
  return data === true
}

async function waitForSlot(supabase) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const allowed = await claimSlot(supabase)
    if (allowed) return true
    await sleep(RETRY_DELAY_MS)
  }
  return false
}

async function fetchNominatim(place) {
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
        'User-Agent': 'MediumIA-CHRONOSPHERE/1.0 (https://mediumia.fr)',
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
  return result
}

export async function resolveBirthLocation(placeValue) {
  const place = cleanPlace(placeValue)
  if (place.length < 2) throw new Error('invalid_birth_place')

  if (!isSupabaseConfigured()) {
    throw new Error('birth_geocoding_not_configured')
  }

  const supabase = getSupabaseAdmin()
  const placeHash = hashPlace(place)

  // 1. Check cache
  try {
    const cached = await lookupCache(supabase, placeHash)
    if (cached) {
      return {
        query: place,
        label: cached.display_name,
        countryCode: cached.country_code || null,
        latitude: cached.lat,
        longitude: cached.lon,
        timeZone: cached.timezone,
        source: 'openstreetmap-nominatim',
      }
    }
  } catch {
    // cache miss → proceed to geocoder
  }

  // 2. Global rate limit (1 req/s across all instances) — fail closed
  const slotObtained = await waitForSlot(supabase)
  if (!slotObtained) {
    throw new Error('birth_geocoding_rate_limited')
  }

  // 3. Call geocoder
  const result = await fetchNominatim(place)

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

  const geo = {
    query: place,
    label: String(result?.display_name || place).slice(0, 220),
    countryCode: String(result?.address?.country_code || '').toUpperCase() || null,
    latitude,
    longitude,
    timeZone,
    source: 'openstreetmap-nominatim',
  }

  // 4. Populate cache
  await writeCache(supabase, placeHash, geo)

  return geo
}
