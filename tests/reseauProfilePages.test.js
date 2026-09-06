import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const profilePath = new URL('../src/components/PractitionerProfile.jsx', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const directoryPath = new URL('../src/components/ReseauDirectory.jsx', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)

async function readSources() {
  const [profile, app, directory, vercelRaw] = await Promise.all([
    readFile(profilePath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(directoryPath, 'utf8'),
    readFile(vercelPath, 'utf8'),
  ])
  return { profile, app, directory, vercel: JSON.parse(vercelRaw) }
}

test('practitioner profile uses existing network data and keeps booking external', async () => {
  const { profile } = await readSources()
  assert.match(profile, /reseauPractitioners\.find/)
  assert.match(profile, /practitioner\.bookingUrl/)
  assert.match(profile, /Membre Fondateur MediumIA/)
  assert.match(profile, /ne constitue ni une certification ni une garantie de résultat/)
})

test('directory opens a dedicated MediumIA profile before external availability', async () => {
  const { directory } = await readSources()
  assert.match(directory, /onOpenProfile/)
  assert.match(directory, /Découvrir son profil/)
  assert.match(directory, /Disponibilités/)
})

test('profile route is lazy and direct practitioner URLs are rewritten to the SPA', async () => {
  const { app, vercel } = await readSources()
  assert.match(app, /const PractitionerProfile = lazy/)
  assert.match(app, /reseau-profile/)
  assert.match(app, /openReseauProfile/)
  const profileRewrite = vercel.rewrites.find((item) => item.source === '/reseau/:slug')
  assert.equal(profileRewrite?.destination, '/index.html')
})
