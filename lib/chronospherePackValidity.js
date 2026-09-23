// CGV ChronoSphère : les tirages d'un pack et les lectures d'un suivi MAX sont
// valables 6 mois après l'achat. La règle ne s'applique qu'aux achats faits à
// partir de l'entrée en vigueur des CGV : les packs vendus avant restent sans limite.
export const PACK_VALIDITY_START = '2026-09-24T00:00:00.000Z'
export const PACK_VALIDITY_MONTHS = 6

export function packExpiresAt(pack) {
  const purchasedAt = new Date(pack?.captured_at || pack?.created_at || NaN)
  if (!Number.isFinite(purchasedAt.getTime())) return null
  if (purchasedAt < new Date(PACK_VALIDITY_START)) return null
  const expires = new Date(purchasedAt)
  expires.setUTCMonth(expires.getUTCMonth() + PACK_VALIDITY_MONTHS)
  return expires.toISOString()
}

export function isPackExpired(pack, now = new Date()) {
  const expiresAt = packExpiresAt(pack)
  return Boolean(expiresAt) && now >= new Date(expiresAt)
}
