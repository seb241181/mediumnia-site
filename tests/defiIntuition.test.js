import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const { secureIndex, parisDay, recordDay, stats, shareText, loadState, saveState, emptyState, ROUNDS, CARDS } = await import('../src/lib/defiIntuition.js')
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the Étoile is drawn fairly among the 5 cards', () => {
  const counts = Array(CARDS).fill(0)
  for (let i = 0; i < 50000; i += 1) counts[secureIndex(CARDS)] += 1
  for (const c of counts) assert.ok(c > 9400 && c < 10600, `uneven draw: ${counts}`)
  // Values above the last full multiple of 5 are redrawn, never folded (no bias).
  const values = [0xffffffff, 7]
  assert.equal(secureIndex(5, (buf) => { buf[0] = values.shift() }), 2)
})

test('the daily challenge follows the Paris calendar', () => {
  assert.equal(parisDay(new Date('2026-10-21T22:30:00Z')), '2026-10-22')
  assert.equal(parisDay(new Date('2026-12-31T22:30:00Z')), '2026-12-31')
  assert.equal(parisDay(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
})

test('one score per day, a streak of consecutive days, and replays do not count', () => {
  let state = emptyState()
  state = recordDay(state, '2026-10-20', [true, false, false, false, false])
  state = recordDay(state, '2026-10-21', [true, true, false, false, true])
  state = recordDay(state, '2026-10-21', [true, true, true, true, true])
  assert.deepEqual(state.days['2026-10-21'].hits.filter(Boolean).length, 3, 'first result of the day is kept')
  const s = stats(state, '2026-10-22')
  assert.deepEqual([s.daysPlayed, s.rounds, s.found, s.streak, s.best], [2, 10, 4, 2, 3], 'streak still alive the next morning')
  assert.equal(stats(state, '2026-10-24').streak, 0, 'a missed day breaks the streak')
})

test('the shared score reads like a little grid, with the chance baseline and the link', () => {
  const text = shareText('2026-10-22', [true, false, true, false, false])
  assert.equal(text, `🔮 Défi Intuition MediumIA · 22/10/2026\n🌟🌑🌟🌑🌑 2/${ROUNDS}\nLe hasard trouve 1 carte sur 5. Et vous ?\nhttps://mediumia.fr/defi-intuition`)
})

test('scores survive a broken or missing storage', () => {
  assert.deepEqual(loadState({ getItem: () => '{oops' }), emptyState())
  assert.deepEqual(loadState(null), emptyState())
  assert.doesNotThrow(() => saveState({ setItem: () => { throw new Error('quota') } }, emptyState()))
})

test('the game is routed, previewed when shared, and honest about chance', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(vercel.rewrites.some((r) => r.source === '/defi-intuition'))
  assert.match(read('src/App.jsx'), /p === '\/defi-intuition' \? 'defi-intuition'/)
  assert.match(read('scripts/prerender-route-meta.mjs'), /'defi-intuition': \{ src: '\/images\/defi-intuition\/defi-intuition-partage\.jpg'/)
  assert.ok(fs.existsSync(new URL('../public/images/defi-intuition/defi-intuition-partage.jpg', import.meta.url)))
  const page = read('src/components/DefiIntuitionPage.jsx')
  assert.match(page, /ne mesure pas un don et ne prédit rien/)
  assert.match(page, /setTarget\(secureIndex\(CARDS\)\)/)
})
