import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const get = async p => readFile(new URL(p,root),'utf8')

test('TEST-only Supabase project with independent auth and no service role', async () => {
  const source = await get('src/components/rdv/mediumiaTeamTestClient.js')
  assert.match(source, /wnbwhnqiulsdjcvkuwos\.supabase\.co/)
  assert.match(source, /VITE_MEDIUMIA_TEAM_PHASE0 === 'true'/)
  assert.match(source, /VITE_MEDIUMIA_TEAM_TEST_URL === TEST_URL/)
  assert.match(source, /mediumia-team-test-owner-v1/)
  assert.match(source, /mediumia_team_test_read_v1/)
  assert.match(source, /mediumiaTeamTestClient\.auth\.getSession/)
  assert.doesNotMatch(source, /SERVICE_ROLE|uotkpygeqqnekpolezts|@mail\.mediumia\.fr|/ )
})

test('team reader logs into TEST and never includes any writing or emailing method', async () => {
  const source = await get('src/components/rdv/MediumiaTeamTestRead.jsx')
  assert.match(source,/auth\.signInWithPassword/)
  assert.match(source,/readMediumiaTeamTest\(\)/)
  assert.match(source,/aucun nom de client/i)
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.sendEmail\(|\.refund\(/)
  assert.match(source,/montants sont ceux enregistrés en TEST/)
})

test('owner preview dashboard includes the real reader as a separate component', async () => {
  const source = await get('src/components/rdv/MediumiaTeamDashboard.jsx')
  assert.match(source,/import MediumiaTeamTestRead/)
  assert.match(source,/<MediumiaTeamTestRead \/>/)
})
