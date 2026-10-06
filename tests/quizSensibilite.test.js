import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CHANNELS, PROFILES, QUESTIONS, QUIZ_SHARE_URL, percentages, quizShareText, scoreQuiz } from '../src/lib/quizSensibilite.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('every question offers exactly one answer per perception channel', () => {
  assert.equal(QUESTIONS.length, 8)
  for (const question of QUESTIONS) {
    assert.deepEqual(question.answers.map(([channel]) => channel).sort(), [...CHANNELS].sort())
  }
  for (const channel of CHANNELS) assert.ok(PROFILES[channel].name && PROFILES[channel].motto && PROFILES[channel].signs.length === 3)
})

test('the most chosen channel wins and ties go to the first channel chosen', () => {
  const clear = scoreQuiz(['vision', 'vision', 'sensation', 'vision', 'audience', 'vision', 'vision', 'connaissance'])
  assert.equal(clear.dominant, 'vision')
  assert.equal(clear.answered, 8)
  assert.equal(clear.balanced, false)

  const tie = scoreQuiz(['audience', 'sensation', 'audience', 'sensation', 'audience', 'sensation', 'vision', 'connaissance'])
  assert.equal(tie.dominant, 'audience')
  assert.equal(tie.secondary, 'sensation')
})

test('evenly spread answers are reported as balanced', () => {
  const result = scoreQuiz(['sensation', 'vision', 'audience', 'connaissance', 'sensation', 'vision', 'audience', 'connaissance'])
  assert.equal(result.balanced, true)
  assert.equal(result.dominant, 'sensation')
})

test('unknown answers are ignored and percentages add up', () => {
  const result = scoreQuiz(['vision', 'nope', 'vision', 'sensation'])
  assert.equal(result.answered, 3)
  const pct = percentages(result.scores)
  assert.equal(pct.vision, 67)
  assert.equal(pct.sensation, 33)
  const split = percentages({ sensation: 5, vision: 3 })
  assert.equal(split.sensation + split.vision, 100)
  assert.deepEqual(percentages({}), { sensation: 0, vision: 0, audience: 0, connaissance: 0 })
})

test('share text names the channel and links back to the quiz', () => {
  const text = quizShareText('connaissance')
  assert.match(text, /Clairconnaissance/)
  assert.ok(text.endsWith(QUIZ_SHARE_URL))
  assert.match(text, /src=story-quiz/)
})

test('the quiz page has its own route, rewrite, share preview and sitemap entry', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(vercel.rewrites.some((r) => r.source === '/quiz-sensibilite'))
  const patch = read('scripts/apply-home-growth-path.mjs')
  assert.match(patch, /p === '\/quiz-sensibilite' \? 'quiz-sensibilite'/)
  assert.match(patch, /'quiz-sensibilite': \{\n {4}title:/)
  assert.match(read('scripts/prerender-route-meta.mjs'), /'quiz-sensibilite': '\/quiz-sensibilite'/)
  assert.match(read('scripts/apply-mobile-seo-sprint.mjs'), /'\/quiz-sensibilite'/)
  for (const hook of ['predev', 'pretest', 'prebuild']) {
    assert.match(JSON.parse(read('package.json')).scripts[hook], /apply-lumia-assistant-console\.mjs && node scripts\/apply-home-growth-path\.mjs/)
  }
})

test('the quiz never claims to measure a gift or predict anything and reuses the consented 3-exercise sequence', () => {
  const page = read('src/components/QuizSensibilitePage.jsx')
  assert.match(page, /pas un diagnostic : il ne mesure pas un don et ne prédit rien/)
  assert.match(page, /\/api\/oracle-interpret\?mode=formation-email-sequence/)
  assert.match(page, /consent: true/)
  assert.match(page, /disabled=\{!consent \|\| loading \|\| done\}/)
})

test('the home page keeps the Formation first, then the quiz, the approach, the path and the Arche', () => {
  const patch = read('scripts/apply-home-growth-path.mjs')
  const order = ['<FeaturedAccompagnement', '<QuizInvite', '<ManifestoBand', '<PathLadder'].map((tag) => patch.indexOf(tag))
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])))
  assert.match(patch, /<ArcheSection \/>/)
  const sections = read('src/components/HomeGrowthPath.jsx')
  assert.match(sections, /https:\/\/www\.amazon\.fr\/dp\/B0HJY4CFFD/)
  assert.match(sections, /Troisième mouvement · en cours/)
  assert.match(read('src/components/CosmicLibraryHero.jsx'), /href="\/quiz-sensibilite"/)
})

test('the pilotage dashboard labels the quiz events and shows its funnel and home doors', () => {
  const patch = read('scripts/apply-home-growth-path.mjs')
  assert.match(patch, /quiz_completed: 'Quiz terminés'/)
  assert.match(patch, /QUIZ DES CANAUX/)
  assert.match(patch, /PARTAGES SOCIAUX/)
  assert.match(patch, /const socialShares = oracleShared \+ quizShared/)
  assert.match(patch, /eyebrow="Stories Oracle"/)
  assert.match(patch, /eyebrow="Stories Quiz"/)
  assert.match(patch, /quiz: 'Quiz des canaux', codex: 'Codex \(Amazon\)'/)
  assert.match(patch, /const home_doors = \{ oracle: 0, chronosphere: 0, reseau: 0, formation: 0, quiz: 0, codex: 0 \}/)
})

test('quiz opt-ins keep their own consent source, version and email wording', async () => {
  const { formationLeadConsent, buildFormationEmailSequence } = await import('../lib/formationEmailLead.js')
  assert.deepEqual(
    [formationLeadConsent('quiz').source, formationLeadConsent('quiz').consentVersion],
    ['quiz_page', 'quiz-3-exercises-v1-2026-10-06'],
  )
  assert.equal(formationLeadConsent().source, 'formation_page')
  assert.equal(formationLeadConsent('anything-else').source, 'formation_page')

  const quiz = buildFormationEmailSequence({ unsubscribeToken: 'q'.repeat(43), origin: 'quiz' })
  const formation = buildFormationEmailSequence({ unsubscribeToken: 'f'.repeat(43) })
  assert.ok(quiz.every((item) => item.text.includes('depuis le quiz MediumIA') && !item.text.includes('après votre tirage Oracle')))
  assert.ok(formation.every((item) => item.text.includes('depuis la page Formation MediumIA')))

  assert.match(read('src/components/QuizSensibilitePage.jsx'), /consent: true, origin: 'quiz'/)
  assert.match(read('supabase/migrations/20261006050000_allow_quiz_email_sequence_source.sql'), /'oracle_free_result', 'formation_page', 'quiz_page'/)
  assert.match(read('scripts/apply-home-growth-path.mjs'), /à la fin du quiz des canaux de perception/)
})

test('quiz sharing creates a story image and counts only a completed share or copy', () => {
  const page = read('src/components/QuizSensibilitePage.jsx')
  const image = read('src/lib/quizShareImage.js')
  assert.match(page, /drawQuizStoryImage/)
  assert.match(page, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/)
  assert.match(page, /await navigator\.share\(\{ files: \[file\], text \}\)/)
  assert.match(page, /await navigator\.clipboard\.writeText\(text\)/)
  assert.match(page, /trackMediumiaMetric\('quiz_shared', 'quiz'\)/)
  assert.match(image, /const W = 1080/)
  assert.match(image, /const H = 1920/)
  assert.match(image, /MON CANAL DE PERCEPTION/)
  assert.match(image, /mediumia\.fr\/quiz-sensibilite/)
})
