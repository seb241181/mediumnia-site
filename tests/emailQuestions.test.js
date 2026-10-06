import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMAIL_QUESTION_DAILY_CAP,
  EMAIL_QUESTION_PACKS,
  EMAIL_QUESTION_TERMS_VERSION,
  emailQuestionsOpen,
} from '../lib/emailQuestions.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('tarifs e-mail : 19,90 € pour 1 question et 29,90 € pour 2', () => {
  assert.deepEqual(EMAIL_QUESTION_PACKS.q1, { count: 1, amountCents: 1990, label: 'Une question' })
  assert.deepEqual(EMAIL_QUESTION_PACKS.q2, { count: 2, amountCents: 2990, label: 'Deux questions' })
  assert.equal(EMAIL_QUESTION_DAILY_CAP, 5)
  assert.match(EMAIL_QUESTION_TERMS_VERSION, /^email-question-/)
})

test('production reste fermée sans interrupteur explicite', () => {
  const beforeEnv = process.env.VERCEL_ENV
  const beforeFlag = process.env.EMAIL_QUESTIONS_ENABLED
  process.env.VERCEL_ENV = 'production'
  delete process.env.EMAIL_QUESTIONS_ENABLED
  assert.equal(emailQuestionsOpen(), false)
  process.env.EMAIL_QUESTIONS_ENABLED = 'true'
  assert.equal(emailQuestionsOpen(), true)
  if (beforeEnv == null) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = beforeEnv
  if (beforeFlag == null) delete process.env.EMAIL_QUESTIONS_ENABLED
  else process.env.EMAIL_QUESTIONS_ENABLED = beforeFlag
})

test('le prix PayPal vient uniquement du pack serveur', () => {
  const src = read('lib/emailQuestions.js')
  assert.match(src, /meta\.amountCents/)
  assert.match(src, /value: \(meta\.amountCents \/ 100\)\.toFixed\(2\)/)
  assert.doesNotMatch(src, /req\.body\?\.amount|req\.body\.amount/)
  assert.match(src, /capture\.amount\?\.value !== \(row\.amount_cents \/ 100\)\.toFixed\(2\)/)
  assert.match(src, /unit\.custom_id === row\.id/)
})

test('la migration lie pack, nombre de questions et montant et reste service_role only', () => {
  const sql = read('supabase/migrations/20261006120000_mediumia_email_questions.sql')
  assert.match(sql, /pack = 'q1' AND question_count = 1/)
  assert.match(sql, /pack = 'q2' AND question_count = 2/)
  assert.match(sql, /pack = 'q1' AND amount_cents = 1990/)
  assert.match(sql, /pack = 'q2' AND amount_cents = 2990/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /FORCE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.mediumia_email_questions FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT ALL ON TABLE public\.mediumia_email_questions TO service_role/)
})

test('le checkout public propose exactement q1 et q2', () => {
  const page = read('src/components/QuestionPage.jsx')
  assert.match(page, /q1: \{ count: 1/)
  assert.match(page, /q2: \{ count: 2/)
  assert.match(page, /2990 : 1990/)
  assert.doesNotMatch(page, /q3|6900|2900/)
  assert.match(page, /questionAction=create/)
  assert.match(page, /questionAction=capture/)
  assert.match(page, /réponse personnelle et développée/)
})

test('l’administration est authentifiée via rdv-admin et offre réponse + remboursement', () => {
  const router = read('api/rdv-admin.js')
  const server = read('lib/emailQuestions.js')
  const panel = read('src/components/rdv/EmailQuestionsPanel.jsx')
  assert.match(router, /case 'email-questions'/)
  assert.ok(router.indexOf("case 'email-questions'") > router.indexOf('const auth = await requireAuth(req)'))
  assert.match(server, /owner_id', userId/)
  assert.match(server, /slug', 'sebastien-seguin'/)
  assert.match(server, /email-question-answer\//)
  assert.match(server, /v2\/payments\/captures\/\$\{encodeURIComponent\(row\.paypal_capture_id\)\}\/refund/)
  assert.match(panel, /Envoyer la réponse/)
  assert.match(panel, /Refuser et rembourser/)
})

test('le parcours public et le tableau de bord sont branchés', () => {
  const app = read('src/App.jsx')
  const consult = read('src/components/ConsultationSection.jsx')
  const dashboard = read('src/components/rdv/RdvDashboard.jsx')
  const vercel = read('vercel.json')
  assert.match(app, /p === '\/question' \? 'question'/)
  assert.match(app, /<QuestionPage/)
  assert.match(consult, /Poser une question par e-mail/)
  assert.match(dashboard, /<EmailQuestionsPanel session=\{session\}/)
  assert.match(vercel, /"source": "\/question"/)
})

test('les métriques question sont explicitement autorisées', () => {
  const src = read('lib/mediumiaAnalytics.js')
  for (const event of ['question_view', 'question_payment_started', 'question_purchase_completed']) {
    assert.match(src, new RegExp(`'${event}'`))
  }
  assert.match(src, /chronosphere-example\|question/)
})
