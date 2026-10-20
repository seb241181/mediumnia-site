import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMediumiaTeamDemo } from '../lib/mediumiaTeamDemoReports.js'
import { MEDIUMIA_TEAM_WORKFLOWS } from '../lib/mediumiaTeamOrchestrator.js'

test('each workflow produces an entirely static, stepwise, no-side-effects rehearsal', () => {
  for (const [workflow, config] of Object.entries(MEDIUMIA_TEAM_WORKFLOWS)) {
    const empty = buildMediumiaTeamDemo(workflow)
    assert.equal(empty.ok, true)
    assert.equal(empty.mode, 'fixture_only')
    assert.equal(empty.totalSteps, config.missions.length)
    assert.equal(empty.externalActionCount, 0)
    assert.equal(empty.modelCalls, 0)
    assert.deepEqual(empty.steps, [])
    assert.equal(Object.isFrozen(empty), true)
    assert.equal(Object.isFrozen(empty.steps), true)

    const all = buildMediumiaTeamDemo(workflow, 9999)
    assert.equal(all.complete, true)
    assert.equal(all.steps.length, all.totalSteps)
    assert.deepEqual(all.steps.map(x => x.mission), config.missions)
    for (const item of all.steps) {
      assert.equal(item.actionExecuted, false)
      assert.equal(item.providerVerified, false)
      assert.equal(item.mode, 'SIMULATION')
      assert.ok(item.simulatedFinding.length > 20)
      assert.ok(item.handoff.length > 20)
      assert.equal(Object.isFrozen(item), true)
    }
  }
})

test('refund is never claimed to be completed and communication remains only a draft', () => {
  const all = buildMediumiaTeamDemo('rdv.cancel_refund', 6)
  const refund = all.steps.find(s => s.mission === 'finance.refund')
  const draft = all.steps.find(s => s.mission === 'communication.draft')
  const send = all.steps.find(s => s.mission === 'communication.send')
  assert.match(refund.simulatedFinding, /NON EFFECTUÉ/)
  assert.match(draft.simulatedFinding, /BROUILLON SIMULÉ/)
  assert.match(send.simulatedFinding, /AUCUN ENVOI/)
  assert.ok(refund.ownerApprovalRequired)
  assert.ok(send.ownerApprovalRequired)
})

test('invalid workflow identifiers and untrusted parameters cannot execute anything', () => {
  for (const bad of [null, '', '__proto__', 'constructor', 'rdv.cancel_refund; pay now', {}, []]) {
    const v = buildMediumiaTeamDemo(bad, 100)
    assert.equal(v.ok, false)
    assert.equal(v.steps.length, 0)
  }
  for (const wrong of [NaN, -10, Infinity, '3', 2.5, {}, null]) {
    const v = buildMediumiaTeamDemo('rdv.reschedule', wrong)
    assert.equal(v.visibleCount, 0)
    assert.equal(v.externalActionCount, 0)
  }
})

test('the fixture never includes a real recipient or token and executes no requests', () => {
  for (const key of Object.keys(MEDIUMIA_TEAM_WORKFLOWS)) {
    const value = JSON.stringify(buildMediumiaTeamDemo(key, 20))
    assert.doesNotMatch(value, /@gmail\.com|@hotmail\.fr|@outlook\.com|https:\/\/.*access=|paypal_capture_id|Authorization: Bearer/i)
    assert.match(value, /SIMULATION/)
  }
})
