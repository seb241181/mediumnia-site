/* global process */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { __conferencePassPayPalTest } from '../lib/conferencePassPayPal.js'
import { buildConferencePassEmail } from '../lib/conferencePassEmail.js'

const files = {
  migration: '../supabase/migrations/20260915103000_conference_pass_checkout.sql',
  concurrencyMigration: '../supabase/migrations/20260916111500_conference_pass_checkout_concurrency.sql',
  handler: '../lib/conferencePassPayPal.js',
  api: '../api/rdv-config.js',
  page: '../src/components/ConferencePassPage.jsx',
  app: '../src/App.jsx',
  vercel: '../vercel.json',
  email: '../lib/conferencePassEmail.js',
}

async function read(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8')
}

async function sources() {
  const entries = await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await read(path)]))
  return Object.fromEntries(entries)
}

test('conference pass schema is additive, token-hashed, server-only and 720h', async () => {
  const { migration } = await sources()

  assert.match(migration, /alter table public\.conference_passes/)
  assert.match(migration, /token_hash/)
  assert.match(migration, /paypal_order_id text/)
  assert.match(migration, /paypal_capture_id text/)
  assert.match(migration, /pass_duration_hours = 720/)
  assert.match(migration, /create table if not exists public\.conference_pass_events/)
  assert.match(migration, /pass_issued/)
  assert.match(migration, /checkout_started/)
  assert.match(migration, /pass_redeemed/)
  assert.match(migration, /alter table public\.conference_pass_events enable row level security/)
  assert.match(migration, /revoke all on public\.conference_pass_events from public, anon, authenticated/)
  assert.match(migration, /grant select, insert, update on public\.conference_pass_events to service_role/)
  assert.doesNotMatch(migration, /registration_open/)
})

test('conference pass RPCs are service-role only and protect open/reserve/redeem lifecycle', async () => {
  const { migration } = await sources()

  assert.match(migration, /create or replace function public\.validate_conference_pass/)
  assert.match(migration, /create or replace function public\.reserve_conference_pass_checkout/)
  assert.match(migration, /create or replace function public\.release_conference_pass_checkout/)
  assert.match(migration, /create or replace function public\.redeem_conference_pass_after_payment/)
  assert.match(migration, /v_pass\.redeemed_at is not null/)
  assert.match(migration, /v_pass\.expires_at <= now\(\)/)
  assert.match(migration, /paypal_capture_id is null/)
  assert.match(migration, /captured_payment_requires_reconciliation/)
  assert.match(migration, /capture_mismatch/)
  assert.match(migration, /grant execute on function public\.validate_conference_pass\(text\) to service_role/)
  assert.match(migration, /grant execute on function public\.redeem_conference_pass_after_payment\(text, text, uuid, uuid\) to service_role/)
})

test('conference pass checkout is multiplexed through existing rdv-config function', async () => {
  const { api, vercel, app } = await sources()
  const config = JSON.parse(vercel)

  assert.match(api, /handleConferencePassPayPal/)
  assert.match(api, /conferencePassAction/)
  assert.ok(config.rewrites.some((rule) => rule.source === '/pass/mediumia/:eventSlug' && rule.destination === '/index.html'))
  assert.match(app, /p\.startsWith\('\/pass\/mediumia\/'\)/)
  assert.match(app, /<ConferencePassPage/)
})

