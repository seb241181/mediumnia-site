// Display rules for reviews (shared by the home page, /avis, Formation and the
// booking page). Kept out of ReviewsPage.jsx so that file only exports components.

// Formation testimonials live on the Formation page only: they are never mixed
// with consultation reviews (home, /avis).
export const isFormationReview = (review) => review?.offering === 'formation'
export const SITE_OFFERINGS = ['consultation', 'oracle', 'chronosphere', 'conference', 'autre']

export const GOOGLE_LINKS = { mapsUrl: 'https://g.page/r/CbFv2pHpBKtYEBM', writeUrl: 'https://g.page/r/CbFv2pHpBKtYEBM/review' }

export function dayLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

const reviewTime = (review) => Date.parse(review?.publishedAt || '') || 0

// Newest publication first (createTime, not the edit date); reviews without a
// known date keep Google's order.
export function sortGoogleReviews(reviews = []) {
  return reviews.map((review, index) => ({ review, index }))
    .sort((a, b) => (reviewTime(b.review) - reviewTime(a.review)) || (a.index - b.index))
    .map(({ review }) => review)
}

export function googleReviewDate(review) {
  if (review?.publishedAt) {
    const published = dayLabel(review.publishedAt)
    return review.updatedAt ? `${published} · modifié le ${dayLabel(review.updatedAt)}` : published
  }
  return review?.when || ''
}
