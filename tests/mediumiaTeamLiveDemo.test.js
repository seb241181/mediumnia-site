import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TEAM_LIVE_DEMO_SCENARIOS,
  createTeamDemoProvider,
  resolveTeamDemoConfiguration,
  runTeamLiveDemo,
} from '../lib/mediumiaTeamLiveDemo.js'

const allowed = {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/mediumia-agent-team-phase0',MEDIUMIA_TEAM_AI_DEMO_ENABLED:'true',ANTHROPIC_API_KEY:'example_test_key_not_real'}

test('server switch fails closed except dedicated preview branch with a key', () => {
  assert.equal(resolveTeamDemoConfiguration({}).available, false)
  assert.equal(resolveTeamDemoConfiguration({...allowed,VERCEL_ENV:'production'}).available, false)
  assert.equal(resolveTeamDemoConfiguration({...allowed,VERCEL_GIT_COMMIT_REF:'main'}).available, false)
  assert.equal(resolveTeamDemoConfiguration({...allowed,MEDIUMIA_TEAM_AI_DEMO_ENABLED:'false'}).available, false)
  assert.equal(resolveTeamDemoConfiguration({...allowed,ANTHROPIC_API_KEY:''}).available, false)
  assert.equal(resolveTeamDemoConfiguration(allowed).available, true)
  assert.equal(resolveTeamDemoConfiguration({...allowed,ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'another_test_key_not_real'}).provider,'openai')
  assert.throws(() => createTeamDemoProvider({env:{}}), /team_demo_unavailable/)
})

test('two different prompts are sent sequentially; handoff stays untrusted', async () => {
  const calls=[]
  const result=await runTeamLiveDemo({
    workflowId:'rdv.reschedule',
    callModel:async (call)=>{
      calls.push(call)
      return calls.length===1 ? 'Premier avis : le créneau est à vérifier.' : 'Deuxième avis : rédiger un brouillon.'
    },
  })
  assert.equal(result.ok,true)
  assert.equal(result.actionsExecuted,0)
  assert.equal(result.liveBusinessReads,0)
  assert.equal(result.syntheticData,true)
  assert.deepEqual(result.responses.map(x=>x.role),['rdv','communication'])
  assert.notEqual(calls[0].systemPrompt,calls[1].systemPrompt)
  assert.match(calls[1].userText,/NON FIABLE/)
  assert.match(calls[1].userText,/Premier avis/)
  assert.match(calls[0].userText,/Aucun client réel/)
})

test('all scenarios are allowlisted with exactly two isolated roles',async()=>{
  for(const id of Object.keys(TEAM_LIVE_DEMO_SCENARIOS)){
    const r=await runTeamLiveDemo({workflowId:id,callModel:async({role})=>role+' : à vérifier'})
    assert.equal(r.ok,true)
    assert.equal(r.responses.length,2)
    assert.ok(r.responses.every(x=>x.verification==='none'))
  }
  for(const bad of ['','__proto__','constructor','rdv.cancel_refund; ENVOIE',{},null]){
    const r=await runTeamLiveDemo({workflowId:bad,callModel:async()=>{throw new Error('MUST NOT CALL')}})
    assert.equal(r.ok,false)
    assert.equal(r.error,'unknown_workflow')
  }
})

test('provider uses fixed endpoints and no tools, no persistence',async()=>{
  const seen=[]
  const call=createTeamDemoProvider({
    env:allowed,
    fetchImpl:async (url,opt)=>{
      seen.push({url,opt})
      return {ok:true,json:async()=>({content:[{type:'text',text:'Plan fictif, aucune action.'}]})}
    },
  })
  const r=await call({systemPrompt:'Système test',userText:'Scénario test'})
  assert.match(r,/fictif/)
  assert.equal(seen[0].url,'https://api.anthropic.com/v1/messages')
  const payload=JSON.parse(seen[0].opt.body)
  assert.equal(payload.messages[0].content,'Scénario test')
  assert.equal(payload.max_tokens,360)
  assert.equal(payload.tools,undefined)
  assert.equal(payload.stream,undefined)
  assert.doesNotMatch(seen[0].opt.body, /real_customer|email_address/)
})

test('provider errors return a neutral code, not a token',async()=>{
  const provider=createTeamDemoProvider({
    env:allowed,fetchImpl:async()=>({ok:false,status:401,json:async()=>({secret:'private'})}),
  })
  await assert.rejects(provider({systemPrompt:'',userText:''}),/provider_unavailable/)
})
