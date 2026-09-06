import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const profilePath = new URL('../src/components/PractitionerProfile.jsx', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const directoryPath = new URL('../src/components/ReseauDirectory.jsx', import.meta.url)
const dataPath = new URL('../src/data/reseauPractitioners.js', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)

async function readSources() {
  const [profile, app, directory, data, vercelRaw] = await Promise.all([
    readFile(profilePath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(directoryPath, 'utf8'),
    readFile(dataPath, 'utf8'),
    readFile(vercelPath, 'utf8'),
  ])
  return { profile, app, directory, data, vercel: JSON.parse(vercelRaw) }
}

test('practitioner profile uses existing network data and keeps external contact explicit', async () => {
  const { profile } = await readSources()
  assert.match(profile, /reseauPractitioners\.find/)
  assert.match(profile, /practitioner\.bookingUrl/)
  assert.match(profile, /practitioner\.externalLabel/)
  assert.match(profile, /Membre Fondateur MediumIA/)
  assert.match(profile, /ne constitue ni une certification ni une garantie de résultat/)
})

test('directory opens a dedicated MediumIA profile before the practitioner external link', async () => {
  const { directory } = await readSources()
  assert.match(directory, /onOpenProfile/)
  assert.match(directory, /Découvrir son profil/)
  assert.match(directory, /externalLabel/)
})

test('profile route is lazy and direct practitioner URLs are rewritten to the SPA', async () => {
  const { app, vercel } = await readSources()
  assert.match(app, /const PractitionerProfile = lazy/)
  assert.match(app, /reseau-profile/)
  assert.match(app, /openReseauProfile/)
  const profileRewrite = vercel.rewrites.find((item) => item.source === '/reseau/:slug')
  assert.equal(profileRewrite?.destination, '/index.html')
})

test('Stephanie Madhyama is founder 002 with Reservio booking and a safe photo fallback', async () => {
  const { data, profile, directory } = await readSources()
  assert.match(data, /id: 'stephanie-madhyama'[\s\S]*founderNumber: 2/)
  assert.match(data, /Médium · écriture automatique/)
  assert.match(data, /https:\/\/stephanie-madhyama\.reservio\.com\//)
  assert.match(data, /Réserver avec Stéphanie/)
  assert.match(profile, /Photo du praticien à venir/)
  assert.match(directory, /Photo à venir/)
  assert.match(directory, /Écriture automatique/)
})

test('Willy Ryckebusch is founder 003 with a restrained Reiki-magnetism profile', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'willy-ryckebusch'[\s\S]*founderNumber: 3/)
  assert.match(data, /Magnétiseur · Maître Reiki · Médium/)
  assert.match(data, /city: 'Wormhout'/)
  assert.match(data, /'Magnétisme'/)
  assert.match(data, /'Reiki'/)
  assert.match(data, /'Animaux'/)
  assert.match(data, /ne remplacent pas un diagnostic, un traitement ou un suivi médical ou vétérinaire/)
  assert.match(data, /https:\/\/willyreikibusch\.wixsite\.com\/monsite-2/)
  assert.match(data, /Découvrir le site de Willy/)
  assert.match(directory, /'Magnétisme'/)
  assert.match(directory, /'Reiki'/)
})

test('Gilda is founder 006 with a restrained voyance-cartomancie profile and Google listing', async () => {
  const { data, directory, profile } = await readSources()
  assert.match(data, /id: 'gilda'[\s\S]*founderNumber: 6/)
  assert.match(data, /Voyante · Cartomancienne/)
  assert.match(data, /'Voyance'/)
  assert.match(data, /'Cartomancie'/)
  assert.match(data, /Voir la fiche Google de Gilda/)
  assert.match(data, /0x47dcf7d908be2da3:0x664c404e4875e75a/)
  assert.match(directory, /'Voyance'/)
  assert.match(directory, /'Cartomancie'/)
  assert.match(profile, /practitioner\.city \? ` · \$\{practitioner\.city\}` : ''/)
})

test('Lydie Lesaffre keeps the next reserved founder number and her public Mots pour Maux profile', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'lydie-lesaffre'[\s\S]*founderNumber: 8/)
  assert.match(data, /Psychopraticienne en hypnose · Médium/)
  assert.match(data, /Hypnose Ericksonienne/)
  assert.match(data, /Constellations familiales/)
  assert.match(data, /https:\/\/www\.mots-pour-maux\.com\//)
  assert.match(directory, /Médiumnité/)
  assert.match(directory, /Hypnose Ericksonienne/)
})
