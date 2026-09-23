import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildChronosphereMaxSnapshot } from '../lib/chronosphereMaxSnapshot.js'
import { compareChronosphereSnapshots, summarizeChronosphereLine } from '../lib/chronosphereMaxCompare.js'
import { chronosphereMaxDemoEntries, chronosphereMaxDemoTimeline } from '../src/data/chronosphereMaxDemo.js'
import { getSolarTemperament, SOLAR_TEMPERAMENTS } from '../lib/chronosphereSolarTemperament.js'

const migrationPath = new URL('../supabase/migrations/20260923143000_chronosphere_max_memory_foundation.sql', import.meta.url)
const pagePath = new URL('../src/components/ChronosphereMaxPage.jsx', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const paypalPath = new URL('../lib/chronospherePayPal.js', import.meta.url)
const verifyBundlePath = new URL('../scripts/verify-chronosphere-v2-bundle.mjs', import.meta.url)
const vercelPath = new URL('../vercel.json', import.meta.url)

function minimalResult() {
  return {
    schemaVersion: 'chronosphere-v2',
    engineVersion: 'chronosphere-999-58-v2',
    createdAt: '2026-09-23T10:00:00.000Z',
    theme: 'projet',
    profile: {
      fullName: 'Personne Exemple',
      birthDate: '1981-11-24',
      birthTime: '12:15',
      birthPlace: 'Lille, France',
    },
    sky: {
      resolvedBirthPlace: 'Lille, France',
      timeZone: 'Europe/Paris',
      houseSystem: 'Placidus',
      ascendant: '1° Balance',
      mc: '8° Cancer',
      timing: {
        horizonDays: 120,
        quality: 'soutien en construction',
        primary: {
          start: '2026-10-01',
          peak: '2026-10-05',
          end: '2026-10-09',
          aspects: [{ transitPlanet: 'Mercure', aspect: 'sextile', natalPlanet: 'Vénus', orb: 0.7 }],
        },
        alternatives: [],
        caution: null,
      },
    },
    cards: [
      { number: 12, name: 'Le Passage', block: 'Mouvement', density: 'air', astre: 'Mercure', gesture: 'Respirer.', decree: 'Je clarifie.' },
      { number: 18, name: 'La Limite', block: 'Cadre', density: 'terre', astre: 'Saturne' },
      { number: 24, name: 'Le Signal', block: 'Lien', density: 'feu', astre: 'Mars' },
    ],
    reading: {
      summary30s: 'Une trajectoire devient plus lisible quand elle est suivie dans le temps.',
      direction: null,
      closure: {
        stillOpen: 'Un choix reste ouvert.',
        mainLock: 'L’attente d’une garantie totale.',
        opensAfterClosure: 'Un test concret.',
      },
      whyNow: [
        {
          calculated: 'Mercure sextile Vénus natal dans la fenêtre prioritaire.',
          interpretation: 'La période soutient symboliquement une clarification.',
        },
        {
          calculated: 'Maison X activée dans le contexte de lecture.',
          interpretation: 'Le domaine de la direction concrète ressort.',
        },
      ],
      sections: [
        "La photographie de l'instant",
        'La fréquence principale',
        'Les deux résonances',
        'Ce que racontent les trois fréquences ensemble',
        'Le ciel de naissance et le contexte astrologique',
        'La ligne de temps',
        'Les deux chemins possibles',
        'Vos leviers concrets',
        'La question que Chronosphère vous renvoie',
      ].map((title) => ({
        title,
        content: title === 'Vos leviers concrets'
          ? 'À faire maintenant : cadrer la prochaine action.\nÀ préparer : choisir une date.\nÀ ne pas forcer : une garantie parfaite.'
          : `Contenu pour ${title}.`,
      })),
      realignmentAct: { gesture: 'Respirer.', decree: 'Je clarifie.' },
    },
    interpretation: 'Ancien rendu texte non nécessaire au snapshot.',
  }
}

test('MAX snapshot is compact and excludes duplicated personal profile data', () => {
  const snapshot = buildChronosphereMaxSnapshot(minimalResult(), {
    sourceDrawTable: 'chronosphere_paid_draws',
    sourceDrawId: '00000000-0000-4000-8000-000000000001',
  })
  const serialized = JSON.stringify(snapshot)
  assert.equal(snapshot.schemaVersion, 'chronosphere-max-snapshot-v1')
  assert.equal(snapshot.sourceSchemaVersion, 'chronosphere-v2')
  assert.equal(snapshot.mainCard.name, 'Le Passage')
  assert.equal(snapshot.activatedDomain.house, 'X')
  assert.doesNotMatch(serialized, /birthDate|birthTime|birthPlace|resolvedBirthPlace|Europe\/Paris|Personne Exemple|interpretation|drawToken|packToken|deliveryEmail/)
})

test('MAX deterministic comparator separates compared data from symbolic interpretation', () => {
  const comparison = compareChronosphereSnapshots(
    chronosphereMaxDemoEntries[1].snapshot,
    chronosphereMaxDemoEntries[2].snapshot,
    { previousSequence: 2, currentSequence: 3 },
  )
  assert.equal(comparison.schemaVersion, 'chronosphere-max-comparison-v1')
  assert.ok(comparison.facts.length >= 5)
  assert.ok(comparison.facts.every((fact) => fact.dataCompared && fact.symbolicInterpretation))
  assert.ok(comparison.facts.some((fact) => fact.kind === 'recurring_card'))
  assert.ok(comparison.facts.some((fact) => fact.kind === 'primary_window_moved'))
  assert.ok(comparison.facts.some((fact) => fact.kind === 'bifurcation_changed' || fact.kind === 'bifurcation_persists'))
  assert.doesNotMatch(JSON.stringify(comparison), /probabilit/i)
})

test('MAX third reading exposes a global Ligne de Temps synthesis', () => {
  const synthesis = summarizeChronosphereLine(chronosphereMaxDemoTimeline.entries)
  assert.equal(synthesis.entriesCount, 3)
  assert.match(synthesis.synthesis, /La Ligne de Temps/)
  assert.equal(synthesis.firstWindow, '2026-09-14')
  assert.equal(synthesis.currentWindow, '2026-10-05')
})

test('MAX migration prepares owner-scoped memory tables without applying payment changes', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /create table if not exists public\.chronosphere_timelines/)
  assert.match(sql, /create table if not exists public\.chronosphere_timeline_entries/)
  assert.match(sql, /references auth\.users\(id\) on delete cascade/)
  assert.match(sql, /references public\.chronosphere_timelines \(user_id, id\)/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/)
  assert.match(sql, /snapshot_json->>'schemaVersion' = 'chronosphere-max-snapshot-v1'/)
  assert.match(sql, /not snapshot_json \? 'birthPlace'/)
  assert.doesNotMatch(sql, /alter table public\.chronosphere_paid_draws|alter table public\.chronosphere_credit_packs|paypal/i)
})

