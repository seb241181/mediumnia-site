import { readFile, readdir } from 'node:fs/promises'

const assetsDir = new URL('../dist/assets/', import.meta.url)
const requiredLabels = [
  'Votre tirage en 30 secondes',
  'La fréquence principale',
  'Ce qui doit se terminer avant la suite',
  'Ce que racontent les trois fréquences ensemble',
  'Pourquoi maintenant ?',
  'Donnée calculée',
  'Interprétation symbolique',
  'Les deux chemins possibles',
  'Vos leviers concrets',
  'La question que Chronosphère vous renvoie',
]

const files = await readdir(assetsDir).catch(() => [])
const scripts = files.filter((file) => file.endsWith('.js'))
const scriptSources = await Promise.all(
  scripts.map(async (file) => ({
    file,
    source: await readFile(new URL(file, assetsDir), 'utf8'),
  })),
)
const bundle = scriptSources.map((item) => item.source).join('\n')

const missing = requiredLabels.filter((label) => !bundle.includes(label))
if (missing.length) {
  throw new Error(`Chronosphere V2 bundle check failed. Missing labels: ${missing.join(', ')}`)
}

const v2OfferBundle = scriptSources
  .filter((item) => item.file.startsWith('ChronospherePage-') || item.source.includes('chronosphere_packPendingPayment'))
  .map((item) => item.source)
  .join('\n')

// Depuis le 27/09/2026, la page ChronoSphère présente MAX, mais seulement
// comme un lien vers sa page dédiée (/chronosphere-max, compte obligatoire) :
// le formulaire V2 ne vend toujours que le tirage unique et le pack de 3.
const v2Offer = v2OfferBundle || bundle
if (v2Offer.includes('ChronoSphère MAX') && !v2Offer.includes('/chronosphere-max')) {
  throw new Error('Chronosphere V2 bundle check failed. "ChronoSphère MAX" may only appear as a link to /chronosphere-max.')
}
if (/setSelectedProduct\(["']max3["']\)/.test(v2OfferBundle)) {
  throw new Error('Chronosphere V2 bundle check failed. The V2 form must not sell the MAX product.')
}

console.log('Chronosphere V2 bundle check passed')
