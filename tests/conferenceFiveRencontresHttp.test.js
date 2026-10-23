import test from 'node:test'
import assert from 'node:assert/strict'
import { handleFormationRencontres } from '../lib/formationRencontresApi.js'
import { CONFERENCE_FIVE_PLAN } from '../lib/conferenceFiveInstallments.js'
import { evaluateFiveBridge, loadFiveBridgeRights, fiveBridgeEnabled } from '../lib/conferenceFiveRencontresTest.js'

const SID = '11111111-1111-4111-8111-111111111111'
const student = 'test-five-pay-student'
const sub = 'I-SANDBOXTEST2026'
const now = new Date('2027-01-16T09:00:00Z')
const start = '2026-10-23T10:00:00Z'
const contract = {
  id: 'contract-test',
  user_id: student,
  offer_code: CONFERENCE_FIVE_PLAN.code,
  paypal_env: 'sandbox',
  paypal_subscription_id: sub,
  status: 'active',
  meetings_approved: true,
  first_paid_at: start,
  provider_last_checked_at: '2027-01-16T08:59:00Z',
}
const capture = (n) => ({
  contract_id: 'contract-test',
  provider_id: 'PAY-' + n,
  capture_id: 'PAY-' + n,
  paypal_subscription_id: sub,
  paypal_env: 'sandbox',
  kind: 'capture',
  status: 'COMPLETED',
  currency: 'EUR',
  amount_cents: 9980,
})
function fakeDb(state) {
  const calls = []
  return {
    calls,
    auth: { getUser: async token => token === 'good' ? { data: { user: { id: student } }, error: null } : { data: null, error: new Error('invalid') } },
    from(table) {
      const filter = []
      const rows = table === 'mediumia_entitlements' ? [] : table === 'conference_five_contracts' ? [state.contract] : table === 'conference_five_transactions' ? state.transactions : []
      const builder = {
        select() { return builder },
        eq(k,v) { filter.push(r=>r[k]===v); return builder },
        in(k,arr) { filter.push(r=>arr.includes(r[k])); return builder },
        order() { return builder },
        limit() { return builder },
        maybeSingle: async () => ({ data: rows.filter(Boolean).filter(r=>filter.every(fn=>fn(r)))[0]||null,error:null }),
        then(resolve) { return Promise.resolve({ data: rows.filter(Boolean).filter(r=>filter.every(fn=>fn(r))), error:null }).then(resolve) },
      }
      return builder
    },
    rpc: async (name,args) => { calls.push({name,args}); return { data: {ok:true,places_left:4}, error:null } },
  }
}
const response = () => {
  const res={statusCode:null,body:null}
  res.setHeader=()=>{}
  res.status=n=>{res.statusCode=n;return res}
  res.json=b=>{res.body=b;return res}
  return res
}
async function call(state, timestamp=now) {
  const db=fakeDb(state),res=response()
  await handleFormationRencontres({
    method:'POST',headers:{authorization:'Bearer good'},body:{rencontreId:SID},
  },res,'book',{supabase:db,env:'sandbox',now:timestamp})
  return {res, db}
}
test('booking HTTP: active plan with no validated payment is rejected, no RPC',async()=>{
  const vars = {VERCEL_ENV:process.env.VERCEL_ENV,SUPABASE_URL:process.env.SUPABASE_URL,CONFERENCE_FIVE_SANDBOX_ENABLED:process.env.CONFERENCE_FIVE_SANDBOX_ENABLED}
  try {
    process.env.VERCEL_ENV='preview'
    process.env.SUPABASE_URL='https://wnbwhnqiulsdjcvkuwos.supabase.co'
    process.env.CONFERENCE_FIVE_SANDBOX_ENABLED='true'
    const none=await call({contract:{...contract,first_paid_at:null},transactions:[]})
    assert.equal(none.res.statusCode,403)
    assert.equal(none.res.body.error,'not_eligible')
    assert.equal(none.db.calls.length,0)
    assert.equal(fiveBridgeEnabled(process.env, 'sandbox'), true, 'TEST flag should enable the bridge')
    const threeCaptures=[capture(1),capture(2),capture(3)]
    const pure=evaluateFiveBridge({userId:student,contract,transactions:threeCaptures,now})
    assert.equal(pure?.eligible, true, 'pure bridge should allow three settled charges')
    const rights=await loadFiveBridgeRights(fakeDb({contract,transactions:threeCaptures}),student,'sandbox',now)
    assert.equal(rights?.eligible, true, 'database adapter should find approved rights')
    const three=await call({contract,transactions:threeCaptures})
    assert.equal(three.res.statusCode,200)
    assert.equal(three.db.calls.length,1)
    assert.equal(three.db.calls[0].name,'formation_rencontre_book')
    assert.equal(three.db.calls[0].args.p_user_id,student)
    const missed=await call({contract:{...contract,provider_last_checked_at:'2027-01-24T08:59:00Z'},transactions:[capture(1),capture(2),capture(3)]},new Date('2027-01-24T09:00:00Z'))
    assert.equal(missed.res.statusCode,403)
    assert.equal(missed.db.calls.length,0)
    const refunded=await call({contract,transactions:[capture(1),capture(2),capture(3),{...capture(1),provider_id:'REF-1',kind:'refund'}]})
    assert.equal(refunded.res.statusCode,403)
    assert.equal(refunded.db.calls.length,0)
  } finally {
    for (const [k,v] of Object.entries(vars)) if(v===undefined)delete process.env[k];else process.env[k]=v
  }
})