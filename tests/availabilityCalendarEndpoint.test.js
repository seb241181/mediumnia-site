/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityCalendarSyncInternals, handleAvailabilityCalendarSync } from '../lib/availabilityCalendarSyncHandler.js'
import { executeAvailabilityCalendarSync } from '../lib/availabilityCalendarExecutor.js'
import fs from 'node:fs'

function response(statuses) {
  return { status: (code) => { statuses.push(code); return { json: () => {} } } }
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
}

test('production calendar sync is disabled before any database work', async () => {
  const previous = {
    vercel: process.env.VERCEL_ENV,
    mediumia: process.env.MEDIUMIA_ENV,
    enabled: process.env.AVAILABILITY_CALENDAR_SYNC_ENABLED,
  }
  process.env.VERCEL_ENV = 'production'
  process.env.MEDIUMIA_ENV = 'production'
  delete process.env.AVAILABILITY_CALENDAR_SYNC_ENABLED
  const statuses = []
  await handleAvailabilityCalendarSync({ method: 'POST', headers: {}, query: {} }, response(statuses))
  assert.deepEqual(statuses, [404])
  restoreEnv({
    VERCEL_ENV: previous.vercel,
    MEDIUMIA_ENV: previous.mediumia,
    AVAILABILITY_CALENDAR_SYNC_ENABLED: previous.enabled,
  })
})

test('calendar sync stays disabled outside an explicit production runtime', () => {
  const previous = {
    vercel: process.env.VERCEL_ENV,
    mediumia: process.env.MEDIUMIA_ENV,
    enabled: process.env.AVAILABILITY_CALENDAR_SYNC_ENABLED,
  }
  process.env.VERCEL_ENV = 'preview'
  process.env.MEDIUMIA_ENV = 'test'
  process.env.AVAILABILITY_CALENDAR_SYNC_ENABLED = 'true'
  assert.equal(availabilityCalendarSyncInternals.isExplicitlyEnabledInProduction(), false)
  restoreEnv({
    VERCEL_ENV: previous.vercel,
    MEDIUMIA_ENV: previous.mediumia,
    AVAILABILITY_CALENDAR_SYNC_ENABLED: previous.enabled,
  })
})

test('blank server secrets never authorize an availability synchronization', () => {
  const previous = {
    cron: process.env.CRON_SECRET,
    manual: process.env.AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET,
  }
  delete process.env.CRON_SECRET
  delete process.env.AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET
  assert.equal(availabilityCalendarSyncInternals.isAuthorized({
    headers: { authorization: 'Bearer ', 'x-availability-sync-secret': '' },
  }), false)
  restoreEnv({
    CRON_SECRET: previous.cron,
    AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET: previous.manual,
  })
})

test('executor rejects a TEST configuration from a Production runtime before database or Google access', async () => {
  const previous = process.env.MEDIUMIA_ENV
  process.env.MEDIUMIA_ENV = 'production'
  await assert.rejects(() => executeAvailabilityCalendarSync({
    db: null,
    config: {
      practitioner_id: 'not-read',
      target_calendar_id: 'availability-secondary',
      source_calendar_id: 'seb',
      environment: 'test',
    },
  }), /unsafe_calendar_target/)
  restoreEnv({ MEDIUMIA_ENV: previous })
})

test('Production configuration contains no availability-calendar Cron', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal((config.crons || []).some((cron) => /availability-calendar/.test(cron.path)), false)
})
