import test from 'node:test'
import assert from 'node:assert/strict'
import { assertCurrentCheckout, createCheckoutOrderGate } from '../src/lib/rdvCheckoutRetry.js'
import { sendCheckoutRateLimit } from '../lib/rdvCheckoutEvents.js'

test('des callbacks simultanés partagent la même demande de commande', async () => {
  const gate = createCheckoutOrderGate()
  const run = (submit) => gate('checkout-1', 'arrhes', submit)
  let calls = 0
  const submit = async () => { calls += 1; return 'order' }
  const first = run(submit)
  assert.equal(first, run(submit))
  assert.equal(await first, 'order')
  assert.equal(calls, 1)
})

test('une erreur technique bloque les répétitions sans soumettre automatiquement', async () => {
  let now = 0
  const gate = createCheckoutOrderGate(() => now)
  const run = (submit) => gate('checkout-1', 'arrhes', submit)
  let calls = 0
  const submit = async () => {
    if (++calls === 1) throw new Error('network')
    return 'order'
  }
  await assert.rejects(run(submit), /network/)
  await assert.rejects(run(submit), /network/)
  assert.equal(calls, 1)
  now = 15_000
  assert.equal(await run(submit), 'order')
  assert.equal(calls, 2)
})

test('les refus horaires et quotidiens fournissent un délai conservateur', async () => {
  for (const [reason, seconds] of [['hourly', 3600], ['daily', 86400]]) {
    let status, header
    const res = {
      setHeader: (key, value) => { assert.equal(key, 'Retry-After'); header = value },
      status: (code) => { status = code; return res },
      json: (body) => body,
    }
    const body = sendCheckoutRateLimit(res, 'create_full', reason)
    assert.equal(status, 429)
    assert.equal(header, String(seconds))
    let now = 0
    const gate = createCheckoutOrderGate(() => now)
    const run = (submit) => gate('checkout-1', 'arrhes', submit)
    const error = Object.assign(new Error(body.error), body)
    await assert.rejects(run(() => { throw error }), /rate_limit_exceeded/)
    now = seconds * 1000 - 1
    await assert.rejects(run(() => assert.fail('aucune nouvelle demande')), /rate_limit_exceeded/)
    now += 1
    assert.equal(await run(() => 'order'), 'order')
  }
})

for (const [from, to] of [['arrhes', 'full_payment'], ['full_payment', 'arrhes']]) {
  for (const latestFirst of [false, true]) {
    test(`changement ${from} vers ${to}, réponse récente ${latestFirst ? 'en premier' : 'en dernier'}`, async () => {
      const run = createCheckoutOrderGate()
      let activeId = 'first'
      let activeChoice = from
      const shown = []
      const start = (id, choice, response) => run(id, choice, async () => {
        const order = await response
        assertCurrentCheckout(() => activeId === id && activeChoice === choice)
        shown.push(order)
        return order
      })
      const oldResponse = Promise.withResolvers()
      const newResponse = Promise.withResolvers()
      const old = start('first', from, oldResponse.promise)
      const rejected = assert.rejects(old, /checkout_context_changed/)
      activeId = 'second'
      activeChoice = to
      const current = start('second', to, newResponse.promise)
      if (latestFirst) {
        newResponse.resolve(to)
        assert.equal(await current, to)
      }
      oldResponse.resolve(from)
      await rejected
      newResponse.resolve(to)
      assert.equal(await current, to)
      assert.deepEqual(shown, [to])
    })
  }
}
