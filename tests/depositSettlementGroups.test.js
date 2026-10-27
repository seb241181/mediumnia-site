import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groupDepositSettlements } from '../src/components/rdv/depositSettlementGroups.js'

test('arrhes : only final settlements are archived, pending and uncertain stays visible', () => {
  const statuses = ['open','refund_pending','partially_refunded','refunded','transferred','retained','manual_review','unexpected']
  const items = statuses.map((status, n) => ({ booking_id: String(n), settlement_status: status }))
  const result = groupDepositSettlements(items)
  assert.deepEqual(result.active.map(x => x.settlement_status), ['open','refund_pending','partially_refunded','manual_review','unexpected'])
  assert.deepEqual(result.archived.map(x => x.settlement_status), ['refunded','transferred','retained'])
  assert.equal(items.length, 8)
  assert.deepEqual(groupDepositSettlements(), { active: [], archived: [] })
})

test('arrhes : dossier réglé absent de la liste active mais toujours accessible dans les archives', () => {
  const ui = fs.readFileSync('src/components/rdv/DepositSettlements.jsx', 'utf8')
  const backend = fs.readFileSync('lib/rdvDepositSettlements.js', 'utf8')
  assert.match(ui, /const \{ active, archived \} = groupDepositSettlements\(items\)/)
  assert.match(ui, /active\.map\(renderSettlementCard\)/)
  assert.match(ui, /archived\.map\(renderSettlementCard\)/)
  assert.match(ui, /<details className=/)
  assert.match(ui, /Archives · Arrhes déjà réglées/)
  assert.match(ui, /Aucune arrhe en attente de décision/)
  assert.match(ui, /onChanged=\{changed\}/)
  assert.match(ui, /item\.allowed\.reconcile/)
  assert.match(backend, /case 'deposit-settlements'|settlement_status/)
  assert.doesNotMatch(ui, /\.delete\(|DELETE FROM|automatic.refund/i)
})
