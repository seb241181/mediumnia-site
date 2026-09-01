export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ error: 'not_found' })
  }

  const clientId = (process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()

  if (!clientId) {
    return res.status(500).json({ error: 'paypal_not_configured' })
  }

  return res.status(200).json({ clientId })
}
