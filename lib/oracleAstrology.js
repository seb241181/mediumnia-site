import * as Astronomy from 'astronomy-engine'

const SIGNS = [
  'Bélier', 'Taureau', 'Gémeaux', 'Cancer', 'Lion', 'Vierge',
  'Balance', 'Scorpion', 'Sagittaire', 'Capricorne', 'Verseau', 'Poissons',
]

const PLANETS = [
  { name: 'Soleil', body: Astronomy.Body.Sun, canRetrograde: false },
  { name: 'Lune', body: Astronomy.Body.Moon, canRetrograde: false },
  { name: 'Mercure', body: Astronomy.Body.Mercury, canRetrograde: true },
  { name: 'Vénus', body: Astronomy.Body.Venus, canRetrograde: true },
  { name: 'Mars', body: Astronomy.Body.Mars, canRetrograde: true },
  { name: 'Jupiter', body: Astronomy.Body.Jupiter, canRetrograde: true },
  { name: 'Saturne', body: Astronomy.Body.Saturn, canRetrograde: true },
  { name: 'Uranus', body: Astronomy.Body.Uranus, canRetrograde: true },
  { name: 'Neptune', body: Astronomy.Body.Neptune, canRetrograde: true },
  { name: 'Pluton', body: Astronomy.Body.Pluto, canRetrograde: true },
]

const ASPECTS = [
  { name: 'conjonction', angle: 0 },
  { name: 'sextile', angle: 60 },
  { name: 'carré', angle: 90 },
  { name: 'trigone', angle: 120 },
  { name: 'opposition', angle: 180 },
]

function cleanText(value, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function normalizeAngle(value) {
  return ((Number(value) % 360) + 360) % 360
}

function signedAngleDelta(from, to) {
  return ((normalizeAngle(to) - normalizeAngle(from) + 540) % 360) - 180
}

function angularSeparation(a, b) {
  return Math.abs(signedAngleDelta(a, b))
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const out = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

function localDateTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hour, minute] = timeValue.split(':').map(Number)
  const desired = { year, month, day, hour, minute, second: 0 }
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = desiredAsUtc

  for (let i = 0; i < 4; i += 1) {
    const actual = zonedParts(new Date(guess), timeZone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const correction = desiredAsUtc - actualAsUtc
    guess += correction
    if (Math.abs(correction) < 1000) break
  }

  const result = new Date(guess)
  const check = zonedParts(result, timeZone)
  const matches = ['year', 'month', 'day', 'hour', 'minute'].every((key) => check[key] === desired[key])
  if (!matches) throw new Error('birth_datetime_timezone_mismatch')
  return result
}

function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function normalizeOracleProfile(raw) {
  const fullName = cleanText(raw?.fullName, 120)
  const birthDate = cleanText(raw?.birthDate, 10)
  const birthTime = cleanText(raw?.birthTime, 5)
  const birthPlace = cleanText(raw?.birthPlace, 160)
  const birthTimeZone = cleanText(raw?.birthTimeZone, 80)

  if (fullName.length < 2) throw new Error('invalid_full_name')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error('invalid_birth_date')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime)) throw new Error('invalid_birth_time')
  if (birthPlace.length < 2) throw new Error('invalid_birth_place')
  if (!birthTimeZone || !validateTimeZone(birthTimeZone)) throw new Error('invalid_birth_timezone')

  const [year, month, day] = birthDate.split('-').map(Number)
  const dateCheck = new Date(Date.UTC(year, month - 1, day))
  if (
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() + 1 !== month ||
    dateCheck.getUTCDate() !== day ||
    year < 1900 ||
    year > new Date().getUTCFullYear()
  ) {
    throw new Error('invalid_birth_date')
  }

  return { fullName, birthDate, birthTime, birthPlace, birthTimeZone }
}

function longitudeFor(body, date) {
  if (body === Astronomy.Body.Moon) {
    return normalizeAngle(Astronomy.EclipticGeoMoon(date).lon)
  }
  const vector = Astronomy.GeoVector(body, date, true)
  return normalizeAngle(Astronomy.Ecliptic(vector).elon)
}

