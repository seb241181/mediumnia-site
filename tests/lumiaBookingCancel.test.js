import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LUMIA_ALLOWED_ACTIONS } from '../lib/lumiaPolicy.js'
import {
  buildBookingCancelPayload,
  buildBookingCancelPreview,
  resolveBookingCancelCandidates,
} from '../lib/lumiaBookingCancel.js'

const migration = readFileSync(new URL('../supabase/migrations/20261005220000_lumia_booking_cancel_preparation.sql', import.meta.url), 'utf8')
const api = readFileSync(new URL('../lib/lumiaBookingCancelApi.js', import.meta.url), 'utf8')

const booking = {
  id: '1a1a1a1a-1111-4111-8111-111111111111',
  practitioner_id: '2b2b2b2b-2222-4222-8222-222222222222',
  status: 'confirmed', booking_source: 'mediumia', updated_at: '2026-10-05T12:00:00.000Z',
  starts_at: '2026-10-07T14:00:00.000Z', ends_at: '2026-10-07T15:00:00.000Z',
  google_event_id: 'g-123', customer_first_name: 'Alice', customer_last_name: 'Martin',
  service: { title: 'Consultation', modality: ['video'] },
}

test('Phase 3B : résolution et preview ne partent que d’un booking confirmé résolu côté serveur', () => {
  assert.equal(resolveBookingCancelCandidates([booking]).status, 'resolved')
  assert.equal(resolveBookingCancelCandidates([booking, { ...booking, id: '3c3c3c3c-3333-4333-8333-333333333333' }]).status, 'ambiguous')
  assert.equal(resolveBookingCancelCandidates([], { bookingId: booking.id }).status, 'not_found')
  const preview = buildBookingCancelPreview(booking)
  assert.equal(preview.source, 'MediumIA')
  assert.equal(preview.effects.google_projection, 'cancel_projection_pending')
  assert.equal(preview.effects.external_calls, false)
  assert.equal(buildBookingCancelPayload(booking).expected_target_updated_at, booking.updated_at)
  assert.equal(buildBookingCancelPreview({ ...booking, status: 'cancelled' }), null)
  assert.equal(buildBookingCancelPreview({ ...booking, booking_source: 'reservio' }), null)
  assert.equal(buildBookingCancelPreview({ ...booking, booking_source: 'manual' }), null)
})

test('Phase 3B : le SQL verrouille et refuse les états financiers à risque sans e-mail, Messages ou Google', () => {
  assert.match(migration, /create table if not exists public\.lumia_calendar_sync_jobs/i)
  assert.match(migration, /unique \(booking_id, operation\)/i)
  assert.match(migration, /operation IN \('cancel_projection'\)/i)
  const expectedLockOrder = [
    'from public.bookings',
    'from public.rdv_balance_payments',
    'from public.rdv_booking_holds',
    'from public.rdv_paypal_payments',
    'from public.rdv_payment_refunds',
    'from public.rdv_deposit_transfers',
    'from public.gift_card_redemptions',
  ]
  let position = -1
  for (const marker of expectedLockOrder) {
    const next = migration.toLowerCase().indexOf(marker, position + 1)
    assert.ok(next > position, `ordre de verrouillage attendu: ${marker}`)
    position = next
  }
  for (const table of ['rdv_balance_payments', 'rdv_booking_holds', 'rdv_paypal_payments', 'rdv_payment_refunds', 'rdv_deposit_transfers', 'gift_card_redemptions']) {
    assert.match(migration, new RegExp(`from public\\.${table}[\\s\\S]{0,300}for update nowait`, 'i'))
  }
  assert.match(migration, /when lock_not_available then[\s\S]*booking_or_payment_busy/i)
  assert.match(migration, /balance_capture_in_progress|balance_already_captured_requires_settlement/i)
  assert.match(migration, /gift_card_redemption_blocked|refund_exists_requires_review|deposit_transfer_exists_requires_review/i)
  assert.match(migration, /insert into public\.lumia_calendar_sync_jobs/i)
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ''), /google_calendar|deletebookingfromgoogle|sendemail|messages\.app|chat\.db/i)
})

test('Phase 3B : seule la source MediumIA peut être annulée par Lumia', () => {
  assert.match(migration, /v_booking\.booking_source is distinct from 'mediumia'/i)
  assert.match(migration, /lumia_booking_source_not_allowed/i)
  assert.match(migration, /where id = v_booking\.id[\s\S]*and status = 'confirmed'[\s\S]*and updated_at = v_intent\.expected_target_updated_at/i)
})

