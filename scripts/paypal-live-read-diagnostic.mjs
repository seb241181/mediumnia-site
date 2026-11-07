/* global process, Buffer, fetch */

// One-shot Vercel build diagnostic. It is inert unless explicitly enabled on
// Production; it never writes Supabase or calls a PayPal financial endpoint.
const enabled = process.env.VERCEL_ENV === 'production' && process.env.PAYPAL_LIVE_READ_DIAGNOSTIC === 'run'
if (!enabled) process.exit(0)

const out = (stage, httpStatus, category) => console.info(`PAYPAL_LIVE_READ_DIAGNOSTIC ${JSON.stringify({ stage, httpStatus, category })}`)
const env = (key) => String(process.env[key] || '').trim()
const supabaseUrl = env('SUPABASE_URL')
const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY')
const clientId = env('PAYPAL_CLIENT_ID')
const clientSecret = env('PAYPAL_CLIENT_SECRET')

if (!supabaseUrl || !serviceRole || !clientId || !clientSecret || env('PAYPAL_RDV_DEPOSIT_ENV') !== 'live') {
  out('configuration', null, 'diagnostic_not_configured')
  process.exit(0)
}

let rows
try {
  const query = new URL('/rest/v1/rdv_paypal_payments', supabaseUrl)
  query.searchParams.set('select', 'paypal_order_id,paypal_env')
  query.searchParams.set('paypal_env', 'eq.live')
  query.searchParams.set('paypal_order_id', 'like.*7357')
  query.searchParams.set('limit', '2')
  const response = await fetch(query, { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } })
  if (!response.ok) { out('lookup', response.status, 'order_lookup_unavailable'); process.exit(0) }
  rows = await response.json()
} catch { out('lookup', null, 'order_lookup_network_error'); process.exit(0) }
if (!Array.isArray(rows) || rows.length !== 1 || !/^[A-Za-z0-9_-]{5,80}$/.test(String(rows[0]?.paypal_order_id || ''))) {
  out('lookup', null, 'order_lookup_not_unique'); process.exit(0)
}

let token
try {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch('https://api-m.paypal.com/v1/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  if (!response.ok) { out('oauth', response.status, response.status === 401 ? 'oauth_credentials_rejected' : response.status >= 500 ? 'oauth_provider_unavailable' : 'oauth_http_error'); process.exit(0) }
  token = (await response.json().catch(() => ({}))).access_token
  if (!token) { out('oauth', response.status, 'oauth_invalid_response'); process.exit(0) }
} catch { out('oauth', null, 'oauth_network_error'); process.exit(0) }

try {
  const response = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(rows[0].paypal_order_id)}`, { headers: { Authorization: `Bearer ${token}` } })
  out('order', response.status, response.ok ? 'order_read_ok' : response.status === 404 ? 'order_not_found' : response.status === 403 ? 'order_forbidden' : response.status === 401 ? 'order_unauthorized' : response.status >= 500 ? 'order_provider_unavailable' : 'order_http_error')
} catch { out('order', null, 'order_network_error') }
