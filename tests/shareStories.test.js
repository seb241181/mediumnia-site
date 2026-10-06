import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the shared story helper counts a share only on success and downloads otherwise', async () => {
  const { shareImageFile } = await import('../src/lib/shareImage.js')
  assert.equal(typeof shareImageFile, 'function')
  const helper = read('src/lib/shareImage.js')
  assert.match(helper, /return 'cancelled'/)
  assert.match(helper, /return 'shared'/)
  assert.match(helper, /return 'downloaded'/)
  assert.equal(1080, (await import('../src/lib/shareImage.js')).STORY_W)
  assert.equal(1920, (await import('../src/lib/shareImage.js')).STORY_H)
})

test('the quiz result offers a story image share and links to the quiz', () => {
  const page = read('src/components/QuizSensibilitePage.jsx')
  assert.match(page, /Partager en story/)
  assert.match(page, /drawQuizImage/)
  assert.match(page, /if \(outcome === 'cancelled'\) return\n\s+trackMediumiaMetric\('quiz_shared', 'quiz'\)/)
  const img = read('src/lib/quizShareImage.js')
  assert.match(img, /mediumia\.fr\/quiz-sensibilite/)
})

test('the Oracle free draw offers a story share that keeps the interpretation private', () => {
  const patch = read('scripts/apply-share-stories.mjs')
  assert.match(patch, /Partager mon tirage en story/)
  assert.match(patch, /jamais votre interprétation personnelle/)
  assert.match(patch, /trackMediumiaMetric\('oracle_shared', 'oracle'\)/)
  assert.match(patch, /'quiz_email_optin_completed',\\n {2}'oracle_shared',/)
  const img = read('src/lib/oracleShareImage.js')
  assert.match(img, /mediumia\.fr\/oracle/)
  // L'image ne dessine jamais l'interprétation.
  assert.doesNotMatch(img, /interpretation/)
  for (const hook of ['predev', 'pretest', 'prebuild']) {
    assert.match(JSON.parse(read('package.json')).scripts[hook], /apply-home-growth-path\.mjs && node scripts\/apply-share-stories\.mjs/)
  }
})
