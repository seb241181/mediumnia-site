// TEST-only manual trigger. Intentionally refuses every Production deployment.
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (process.env.VERCEL_ENV === 'production' || process.env.MEDIUMIA_ENV !== 'test') return res.status(404).json({ error: 'test_only' })
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!process.env.AVAILABILITY_SYNC_TEST_SECRET || token !== process.env.AVAILABILITY_SYNC_TEST_SECRET) return res.status(401).json({ error: 'unauthorized' })
  const db = getSupabaseAdmin()
  const { data: configs, error } = await db.from('availability_calendar_sync_config').select('practitioner_id,target_calendar_id,source_calendar_id,enabled,environment').eq('enabled', true).eq('environment', 'test')
  if (error) return res.status(503).json({ error: 'sync_config_unavailable' })
  if ((configs || []).some(c => c.target_calendar_id === c.source_calendar_id)) return res.status(409).json({ error: 'unsafe_calendar_target' })
  // The worker is deliberately not enabled until its TEST Google credential is supplied.
  return res.status(202).json({ status: 'queued_test', configurations: (configs || []).length })
}
