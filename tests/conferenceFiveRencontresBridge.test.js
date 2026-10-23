import test from 'node:test'
import assert from 'node:assert/strict'
import { fiveBridgeEnabled, evaluateFiveBridge, loadFiveBridgeRights } from '../lib/conferenceFiveRencontresTest.js'
import { CONFERENCE_FIVE_PLAN } from '../lib/conferenceFiveInstallments.js'

const ownerId = 'unit-test-student'
const id='I-TESTCONFERENCE5X'
const contract = {
  id:'test-contract',
  user_id:ownerId,
  offer_code:CONFERENCE_FIVE_PLAN.code,
  paypal_env:'sandbox',
  paypal_subscription_id:id,
  status:'active',
  meetings_approved:true,
  first_paid_at:'2026-10-23T10:00:00Z',
  provider_last_checked_at:'2027-01-16T08:57:00Z',
}
const transactions=Array.from({length:3},(_,i)=>({
  provider_id:`CAPTURE-${i+1}`, paypal_subscription_id:id,
  paypal_env:'sandbox', currency:'EUR',kind:'capture',
  capture_id:`CAPTURE-${i+1}`,status:'COMPLETED',amount_cents:9980,
}))
const now=new Date('2027-01-16T09:00:00Z')
const eligible = (data=contract,tx=transactions,at=now)=>evaluateFiveBridge({userId:ownerId,contract:data,transactions:tx,now:at})
test('conference 5x: three settled October-December payments give January visio right, not full training',()=>{
  const r=eligible()
  assert.equal(r?.eligible,true)
  assert.equal(r?.scope,'conference_5x_test')
  assert.equal(r?.fullTrainingAccess,false)
  assert.ok(new Date(r.from)<now)
  assert.ok(new Date(r.until)>new Date('2027-05-22T08:00:00Z'))
})
test('conference 5x: stale reconciliation, future timestamp or unpaid fourth instalment blocks meeting',()=>{
  assert.equal(eligible({...contract,provider_last_checked_at:'2027-01-15T22:00:00Z'}),null)
  assert.equal(eligible({...contract,provider_last_checked_at:'2027-01-16T10:00:00Z'}),null)
  assert.equal(eligible({...contract,provider_last_checked_at:'2027-01-24T08:57:00Z'},transactions,new Date('2027-01-24T09:00:00Z')),null)
})
test('conference 5x: refunds, duplicate capture and wrong payment amount always block',()=>{
  assert.equal(eligible(contract,[...transactions, {...transactions[0],provider_id:'refund:CAPTURE-1',kind:'refund'}]),null)
  assert.equal(eligible(contract,[...transactions,transactions[0]]),null)
  assert.equal(eligible(contract,[...transactions.slice(0,2),{...transactions[2],amount_cents:9999}]),null)
})
test('conference 5x: owner approval, contract status and matching identity mandatory',()=>{
  assert.equal(eligible({...contract,meetings_approved:false}),null)
  assert.equal(eligible({...contract,status:'suspended'}),null)
  assert.equal(eligible({...contract,user_id:'different'}),null)
  assert.equal(eligible({...contract,offer_code:'ordinary-progressive-597'}),null)
})
test('conference 5x: no authorization in production or when TEST switch is disabled',()=>{
  const env={VERCEL_ENV:'preview',SUPABASE_URL:'https://wnbwhnqiulsdjcvkuwos.supabase.co',CONFERENCE_FIVE_SANDBOX_ENABLED:'true'}
  assert.equal(fiveBridgeEnabled(env,'sandbox'),true)
  assert.equal(fiveBridgeEnabled({...env,VERCEL_ENV:'production'},'sandbox'),false)
  assert.equal(fiveBridgeEnabled({...env,SUPABASE_URL:'https://uotkpygeqqnekpolezts.supabase.co'},'sandbox'),false)
  assert.equal(fiveBridgeEnabled({...env,CONFERENCE_FIVE_SANDBOX_ENABLED:'false'},'sandbox'),false)
  assert.equal(fiveBridgeEnabled(env,'live'),false)
})
test('conference 5x: loading rights fails closed when TEST flag not present, without SQL query',async()=>{
  let queried=false
  const db={from:()=>{queried=true;throw Error('should never query')}}
  const result=await loadFiveBridgeRights(db,ownerId,'live',now)
  assert.equal(result,null)
  assert.equal(queried,false)
})
