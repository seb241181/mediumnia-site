/* global process, Buffer, fetch, AbortSignal */
const enabled = process.env.VERCEL_ENV === 'production' && process.env.PAYPAL_LIVE_READ_DIAGNOSTIC === 'run'
if (!enabled) process.exit(0)
const out = (payload) => console.info(`PAYPAL_LIVE_READ_DIAGNOSTIC ${JSON.stringify(payload)}`)
const env = (key) => String(process.env[key] || '').trim()
const supabaseUrl = env('SUPABASE_URL'); const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY')
const clientId = env('PAYPAL_CLIENT_ID'); const clientSecret = env('PAYPAL_CLIENT_SECRET')
if (!supabaseUrl || !serviceRole || !clientId || !clientSecret || env('PAYPAL_RDV_DEPOSIT_ENV') !== 'live') { out({ stage: 'configuration', category: 'diagnostic_not_configured' }); process.exit(0) }
let rows
try {
  const query = new URL('/rest/v1/rdv_paypal_payments', supabaseUrl)
  query.searchParams.set('select', 'paypal_order_id'); query.searchParams.set('paypal_env', 'eq.live'); query.searchParams.set('paypal_order_id', 'like.*7357'); query.searchParams.set('limit', '2')
  const r = await fetch(query, { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } })
  if (!r.ok) { out({ stage: 'lookup', httpStatus: r.status, category: 'order_lookup_unavailable' }); process.exit(0) }
  rows = await r.json()
} catch { out({ stage: 'lookup', category: 'order_lookup_network_error' }); process.exit(0) }
if (!Array.isArray(rows) || rows.length !== 1) { out({ stage: 'lookup', category: 'order_lookup_not_unique' }); process.exit(0) }
let token
try {
  const r = await fetch('https://api-m.paypal.com/v1/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20_000) })
  if (!r.ok) { out({ stage: 'oauth', httpStatus: r.status, category: r.status === 401 ? 'oauth_credentials_rejected' : 'oauth_http_error' }); process.exit(0) }
  token = (await r.json().catch(() => ({}))).access_token
  if (!token) { out({ stage: 'oauth', httpStatus: r.status, category: 'oauth_invalid_response' }); process.exit(0) }
} catch (error) { out({ stage: 'oauth', category: error?.name === 'TimeoutError' ? 'oauth_timeout' : 'oauth_network_error' }); process.exit(0) }
try {
  const r = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(rows[0].paypal_order_id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  const data = await r.json().catch(() => null)
  if (!r.ok) { out({ stage: 'order', httpStatus: r.status, category: 'order_http_error' }); process.exit(0) }
  if (!data?.status) { out({ stage: 'order', httpStatus: r.status, category: 'order_invalid_response' }); process.exit(0) }
  const unit = data.purchase_units?.[0] || {}; const captures = unit.payments?.captures || []
  out({ stage: 'order', httpStatus: r.status, category: 'order_read_ok', orderStatus: data.status, amount: unit.amount?.value || null, currency: unit.amount?.currency_code || null, captures: captures.map(c => ({ status: c.status || null, amount: c.amount?.value || null, currency: c.amount?.currency_code || null, createdAt: c.create_time || null })) })
} catch (error) { out({ stage: 'order', category: error?.name === 'TimeoutError' ? 'order_timeout' : 'order_network_error' }) }
