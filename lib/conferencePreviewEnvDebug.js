/* global Buffer, process */

export async function handleConferencePreviewEnvDebug(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'not_found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const url = String(process.env.SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const paypalClientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const paypalClientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()

  let host = 'invalid'
  try { host = new URL(url).hostname } catch {}
  const keyKind = key.startsWith('sb_secret_') ? 'sb_secret' : key.startsWith('eyJ') ? 'jwt' : 'other'

  let supabase = {
    ok: false,
    urlPresent: !!url,
    keyPresent: !!key,
    host,
    keyKind,
    upstreamStatus: null,
  }

  if (url && key) {
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/conference_events?select=id&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      })
      const payload = await response.json().catch(() => ({}))
      supabase = {
        ok: response.ok,
        urlPresent: true,
        keyPresent: true,
        host,
        keyKind,
        upstreamStatus: response.status,
        code: payload?.code || null,
        message: payload?.message || null,
      }
    } catch (error) {
      supabase = {
        ...supabase,
        code: 'network_error',
        message: String(error?.message || 'network_error').slice(0, 160),
      }
    }
  }

  let paypal = {
    ok: false,
    env: 'sandbox',
    clientIdPresent: !!paypalClientId,
    clientSecretPresent: !!paypalClientSecret,
    upstreamStatus: null,
  }

  if (paypalClientId && paypalClientSecret) {
    try {
      const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      const payload = await response.json().catch(() => ({}))
      paypal = {
        ok: response.ok && !!payload?.access_token,
        env: 'sandbox',
        clientIdPresent: true,
        clientSecretPresent: true,
        upstreamStatus: response.status,
        error: response.ok ? null : (payload?.error || 'paypal_auth_failed'),
      }
    } catch (error) {
      paypal = {
        ...paypal,
        error: 'network_error',
        message: String(error?.message || 'network_error').slice(0, 160),
      }
    }
  }

  return res.status(200).json({
    ok: supabase.ok && paypal.ok,
    supabase,
    paypal,
  })
}
