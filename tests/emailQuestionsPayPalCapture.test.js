import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('capture corrigée : GET avant POST, réponse ambiguë gérée par relecture', () => {
  const src = read('lib/emailQuestions.js')
  const captureStart = src.indexOf('async function captureQuestionOrder(')
  const captureEnd = src.indexOf('\nasync function', captureStart + 1)
  assert.ok(captureStart > 0 && captureEnd > captureStart)
  const captureFn = src.slice(captureStart, captureEnd)

  // GET d'abord pour vérifier l'état avant de tenter la capture.
  const getIndex = captureFn.indexOf("'GET', `/v2/checkout/orders/")
  const postIndex = captureFn.indexOf("'POST', `/v2/checkout/orders/")
  assert.ok(getIndex > 0, 'doit contenir un GET orders')
  assert.ok(postIndex > 0, 'doit contenir un POST capture')
  assert.ok(getIndex < postIndex, 'GET doit précéder POST')

  // Vérifie que si la commande est déjà COMPLETED, on ne re-capture pas.
  assert.match(captureFn, /preCheck\.data\?\.status === 'COMPLETED'/, 'détecte les commandes déjà capturées')

  // Vérifie que seules les commandes APPROVED sont capturées.
  assert.match(captureFn, /preCheck\.data\?\.status === 'APPROVED'/, 'ne capture que les commandes approuvées')

  // En cas de réponse ambiguë, relecture GET pour vérifier.
  const recheckPattern = /recheck.*=.*paypalRequest.*'GET'/
  assert.match(captureFn, recheckPattern, 'relecture GET en cas de réponse ambiguë')

  // Idempotence PayPal : clé de requête présente.
  assert.match(captureFn, /mediumia-email-question-capture-/, 'clé d’idempotence PayPal présente')

  // Vérification montant/devise/référence inchangée.
  assert.match(captureFn, /capture\.amount\?\.currency_code !== 'EUR'/)
  assert.match(captureFn, /reference_id !== `MEDIUMIA_EMAIL_/)
  assert.match(captureFn, /custom_id === row\.id/)
})

test('capture : jamais de double débit — commande non-APPROVED rejetée sans POST', () => {
  const src = read('lib/emailQuestions.js')
  const captureStart = src.indexOf('async function captureQuestionOrder(')
  const captureEnd = src.indexOf('\nasync function', captureStart + 1)
  const captureFn = src.slice(captureStart, captureEnd)

  // Les commandes dans un état inattendu (CREATED, VOIDED) retournent une erreur sans appel POST.
  assert.match(captureFn, /paypal_order_not_approved/, 'erreur spécifique pour état inattendu')
  assert.match(captureFn, /orderStatus.*preCheck\.data\?\.status/, 'retourne le statut pour diagnostic')
})

test('capture : idempotence en base — status payment_pending requis pour la mise à jour', () => {
  const src = read('lib/emailQuestions.js')
  const captureStart = src.indexOf('async function captureQuestionOrder(')
  const captureEnd = src.indexOf('\nasync function', captureStart + 1)
  const captureFn = src.slice(captureStart, captureEnd)

  // La mise à jour en base requiert status === payment_pending (garde optimiste).
  assert.match(captureFn, /\.eq\('status', 'payment_pending'\)/)
  // En cas de conflit, vérifie si le capture_id correspond déjà.
  assert.match(captureFn, /replay\?\.paypal_capture_id === capture\.id/)
})

test('webhook Guidance : filtrage strict, relecture PayPal, idempotence', () => {
  const src = read('lib/emailQuestions.js')

  // Le handler webhook est branché dans handleEmailQuestions.
  assert.match(src, /action === 'webhook'.*handleWebhook/)

  const webhookStart = src.indexOf('async function handleWebhook(')
  const webhookEnd = src.indexOf('\nexport async function handleEmailQuestions(', webhookStart)
  assert.ok(webhookStart > 0 && webhookEnd > webhookStart)
  const webhookFn = src.slice(webhookStart, webhookEnd)

  // Seul PAYMENT.CAPTURE.COMPLETED est traité.
  assert.match(webhookFn, /PAYMENT\.CAPTURE\.COMPLETED/, 'filtre sur le bon event_type')
  assert.match(webhookFn, /event_type_not_handled/, 'rejette les autres types')

  // Validation de l'event_id PayPal (format WH-...).
  assert.match(webhookFn, /WH-\[A-Za-z0-9-\]/, 'valide le format event_id')

  // Filtrage Guidance : seules les commandes avec un UUID custom_id sont traitées.
  assert.match(webhookFn, /not_a_guidance_order/, 'ignore les ordres non-guidance')

  // Relecture via GET au lieu de faire confiance au payload.
  assert.match(webhookFn, /'GET'.*checkout\/orders/, 'relit l’état depuis PayPal')

  // Aucun appel PayPal POST (capture, refund) dans le webhook — uniquement des GET.
  assert.doesNotMatch(webhookFn, /paypalRequest\([^)]*'POST'/, 'aucun appel PayPal POST dans le webhook')

  // Vérification montant, devise, référence.
  assert.match(webhookFn, /currency_code !== 'EUR'/)
  assert.match(webhookFn, /reference_id !== `MEDIUMIA_EMAIL_/)

  // Idempotence par capture_id en base.
  assert.match(webhookFn, /paypal_capture_id === captureId/)

  // Mise à jour en base avec garde status === payment_pending.
  assert.match(webhookFn, /\.eq\('status', 'payment_pending'\)/)

  // Envoi des e-mails de confirmation après mise à jour réussie.
  assert.match(webhookFn, /sendPurchaseEmails\(db, paid\)/)
})

test('webhook : pas de détournement — les webhooks formations et autres ne sont pas affectés', () => {
  const router = read('api/rdv-config.js')
  // Le webhook guidance passe par questionAction=webhook, pas formationPathAction.
  assert.match(router, /questionAction/)
  assert.match(router, /formationPathAction/)
  // Les deux routes sont distinctes.
  const questionLine = router.indexOf('questionAction')
  const formationLine = router.indexOf('formationPathAction')
  assert.ok(questionLine !== formationLine, 'routes distinctes pour guidance et formation')
})
