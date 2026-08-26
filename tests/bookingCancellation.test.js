import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bookingCancellationUrl,
  cancellationCutoff,
  canSelfCancel,
  createCancellationToken,
  hashCancellationToken,
} from '../lib/bookingCancellation.js'

test('génère un token aléatoire et ne conserve qu’un hash SHA-256', () => {
  const first = createCancellationToken()
  const second = createCancellationToken()

  assert.notEqual(first.token, second.token)
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/)
  assert.equal(hashCancellationToken(first.token), first.tokenHash)
})

test('refuse les tokens manifestement invalides', () => {
  assert.equal(hashCancellationToken('court'), null)
  assert.equal(hashCancellationToken(null), null)
})

test('autorise jusqu’à H-24 inclus et bloque ensuite', () => {
  const start = '2026-09-15T06:00:00.000Z'
  assert.equal(cancellationCutoff(start).toISOString(), '2026-09-14T06:00:00.000Z')
  assert.equal(canSelfCancel(start, '2026-09-14T06:00:00.000Z'), true)
  assert.equal(canSelfCancel(start, '2026-09-14T06:00:00.001Z'), false)
})

test('utilise l’URL Preview Vercel hors Production', () => {
  const oldEnv = process.env.VERCEL_ENV
  const oldBranch = process.env.VERCEL_BRANCH_URL
  const oldPublic = process.env.BOOKING_PUBLIC_URL
  try {
    process.env.BOOKING_PUBLIC_URL = 'https://mediumia.fr'
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_BRANCH_URL = 'mediumia-preview.vercel.app'

    assert.equal(
      bookingCancellationUrl('secret-token-value-abcdefghijklmnopqrstuvwxyz'),
      'https://mediumia-preview.vercel.app/rdv/annuler#token=secret-token-value-abcdefghijklmnopqrstuvwxyz',
    )
  } finally {
    if (oldEnv == null) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = oldEnv
    if (oldBranch == null) delete process.env.VERCEL_BRANCH_URL
    else process.env.VERCEL_BRANCH_URL = oldBranch
    if (oldPublic == null) delete process.env.BOOKING_PUBLIC_URL
    else process.env.BOOKING_PUBLIC_URL = oldPublic
  }
})
