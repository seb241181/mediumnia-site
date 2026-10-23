import test from 'node:test'
import assert from 'node:assert/strict'
import { readFiveProviderSchedule } from '../lib/conferenceFiveProviderSchedule.js'

const normal = (extra={}) => ({
  status:'ACTIVE', start_time:'2026-10-23T10:00:00Z',
  billing_info:{
    cycle_executions:[{tenure_type:'REGULAR',total_cycles:5,cycles_completed:1}],
    next_billing_time:'2026-11-23T10:00:00Z',
  },
  ...extra,
})

test('PayPal 5x: verified subscription dates and completed cycles are read from the provider',()=>{
  const d=readFiveProviderSchedule(normal())
  assert.equal(d.valid,true)
  assert.equal(d.anchor,'2026-10-23T10:00:00.000Z')
  assert.equal(d.nextBillingAt,'2026-11-23T10:00:00.000Z')
  assert.equal(d.cyclesCompleted,1)
  assert.equal(d.dueDates.length,5)
  assert.equal(d.dueDates[4],'2027-02-23T10:00:00.000Z')
})

test('PayPal 5x: never accept an infinite plan or a sixth cycle',()=>{
  for(const total_cycles of [0,4,6]){
    const v=readFiveProviderSchedule(normal({billing_info:{cycle_executions:[{tenure_type:'REGULAR',total_cycles,cycles_completed:1}],next_billing_time:'2026-11-23T10:00:00Z'}}))
    assert.equal(v.valid,false)
  }
})

test('PayPal 5x: invalid or missing next due dates fail closed',()=>{
  for(const next_billing_time of [null,'bad-time','2027-01-23T10:00:00Z']){
    const v=readFiveProviderSchedule(normal({billing_info:{cycle_executions:[{tenure_type:'REGULAR',total_cycles:5,cycles_completed:1}],next_billing_time}}))
    assert.equal(v.valid,false)
  }
})

test('PayPal 5x: suspension, missing billing terms or missing start time fail closed',()=>{
  assert.equal(readFiveProviderSchedule(normal({status:'SUSPENDED'})).valid,false)
  assert.equal(readFiveProviderSchedule(normal({start_time:undefined})).valid,false)
  assert.equal(readFiveProviderSchedule(normal({billing_info:{}})).valid,false)
  assert.equal(readFiveProviderSchedule(normal({billing_info:{cycle_executions:[{tenure_type:'REGULAR',total_cycles:5,cycles_completed:3}],next_billing_time:'2027-01-23T10:00:00Z'}})).valid,true)
})

test('PayPal 5x: final cycle can have no upcoming payment',()=>{
  const d=readFiveProviderSchedule(normal({status:'EXPIRED',billing_info:{cycle_executions:[{tenure_type:'REGULAR',total_cycles:5,cycles_completed:5}]}}))
  assert.equal(d.valid,true)
  assert.equal(d.nextBillingAt,null)
  assert.equal(d.cyclesCompleted,5)
})