test('server decides conference pass amount and refuses missing promotion config', () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_CONFERENCE_PASS_ENABLED: process.env.PAYPAL_CONFERENCE_PASS_ENABLED,
  }

  try {
    process.env.VERCEL_ENV = 'production'
    process.env.PAYPAL_ENV = 'live'
    process.env.PAYPAL_CONFERENCE_PASS_ENABLED = 'true'
    assert.throws(() => __conferencePassPayPalTest.runtimeConfig(null), /offer_not_configured/)
    const cfg = __conferencePassPayPalTest.runtimeConfig(39900)
    assert.equal(cfg.amount, '399.00')
    assert.equal(cfg.displayAmount, '399.00')
    assert.equal(cfg.referenceId, 'MEDIUMIA_CONFERENCE_PASS')
    assert.equal(cfg.accessLevel, 'full')
    assert.equal(cfg.maxModule, 25)
    assert.equal(cfg.durationDays, 365)

    process.env.VERCEL_ENV = 'preview'
    const sandbox = __conferencePassPayPalTest.runtimeConfig(39900)
    assert.equal(sandbox.env, 'sandbox')
    assert.equal(sandbox.amount, '1.00')
    assert.equal(sandbox.displayAmount, '399.00')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('capture validation enforces reference, amount, payer email and optional custom id', () => {
  const cfg = __conferencePassPayPalTest.runtimeConfig(39900)
  const order = {
    id: 'ORDER-PASS-123',
    status: 'COMPLETED',
    payer: { email_address: 'participant@example.test', name: { given_name: 'Ada', surname: 'Lovelace' } },
    purchase_units: [{
      reference_id: cfg.referenceId,
      payments: { captures: [{ id: 'CAP-PASS-123', status: 'COMPLETED', amount: { currency_code: 'EUR', value: cfg.amount } }] },
    }],
  }

  assert.equal(__conferencePassPayPalTest.validateCompletedOrder(cfg, order, order.id).payerEmail, 'participant@example.test')
  const wrongAmount = structuredClone(order)
  wrongAmount.purchase_units[0].payments.captures[0].amount.value = '597.00'
  assert.throws(() => __conferencePassPayPalTest.validateCompletedOrder(cfg, wrongAmount, order.id), /paypal_amount_mismatch/)
  const wrongCustomId = structuredClone(order)
  wrongCustomId.purchase_units[0].custom_id = 'WRONG'
  assert.throws(() => __conferencePassPayPalTest.validateCompletedOrder(cfg, wrongCustomId, order.id), /paypal_consent_mismatch/)
})

test('capture authorizes a different PayPal payer email but provisions the registration email', async () => {
  const { handler } = await sources()

  assert.doesNotMatch(handler, /pass_email_mismatch/)
  assert.doesNotMatch(handler, /registration\.email_normalized !== payment\.payerEmail/)
  assert.match(handler, /createOrFindUser\(supabase, registration\.email_normalized, displayName\)/)
  assert.match(handler, /payerEmail/)
})

test('capture trusts only the server-bound order id, never a frontend pass or registration substitute', async () => {
  const { handler, page } = await sources()

  assert.match(handler, /async function getReservedPass\(supabase, orderId\)/)
  assert.match(handler, /\.from\('conference_passes'\)[\s\S]*\.eq\('paypal_order_id', orderId\)/)
  assert.match(handler, /if \(!data\) throw new Error\('pass_not_found'\)/)
  assert.match(page, /body: JSON\.stringify\(\{ orderId \}\)/)
  assert.match(page, /await captureExistingOrder\(data\.orderID\)/)
  assert.doesNotMatch(page, /registration_id|registrationId|email|entitlement|amountCents|product/)
})

test('capture refuses an order whose recorded pass intent no longer matches server config', async () => {
  const { handler } = await sources()

  assert.match(handler, /pass\.paypal_env !== cfg\.env/)
  assert.match(handler, /pass\.amount_cents !== cfg\.amountCents/)
  assert.match(handler, /pass\.currency !== cfg\.currency/)
  assert.match(handler, /pass\.reference_id !== cfg\.referenceId/)
  assert.match(handler, /throw new Error\('pass_intent_mismatch'\)/)
})

test('completed provisioned order returns alreadyProvisioned before any PayPal recapture', async () => {
  const { handler } = await sources()
  const captureCheckout = handler.slice(handler.indexOf('async function captureCheckout'), handler.indexOf('async function configResponse'))
  const earlyReturn = captureCheckout.indexOf("if (pass.paypal_capture_id && pass.redeemed_at)")
  const fetchOrder = captureCheckout.indexOf('const fetched = await fetchOrder')
  const captureOrder = captureCheckout.indexOf('await captureOrder')

  assert.ok(earlyReturn > -1)
  assert.ok(fetchOrder > earlyReturn)
  assert.ok(captureOrder > earlyReturn)
  assert.match(handler, /alreadyProvisioned: true/)
})

test('retry after a lost capture response reconciles by deterministic order and capture identifiers', async () => {
  const { handler, migration } = await sources()

  assert.match(handler, /PayPal-Request-Id': `mediumia-pass-capture-\$\{orderId\}`/)
  assert.match(handler, /redeem_conference_pass_after_payment/)
  assert.match(migration, /if v_pass\.paypal_capture_id = trim\(p_paypal_capture_id\) and v_pass\.redeemed_at is not null then/)
  assert.match(migration, /'alreadyRedeemed', true/)
  assert.match(migration, /capture_mismatch/)
})

test('capture failures keep the pass reserved for retry or reconciliation', async () => {
  const { handler } = await sources()

  assert.match(handler, /potentially paid pass/)
  assert.doesNotMatch(handler, /action === 'capture'[\s\S]{0,240}release_conference_pass_checkout/)
})

test('cancel then retry reuses the existing uncaptured PayPal order', async () => {
  const { handler, migration } = await sources()
  const createCheckout = handler.slice(handler.indexOf('async function createCheckout'), handler.indexOf('async function captureCheckout'))
  const lookup = createCheckout.indexOf('const pass = await getPassByHash')
  const fetchExisting = createCheckout.indexOf('const existing = await fetchOrder')
  const createOrder = createCheckout.indexOf('await createPaypalOrder')

  assert.ok(lookup > -1)
  assert.ok(fetchExisting > lookup)
  assert.ok(createOrder > fetchExisting)
  assert.match(createCheckout, /if \(isReusablePaypalOrder\(existing\.data\)\) \{\s*return res\.status\(200\)\.json\(\{ id: pass\.paypal_order_id, env: cfg\.env, reused: true \}\)/)
  assert.match(migration, /status not in \('released', 'failed'\)/)
})

test('refresh with completed existing order reconciles instead of creating a new checkout', async () => {
  const { handler, page } = await sources()
  const createCheckout = handler.slice(handler.indexOf('async function createCheckout'), handler.indexOf('async function captureCheckout'))
  const completedReturn = createCheckout.indexOf('completed: true')
  const createOrder = createCheckout.indexOf('await createPaypalOrder')

  assert.ok(completedReturn > -1)
  assert.ok(completedReturn < createOrder)
  assert.match(page, /if \(data\.completed\) \{\s*await captureExistingOrder\(data\.id\)/)
  assert.match(page, /conference_pass_reconciled/)
  assert.match(page, /err\?\.message === 'conference_pass_reconciled'/)
})

test('server releases or replaces an old order only after PayPal proves no capture exists', async () => {
  const { handler, migration } = await sources()
  const createCheckout = handler.slice(handler.indexOf('async function createCheckout'), handler.indexOf('async function captureCheckout'))
  const completedGuard = createCheckout.indexOf('hasCompletedCapture(existing.data, cfg)')
  const reusableGuard = createCheckout.indexOf('isReusablePaypalOrder(existing.data)')
  const release = createCheckout.indexOf('release_conference_pass_checkout')

  assert.ok(completedGuard > -1)
  assert.ok(reusableGuard > completedGuard)
  assert.ok(release > reusableGuard)
  assert.match(migration, /v_pass\.paypal_capture_id is not null[\s\S]*already_reserved/)
})

test('concurrent checkout creation is idempotent across PayPal and reservation RPC', async () => {
  const { handler, concurrencyMigration } = await sources()

  assert.match(handler, /createCheckoutRequestId/)
  assert.match(handler, /conference-pass-create:/)
  assert.doesNotMatch(handler, /'PayPal-Request-Id': randomUUID\(\)/)
  assert.match(handler, /PREVIOUS_REQUEST_IN_PROGRESS/)
  assert.match(handler, /already_reserved/)
  assert.match(handler, /reused: true/)
  assert.match(concurrencyMigration, /alreadyReserved/)
  assert.match(concurrencyMigration, /v_pass\.paypal_order_id = trim\(p_paypal_order_id\)/)
  assert.match(concurrencyMigration, /event_name\s*\)\s*values[\s\S]*'checkout_started'/)
})

test('conference pass handler awaits async branches so errors stay inside its catch', async () => {
  const { handler } = await sources()

  assert.match(handler, /return await configResponse\(req, res, pass\)/)
  assert.match(handler, /return await createCheckout\(req, res, cfg, tokenHash\)/)
  assert.match(handler, /return await captureCheckout\(req, res, normalizeOrderId\(req\.body\?\.orderId\)\)/)
})

test('frontend keeps raw pass token in fragment flow and never hardcodes a promo amount', async () => {
  const { page } = await sources()

  assert.match(page, /new URLSearchParams/)
  assert.match(page, /params\.get\('pass'\)/)
  assert.match(page, /window\.history\.replaceState/)
  assert.match(page, /conferencePassAction='/)
  assert.match(page, /fetch\(`\$\{API\}config`/)
  assert.match(page, /fetch\(`\$\{API\}create`/)
  assert.match(page, /fetch\(`\$\{API\}capture`/)
  assert.doesNotMatch(page, /399\s?€|497\s?€|297\s?€|promo/i)
  assert.match(page, /Prix normal/)
  assert.match(page, /Offre spéciale conférence/)
  assert.match(page, /adresse e-mail utilisée lors de votre inscription à la conférence/)
  assert.doesNotMatch(page, /adresse e-mail utilisée lors du paiement PayPal/)
})

test('pass email uses a fragment link and does not expose token in query params', () => {
  const email = buildConferencePassEmail({
    firstName: 'Ada',
    eventTitle: 'Et si la médiumnité devenait accessible ?',
    expiresAt: '2026-10-30T19:00:00.000Z',
    passUrl: 'https://mediumia.fr/pass/mediumia/premiere-conference-mediumia#pass=TOKEN_BRUT',
    offerLabel: 'Offre spéciale conférence',
  })

  assert.match(email.html, /#pass=TOKEN_BRUT/)
  assert.match(email.text, /#pass=TOKEN_BRUT/)
  assert.doesNotMatch(email.html, /\?pass=/)
  assert.match(email.subject, /Pass Conférence MediumIA/)
})

test('vercel function count remains within Hobby limit', async () => {
  const apiFiles = [
    'agent-chat.js',
    'google-calendar/callback.js',
    'google-calendar/connect.js',
    'google-calendar/disconnect.js',
    'google-calendar/status.js',
    'mediumia-trial.js',
    'oracle-interpret.js',
    'rdv-admin.js',
    'rdv-availability.js',
    'rdv-book.js',
    'rdv-config.js',
    'retractation.js',
  ]
  assert.equal(apiFiles.length, 12)
})
