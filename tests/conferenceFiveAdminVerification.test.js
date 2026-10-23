import test from 'node:test'
import assert from 'node:assert/strict'
import { handleFormationRencontres } from '../lib/formationRencontresApi.js'
import { CONFERENCE_FIVE_PLAN } from '../lib/conferenceFiveInstallments.js'

const bookingId = '11111111-1111-4111-8111-111111111112'
const rencontreId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2027-01-15T10:00:00Z')
const subId = 'I-TESTXYZ12345'
const contract = {
  id: 'contract',
  user_id: 'student',
  paypal_subscription_id: subId,
  paypal_env: 'sandbox',
  offer_code: CONFERENCE_FIVE_PLAN.code,
  status: 'active',
  meetings_approved: true,
  first_paid_at: '2026-10-23T10:00:00Z',
  provider_last_checked_at: '2027-01-15T09:59:00Z',
}
const payments = [1,2,3].map(n=>({
  contract_id:'contract', provider_id:'CAPTURE-'+n, capture_id:'CAPTURE-'+n,
  paypal_subscription_id:subId, paypal_env:'sandbox', currency:'EUR',
  kind:'capture', status:'COMPLETED',amount_cents:9980,
}))
const booking = {id:bookingId,user_id:'student',rencontre_id:rencontreId,status:'booked'}
const meeting = {id:rencontreId,status:'scheduled',starts_at:'2027-01-16T09:00:00Z',ends_at:'2027-01-16T11:00:00Z'}
function fakeDb({tx=payments,b=booking,contractRow=contract}={}) {
  const data = {
    booking_practitioners:[{slug:'sebastien-seguin',owner_id:'owner',id:'p1'}],
    formation_rencontre_bookings:[b],
    formation_rencontres:[meeting],
    mediumia_entitlements:[],
    conference_five_contracts:[contractRow],
    conference_five_transactions:tx,
  }
  return {
    auth:{getUser:async token=>token==='owner'||token==='student'
      ? {data:{user:{id:token}},error:null}
      : {data:{user:null},error:new Error('invalid')}},
    from(name){
      const filters=[]
      const q={
        select(){return q},
        eq(k,v){filters.push(r=>r[k]===v);return q},
        in(k,list){filters.push(r=>list.includes(r[k]));return q},
        order(){return q},
        limit(){return q},
        maybeSingle:async()=>({data:(data[name]||[]).filter(Boolean).find(r=>filters.every(f=>f(r)))||null,error:null}),
        then(fn){return Promise.resolve({data:(data[name]||[]).filter(Boolean).filter(r=>filters.every(f=>f(r))),error:null}).then(fn)},
      }
      return q
    },
  }
}
async function ask(db, who='owner', paymentVerifier=async()=>true, at=now) {
  const res={statusCode:0,body:null,setHeader(){},status(v){this.statusCode=v;return this},json(v){this.body=v;return this}}
  await handleFormationRencontres({method:'POST',headers:{authorization:'Bearer '+who},body:{bookingId}},res,'admin-verify',{
    supabase:db,env:'sandbox',now:at,paymentVerifier,
  })
  return res
}
test('operator verifies a booked 5x attendee only after provider recheck',async()=>{
  const old={VERCEL_ENV:process.env.VERCEL_ENV,SUPABASE_URL:process.env.SUPABASE_URL,CONFERENCE_FIVE_SANDBOX_ENABLED:process.env.CONFERENCE_FIVE_SANDBOX_ENABLED}
  process.env.VERCEL_ENV='preview'
  process.env.SUPABASE_URL='https://wnbwhnqiulsdjcvkuwos.supabase.co'
  process.env.CONFERENCE_FIVE_SANDBOX_ENABLED='true'
  try{
    let rechecks=0
    const allowed=await ask(fakeDb(), 'owner', async()=>{rechecks++;return true})
    assert.equal(allowed.statusCode,200)
    assert.deepEqual(allowed.body,{eligible:true,reason:null,checkedAt:now.toISOString()})
    assert.equal(rechecks,1)
    const missing=await ask(fakeDb({tx:[]}))
    assert.equal(missing.body.eligible,false)
    const refunded=await ask(fakeDb({tx:[...payments,{...payments[0],provider_id:'REFUND-1',kind:'refund'}]}))
    assert.equal(refunded.body.eligible,false)
    const cancelled=await ask(fakeDb({b:{...booking,status:'cancelled'}}))
    assert.deepEqual(cancelled.body,{eligible:false,reason:'booking_not_active'})
    const failedProvider=await ask(fakeDb(), 'owner', async()=>{throw Error('PayPal Sandbox unavailable')})
    assert.equal(failedProvider.body.eligible,false)
    assert.equal((await ask(fakeDb(),'student')).statusCode,403)
    process.env.VERCEL_ENV='production'
    assert.equal((await ask(fakeDb())).body.eligible,false)
  } finally {
    for(const[k,v]of Object.entries(old)) if(v===undefined)delete process.env[k];else process.env[k]=v
  }
})