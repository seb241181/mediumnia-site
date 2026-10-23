/* global process */
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
  paypal_billing_anchor_at: '2026-10-23T10:00:00Z',
  paypal_next_billing_at: '2027-01-23T10:00:00Z',
  paypal_regular_cycles_completed: 3,
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
        gte(k,v){filters.push(r=>String(r[k])>=String(v));return q},
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
async function askMine(db, paymentVerifier=async()=>true, at=now) {
  const res={statusCode:0,body:null,setHeader(){},status(v){this.statusCode=v;return this},json(v){this.body=v;return this}}
  await handleFormationRencontres({method:'GET',headers:{authorization:'Bearer student'}},res,'mine',{
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
    // The provider may finish reconciliation milliseconds AFTER the request
    // timestamp; do not reject a valid attendee for a small bounded skew.
    const postSync={...contract,provider_last_checked_at:new Date(now.getTime()+5000).toISOString()}
    const checked=await ask(fakeDb({contractRow:postSync}))
    assert.equal(checked.statusCode,200)
    assert.equal(checked.body.eligible,true)
    const farFuture={...contract,provider_last_checked_at:new Date(now.getTime()+60000).toISOString()}
    assert.equal((await ask(fakeDb({contractRow:farFuture}))).body.eligible,false)

    const mine=await askMine(fakeDb(),async()=>{rechecks++;return true})
    assert.equal(mine.statusCode,200)
    assert.equal(mine.body.rights.eligible,true,'view must refresh an active test subscription')
    assert.equal(mine.body.rights.provisional,true,'access to visios is provisional only')
    assert.equal(rechecks,2)
    const mineWithoutProvider=await askMine(fakeDb(),async()=>{throw Error('provider_unavailable')})
    assert.equal(mineWithoutProvider.statusCode,200)
    assert.equal(mineWithoutProvider.body.rights.eligible,false)
    assert.equal(mineWithoutProvider.body.rights.paymentReview,true)
    const missing=await ask(fakeDb({tx:[]}))
    assert.equal(missing.body.eligible,false)
    const refunded=await ask(fakeDb({tx:[...payments,{...payments[0],provider_id:'REFUND-1',kind:'refund'}]}))
    assert.equal(refunded.body.eligible,false)
    // Negative access matrix, always against in-memory records — no writes to
    // a real subscription, no fabricated PayPal transactions persisted.
    const denied = [
      ['suspended_subscription', {contractRow:{...contract,status:'suspended'}}],
      ['cancelled_subscription', {contractRow:{...contract,status:'cancelled'}}],
      ['unapproved_meetings', {contractRow:{...contract,meetings_approved:false}}],
      ['missing_first_payment', {contractRow:{...contract,first_paid_at:null}}],
      ['missing_provider_schedule', {contractRow:{...contract,paypal_next_billing_at:null}}],
      ['unverified_cycle', {contractRow:{...contract,paypal_regular_cycles_completed:4}}],
      ['pending_capture', {tx:[...payments.slice(0,2),{...payments[2],status:'PENDING'}]}],
      ['partial_refund', {tx:[...payments,{...payments[0],provider_id:'REFUND-PARTIAL',kind:'refund',amount_cents:1996}]}],
      ['foreign_subscription', {tx:[...payments.slice(0,2),{...payments[2],paypal_subscription_id:'I-SOMEBODYELSE'}]}],
      ['wrong_capture_amount', {tx:[...payments.slice(0,2),{...payments[2],amount_cents:9999}]}],
      ['duplicate_capture', {tx:[...payments,payments[0]]}],
      ['future_verification', {contractRow:{...contract,provider_last_checked_at:'2027-01-15T10:01:00Z'}}],
      ['stale_verification', {contractRow:{...contract,provider_last_checked_at:'2027-01-15T09:40:00Z'}}],
    ]
    for (const [scenario, fixture] of denied) {
      const decision=await ask(fakeDb(fixture))
      assert.equal(decision.statusCode,200,scenario)
      assert.equal(decision.body.eligible,false,scenario)
      assert.equal('join_url' in decision.body,false,scenario)
      assert.equal('password' in decision.body,false,scenario)
    }
    const missedPayment=await ask(
      fakeDb({contractRow:{...contract,provider_last_checked_at:'2027-01-24T09:59:00Z'}}),
      'owner',async()=>true,new Date('2027-01-24T10:00:00Z'),
    )
    assert.equal(missedPayment.body.eligible,false,'fourth monthly charge overdue')
    const negativeProvider=await ask(fakeDb(),'owner',async()=>false)
    assert.equal(negativeProvider.body.eligible,false,'provider explicitly denied')

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