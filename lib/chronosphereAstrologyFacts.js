export const ASTROLOGY_FACTS_VERSION = 'chronosphere-astrology-facts-v1'

// Only call this with the astronomy engine output, never with model output.
export function buildAstrologyFacts(astrology) {
  const facts = []
  for (const [kind, positions] of [['natal', astrology.natal], ['transit', astrology.transits]]) {
    for (const position of positions || []) {
      facts.push({
        id: `${kind}:${position.planet}`, kind, planet: position.planet,
        eclipticLongitude: position.longitude, sign: position.sign,
        house: kind === 'natal' ? position.house : position.natalHouse,
        retrograde: position.retrograde,
        label: `${position.planet} ${kind === 'natal' ? 'natal' : 'en transit'} : ${position.label}, maison ${kind === 'natal' ? position.house : position.natalHouse}`,
      })
    }
  }
  for (const [name, value] of [['ascendant', astrology.geometry?.ascendant], ['mc', astrology.geometry?.mc]]) {
    if (value) facts.push({ id: `angle:${name}`, kind: 'angle', angle: name, eclipticLongitude: value.longitude, sign: value.sign, label: `${name} : ${value.label}` })
  }
  for (const aspect of astrology.aspects || []) {
    facts.push({
      id: `aspect:${aspect.transitPlanet}:${aspect.aspect}:${aspect.natalPlanet}`,
      kind: 'aspect', ...aspect,
      label: `${aspect.transitPlanet} ${aspect.aspect} ${aspect.natalPlanet} natal, orbe ${aspect.orb}`,
    })
  }
  const timing = astrology.timing || {}
  for (const [name, window] of [['primary', timing.primary], ...(timing.alternatives || []).map((value, i) => [`alternative${i + 1}`, value]), ['caution', timing.caution]]) {
    if (window) facts.push({ id: `window:${name}`, kind: 'window', start: window.start, end: window.end, peak: window.peak, label: `${name} : du ${window.start} au ${window.end}, pic ${window.peak}` })
  }
  return { schemaVersion: ASTROLOGY_FACTS_VERSION, facts }
}

export function serverFacts(value) {
  return value?.schemaVersion === ASTROLOGY_FACTS_VERSION && Array.isArray(value.facts) ? value.facts : []
}

export function bindReadingFacts(reading, calculated) {
  const byId = new Map(serverFacts(calculated).map((fact) => [fact.id, fact]))
  return {
    ...reading,
    whyNow: (reading.whyNow || []).flatMap((item) => {
      const fact = byId.get(item.factId)
      return fact ? [{ factId: fact.id, calculated: fact.label, interpretation: item.interpretation }] : []
    }).slice(0, 3),
  }
}
