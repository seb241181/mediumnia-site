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

test('Lydie Lesaffre is prepared as founder 002 from her public Mots pour Maux profile', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'lydie-lesaffre'/)
  assert.match(data, /founderNumber: 2/)
  assert.match(data, /Psychopraticienne en hypnose · Médium/)
  assert.match(data, /Hypnose Ericksonienne/)
  assert.match(data, /Constellations familiales/)
  assert.match(data, /Médiumnité/)
  assert.match(data, /https:\/\/www\.mots-pour-maux\.com\//)
  assert.match(directory, /Médiumnité/)
  assert.match(directory, /Hypnose Ericksonienne/)
})