test('Phase 3B : l’exécution révalide le propriétaire du praticien sous verrou', () => {
  assert.match(migration, /from public\.booking_practitioners p[\s\S]*p\.id = v_booking\.practitioner_id[\s\S]*p\.owner_id = p_owner_id/i)
  assert.match(migration, /practitioner_not_owned/i)
})

test('Phase 3B : le job Google existant doit rester cohérent et actionnable', () => {
  assert.match(migration, /from public\.lumia_calendar_sync_jobs[\s\S]*for update nowait/i)
  assert.match(migration, /v_google_job\.google_event_id <> v_booking\.google_event_id/i)
  assert.match(migration, /v_google_job\.status not in \('pending', 'retry', 'running'\)/i)
  assert.match(migration, /google_sync_job_incoherent/i)
  assert.doesNotMatch(migration, /on conflict \(booking_id, operation\) do nothing/i)
  assert.match(migration, /coalesce\(v_google_job\.status, 'pending'\)/i)
})

test('Phase 3B : reprise après claim, échecs durables et snapshot updated_at sont explicitement protégés', () => {
  assert.match(migration, /v_intent\.status IN \('succeeded', 'failed', 'compensation_required'\)/i)
  assert.match(migration, /IF v_intent\.status <> 'executing'/i)
  assert.match(migration, /v_booking\.updated_at IS DISTINCT FROM v_intent\.expected_target_updated_at/i)
  assert.match(migration, /SET status = 'failed', executed_at = clock_timestamp\(\)/i)
  assert.match(migration, /RETURN v_result;/i)
  assert.match(migration, /SET status = 'cancelled', cancelled_at = clock_timestamp\(\)/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.lumia_execute_mediumia_booking_cancel[\s\S]*PUBLIC, anon, authenticated/i)
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i)
})

test('Phase 3B : API authentifiée reste dormante tant que la whitelist est vide', () => {
  assert.deepEqual(LUMIA_ALLOWED_ACTIONS, [])
  assert.match(api, /if \(!LUMIA_ALLOWED_ACTIONS\.includes\(LUMIA_BOOKING_CANCEL_ACTION\)\) return disabled\(\)/)
  assert.match(api, /ownedConversation\(db, userId/i)
  assert.match(api, /LUMIA_RDV_AGENT_ID = 'fcd33963-3e5f-4726-abec-b9c5c5ee4fe2'/)
  assert.match(api, /eq\('agent_id', LUMIA_RDV_AGENT_ID\)/)
  assert.match(api, /booking_practitioners\.owner_id', userId/i)
  assert.match(api, /booking\.booking_source !== 'mediumia'/i)
  assert.doesNotMatch(api, /sendEmail|googleCalendar|Messages\.app|chat\.db/)
})

test('Phase 3B : approve et claim n’acceptent que l’intent Lumia cancel privé', () => {
  assert.match(api, /async function ownedBookingCancelIntent[\s\S]*action_type !== LUMIA_BOOKING_CANCEL_ACTION[\s\S]*target_source !== 'mediumia_booking'[\s\S]*!data\.practitioner_id[\s\S]*!isUuid\(data\.target_id\)/)
  const approveAt = api.indexOf("if (op === 'approve')")
  const approveRpcAt = api.indexOf("lumia_approve_action_intent")
  const executeAt = api.indexOf("if (op === 'execute')")
  const claimRpcAt = api.indexOf("lumia_claim_action_execution")
  assert.ok(api.indexOf('ownedBookingCancelIntent', approveAt) < approveRpcAt)
  assert.ok(api.indexOf('ownedBookingCancelIntent', executeAt) < claimRpcAt)
})

test('Phase 3B : claim utilise les quatre arguments serveur et la clé de l’intent', () => {
  const claimAt = api.indexOf("lumia_claim_action_execution")
  const claimBlock = api.slice(claimAt, claimAt + 360)
  assert.match(claimBlock, /p_owner_id: userId/)
  assert.match(claimBlock, /p_conversation_id: conversation\.id/)
  assert.match(claimBlock, /p_intent_id: intent\.id/)
  assert.match(claimBlock, /p_executor_name: LUMIA_BOOKING_CANCEL_EXECUTOR/)
  assert.match(api, /idempotencyKey: intent\.idempotency_key/)
  assert.doesNotMatch(api, /input\.idempotency_key/)
})
