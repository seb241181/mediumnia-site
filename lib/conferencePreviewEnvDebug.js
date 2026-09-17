/* global process */

export async function handleConferencePreviewEnvDebug(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'not_found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const url = String(process.env.SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) {
    return res.status(200).json({
      ok: false,
      urlPresent: !!url,
      keyPresent: !!key,
    })
  }

  let host = 'invalid'
  try { host = new URL(url).hostname } catch {}
  const keyKind = key.startsWith('sb_secret_') ? 'sb_secret' : key.startsWith('eyJ') ? 'jwt' : 'other'

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/conference_events?select=id&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
    const payload = await response.json().catch(() => ({}))
    return res.status(200).json({
      ok: response.ok,
      host,
      keyKind,
      upstreamStatus: response.status,
      code: payload?.code || null,
      message: payload?.message || null,
    })
  } catch (error) {
    return res.status(200).json({
      ok: false,
      host,
      keyKind,
      upstreamStatus: null,
      code: 'network_error',
      message: String(error?.message || 'network_error').slice(0, 160),
    })
  }
}
