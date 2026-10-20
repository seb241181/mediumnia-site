import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeTeamTestAnalysis,
  isMediumiaTeamTestAnalysisEnabled,
  analyzeVerifiedTeamTest,
} from '../lib/mediumiaTeamTestAnalysis.js'

const fixture = {
  source:'mediumia_test', environment:'TEST', practitioner:'seb-test',
  contains_client_identity:false, provider_verified:false,
  bookings:{confirmed:4,future_confirmed:2},
  payments:{records:1,captured:1,captured_total_cents:7000},
  refunds:{completed:0},
  upcoming_slots:[{starts_at:'2026-10-23T12:00:00Z',service:'Guidance visio test'}],
}

test('production and unapproved branches cannot run the TEST model reader', () => {
  const e={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/mediumia-agent-team-phase0',
    MEDIUMIA_TEAM_READ_TEST_ENABLED:'true',MEDIUMIA_TEAM_AI_DEMO_ENABLED:'true',
    VITE_MEDIUMIA_TEAM_TEST_URL:'https://wnbwhnqiulsdjcvkuwos.supabase.co',
    VITE_MEDIUMIA_TEAM_TEST_PUBLISHABLE_KEY:'sb_publishable_test_value',
    ANTHROPIC_API_KEY:'test_key_is_not_a_secret'}
  assert.equal(isMediumiaTeamTestAnalysisEnabled(e),true)
  assert.equal(isMediumiaTeamTestAnalysisEnabled({...e,VERCEL_ENV:'production'}),false)
  assert.equal(isMediumiaTeamTestAnalysisEnabled({...e,VERCEL_GIT_COMMIT_REF:'main'}),false)
  assert.equal(isMediumiaTeamTestAnalysisEnabled({...e,MEDIUMIA_TEAM_READ_TEST_ENABLED:'false'}),false)
})

test('only normalized counters may reach agents, with no personal data', async () => {
  const raw={...fixture,extra:'forbidden',upcoming_slots:[
    {...fixture.upcoming_slots[0],customer_email:'never-send@example.invalid'},
  ]}
  const cleaned=sanitizeTeamTestAnalysis(raw)
  assert.deepEqual(cleaned,{
    confirmed:4,upcoming:2,paymentRecords:1,captured:1,capturedCents:7000,
    refundsCompleted:0,firstUpcomingAt:'2026-10-23T12:00:00Z',
  })
  assert.equal(sanitizeTeamTestAnalysis({...fixture,environment:'PROD'}),null)
  assert.equal(sanitizeTeamTestAnalysis({...fixture,contains_client_identity:true}),null)
  const requests=[]
  const notes=await analyzeVerifiedTeamTest(cleaned,async query=>{
    requests.push(query)
    return 'Compte rendu clair et prudent.'
  })
  assert.deepEqual(notes.map(n=>n.role),['rdv','finance'])
  assert.equal(notes.length,2)
  assert.doesNotMatch(JSON.stringify(requests), /never-send|example.invalid|Guidance visio test|forbidden/)
})
