import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const events = [
  'rdv_funnel_service',
  'rdv_funnel_slot',
  'rdv_funnel_contact',
  'rdv_funnel_paypal_buttons',
  'rdv_funnel_arrhes_order',
  'rdv_funnel_full_order',
  'rdv_funnel_paypal_cancel',
  'rdv_funnel_paypal_error',
  'rdv_funnel_confirmed',
]

test('only anonymous stage names are accepted by existing restricted metrics API', async () => {
  const analytics = await read('../lib/mediumiaAnalytics.js')
  for (const event of events) assert.ok(analytics.includes(`'${event}'`))
  assert.match(analytics, /RDV_SOURCE_RE\.test\(source\)/)
  assert.match(analytics, /process\.env\.VERCEL_ENV !== 'production'/)
  const client = await read('../src/lib/mediumiaMetrics.js')
  assert.match(client, /body: JSON\.stringify\(\{ event, source \}\)/)
  assert.doesNotMatch(client, /customer_email|firstName|lastName|customer_phone|checkoutId|orderId/)
})

test('paid booking tracks stages without registering failed form submissions', async () => {
  const page = await read('../src/components/rdv/RdvPublic.jsx')
  assert.match(page, /const funnelSent = useRef\(new Set\(\)\)/)
  assert.match(page, /trackFunnel\('rdv_funnel_service'\)/)
  assert.match(page, /trackFunnel\('rdv_funnel_slot'\)/)
  const formStart = page.indexOf('async function handleConfirm(contactForm)')
  const confirm = page.slice(formStart, formStart + 900)
  assert.match(confirm, /if \(requiresDeposit\)/)
  assert.match(confirm, /trackFunnel\('rdv_funnel_contact'\)/)
  assert.match(page, /onMetric=\{trackFunnel\}/)
  assert.match(page, /trackFunnel\('rdv_funnel_confirmed'\)/)
})

test('PayPal telemetry is read-only and separates deposit and full order creation', async () => {
  const checkout = await read('../src/components/rdv/RdvDepositCheckout.jsx')
  assert.match(checkout, /await buttons\.render\(container\)/)
  assert.match(checkout, /emitOnce\('rdv_funnel_paypal_buttons'\)/)
  assert.match(checkout, /result\.id\) emitOnce\(paymentChoice === 'full_payment'/)
  assert.match(checkout, /'rdv_funnel_full_order' : 'rdv_funnel_arrhes_order'/)
  assert.match(checkout, /emitOnce\('rdv_funnel_paypal_cancel'\)/)
  assert.match(checkout, /emitOnce\('rdv_funnel_paypal_error'\)/)
  assert.match(checkout, /const checkoutFunnelSent = useRef\(new Set\(\)\)/)
  assert.match(checkout, /rdvDepositAction=capture/)
})

test('private dashboard has explicit new-funnel coverage and caveats', async () => {
  const pilot = await read('../src/components/rdv/PilotageDashboard.jsx')
  assert.match(pilot, /data-rdv-funnel="paid-booking-v1"/)
  assert.match(pilot, /Les réservations antérieures ne sont pas reconstituées/)
  assert.match(pilot, /Commandes PayPal pour les arrhes/)
  assert.match(pilot, /Une commande PayPal créée n’est pas un encaissement/)
  assert.match(pilot, /hasDetailedRdvFunnel/)
})