test('MAX solar temperament covers all signs and keeps the framing symbolic', () => {
  assert.equal(Object.keys(SOLAR_TEMPERAMENTS).length, 12)
  const scorpio = getSolarTemperament('Scorpion')
  assert.equal(scorpio.symbol, '♏')
  assert.equal(scorpio.element, 'Eau')
  assert.equal(scorpio.modality, 'Fixe')
  assert.match(scorpio.lineTimeLens, /Ligne de Temps/)
  assert.equal(getSolarTemperament('scorpion').sign, 'Scorpion')
})

test('MAX preview exposes the solar temperament panel without turning it into a diagnosis', async () => {
  const page = await readFile(pagePath, 'utf8')
  assert.match(page, /Votre tempérament solaire/)
  assert.match(page, /Comment ce tempérament colore cette Ligne de Temps/)
  assert.match(page, /langage de tempérament/)
  assert.match(page, /pas une vérité psychologique/)
})

test('MAX preview route is isolated from V2 pricing and PayPal checkout', async () => {
  const [page, app, paypal, vercel] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(paypalPath, 'utf8'),
    readFile(vercelPath, 'utf8'),
  ])
  assert.match(app, /chronosphere-max/)
  assert.deepEqual(JSON.parse(vercel).rewrites.find((route) => route.source === '/chronosphere-max'), {
    source: '/chronosphere-max',
    destination: '/index.html',
  })
  assert.match(page, /Mes Lignes de Temps/)
  assert.match(page, /Continuer cette Ligne de Temps/)
  assert.match(page, /Donnée comparée/)
  assert.match(page, /Interprétation symbolique/)
  assert.match(page, /Créer une nouvelle Ligne de Temps/)
  assert.doesNotMatch(page, /PayPal|paypal|9,90|5 €|Faire mon tirage/)
  assert.doesNotMatch(page, /probabilit/i)
  assert.match(paypal, /displayAmount: '9\.90'/)
  assert.match(paypal, /displayAmount: '5\.00'/)
})

test('V2 bundle verifier stays scoped to the V2 offer while MAX becomes a distinct route', async () => {
  const verifier = await readFile(verifyBundlePath, 'utf8')
  assert.match(verifier, /v2OfferBundle/)
  assert.match(verifier, /ChronospherePage-/)
  assert.match(verifier, /chronosphere_packPendingPayment/)
  assert.doesNotMatch(verifier, /if \(bundle\.includes\('ChronoSphère MAX'\)\)/)
})
