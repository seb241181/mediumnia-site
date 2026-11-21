/**
 * Angles du thème (Ascendant, Descendant, MC, FC) et maisons (Placidus,
 * égales, signe entier) pour l'Oracle.
 *
 * Copie fidèle des calculs de free-human-design 1.0.1 (src/hd/houses.js et
 * normalizeAngleDegrees de src/calc/mandala.js), sans les parties Human Design
 * que l'Oracle n'utilise pas. Le paquet a été retiré de npm le 19/11/2026
 * (1.0.1 dépubliée), ce qui cassait toute installation ; ces deux fonctions,
 * purement mathématiques, vivent donc désormais dans le dépôt.
 * Le code utilisé est identique dans la version 2.0.0 du paquet.
 *
 * Origine : free-human-design — Copyright (c) 2026 Adam Blvck / Blvck Studios,
 * licence MIT (texte complet dans third_party/free-human-design/LICENSE).
 * Dépendance restante : astronomia (MIT), temps sidéral et obliquité.
 *
 * Aucune éphéméride : seulement le jour julien (UT), la latitude et la longitude.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const A = require('astronomia')

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

// [0, 360)
export function normalizeAngleDegrees(angle) {
  const out = angle % 360
  return out < 0 ? out + 360 : out
}

// Temps sidéral apparent de Greenwich, en degrés (astronomia renvoie des secondes de temps).
export function gastDegrees(jdUT) {
  return normalizeAngleDegrees((A.sidereal.apparent(jdUT) / 3600) * 15)
}

// Obliquité vraie : obliquité moyenne + nutation en obliquité, en degrés.
export function trueObliquityDeg(jdUT) {
  return (A.nutation.meanObliquity(jdUT) + A.nutation.nutation(jdUT)[1]) * R2D
}

// Ascension droite du milieu du ciel (temps sidéral local apparent), en degrés.
// lngEast : longitude géographique en degrés, est positif.
export function ramcDegrees(jdUT, lngEast) {
  return normalizeAngleDegrees(gastDegrees(jdUT) + lngEast)
}

// Longitude écliptique d'un point de l'écliptique (β = 0) d'ascension droite donnée.
export function eclipticLonFromRA(raDeg, epsDeg) {
  const ra = raDeg * D2R
  const eps = epsDeg * D2R
  return normalizeAngleDegrees(Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(eps)) * R2D)
}

function declOfEclipticPoint(lonDeg, epsDeg) {
  return Math.asin(Math.sin(epsDeg * D2R) * Math.sin(lonDeg * D2R)) * R2D
}

/**
 * Les quatre angles du thème.
 * @param {{ jdUT: number, lat: number, lng: number }} args  latitude nord +, longitude est +
 */
export function computeAngles({ jdUT, lat, lng }) {
  const eps = trueObliquityDeg(jdUT)
  const ramc = ramcDegrees(jdUT, lng)
  const ramcR = ramc * D2R
  const epsR = eps * D2R
  const phiR = lat * D2R

  const mc = normalizeAngleDegrees(
    Math.atan2(Math.sin(ramcR), Math.cos(ramcR) * Math.cos(epsR)) * R2D,
  )

  let asc = normalizeAngleDegrees(
    Math.atan2(
      Math.cos(ramcR),
      -(Math.sin(ramcR) * Math.cos(epsR) + Math.tan(phiR) * Math.sin(epsR)),
    ) * R2D,
  )

  // L'Ascendant est dans le demi-cercle levant (0 à 180° à l'est du MC) ;
  // sinon la formule a donné le point opposé.
  if (normalizeAngleDegrees(asc - mc) > 180) {
    asc = normalizeAngleDegrees(asc + 180)
  }

  return {
    ascendant: { longitude: asc },
    descendant: { longitude: normalizeAngleDegrees(asc + 180) },
    mc: { longitude: mc },
    ic: { longitude: normalizeAngleDegrees(mc + 180) },
    _meta: { ramc, obliquity: eps },
  }
}

