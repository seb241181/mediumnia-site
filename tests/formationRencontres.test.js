import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = () => read('src/components/FormationPage.jsx')
const section = () => {
  const source = page()
  const start = source.indexOf('<section id="rencontres"')
  return source.slice(start, source.indexOf('</section>', start))
}

test('rencontres : les cinq samedis du premier cycle 2027, dans l’ordre, de 10 h à 12 h', () => {
  const source = page()
  const dates = [...source.matchAll(/\{ date: '(2027-\d\d-\d\d)', jour: '([^']+)', theme: '([^']+)' \}/g)].map((m) => [m[1], m[2], m[3]])
  assert.deepEqual(dates, [
    ['2027-01-16', 'Samedi 16 janvier 2027', 'Premiers apprentissages'],
    ['2027-02-13', 'Samedi 13 février 2027', 'Perceptions et discernement'],
    ['2027-03-13', 'Samedi 13 mars 2027', 'Pratique et techniques'],
    ['2027-04-10', 'Samedi 10 avril 2027', 'Approfondissement'],
    ['2027-05-22', 'Samedi 22 mai 2027', 'Intégration et autonomie'],
  ])
  for (const [iso] of dates) assert.equal(new Date(`${iso}T12:00:00Z`).getUTCDay(), 6, `${iso} doit être un samedi`)
  assert.match(section(), /Le samedi, de 10 h à 12 h \(heure de Paris\)/)
  assert.match(section(), /dateTime=\{`\$\{r\.date\}T10:00\+01:00`\}/)
})

test('rencontres : incluses sans supplément, réservations présentées comme non ouvertes, aucun lien de visio', () => {
  const source = page()
  assert.match(section(), /sans supplément pour les élèves de la formation complète \(597 €\)/)
  assert.match(section(), /Réservations pas encore ouvertes/)
  assert.match(source, /Les réservations ne sont pas encore ouvertes\. Les modalités de réservation, le nombre de places par rencontre et les conditions d'accès seront communiqués/)
  assert.match(source, /Si vous n'êtes pas encore prêt pour un thème, vous le retrouverez lors d'une prochaine programmation/)
  assert.match(source, /Les cinq thèmes seront reprogrammés lors de prochains cycles/)
  assert.doesNotMatch(source, /zoom\.us|meet\.google|teams\.microsoft/i)
  assert.doesNotMatch(section(), /<button|<a |href=|onClick|FormationCheckout|inscri(?:vez|ption ouverte)/i)
})

test('rencontres : la page garde ses deux paiements et sa navigation pointe vers le nouveau bloc', () => {
  const source = page()
  assert.equal((source.match(/<FormationCheckout product="discovery" \/>/g) || []).length, 1)
  assert.equal((source.match(/<FormationCheckout \/>/g) || []).length, 1)
  assert.match(source, /\{ id: 'rencontres', label: 'Visios 2027' \}/)
  assert.match(source, /q: 'Les rencontres en visio sont-elles comprises dans la formation \?'/)
})
