// Liens Google Business Profile des praticiens qui recueillent des avis Google.
// Le lien « review » ouvre directement la fenêtre de dépôt d'avis.
export const GOOGLE_REVIEW_PROFILES = {
  'sebastien-seguin': {
    writeUrl: 'https://g.page/r/CbFv2pHpBKtYEBM/review',
    profileUrl: 'https://g.page/r/CbFv2pHpBKtYEBM',
  },
}

export function googleReviewProfile(practitionerSlug) {
  return GOOGLE_REVIEW_PROFILES[practitionerSlug] || null
}