// Cuspide intermédiaire Placidus (maisons 11, 12, 2, 3), par itération.
// null si le point est circumpolaire (Placidus indéfini, |lat| > ~66°).
function placidusIntermediate(ramc, eps, lat, which) {
  const phiR = lat * D2R

  function targetRA(SA) {
    const NA = 180 - SA
    switch (which) {
      case '11': return ramc + (1 / 3) * SA
      case '12': return ramc + (2 / 3) * SA
      case '2': return ramc + SA + (1 / 3) * NA
      case '3': return ramc + SA + (2 / 3) * NA
      default: throw new Error(`bad cusp ${which}`)
    }
  }

  const initialOffset = { 11: 30, 12: 60, 2: 120, 3: 150 }[which]
  let ra = ramc + initialOffset

  for (let i = 0; i < 100; i += 1) {
    const lon = eclipticLonFromRA(ra, eps)
    const decl = declOfEclipticPoint(lon, eps)
    const cosSA = -Math.tan(phiR) * Math.tan(decl * D2R)
    if (cosSA <= -1 || cosSA >= 1) return null
    const SA = Math.acos(cosSA) * R2D
    const next = targetRA(SA)
    if (Math.abs(normalizeAngleDegrees(next - ra + 180) - 180) < 1e-9) {
      ra = next
      break
    }
    ra = next
  }
  return eclipticLonFromRA(ra, eps)
}

/**
 * Les 12 cuspides pour un système donné.
 * @param {{ jdUT, lat, lng, system?: 'whole'|'equal'|'placidus' }} args
 * @returns {{ system, requestedSystem, fallback?, cusps: Array<{ house, longitude }>, angles }}
 */
export function computeHouses({ jdUT, lat, lng, system = 'placidus' }) {
  const angles = computeAngles({ jdUT, lat, lng })
  const asc = angles.ascendant.longitude
  const mc = angles.mc.longitude
  const eps = angles._meta.obliquity
  const ramc = angles._meta.ramc

  const sys = String(system).toLowerCase()
  const cuspLons = new Array(12)
  let usedSystem = sys
  let fallback

  const wholeSign = () => {
    const base = Math.floor(normalizeAngleDegrees(asc) / 30) * 30
    for (let i = 0; i < 12; i += 1) cuspLons[i] = normalizeAngleDegrees(base + i * 30)
  }

  if (sys === 'whole') {
    wholeSign()
  } else if (sys === 'equal') {
    for (let i = 0; i < 12; i += 1) cuspLons[i] = normalizeAngleDegrees(asc + i * 30)
  } else {
    const c11 = placidusIntermediate(ramc, eps, lat, '11')
    const c12 = placidusIntermediate(ramc, eps, lat, '12')
    const c2 = placidusIntermediate(ramc, eps, lat, '2')
    const c3 = placidusIntermediate(ramc, eps, lat, '3')
    if ([c11, c12, c2, c3].some((x) => x === null)) {
      // Latitude polaire : repli sur les maisons en signe entier.
      fallback = 'placidus undefined at this latitude — fell back to whole sign'
      usedSystem = 'whole'
      wholeSign()
    } else {
      cuspLons[0] = asc
      cuspLons[1] = c2
      cuspLons[2] = c3
      cuspLons[3] = normalizeAngleDegrees(mc + 180)
      cuspLons[4] = normalizeAngleDegrees(c11 + 180)
      cuspLons[5] = normalizeAngleDegrees(c12 + 180)
      cuspLons[6] = normalizeAngleDegrees(asc + 180)
      cuspLons[7] = normalizeAngleDegrees(c2 + 180)
      cuspLons[8] = normalizeAngleDegrees(c3 + 180)
      cuspLons[9] = mc
      cuspLons[10] = c11
      cuspLons[11] = c12
    }
  }

  const cusps = cuspLons.map((longitude, i) => ({ house: i + 1, longitude }))
  return { system: usedSystem, requestedSystem: sys, fallback, cusps, angles }
}
