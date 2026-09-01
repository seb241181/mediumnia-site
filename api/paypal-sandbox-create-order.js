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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ error: 'not_found' })
  }

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
            amount: {
              currency_code: 'EUR',
              value: '1.00',
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              return_url: 'https://mediumia.fr',
              cancel_url: 'https://mediumia.fr',
            },
          },
        },
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok || !data.id) {
      return res.status(502).json({ error: 'paypal_create_order_failed' })
    }

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
