/* global process */
import { timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { bankSyncEnabled, runAllBankSyncs } from './enableBankingSync.js'

function authorizedCron(req) {
  const secret = String(process.env.CRON_SECRET || '')
  const bearer = String(req.headers?.authorization || '')
  if (!secret || !bearer.startsWith('Bearer ')) return false
  const received = Buffer.from(bearer.slice(7), 'utf8')
  const expected = Buffer.from(secret, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function handleEnableBankingCron(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorizedCron(req)) return res.status(401).json({ error: 'unauthorized' })
  if (!bankSyncEnabled()) return res.status(200).json({ status: 'disabled' })
  try {
    const result = await runAllBankSyncs(getSupabaseAdmin())
    return res.status(result.failed ? 503 : 200).json(result)
  } catch {
    return res.status(503).json({ error: 'bank_sync_unavailable' })
  }
}
