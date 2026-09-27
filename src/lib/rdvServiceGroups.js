// Regroupe les prestations déclinées « En présence » / « Visio » / « À distance »
// en une seule carte. Aucune donnée n'est modifiée : chaque déclinaison reste la
// prestation d'origine (même slug, même prix, même mode de réservation).

const VARIANT_SUFFIX_RE = /\s*(?:[—–-]\s*)?(?:(?:en|par|via)\s+)?(?:visioconf[ée]rence|visio|vid[ée]o|pr[ée]sence|pr[ée]sentiel|(?:à|a)\s+distance|t[ée]l[ée]phone)\s*$/i

function stripAccents(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// « Désenvoûtement — En présence » et « desenvoutement par visioconférence »
// donnent la même clé : « desenvoutement ».
export function serviceGroupKey(title) {
  const base = String(title || '').replace(VARIANT_SUFFIX_RE, '')
  return stripAccents(base).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
}

export function baseServiceTitle(title) {
  const base = String(title || '').replace(VARIANT_SUFFIX_RE, '').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : String(title || '')
}

export function variantLabel(service) {
  const title = stripAccents(String(service?.title || '')).toLowerCase()
  const modality = service?.modality || []
  if (/distance/.test(title)) return 'À distance'
  if (modality.includes('in-person')) return 'En présence'
  if (modality.includes('video')) return 'Visio'
  if (modality.includes('phone')) return 'Téléphone'
  return 'Séance'
}

const VARIANT_ORDER = { 'En présence': 0, Visio: 1, 'À distance': 2, Téléphone: 3, Séance: 4 }

// Un titre saisi tout en minuscules (« desenvoutement ») perd face à une
// variante correctement écrite (« Désenvoûtement »).
function titleScore(title) {
  const base = String(title || '').replace(VARIANT_SUFFIX_RE, '').trim()
  let score = 0
  if (/^[A-ZÀ-Ý]/.test(base)) score += 2
  if (/[À-ÿ]/.test(base)) score += 1
  return score
}

export function groupServices(services) {
  const groups = []
  const byKey = new Map()
  for (const service of services || []) {
    const key = serviceGroupKey(service.title) || service.id
    let group = byKey.get(key)
    if (!group) {
      group = { key, variants: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.variants.push({ ...service, variantLabel: variantLabel(service) })
  }
  return groups.map(group => {
    const variants = group.variants
      .slice()
      .sort((a, b) => (VARIANT_ORDER[a.variantLabel] ?? 9) - (VARIANT_ORDER[b.variantLabel] ?? 9))
    const bestTitle = variants.reduce((best, v) => (titleScore(v.title) > titleScore(best.title) ? v : best), variants[0]).title
    const title = baseServiceTitle(bestTitle)
    return {
      key: group.key,
      title,
      variants: variants.map(v => ({
        ...v,
        displayTitle: variants.length > 1 || v.title !== bestTitle ? `${title} — ${v.variantLabel}` : v.title,
      })),
    }
  })
}

// Montant d'arrhes commun à toutes les prestations réservables en ligne, pour
// ne l'annoncer qu'une fois. null si les montants diffèrent.
export function commonDepositCents(services) {
  const amounts = new Set(
    (services || [])
      .filter(s => (s.booking_mode || 'instant') === 'instant' && s.reservation_payment_kind === 'arrhes' && Number(s.reservation_payment_cents) > 0)
      .map(s => Number(s.reservation_payment_cents)),
  )
  return amounts.size === 1 ? [...amounts][0] : null
}

// Premier paragraphe de la description, pour l'aperçu replié.
export function descriptionParagraphs(description) {
  return String(description || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}
