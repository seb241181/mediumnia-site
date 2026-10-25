import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { RENCONTRES_CYCLE_1 } from '../lib/formationRencontres.js'
import { MEDIUMIA_PUBLIC_CATALOG } from '../lib/mediumiaPublicCatalog.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = () => read('src/components/FormationPage.jsx')
const section = () => {
  const source = page()
  const start = source.indexOf('<section id="rencontres"')
  return source.slice(start, source.indexOf('</section>', start))
}
const paris = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

test('annonce : cinq samedis du premier cycle 2027, de 10 h à 12 h heure de Paris (hiver et été)', () => {
  assert.deepEqual(RENCONTRES_CYCLE_1.map((r) => [r.label, r.theme]), [
    ['Samedi 16 janvier 2027', 'Premiers apprentissages'],
    ['Samedi 13 février 2027', 'Perceptions et discernement'],
    ['Samedi 13 mars 2027', 'Pratique et techniques'],
    ['Samedi 10 avril 2027', 'Approfondissement'],
    ['Samedi 22 mai 2027', 'Intégration et autonomie'],
  ])
  for (const r of RENCONTRES_CYCLE_1) {
    assert.equal(paris(r.startsAt), 'samedi 10:00', r.id)
    assert.equal(paris(r.endsAt), 'samedi 12:00', r.id)
  }
})

test('annonce : réservations présentées comme à venir, sans lien, bouton ni page de réservation', () => {
  const source = page()
  assert.match(source, /import \{ RENCONTRES_CYCLE_1 \} from '\.\.\/\.\.\/lib\/formationRencontres\.js'/)
  assert.match(section(), /<time dateTime=\{r\.startsAt\}/)
  assert.match(section(), /Le samedi, de 10 h à 12 h \(heure de Paris\)/)
  assert.match(section(), /Réservations : ouverture prochainement/)
  assert.match(section(), /La Découverte à 29 € seule n'y donne pas accès\./)
  assert.match(source, /Les réservations ouvriront prochainement, depuis votre espace élève\. Chaque rencontre se déroule en petit groupe : 5 places au lancement\./)
  assert.doesNotMatch(source, /zoom\.us|meet\.google|teams\.microsoft|\/formation\/rencontres/i)
  assert.doesNotMatch(section(), /<button|<a |href=|onClick|FormationCheckout|modules? \d/i)
})

test('annonce : les deux paiements restent en place, le menu et la FAQ annoncent les visios', () => {
  const source = page()
  assert.equal((source.match(/<FormationCheckout product="discovery" \/>/g) || []).length, 1)
  assert.equal((source.match(/<FormationCheckout \/>/g) || []).length, 1)
  assert.match(source, /\{ id: 'rencontres', label: 'Visios 2027' \}/)
  assert.match(read('scripts/apply-formation-simple-checkout.mjs'), /\{ id: 'rencontres', label: 'Visios 2027' \}/)
  assert.match(source, /q: 'Les rencontres en visio sont-elles comprises dans la formation \?'/)
})

test('annonce : l’assistant connaît les cinq dates sans ouvrir de réservation', () => {
  for (const r of RENCONTRES_CYCLE_1) assert.ok(MEDIUMIA_PUBLIC_CATALOG.includes(`${r.label} (${r.theme.toLowerCase()})`), r.id)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /Les réservations ne sont PAS encore ouvertes : elles ouvriront prochainement/)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /La formule Découverte à 29 € seule ne donne pas accès aux rencontres/)
  assert.doesNotMatch(MEDIUMIA_PUBLIC_CATALOG, /zoom\.us|meet\.google|teams\.microsoft|\/formation\/rencontres/i)
})

test('annonce : en page publiée, les rencontres précèdent immédiatement les trois exercices offerts', () => {
  const source = page()
  const main = source.slice(source.indexOf('export default function FormationPage'))
  const start = main.indexOf('<section id="rencontres"')
  const exercises = main.indexOf('<FormationExerciseLead />')
  assert.ok(start >= 0 && exercises > start, 'Les rencontres doivent précéder les exercices offerts')
  assert.ok(main.slice(start, exercises).trimEnd().endsWith('</section>'), 'Aucun autre bloc ne doit séparer les rencontres des exercices')
  const script = read('scripts/apply-formation-simple-checkout.mjs')
  assert.ok(script.indexOf("{ id: 'rencontres', label: 'Visios 2027' }") < script.indexOf("{ id: 'formation-exercices-gratuits', label: 'Exercices offerts' }"))
})

test('achat public : le lecteur découvre le programme et les rencontres avant les formules en bas', () => {
  const source = page()
  const main = source.slice(source.indexOf('export default function FormationPage'))
  const offres = main.slice(main.indexOf('<section id="offre"'))
  assert.ok(main.indexOf('id="programme"') < main.indexOf('<section id="offre"'))
  assert.ok(main.indexOf('id="rencontres"') < main.indexOf('<section id="offre"'))
  assert.ok(main.indexOf('id="formation-exercices-gratuits"') < main.indexOf('<section id="offre"') || main.indexOf('<FormationExerciseLead />') < main.indexOf('<section id="offre"'))
  assert.ok(offres.indexOf('id="formation-progressive"') < offres.indexOf('id="formation-complete"'))
  assert.ok(offres.indexOf('id="formation-complete"') < offres.indexOf('id="formation-decouverte"'))
  assert.ok(offres.includes('<ParcoursOffer />'))
  assert.match(source, /goTo\('formation-complete'\)/)
  assert.match(source, /Accéder à la formation complète — 597 €/)
  assert.equal((source.match(/<FormationCheckout \/>/g) || []).length, 1)
  assert.equal((source.match(/<FormationCheckout product="discovery" \/>/g) || []).length, 1)
})