function zodiacPosition(longitude) {
  const lon = normalizeAngle(longitude)
  const signIndex = Math.floor(lon / 30) % 12
  const withinSign = lon % 30
  const degree = Math.floor(withinSign)
  const minute = Math.floor((withinSign - degree) * 60)
  return {
    longitude: Number(lon.toFixed(4)),
    sign: SIGNS[signIndex],
    degree,
    minute,
    label: `${degree}°${String(minute).padStart(2, '0')} ${SIGNS[signIndex]}`,
  }
}

function planetarySnapshot(date) {
  const before = new Date(date.getTime() - 12 * 60 * 60 * 1000)
  const after = new Date(date.getTime() + 12 * 60 * 60 * 1000)

  return PLANETS.map((planet) => {
    const longitude = longitudeFor(planet.body, date)
    let retrograde = false
    if (planet.canRetrograde) {
      const motion = signedAngleDelta(longitudeFor(planet.body, before), longitudeFor(planet.body, after))
      retrograde = motion < 0
    }
    return {
      planet: planet.name,
      ...zodiacPosition(longitude),
      retrograde,
    }
  })
}

function nearestAspect(separation) {
  let best = null
  for (const aspect of ASPECTS) {
    const orb = Math.abs(separation - aspect.angle)
    if (!best || orb < best.orb) best = { ...aspect, orb }
  }
  return best
}

function majorTransitAspects(natal, transits) {
  const aspects = []
  for (const transit of transits) {
    for (const natalPlanet of natal) {
      const separation = angularSeparation(transit.longitude, natalPlanet.longitude)
      const aspect = nearestAspect(separation)
      const luminary = ['Soleil', 'Lune'].includes(transit.planet) || ['Soleil', 'Lune'].includes(natalPlanet.planet)
      const maxOrb = luminary ? 5 : 3.5
      if (aspect.orb <= maxOrb) {
        aspects.push({
          transitPlanet: transit.planet,
          aspect: aspect.name,
          natalPlanet: natalPlanet.planet,
          orb: Number(aspect.orb.toFixed(2)),
        })
      }
    }
  }

  return aspects
    .sort((a, b) => a.orb - b.orb)
    .slice(0, 12)
}

export function calculateOracleAstrology(profile, drawDate = new Date()) {
  const birthUtc = localDateTimeToUtc(
    profile.birthDate,
    profile.birthTime,
    profile.birthTimeZone,
  )
  const natal = planetarySnapshot(birthUtc)
  const transits = planetarySnapshot(drawDate)
  const aspects = majorTransitAspects(natal, transits)

  return {
    birthUtc: birthUtc.toISOString(),
    drawUtc: drawDate.toISOString(),
    natal,
    transits,
    aspects,
  }
}

export function astrologyPromptContext(profile, astrology) {
  const natalLines = astrology.natal
    .map((p) => `${p.planet}: ${p.label}${p.retrograde ? ' rétrograde' : ''}`)
    .join('\n')
  const transitLines = astrology.transits
    .map((p) => `${p.planet}: ${p.label}${p.retrograde ? ' rétrograde' : ''}`)
    .join('\n')
  const aspectLines = astrology.aspects.length
    ? astrology.aspects.map((a) => `${a.transitPlanet} ${a.aspect} ${a.natalPlanet} natal — orbe ${a.orb}°`).join('\n')
    : 'Aucun aspect majeur retenu dans les orbes internes de cette version.'

  return `IDENTITE DE LECTURE\nPrénom / nom : ${profile.fullName}\nNaissance locale : ${profile.birthDate} à ${profile.birthTime}\nLieu déclaré : ${profile.birthPlace}\nFuseau utilisé : ${profile.birthTimeZone}\nInstant natal converti en UTC : ${astrology.birthUtc}\nInstant exact du tirage en UTC : ${astrology.drawUtc}\n\nPOSITIONS NATALES CALCULEES\n${natalLines}\n\nCIEL DU TIRAGE CALCULE\n${transitLines}\n\nASPECTS TRANSIT → NATAL RETENUS\n${aspectLines}`
}
