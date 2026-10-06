import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBookingCancelChatCommand } from '../lib/lumiaBookingCancelChat.js'

const agentChat = readFileSync(new URL('../api/agent-chat.js', import.meta.url), 'utf8')
const cancelApi = readFileSync(new URL('../lib/lumiaBookingCancelApi.js', import.meta.url), 'utf8')
const syncWorker = readFileSync(new URL('../lib/lumiaCalendarSync.js', import.meta.url), 'utf8')

test('Lumia comprend une annulation simple par jour et heure', () => {
  const parsed = parseBookingCancelChatCommand('Annule le rendez-vous de mardi 16h', new Date('2026-10-06T04:00:00Z'))
  assert.equal(parsed.kind, 'cancel')
  assert.equal(parsed.weekday, 'mardi')
  assert.equal(parsed.hour, 16)
  assert.equal(parsed.minute, 0)
})

test('Lumia comprend demain et une date absolue', () => {
  const tomorrow = parseBookingCancelChatCommand('annule le rdv demain à 14h30', new Date('2026-10-06T04:00:00Z'))
  assert.equal(tomorrow.kind, 'cancel')
  assert.equal(tomorrow.date, '2026-10-07')
  assert.equal(tomorrow.hour, 14)
  assert.equal(tomorrow.minute, 30)

  const absolute = parseBookingCancelChatCommand('supprime le rendez-vous du 12/10 à 13h30', new Date('2026-10-06T04:00:00Z'))
  assert.equal(absolute.date, '2026-10-12')
  assert.equal(absolute.hour, 13)
  assert.equal(absolute.minute, 30)
})

test('GO est lié au code court quand il est fourni', () => {
  assert.deepEqual(
    parseBookingCancelChatCommand('GO #A1B2C3'),
    { kind: 'approve', shortCode: '#A1B2C3' },
  )
  assert.deepEqual(
    parseBookingCancelChatCommand('GO'),
    { kind: 'approve', shortCode: null },
  )
})

test('un message ordinaire ne déclenche aucune action', () => {
  assert.deepEqual(parseBookingCancelChatCommand('Quels rendez-vous ai-je mardi ?'), { kind: 'none' })
})

test('agent-chat traite le chemin action serveur avant le modèle', () => {
  assert.match(agentChat, /maybeHandleLumiaBookingCancelChat/)
  const actionAt = agentChat.indexOf('maybeHandleLumiaBookingCancelChat')
  const providerAt = agentChat.indexOf("if (provider === 'anthropic')")
  assert.ok(actionAt >= 0 && providerAt > actionAt)
  assert.match(agentChat, /actionHandled: true/)
})

test('annulation réussie lance la synchronisation Google durable', () => {
  assert.match(cancelApi, /processLumiaCalendarSyncJob/)
  assert.match(cancelApi, /body\?\.status === 'succeeded'/)
  assert.match(syncWorker, /deleteBookingFromGoogleCalendar/)
  assert.match(syncWorker, /status: 'running'/)
  assert.match(syncWorker, /\['deleted', 'already_deleted'\]/)
  assert.match(syncWorker, /manual_review/)
})
