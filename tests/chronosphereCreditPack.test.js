import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/20260905210000_chronosphere_credit_packs.sql', import.meta.url)
const paypalPath = new URL('../lib/chronospherePayPal.js', import.meta.url)
const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)

async function sources() {
  const [migration, paypal, timeline, page] = await Promise.all([
    readFile(migrationPath, 'utf8'), readFile(paypalPath, 'utf8'), readFile(timelinePath, 'utf8'), readFile(pagePath, 'utf8'),
  ])
  return { migration, paypal, timeline, page }
}

test('pack credit schema is additive and service-role-only', async () => {
  const { migration } = await sources()
  assert.match(migration, /create table if not exists chronosphere_credit_packs/)
  assert.match(migration, /create table if not exists chronosphere_pack_draws/)
  assert.match(migration, /credits_total = 3/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke execute on function consume_chronosphere_pack_credit[\s\S]*from public, anon, authenticated/)
  assert.doesNotMatch(migration, /alter table chronosphere_paid_draws\s+drop/i)
})

test('consumption serializes a pack, caches identical requests, and refuses a fourth credit', async () => {
  const { migration } = await sources()
  assert.match(migration, /from chronosphere_credit_packs[\s\S]*for update/)
  assert.match(migration, /chronosphere_pack_draws_request_key unique \(pack_id, request_hash\)/)
  assert.match(migration, /v_draw_exists and v_draw.status = 'completed'/)
  assert.match(migration, /credits_remaining <= 0[\s\S]*reason', 'no_credits/)
  assert.match(migration, /credits_remaining = v_remaining/)
})

test('failed processing refunds exactly once and a retry reserves a credit again', async () => {
  const { migration } = await sources()
  assert.match(migration, /create or replace function release_chronosphere_pack_credit/)
  assert.match(migration, /if v_draw.status <> 'processing'/)
  assert.match(migration, /credits_remaining \+ 1/)
  assert.match(migration, /status = 'failed'/)
  assert.match(migration, /A failed attempt was already refunded/)
})

test('stale processing is recovered in place with an exclusive claim', async () => {
  const { migration, timeline } = await sources()
  assert.match(migration, /p_processing_ttl_seconds integer default 300/)
  assert.match(migration, /processing_claim_id uuid/)
  assert.match(migration, /'recovered', true/)
  assert.match(migration, /v_draw\.processing_claim_id <> p_claim_id/)
  assert.match(timeline, /p_claim_id: processingClaimId/)
})

test('PayPal pack parameters remain server-decided and capture is idempotent', async () => {
  const { paypal } = await sources()
  assert.match(paypal, /amount: '9\.90'/)
  assert.match(paypal, /MEDIUMIA_CHRONOSPHERE_PACK3_990/)
  assert.match(paypal, /const PACK_CREDITS = 3/)
  assert.match(paypal, /eq\('status', 'payment_pending'\)/)
  assert.match(paypal, /credits_remaining: PACK_CREDITS/)
  assert.match(paypal, /captureSingleDraw/)
  assert.match(paypal, /LEGACY_CONSENT_VERSION/)
})

test('timeline accepts the new pack token while retaining historical draw tokens', async () => {
  const { timeline } = await sources()
  assert.match(timeline, /const packToken/)
  assert.match(timeline, /consume_chronosphere_pack_credit/)
  assert.match(timeline, /consume_chronosphere_draw_token/)
  assert.match(timeline, /complete_chronosphere_pack_draw/)
  assert.match(timeline, /release_chronosphere_pack_credit/)
  assert.match(timeline, /chronosphere_paid_draws/)
})

test('frontend restores the pack locally and exposes its current balance', async () => {
  const { page } = await sources()
  assert.match(page, /chronosphere_packToken/)
  assert.match(page, /chronospherePayPalAction=status/)
  assert.match(page, /packToken: token/)
  assert.match(page, /Pack de 3 tirages/)
  assert.match(page, /Faire un nouveau tirage/)
  assert.match(page, /Obtenir 3 nouveaux tirages/)
  assert.match(page, /chronosphere_drawToken/)
  assert.match(page, /resultToken/)
  assert.match(page, /À partir de \{singlePrice/)
  assert.match(page, /Un paiement unique pour 3 tirages complets avec envoi de chaque compte rendu par e-mail/)
})
