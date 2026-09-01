import { randomUUID } from 'node:crypto'

const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com'

async function getAccessToken() {
  const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').trim()

  if (!clientId || !clientSecret) {
    throw new Error('paypal_not_configured')
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    throw new Error('paypal_auth_failed')
  }

  const data = await response.json()
  return data.access_token
}

export async function handlePayPalSandbox(req, res, action) {
  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ error: 'not_found' })
  }

  if (action === 'config') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const clientId = (process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()
    if (!clientId) return res.status(500).json({ error: 'paypal_not_configured' })
    return res.status(200).json({ clientId })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': randomUUID(),
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: 'MEDIUMIA_SANDBOX_TEST',
              description: 'MediumIA — test Sandbox',
              amount: { currency_code: 'EUR', value: '1.00' },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
              },
            },
          },
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) return res.status(502).json({ error: 'paypal_create_order_failed' })
      return res.status(201).json({ id: data.id })
    } catch (error) {
      const code = error?.message === 'paypal_not_configured'
        ? 'paypal_not_configured'
        : error?.message === 'paypal_auth_failed'
          ? 'paypal_auth_failed'
          : 'paypal_create_order_failed'
      return res.status(code === 'paypal_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'capture') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) {
      return res.status(400).json({ error: 'invalid_order_id' })
    }

    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.status !== 'COMPLETED') {
        return res.status(502).json({ error: 'paypal_capture_failed', status: data.status || null })
      }

      const capture = data.purchase_units?.[0]?.payments?.captures?.[0]
      return res.status(200).json({
        status: data.status,
        orderId: data.id,
        captureId: capture?.id || null,
        amount: capture?.amount || null,
      })
    } catch (error) {
      const code = error?.message === 'paypal_not_configured'
        ? 'paypal_not_configured'
        : error?.message === 'paypal_auth_failed'
          ? 'paypal_auth_failed'
          : 'paypal_capture_failed'
      return res.status(code === 'paypal_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  return res.status(400).json({ error: 'invalid_paypal_action' })
}
