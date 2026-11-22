// Conditions applicables uniquement aux nouvelles réservations acceptées à partir du 22/11/2026.
// Ne pas appliquer rétroactivement la règle aux rendez-vous antérieurs.
export const RDV_TERMS_VERSION = 'rdv-annulation-2026-11-22-v1'
export const RDV_TERMS_URL = 'https://mediumia.fr/conditions-rdv'
export const RDV_CANCEL_NOTICE_HOURS = 48

/**
 * Aide au traitement administratif. Ne déclenche jamais de remboursement.
 * Les droits légaux (notamment rétractation) et les cas particuliers priment.
 * L'absence d'un motif clairement client rend la décision manuelle obligatoire.
 */
export function rdvRefundGuidance({ termsVersion, cancelledAt, startsAt, cancelReason, paidCents, arrhesCents }) {
  const paid = Number(paidCents)
  const arrhes = Number(arrhesCents)
  const cancelledMs = new Date(cancelledAt).getTime()
  const startsMs = new Date(startsAt).getTime()
  const review = { code: 'manual_review', recommendedRefundCents: null, retainedCents: null }
  if (termsVersion !== RDV_TERMS_VERSION || !Number.isSafeInteger(paid) || paid <= 0 ||
    !Number.isSafeInteger(arrhes) || arrhes < 0 || arrhes > paid ||
    !Number.isFinite(cancelledMs) || !Number.isFinite(startsMs)) return review
  if (!['client_self_service', 'client_request'].includes(cancelReason)) return review
  if (cancelledMs <= startsMs - RDV_CANCEL_NOTICE_HOURS * 60 * 60 * 1000) {
    return { code: 'early_full_refund', recommendedRefundCents: paid, retainedCents: 0 }
  }
  return {
    code: 'late_arrhes_review',
    recommendedRefundCents: Math.max(0, paid - arrhes),
    retainedCents: arrhes,
  }
}
