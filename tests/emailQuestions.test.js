import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMAIL_QUESTION_DAILY_CAP,
  EMAIL_QUESTION_PACKS,
  EMAIL_QUESTION_SUSPENDED_MESSAGE,
  EMAIL_QUESTION_TERMS_VERSION,
  buildEmailGuidanceAnswer,
  buildOwnerQuestionEmail,
  createQuestionOrder,
  emailQuestionEnv,
  emailQuestionPurchasesSuspended,
  emailQuestionLiveWebhookReady,
  emailQuestionsOpen,
} from '../lib/emailQuestions.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('tarifs e-mail : 19,90 € pour 1 question et 29,90 € pour 2', () => {
  assert.deepEqual(EMAIL_QUESTION_PACKS.q1, { count: 1, amountCents: 1990, label: 'Une question' })
  assert.deepEqual(EMAIL_QUESTION_PACKS.q2, { count: 2, amountCents: 2990, label: 'Deux questions' })
  assert.equal(EMAIL_QUESTION_DAILY_CAP, 5)
  assert.match(EMAIL_QUESTION_TERMS_VERSION, /^email-question-/)
})

test('Sandbox : confirmation indique paiement fictif et aucun e-mail client', () => {
  const page = read('src/components/QuestionPage.jsx')
  assert.match(page, /config\.env === 'sandbox'/)
  assert.match(page, /Paiement fictif PayPal Sandbox validé/)
  assert.match(page, /Aucun paiement réel ni e-mail client n’a été envoyé/)
  assert.doesNotMatch(page, /Un e-mail de confirmation vient de vous être envoyé/)
  assert.match(page, /Approbation reçue\. Vérification sécurisée du paiement/)
})

