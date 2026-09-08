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

test('practitioner profile uses network data and keeps external contact explicit', async () => {
  const { profile } = await readSources()
  assert.match(profile, /reseauPractitioners\.find/)
  assert.match(profile, /practitioner\.bookingUrl/)
  assert.match(profile, /practitioner\.externalLabel/)
  assert.match(profile, /Membre Fondateur MediumIA/)
  assert.match(profile, /Participation au lancement du Réseau/)
  assert.match(profile, /ne constitue ni une certification ni une garantie de compétence/)
  assert.match(profile, /Contact public/)
  assert.match(profile, /Array\.isArray\(practical\.phones\)/)
  assert.match(profile, /tel:\$\{phone\.replace/)
  assert.match(profile, /mailto:\$\{practical\.email\}/)
  assert.match(profile, /Appeler · \{phone\}/)
  assert.match(profile, /Écrire · \{practical\.email\}/)
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

test('Lydie Lesaffre is founder 008 with Mots pour Maux profile', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'lydie-lesaffre'[\s\S]*founderNumber: 8/)
  assert.match(data, /Psychopraticienne en hypnose · Médium/)
  assert.match(data, /city: 'Arras & Annezin'/)
  assert.match(data, /'Hypnose Ericksonienne'/)
  assert.match(data, /'Constellations familiales'/)
  assert.match(data, /'Médiumnité'/)
  assert.match(data, /phone: '06 62 51 79 79'/)
  assert.match(data, /email: 'hypnose\.arras@free\.fr'/)
  assert.match(data, /https:\/\/www\.mots-pour-maux\.com\//)
  assert.match(data, /Découvrir Mots pour Maux/)
  assert.match(directory, /'Hypnose Ericksonienne'/)
  assert.match(directory, /'Constellations familiales'/)
})

test('Willy Ryckebusch is founder 003 with his verified public contact', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'willy-ryckebusch'[\s\S]*founderNumber: 3/)
  assert.match(data, /Magnétiseur · Maître Reiki · Médium/)
  assert.match(data, /city: 'Wormhout'/)
  assert.match(data, /'Magnétisme'/)
  assert.match(data, /'Reiki'/)
  assert.match(data, /'Animaux'/)
  assert.match(data, /phone: '06 22 82 32 71'/)
  assert.match(data, /email: 'willyreikibusch@gmail\.com'/)
  assert.match(data, /ne remplacent pas un diagnostic, un traitement ou un suivi médical ou vétérinaire/)
  assert.match(data, /https:\/\/willyreikibusch\.wixsite\.com\/monsite-2/)
  assert.match(data, /Découvrir le site de Willy/)
  assert.match(directory, /'Magnétisme'/)
  assert.match(directory, /'Reiki'/)
})

test('Clara Sidler is founder 004 with her validated services and Calendly booking', async () => {
  const { data, directory } = await readSources()
  const start = data.indexOf("id: 'clara-sidler'")
  const end = data.indexOf("id: 'gilda'", start)
  const clara = data.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(clara, /founderNumber: 4/)
  assert.match(clara, /Médium · Soins énergétiques · Tarot évolutif/)
  assert.doesNotMatch(clara, /06 99 44 09 14/)
  assert.match(clara, /email: 'contact@clarasidler\.com'/)
  assert.match(clara, /startingPrice: 'À partir de 110 €'/)
  assert.match(clara, /Soin énergétique'[\s\S]*45 min[\s\S]*110 €/)
  assert.match(clara, /Médiumnité'[\s\S]*120 €/)
  assert.match(clara, /Tarot évolutif blanc'[\s\S]*45 min[\s\S]*110 €/)
  assert.match(clara, /lecture d’aura/)
  assert.doesNotMatch(clara, /Reiki/)
  assert.match(clara, /https:\/\/calendly\.com\/clarasidler/)
  assert.match(clara, /Voir ses consultations/)
  assert.match(directory, /'Soin énergétique'/)
  assert.match(directory, /'Tarot évolutif'/)
  assert.match(directory, /Amandine, Lydie, Willy, Clara, Stéphanie, Gilda et Blandine/)
})

test('Gilda is founder 006 with current cartomancie profile, image and contact', async () => {
  const { data, directory, profile } = await readSources()
  assert.match(data, /id: 'gilda'[\s\S]*founderNumber: 6/)
  assert.match(data, /Voyante · Cartomancienne/)
  assert.match(data, /startingPrice: '40 €'/)
  assert.match(data, /duration: '1 h'/)
  assert.match(data, /phones: \['06 79 36 16 07', '03 28 21 89 83'\]/)
  assert.match(data, /Consultation de cartomancie'[\s\S]*1 h[\s\S]*40 €/)
  assert.match(data, /portrait: '\/images\/reseau\/gilda-cartomancie\.jpg'/)
  assert.match(data, /'Voyance'/)
  assert.match(data, /'Cartomancie'/)
  assert.match(data, /Voir la fiche Google de Gilda/)
  assert.match(data, /0x47dcf7d908be2da3:0x664c404e4875e75a/)
  assert.match(directory, /'Voyance'/)
  assert.match(directory, /'Cartomancie'/)
  assert.match(profile, /Array\.isArray\(practical\.phones\)/)
  assert.match(profile, /practitioner\.city \? ` · \$\{practitioner\.city\}` : ''/)
})

test('Blandine Gourdin is founder 007 with verified Terapiz details and portrait', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'blandine-gourdin'[\s\S]*founderNumber: 7/)
  assert.match(data, /Médium · Magnétisme · Soins énergétiques · Ostéofluidique/)
  assert.match(data, /city: 'Offekerque'/)
  assert.match(data, /phone: '06 19 76 75 44'/)
  assert.match(data, /startingPrice: 'À partir de 70 €'/)
  assert.match(data, /Dégagement des lieux'[\s\S]*100 €/)
  assert.match(data, /Atelier bien-être'[\s\S]*350 €/)
  assert.match(data, /portrait: '\/images\/reseau\/blandine-gourdin\.jpg'/)
  assert.match(data, /https:\/\/terapiz\.com\/therapeute\/offekerque\/blandine-gourdin/)
  assert.match(data, /Prendre rendez-vous avec Blandine/)
  assert.match(directory, /Blandine/)
})

test('Stephanie Madhyama is founder 002 with portrait, cadrage and booking URL', async () => {
  const { data, directory } = await readSources()
  assert.match(data, /id: 'stephanie-madhyama'[\s\S]*founderNumber: 2/)
  assert.match(data, /Médium · écriture automatique/)
  assert.match(data, /city: 'Lederzeele'/)
  assert.match(data, /'Médiumnité'/)
  assert.match(data, /'Écriture automatique'/)
  assert.match(data, /portrait: '\/images\/reseau\/stephanie-madhyama\.jpg'/)
  assert.match(data, /portraitPosition: 'center top'/)
  assert.match(data, /https:\/\/stephanie-madhyama\.reservio\.com\//)
  assert.match(data, /Réserver avec Stéphanie/)
  assert.match(directory, /Stéphanie/)
})
