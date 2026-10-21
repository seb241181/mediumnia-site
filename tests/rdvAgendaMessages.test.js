import test from 'node:test'
import assert from 'node:assert/strict'
import { rescheduleErrorMessage } from '../src/lib/rdvAgendaMessages.js'

test('reschedule errors have a clear French message for each API code', () => {
  const codes = [
    'outside_availability', 'exception_closed', 'slot_unavailable', 'booking_busy',
    'hold_busy', 'offer_busy', 'booking_changed', 'max_per_day', 'daily_limit_reached',
    'min_advance', 'outside_horizon', 'outside_booking_horizon', 'google_calendar_unavailable',
    'payment_busy', 'google_sync_pending', 'availability_unavailable', 'reschedule_unavailable',
  ]
  for (const code of codes) {
    const message = rescheduleErrorMessage(code)
    assert.ok(message.length > 20, `${code} should have a useful message`)
    assert.doesNotMatch(message, /\b(?:SQLSTATE|PostgreSQL|Supabase|RPC|HTTP 5\d\d)\b/i)
    assert.doesNotMatch(message, new RegExp(code, 'i'))
  }
})

test('unknown API errors receive a neutral message without echoing technical details', () => {
  const message = rescheduleErrorMessage('private_internal_error')
  assert.equal(message, 'Le déplacement n’a pas été effectué. Vérifiez les informations et réessayez.')
  assert.doesNotMatch(message, /private_internal_error/)
  assert.equal(rescheduleErrorMessage('constructor'), 'Le déplacement n’a pas été effectué. Vérifiez les informations et réessayez.')
})
