import assert from 'node:assert/strict'
import test from 'node:test'
import { RDV_TERMS_VERSION, rdvRefundGuidance } from '../lib/rdvCancellationTerms.js'

const startsAt='2026-12-11T15:00:00+01:00'
const base={termsVersion:RDV_TERMS_VERSION,startsAt,cancelReason:'client_self_service',paidCents:8000,arrhesCents:2000}
test('RDV : annulation exactement 48 heures avant = remboursement intégral du paiement',()=>{
  assert.deepEqual(rdvRefundGuidance({...base,cancelledAt:'2026-12-09T15:00:00+01:00'}),{
    code:'early_full_refund',recommendedRefundCents:8000,retainedCents:0,
  })
})
test('RDV : moins de 48 h, 80 € versés = 60 € à rembourser, 20 € d’arrhes à examiner',()=>{
  assert.deepEqual(rdvRefundGuidance({...base,cancelReason:'client_request',cancelledAt:'2026-12-10T15:00:00+01:00'}),{
    code:'late_arrhes_review',recommendedRefundCents:6000,retainedCents:2000,
  })
})
test('RDV : moins de 48 h, seulement 20 € d’arrhes = 0 € recommandé hors droits légaux',()=>{
  assert.deepEqual(rdvRefundGuidance({...base,paidCents:2000,cancelReason:'client_request',cancelledAt:'2026-12-10T15:00:00+01:00'}),{
    code:'late_arrhes_review',recommendedRefundCents:0,retainedCents:2000,
  })
})
test('RDV : anciennes conditions, annulation du professionnel ou motif absent = décision humaine',()=>{
  for(const overrides of [
    {termsVersion:'rdv-arrhes-2026-09-24-v2'},
    {cancelReason:'practitioner_cancelled'},
    {cancelReason:null},
  ]) assert.deepEqual(rdvRefundGuidance({...base,cancelledAt:'2026-12-10T15:00:00+01:00',...overrides}),{
    code:'manual_review',recommendedRefundCents:null,retainedCents:null,
  })
})
