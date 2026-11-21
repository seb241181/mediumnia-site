// Doublons POSSIBLES entre un avis déposé sur MediumIA et un avis Google.
//
// Règle : on compare uniquement le TEXTE des avis (mots communs), jamais le
// prénom ni l'initiale. Deux personnes différentes peuvent avoir le même
// prénom ; une même personne peut signer autrement.
// Ce n'est qu'un signalement pour la modération : aucun avis n'est masqué,
// retiré ou modifié automatiquement.

const STOP_WORDS = new Set([
  'les', 'des', 'une', 'pour', 'avec', 'dans', 'que', 'qui', 'est', 'pas', 'mais', 'sur', 'par', 'son', 'ses', 'mes',
  'mon', 'moi', 'vous', 'votre', 'vos', 'nous', 'elle', 'ils', 'été', 'tout', 'tres', 'très', 'plus', 'cette', 'ces',
  'aux', 'avait', 'avoir', 'suis', 'fait', 'merci', 'encore', 'bien', 'aussi', 'comme', 'sans', 'meme', 'même',
])

export function reviewWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )
}

// Part des mots du texte le plus court que l'on retrouve dans l'autre (0 à 1).
export function textOverlap(a, b) {
  const left = reviewWords(a)
  const right = reviewWords(b)
  const smaller = left.size <= right.size ? left : right
  const larger = smaller === left ? right : left
  if (smaller.size < 6) return 0
  let common = 0
  for (const word of smaller) if (larger.has(word)) common += 1
  return common / smaller.size
}

export const DUPLICATE_THRESHOLD = 0.6

// Renvoie { [id avis MediumIA]: [{ author, publishedAt, when, overlap }] }.
export function findPossibleDuplicates(siteReviews = [], googleReviews = [], threshold = DUPLICATE_THRESHOLD) {
  const result = {}
  for (const site of siteReviews) {
    const matches = googleReviews
      .map((google) => ({ author: google.author, publishedAt: google.publishedAt || null, when: google.when || '', overlap: textOverlap(site.body, google.text) }))
      .filter((match) => match.overlap >= threshold)
      .sort((x, y) => y.overlap - x.overlap)
    if (matches.length) result[site.id] = matches
  }
  return result
}
