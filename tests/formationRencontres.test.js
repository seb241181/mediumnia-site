import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { RENCONTRES_CYCLE_1, RENCONTRES_BOOKING_OPEN, rencontreEligibility } from '../lib/formationRencontres.js'
import { MEDIUMIA_PUBLIC_CATALOG } from '../lib/mediumiaPublicCatalog.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = () => read('src/components/FormationPage.jsx')
const section = () => {
  const source = page()
  const start = source.indexOf('<section id="rencontres"')
  return source.slice(start, source.indexOf('</section>', start))
}
const paris = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

test('rencontres : cinq samedis du premier cycle 2027, de 10 h à 12 h heure de Paris (hiver et été)', () => {
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
    assert.equal(r.startsAt.slice(0, 10), r.id)
  }
  assert.equal(RENCONTRES_BOOKING_OPEN, false)
})

test('page : le bloc utilise les dates partagées, sans lien de visio ni inscription', () => {
  const source = page()
  assert.match(source, /import \{ RENCONTRES_CYCLE_1 \} from '\.\.\/\.\.\/lib\/formationRencontres\.js'/)
  assert.match(section(), /<time dateTime=\{r\.startsAt\}/)
  assert.match(section(), /Le samedi, de 10 h à 12 h \(heure de Paris\)/)
  assert.match(section(), /sans supplément pour les élèves de la formation complète \(597 €\)/)
  assert.match(section(), /Réservations pas encore ouvertes/)
  assert.match(source, /Les réservations ne sont pas encore ouvertes\. Les modalités de réservation, le nombre de places par rencontre et les conditions d'accès seront communiqués/)
  assert.match(source, /Si vous n'êtes pas encore prêt pour un thème, vous le retrouverez lors d'une prochaine programmation/)
  assert.doesNotMatch(source, /zoom\.us|meet\.google|teams\.microsoft/i)
  assert.doesNotMatch(section(), /<button|<a |href=|onClick|FormationCheckout|modules? \d/i)
})

test('page : les deux paiements restent en place et le menu pointe vers le bloc', () => {
  const source = page()
  assert.equal((source.match(/<FormationCheckout product="discovery" \/>/g) || []).length, 1)
  assert.equal((source.match(/<FormationCheckout \/>/g) || []).length, 1)
  assert.match(source, /\{ id: 'rencontres', label: 'Visios 2027' \}/)
  assert.match(source, /q: 'Les rencontres en visio sont-elles comprises dans la formation \?'/)
})

const [janvier, fevrier, mars, avril, mai] = RENCONTRES_CYCLE_1
const parcoursComplet = (lastPaidAt) => [
  { kind: 'discovery', value_cents: 2900, paid_at: '2026-10-01T09:00:00Z' },
  ...Array.from({ length: 11 }, (_, i) => ({ kind: 'monthly', value_cents: 4800, paid_at: `2026-${String(Math.min(10 + i, 12)).padStart(2, '0')}-0${(i % 9) + 1}T09:00:00Z` })),
  { kind: 'monthly', value_cents: 4000, paid_at: lastPaidAt },
]

test('éligibilité : achat en une fois, Découverte + solde, ou parcours progressif terminé', () => {
  const unique = [{ kind: 'full', value_cents: 59700, paid_at: '2026-10-22T18:00:00Z' }]
  const solde = [{ kind: 'discovery', value_cents: 2900, paid_at: '2026-10-05T09:00:00Z' }, { kind: 'unlock', value_cents: 56800, paid_at: '2026-10-23T09:00:00Z' }]
  for (const payments of [unique, solde, parcoursComplet('2026-12-20T09:00:00Z')]) {
    for (const r of RENCONTRES_CYCLE_1) assert.equal(rencontreEligibility(payments, r).eligible, true, r.id)
  }
  assert.equal(rencontreEligibility(unique, mai).accessUntil, '2027-10-22T18:00:00.000Z')
})

test('éligibilité : parcours en cours = pas encore de droit, avec le reste à payer', () => {
  const enCours = [
    { kind: 'discovery', value_cents: 2900, paid_at: '2026-10-01T09:00:00Z' },
    ...Array.from({ length: 5 }, (_, i) => ({ kind: 'monthly', value_cents: 4800, paid_at: `2026-1${i % 3}-01T09:00:00Z` })),
  ]
  assert.deepEqual(rencontreEligibility(enCours, janvier), { eligible: false, reason: 'formation_incomplete', remainingCents: 32800, accessUntil: null })
  assert.equal(rencontreEligibility([], janvier).reason, 'formation_incomplete')
  assert.equal(rencontreEligibility([{ kind: 'discovery', value_cents: 2900, paid_at: '2026-10-01T09:00:00Z' }], janvier).eligible, false)
})

test('éligibilité : un remboursement retire le droit', () => {
  const rembourse = [
    { kind: 'full', value_cents: 59700, paid_at: '2026-10-22T18:00:00Z' },
    { kind: 'refund', refunded_kind: 'full', value_cents: 59700, paid_at: '2026-10-25T18:00:00Z' },
  ]
  assert.equal(rencontreEligibility(rembourse, janvier).reason, 'formation_incomplete')
})

test('éligibilité : seules les rencontres comprises dans les 12 mois d’accès sont ouvertes', () => {
  const ancien = [{ kind: 'full', value_cents: 59700, paid_at: '2026-03-01T09:00:00Z' }]
  assert.equal(rencontreEligibility(ancien, janvier).eligible, true)
  assert.equal(rencontreEligibility(ancien, fevrier).eligible, true)
  assert.deepEqual(rencontreEligibility(ancien, mars), { eligible: false, reason: 'access_expired', remainingCents: 0, accessUntil: '2027-03-01T09:00:00.000Z' })
  assert.equal(rencontreEligibility(ancien, avril).reason, 'access_expired')
  const tresAncien = [{ kind: 'full', value_cents: 59700, paid_at: '2025-12-01T09:00:00Z' }]
  for (const r of RENCONTRES_CYCLE_1) assert.equal(rencontreEligibility(tresAncien, r).reason, 'access_expired')
})

test('assistant : le catalogue annonce les cinq dates sans ouvrir de réservation', () => {
  for (const r of RENCONTRES_CYCLE_1) assert.ok(MEDIUMIA_PUBLIC_CATALOG.includes(`${r.label} (${r.theme.toLowerCase()})`), r.id)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /Les réservations ne sont PAS encore ouvertes/)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /ceux dont les paiements atteignent 597 €, en une fois ou par le parcours progressif/)
  assert.doesNotMatch(MEDIUMIA_PUBLIC_CATALOG, /zoom\.us|meet\.google|teams\.microsoft|modules? 1 ?[-–à]/i)
})
