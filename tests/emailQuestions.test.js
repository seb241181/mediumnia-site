import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMAIL_QUESTION_DAILY_CAP,
  EMAIL_QUESTION_PACKS,
  EMAIL_QUESTION_TERMS_VERSION,
  emailQuestionEnv,
  emailQuestionsOpen,
} from '../lib/emailQuestions.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('tarifs e-mail : 19,90 € pour 1 question et 29,90 € pour 2', () => {
  assert.deepEqual(EMAIL_QUESTION_PACKS.q1, { count: 1, amountCents: 1990, label: 'Une question' })
  assert.deepEqual(EMAIL_QUESTION_PACKS.q2, { count: 2, amountCents: 2990, label: 'Deux questions' })
  assert.equal(EMAIL_QUESTION_DAILY_CAP, 5)
  assert.match(EMAIL_QUESTION_TERMS_VERSION, /^email-question-/)
})

test('PayPal reste obligatoirement en sandbox hors production', () => {
  const beforeVercel = process.env.VERCEL_ENV
  const beforePayPal = process.env.PAYPAL_ENV
  process.env.VERCEL_ENV = 'preview'
  process.env.PAYPAL_ENV = 'live'
  assert.equal(emailQuestionEnv(), 'sandbox')

  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_ENV = 'live'
  assert.equal(emailQuestionEnv(), 'live')

  process.env.PAYPAL_ENV = 'sandbox'
  assert.throws(() => emailQuestionEnv(), /paypal_env_mismatch/)

  if (beforeVercel == null) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = beforeVercel
  if (beforePayPal == null) delete process.env.PAYPAL_ENV
  else process.env.PAYPAL_ENV = beforePayPal
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
  assert.match(src, /custom_id === row\.id/)
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
  assert.match(page, /Aucune question d’ordre médical n’est acceptée/)
  assert.match(page, /Toute demande médicale sera refusée et remboursée/)
  assert.match(page, /interdiction de toute question d’ordre médical/)
})

test('les e-mails n’utilisent aucune boîte contact fictive et supportent Reply-To', () => {
  const server = read('lib/emailQuestions.js')
  const helper = read('lib/transactionalEmail.js')
  assert.doesNotMatch(server, /contact@mediumia\.fr/)
  assert.match(server, /EMAIL_QUESTIONS_OWNER_EMAIL/)
  assert.match(server, /EMAIL_QUESTIONS_REPLY_TO/)
  assert.match(helper, /payload\.reply_to = replyTo/)
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
  const disclaimer = 'Cette guidance repose sur une interprétation intuitive : une erreur reste possible et aucune prédiction ne peut être considérée comme certaine ni garantie.'
  assert.equal(server.split(disclaimer).length - 1, 2)
  assert.doesNotMatch(server, /certaine, garantie ou infaillible/)
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
  assert.match(consult, /Guidance par e-mail/)
  assert.match(consult, /Nouveau/)
  assert.match(dashboard, /<EmailQuestionsPanel session=\{session\}/)
  assert.ok(JSON.parse(vercel).rewrites.some((item) => item.source === '/question' && item.destination === '/index.html'))
})

test('les métriques question sont explicitement autorisées', () => {
  const src = read('lib/mediumiaAnalytics.js')
  for (const event of ['question_view', 'question_payment_started', 'question_purchase_completed']) {
    assert.match(src, new RegExp(`'${event}'`))
  }
  assert.match(src, /const SOURCE_RE = .*question/)
})
