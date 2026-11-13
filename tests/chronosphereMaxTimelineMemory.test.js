import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildMaxMemoryForReading,
  detectRedThreadCard,
  maxMemoryPromptContext,
  recurringNumbersAcrossLine,
  summarizeChronosphereLine,
} from '../lib/chronosphereMaxCompare.js'

const NAMES = { 1: 'Un', 2: 'Deux', 3: 'Trois', 4: 'Quatre', 5: 'Cinq', 6: 'Six', 7: 'Sept', 8: 'Huit', 9: 'Neuf' }
function entry(sequenceNumber, numbers, extra = {}) {
  const [main, ...rest] = numbers
  return {
    sequenceNumber,
    snapshot: {
      theme: 'projet',
      readAt: `2026-11-1${sequenceNumber}T10:00:00.000Z`,
      mainCard: { number: main, name: NAMES[main] },
      resonances: rest.map((n) => ({ number: n, name: NAMES[n] })),
      synthesis: `Synthèse ${sequenceNumber}`,
      stillOpen: `Ouvert ${sequenceNumber}`,
      bifurcationPoint: `Question ${sequenceNumber}`,
      levers: [{ key: 'now', text: `Levier ${sequenceNumber}` }],
      timing: { primary: { peak: `2026-12-0${sequenceNumber}` } },
      ...extra,
    },
  }
}
const card = (n) => ({ card_number: n, name: NAMES[n] })

test('lecture 1 : aucune mémoire, le prompt reste inchangé', () => {
  assert.equal(buildMaxMemoryForReading([], [card(1), card(2), card(3)]), null)
  assert.equal(maxMemoryPromptContext(null), '')
})

test('lecture 2 : la première lecture est transmise et un nombre qui revient est repéré', () => {
  const memory = buildMaxMemoryForReading([entry(1, [1, 2, 3])], [card(4), card(2), card(5)])
  assert.equal(memory.sequence, 2)
  assert.equal(memory.isFinal, false)
  assert.deepEqual(memory.recurringNumbers.map((item) => item.number), [2])
  assert.equal(memory.redThread, null)
  const text = maxMemoryPromptContext(memory)
  assert.match(text, /DEUXIEME/)
  assert.match(text, /Synthèse 1/)
  assert.match(text, /N°2 Deux — choisie aux lectures 1, 2/)
  assert.doesNotMatch(text, /CARTE FIL ROUGE CALCULEE/)
})

test('sans récurrence : le prompt l’interdit explicitement', () => {
  const memory = buildMaxMemoryForReading([entry(1, [1, 2, 3])], [card(4), card(5), card(6)])
  assert.deepEqual(memory.recurringNumbers, [])
  assert.match(maxMemoryPromptContext(memory), /AUCUN\. Aucune carte du tirage actuel/)
})

test('lecture 3 : fil rouge quand une carte est choisie trois fois', () => {
  const memory = buildMaxMemoryForReading([entry(1, [1, 2, 3]), entry(2, [4, 2, 5])], [card(6), card(7), card(2)])
  assert.equal(memory.isFinal, true)
  assert.equal(memory.redThread.number, 2)
  assert.equal(memory.redThread.reason, 'three_readings')
  const text = maxMemoryPromptContext(memory)
  assert.match(text, /TROISIEME/)
  assert.match(text, /CARTE FIL ROUGE CALCULEE\nN°2 Deux/)
  assert.match(text, /comparant explicitement la troisième à la première/)
})

test('fil rouge : jamais obligatoire, jamais en cas d’égalité', () => {
  assert.equal(detectRedThreadCard([entry(1, [1, 2, 3]), entry(2, [4, 5, 6]), entry(3, [7, 8, 9])]), null)
  // deux cartes reviennent deux fois, chacune une fois en principale : égalité
  assert.equal(detectRedThreadCard([entry(1, [1, 2, 3]), entry(2, [2, 1, 4]), entry(3, [7, 8, 9])]), null)
  // une carte revient deux fois sans jamais être principale : insuffisant
  assert.equal(detectRedThreadCard([entry(1, [1, 2, 3]), entry(2, [4, 2, 5]), entry(3, [7, 8, 9])]), null)
  // deux fois dont une en principale : retenue
  assert.equal(detectRedThreadCard([entry(1, [2, 1, 3]), entry(2, [4, 5, 6]), entry(3, [7, 2, 9])]).number, 2)
  // moins de trois lectures : jamais
  assert.equal(detectRedThreadCard([entry(1, [2, 1, 3]), entry(2, [2, 5, 6])]), null)
  const text = maxMemoryPromptContext(buildMaxMemoryForReading([entry(1, [1, 2, 3]), entry(2, [4, 5, 6])], [card(7), card(8), card(9)]))
  assert.match(text, /AUCUNE\. Les données ne désignent aucune carte fil rouge/)
})

test('synthèse de ligne : comparaison directe 3 ↔ 1 et nombres récurrents', () => {
  const entries = [entry(1, [1, 2, 3]), entry(2, [4, 5, 6]), entry(3, [1, 7, 8])]
  const line = summarizeChronosphereLine(entries)
  assert.deepEqual(line.recurringNumbers.map((item) => [item.number, item.readings]), [[1, [1, 3]]])
  assert.equal(line.redThread.number, 1)
  // 3 comparée à 2 : aucune carte commune ; 3 comparée à 1 : la carte 1 persiste
  assert.equal(line.trajectory.persistent.some((fact) => fact.kind === 'recurring_card'), false)
  assert.equal(line.fromStart.persistent.some((fact) => fact.kind === 'recurring_card'), true)
  assert.equal(summarizeChronosphereLine(entries.slice(0, 2)).fromStart, null)
  assert.deepEqual(recurringNumbersAcrossLine(entries.slice(0, 2)), [])
})

test('règles de rédaction : pas d’événement réel, pas de lien inventé', () => {
  const text = maxMemoryPromptContext(buildMaxMemoryForReading([entry(1, [1, 2, 3])], [card(4), card(5), card(6)]))
  assert.match(text, /Ne dis JAMAIS que quelque chose s'est produit/)
  assert.match(text, /N'invente aucun lien symbolique/)
  assert.match(text, /restent le centre de la lecture/)
  assert.doesNotMatch(text, /birth|naissance|@/i)
})

test('moteur : mémoire limitée au compte, au pack et au consentement', async () => {
  const source = await readFile(new URL('../lib/oracleTimeline.js', import.meta.url), 'utf8')
  const loader = source.slice(source.indexOf('async function loadChronosphereMaxMemory'), source.indexOf('async function persistChronosphereMaxMemory'))
  assert.match(loader, /\.eq\('user_id', maxUser\.id\)\s*\.eq\('max_pack_id', maxPack\.id\)/)
  assert.match(loader, /!timeline\.memory_consent_at\) return null/)
  assert.match(loader, /\.eq\('timeline_id', timeline\.id\)\s*\.eq\('user_id', maxUser\.id\)/)
  assert.match(source, /const maxMemory = maxPack \? await loadChronosphereMaxMemory/)
})