test('la page Guidance par e-mail s’ouvre en haut sans réinitialiser le formulaire', () => {
  const app = read('src/App.jsx')
  const page = read('src/components/QuestionPage.jsx')
  // SPA link from an already scrolled homepage: no inherited smooth scroll.
  assert.match(app, /if \(v === 'question'\) window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/)
  // Direct link /question and browser restores: synchronous before first paint.
  assert.match(page, /useLayoutEffect\(\(\) => \{/)
  assert.match(page, /window\.history\.scrollRestoration = 'manual'/)
  assert.match(page, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/)
  assert.match(page, /return \(\) => \{ window\.history\.scrollRestoration = previous \}/)
  assert.ok(page.indexOf('useLayoutEffect(() => {') < page.indexOf("fetch('/api/rdv-config?questionAction=config'"))
  assert.match(page, /\}, \[\]\)\s*\n\s*useEffect\(\(\) => \{/)
})

test('client : apres approbation incertaine, aucun deuxieme appel a capture', () => {
  const page = read('src/components/QuestionPage.jsx')
  assert.match(page, /result\.retryable === true/)
  assert.match(page, /request\('reconcile'\)/)
  assert.match(page, /\[0, 1200, 3000, 6000\]/)
  assert.equal((page.match(/request\('capture'\)/g) || []).length, 1)
  assert.match(page, /Ne recommencez pas le reglement|Ne recommencez pas le règlement/)
})

test('LIVE : aucune nouvelle guidance payante sans identifiant de webhook PayPal signé', async () => {
  const previous = process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
  const beforeSuspend = process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
  try {
    delete process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
    process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = 'false'
    assert.equal(emailQuestionLiveWebhookReady('live'), false)
    assert.equal(emailQuestionLiveWebhookReady('sandbox'), true)
    const result = { code: null, body: null,
      status(code) { this.code = code; return this },
      json(payload) { this.body = payload; return this },
    }
    await createQuestionOrder({ method: 'POST', body: {} }, result, {
      from: () => assert.fail('DB must not be touched'),
    }, 'live')
    assert.equal(result.code, 503)
    assert.equal(result.body.error, 'paypal_webhook_not_configured')
    process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID = 'WH-INVALID'
    assert.equal(emailQuestionLiveWebhookReady('live'), false)
    process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID = '1234ABCD5678EFGH'
    assert.equal(emailQuestionLiveWebhookReady('live'), true)
  } finally {
    if (previous === undefined) delete process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID
    else process.env.PAYPAL_EMAIL_QUESTIONS_WEBHOOK_ID = previous
    if (beforeSuspend === undefined) delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    else process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = beforeSuspend
  }
})

test('admin: les 5 commandes historiques disposent d’une vérification fournisseur strictement en lecture seule', () => {
  const ui = read('src/components/rdv/EmailQuestionsPanel.jsx')
  const handler = read('lib/emailQuestions.js')
  assert.match(ui, /paymentPending\.map/)
  assert.match(ui, /onClick=\{checkPendingPayPal\}/)
  assert.match(ui, /op: 'paypal_readonly_preview'/)
  assert.match(ui, /Vérifier les paiements chez PayPal — lecture seule/)
  assert.match(ui, /Aucun débit, remboursement, e-mail ou changement de statut/)
  const diagnostic = handler.split("if (input.op === 'paypal_readonly_preview')")[1]?.split("if (input.op === 'start')")[0]
  assert.ok(diagnostic, 'owner-only read-only diagnosis available')
  assert.match(diagnostic, /paypalAccessToken\(row\.paypal_env\)/)
  assert.match(diagnostic, /paypalRequest\(row\.paypal_env, access, 'GET'/)
  assert.doesNotMatch(diagnostic, /paypalRequest\([^\n]*'POST'|\.update\(|\.insert\(|sendEmail\(/)
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

function validQuestionBody() {
  return {
    pack: 'q2',
    firstName: 'Camille',
    email: 'camille@example.invalid',
    questions: [
      { q: 'Est-ce le bon moment pour changer de voie professionnelle ?', context: 'Je prépare une reconversion depuis plusieurs mois et j’hésite à me lancer.' },
      { q: 'Comment avancer sereinement dans cette période de transition ?', context: 'Je quitte progressivement mon poste et je crains de faire le mauvais choix.' },
    ],
    retractationWaived: true,
    rulesAccepted: true,
  }
}

function res() {
  return { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
}

function createDbMock() {
  const inserted = []
  return {
    inserted,
    from(table) {
      assert.equal(table, 'mediumia_email_questions')
      const q = {
        select() { return q },
        eq() { return q },
        gte() { return q },
        insert(row) { inserted.push(row); return Promise.resolve({ error: null }) },
        then(resolve) { return Promise.resolve({ count: 0, error: null }).then(resolve) },
      }
      return q
    },
  }
}

test('contexte obligatoire : création refusée avant toute requête DB ou PayPal', async () => {
  const prior = process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
  const originalFetch = globalThis.fetch
  try {
    delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    let fetchCalls = 0
    let dbCalls = 0
    globalThis.fetch = async () => { fetchCalls++; throw new Error('paypal_must_not_be_called') }
    const db = { from() { dbCalls++; throw new Error('db_must_not_be_called') } }

    const scenarios = [
      { name: 'une question sans contexte', body: {
        ...validQuestionBody(), pack: 'q1', questions: [{ q: validQuestionBody().questions[0].q, context: '' }],
      } },
      { name: 'deux questions dont la seconde sans contexte', body: (() => {
        const body = validQuestionBody(); body.questions[1].context = ''; return body
      })() },
      { name: 'contexte composé uniquement d’espaces', body: (() => {
        const body = validQuestionBody(); body.questions[0].context = '                             '; return body
      })() },
      { name: 'contexte trop court', body: (() => {
        const body = validQuestionBody(); body.questions[0].context = 'a'.repeat(19); return body
      })() },
    ]

    for (const scenario of scenarios) {
      const out = res()
      await createQuestionOrder({ method: 'POST', body: scenario.body }, out, db, 'sandbox')
      assert.equal(out.code, 400, scenario.name)
      assert.equal(out.body.error, 'invalid_form', scenario.name)
    }
    assert.equal(dbCalls, 0)
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (prior == null) delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    else process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = prior
  }
})

test('formulaire : chaque contexte est requis avant l’affichage du paiement', () => {
  const page = read('src/components/QuestionPage.jsx')
  assert.match(page, /contexts\.slice\(0, count\)\.every\(\(context\) => context\.trim\(\)\.length >= 20\)/)
  assert.match(page, /questionsOk && contextsOk && waived && rulesOk/)
  assert.match(page, /minLength=\{20\}/)
  assert.doesNotMatch(page, /facultatif, quelques lignes/)
})

test('suspension Guidances e-mail : aucune nouvelle commande PayPal créée', async () => {
  const before = process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
  try {
    process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = 'true'
    assert.equal(emailQuestionPurchasesSuspended(), true)
    let dbTouched = false
    const db = { from() { dbTouched = true; throw new Error('db_must_not_be_touched_before_suspension_reply') } }
    const out = res()
    await createQuestionOrder({ method: 'POST', body: validQuestionBody() }, out, db, 'sandbox')
    assert.equal(out.code, 503)
    assert.equal(out.body.error, 'email_questions_suspended')
    assert.equal(out.body.message, EMAIL_QUESTION_SUSPENDED_MESSAGE)
    assert.equal(dbTouched, false)
  } finally {
    if (before == null) delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    else process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = before
  }
})

test('suspension désactivée : création PayPal normale inchangée', async () => {
  const before = {
    suspended: process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED,
    clientId: process.env.PAYPAL_CLIENT_ID,
    secret: process.env.PAYPAL_CLIENT_SECRET,
  }
  const beforeFetch = globalThis.fetch
  try {
    delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    process.env.PAYPAL_CLIENT_ID = 'client-id-test'
    process.env.PAYPAL_CLIENT_SECRET = 'secret-test'
    const calls = []
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), method: options?.method, body: options?.body })
      if (String(url).includes('/v1/oauth2/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'TOKEN' }) }
      }
      if (String(url).includes('/v2/checkout/orders')) {
        return { ok: true, status: 201, json: async () => ({ id: 'ORDER-NORMAL-123' }) }
      }
      throw new Error('unexpected_fetch')
    }
    const db = createDbMock()
    const out = res()
    await createQuestionOrder({ method: 'POST', body: validQuestionBody() }, out, db, 'sandbox')
    assert.equal(out.code, 200)
    assert.equal(out.body.id, 'ORDER-NORMAL-123')
    assert.deepEqual(calls.map((call) => call.method), ['POST', 'POST'])
    assert.equal(db.inserted.length, 1)
    assert.equal(db.inserted[0].paypal_order_id, 'ORDER-NORMAL-123')
  } finally {
    globalThis.fetch = beforeFetch
    if (before.suspended == null) delete process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED
    else process.env.EMAIL_QUESTIONS_PURCHASES_SUSPENDED = before.suspended
    if (before.clientId == null) delete process.env.PAYPAL_CLIENT_ID
    else process.env.PAYPAL_CLIENT_ID = before.clientId
    if (before.secret == null) delete process.env.PAYPAL_CLIENT_SECRET
    else process.env.PAYPAL_CLIENT_SECRET = before.secret
  }
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
  assert.match(page, /request\('capture'\)/)
  assert.match(page, /request\('reconcile'\)/)
  assert.match(page, /Les commandes de Guidances par e-mail sont momentanément suspendues pour maintenance\. Vos demandes déjà enregistrées restent prises en charge\./)
  assert.match(page, /réponse personnelle et développée/)
  assert.match(page, /Aucune question d’ordre médical n’est acceptée/)
  assert.match(page, /Toute demande médicale sera refusée et remboursée/)
  assert.match(page, /interdiction de toute question d’ordre médical/)
})

test('erreur PayPal ambiguë : ne jamais promettre absence de double débit ni encourager à repayer', () => {
  const page = read('src/components/QuestionPage.jsx')
  const onError = page.split('onError: (error) => setStatus(')[1]?.split('}).render(node)')[0] || ''
  assert.match(onError, /Nous ne pouvons pas confirmer l’état de votre paiement/)
  assert.match(onError, /Ne recommencez pas le paiement pour le moment/)
  assert.match(onError, /Contactez-moi/)
  assert.match(onError, /email_questions_suspended/)
  assert.doesNotMatch(page, /sans être débité deux fois|Vous pouvez réessayer sans être débité/)
})

test('la réponse de guidance reprend le style Chronosphère et échappe les contenus', () => {
  const email = buildEmailGuidanceAnswer({
    first_name: '<Camille>',
    questions: [
      { q: 'Est-ce le bon moment pour changer de travail ?' },
      { q: '<script>alert(1)</script>' },
    ],
  }, 'Voici ma guidance <b>personnelle</b>.\nDeuxième ligne.')

  assert.equal(email.subject, 'Votre guidance par e-mail — MediumIA')
  assert.match(email.html, /background:#f3efe6/)
  assert.match(email.html, /background:#1a1535/)
  assert.match(email.html, /#d4b469/)
  assert.match(email.html, /GUIDANCE PAR E-MAIL/)
  assert.match(email.html, /Votre demande/)
  assert.match(email.html, /Votre guidance/)
  assert.match(email.html, /Question 1/)
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(email.html, /Voici ma guidance &lt;b&gt;personnelle&lt;\/b&gt;/)
  assert.doesNotMatch(email.html, /<script>alert\(1\)<\/script>/)
  assert.doesNotMatch(email.html, /<b>personnelle<\/b>/)
  assert.match(email.text, /VOTRE DEMANDE/)
  assert.match(email.text, /VOTRE GUIDANCE/)
  assert.match(email.text, /Cette guidance repose sur une interprétation intuitive/)
})

test('les e-mails n’utilisent aucune boîte contact fictive et supportent Reply-To', () => {
  const server = read('lib/emailQuestions.js')
  const helper = read('lib/transactionalEmail.js')
  assert.doesNotMatch(server, /contact@mediumia\.fr/)
  assert.match(server, /EMAIL_QUESTIONS_OWNER_EMAIL/)
  assert.match(server, /EMAIL_QUESTIONS_REPLY_TO/)
  assert.match(helper, /payload\.reply_to = replyTo/)
})

test('notification propriétaire : inclut les questions, contextes et référence, échappe le HTML', () => {
  const row = {
    id: 'test-id',
    first_name: 'Camille',
    email: 'camille@example.invalid',
    question_count: 2,
    questions: [
      { q: 'Est-ce le bon moment pour changer de travail ?', context: 'Je doute de ma décision.' },
      { q: '<script>alert(1)</script>', context: '<b>Contexte privé</b>' },
    ],
    amount_cents: 2990,
    paypal_order_id: 'ORDER-TEST-1',
  }
  const owner = buildOwnerQuestionEmail(row, '22 octobre 2026')
  assert.match(owner.text, /Est-ce le bon moment/)
  assert.match(owner.text, /Je doute de ma décision/)
  assert.match(owner.text, /ORDER-TEST-1/)
  assert.match(owner.text, /Contexte privé/)
  assert.match(owner.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(owner.html, /&lt;b&gt;Contexte privé&lt;\/b&gt;/)
  assert.doesNotMatch(owner.html, /<script>/)
  const server = read('lib/emailQuestions.js')
  assert.match(server, /email-question-owner\/\$\{row\.id\}/)
  assert.match(server, /buildOwnerQuestionEmail\(row, due\)/)
})

test('administration : demandes sans statut payé lisibles, mais aucune action financière ni réponse dans leur bloc', () => {
  const panel = read('src/components/rdv/EmailQuestionsPanel.jsx')
  const marker = 'Commandes à vérifier — paiement non confirmé dans MediumIA'
  const start = panel.indexOf(marker)
  const end = panel.indexOf('{history.length > 0', start)
  assert.ok(start > 0 && end > start)
  const block = panel.slice(start, end)
  assert.match(block, /paymentPending\.map/)
  assert.match(block, /row\.questions/)
  assert.match(block, /row\.paypal_order_id/)
  assert.doesNotMatch(block, /mutate\(|Envoyer la réponse|Refuser et rembourser/)
  assert.match(panel, /r\.status === 'payment_pending'/)
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
  const rendered = buildEmailGuidanceAnswer({ first_name: 'Camille', questions: [{ q: 'Ma question' }] }, 'Ma guidance personnalisée.')
  const disclaimer = 'Cette guidance repose sur une interprétation intuitive : une erreur reste possible et aucune prédiction ne peut être considérée comme certaine ni garantie.'
  assert.ok(rendered.html.includes(disclaimer))
  assert.ok(rendered.text.includes(disclaimer))
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
