import { readFile, readdir } from 'node:fs/promises'

const assetsDir = new URL('../dist/assets/', import.meta.url)
const requiredLabels = [
  'Votre tirage en 30 secondes',
  'La fréquence principale',
  'Ce que racontent les trois fréquences ensemble',
  'Les deux chemins possibles',
  'Vos leviers concrets',
  'La question que Chronosphère vous renvoie',
]

const files = await readdir(assetsDir).catch(() => [])
const scripts = files.filter((file) => file.endsWith('.js'))
const bundle = (await Promise.all(
  scripts.map(async (file) => readFile(new URL(file, assetsDir), 'utf8')),
)).join('\n')

const missing = requiredLabels.filter((label) => !bundle.includes(label))
if (missing.length) {
  throw new Error(`Chronosphere V2 bundle check failed. Missing labels: ${missing.join(', ')}`)
}

console.log('Chronosphere V2 bundle check passed')
