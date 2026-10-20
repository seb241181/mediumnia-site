import {
  resolveTeamDemoConfiguration,
  createTeamDemoProvider,
  runTeamLiveDemo,
} from './mediumiaTeamLiveDemo.js'

/**
 * Existing /api/rdv-admin?action=mediumia-team-demo
 * External callers never receive any business data. Server runtime only;
 * absent from Production unless the exact Preview branch is opted in.
 */
export async function handleMediumiaTeamDemo(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  const conf = resolveTeamDemoConfiguration()
  if (req.method === 'GET') return res.status(200).json({
    available: conf.available, mode: 'synthetic_only', models: conf.available ? 2 : 0,
  })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!conf.available) return res.status(503).json({ error: 'ai_not_connected' })
  const host = String(req.headers.host || '').toLowerCase()
  const origin = String(req.headers.origin || '')
  // Only from the Vercel-SSO protected branch Preview of this team.
  if (!host.endsWith('-seguins-projects-a1d4673f.vercel.app') ||
      origin !== 'https://' + host) return res.status(403).json({ error: 'preview_only' })
  if (!req.headers['content-type']?.startsWith('application/json'))
    return res.status(415).json({ error: 'json_required' })
  const workflowId = req.body?.workflowId
  if (typeof workflowId !== 'string' ||
      !req.body || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1)
    return res.status(400).json({ error: 'unknown_workflow' })

  try {
    const result = await runTeamLiveDemo({ workflowId, callModel: createTeamDemoProvider() })
    return res.status(result.ok ? 200 : 400).json(result)
  } catch {
    return res.status(502).json({ error: 'provider_unavailable' })
  }
}
