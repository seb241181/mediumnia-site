import { resolveTeamDemoConfiguration, createTeamDemoProvider, runTeamLiveDemo } from '../lib/mediumiaTeamLiveDemo.js'

/**
 * Two model calls maximum, purely synthetic cases, no account or database access.
 *
 * The demo works ONLY on the dedicated preview branch of the TEST project,
 * with its own explicit server-side switch and AI provider key.
 * It is disabled by default even if deployed as part of the public site.
 */

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  const conf = resolveTeamDemoConfiguration()
  if (req.method === 'GET') return res.status(200).json({ available: conf.available, mode: 'synthetic_only', models: conf.available ? 2 : 0 })
  if (req.method !== 'POST') return res.status(405).json({error:'method_not_allowed'})
  if (!conf.available) return res.status(503).json({error:'ai_not_connected'})
  const host = String(req.headers.host || '').toLowerCase()
  const origin = String(req.headers.origin || '')
  // Browser UI only: prevent cross-origin dispatch. The Preview is SSO-protected.
  if (!host.endsWith('-seguins-projects-a1d4673f.vercel.app') ||
      origin !== 'https://' + host) return res.status(403).json({error:'preview_only'})
  if (!req.headers['content-type']?.startsWith('application/json'))
    return res.status(415).json({error:'json_required'})
  const workflowId = req.body?.workflowId
  if (typeof workflowId !== 'string' || Object.keys(req.body || {}).length !== 1)
    return res.status(400).json({error:'unknown_workflow'})
  try {
    const result = await runTeamLiveDemo({workflowId,callModel:createTeamDemoProvider()})
    return res.status(result.ok ? 200 : 400).json(result)
  } catch {
    return res.status(502).json({error:'provider_unavailable'})
  }
}
