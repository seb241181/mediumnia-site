import fs from 'node:fs'

const apiPath = 'api/rdv-admin.js'
let source = fs.readFileSync(apiPath, 'utf8')
let changed = false

if (!source.includes("import { createManualPayment } from '../lib/rdvManualPaymentsAdmin.js'")) {
  const marker = "import { requireAuth, getSupabaseAdmin } from '../lib/supabaseAdmin.js'\n"
  if (!source.includes(marker)) throw new Error('manual_payment_e2e_import_marker_missing')
  source = source.replace(marker, marker + "import { createManualPayment } from '../lib/rdvManualPaymentsAdmin.js'\n")
  changed = true
}

if (!source.includes('async function handleManualPaymentE2ETest(')) {
  const marker = '// ── Router principal ──────────────────────────────────────────────────────────'
  if (!source.includes(marker)) throw new Error('manual_payment_e2e_router_marker_missing')

  const helper = String.raw`async function handleManualPaymentE2ETest(req, res) {
  const TEST_PROJECT = 'wnbwhnqiulsdjcvkuwos'
  const TEST_OWNER_ID = '2b6cdd7b-a552-49c6-b9b1-76be26b9c745'
  const TEST_PRACTITIONER_ID = '7dcf2820-edb2-412b-b418-2a67fbf824ea'
  const TEST_SERVICE_ID = '682fdcf1-7f8e-4fb6-9ba3-7022764c870e'
  const TEST_BOOKING_ID = 'dfe3a276-ad9f-4b66-9466-a1ef018a31d8'

  if (process.env.VERCEL_ENV === 'production') return res.status(404).json({ error: 'not_found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(process.env.SUPABASE_URL || '').includes(TEST_PROJECT)) {
    return res.status(403).json({ error: 'test_database_required' })
  }

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()
  const bookingPayload = {
    practitioner_id: TEST_PRACTITIONER_ID,
    booking_id: TEST_BOOKING_ID,
    gross_cents: 5000,
    payment_method: 'cash',
    occurred_at: now,
    note: 'TEST E2E solde sur place en espèces',
    client_request_id: 'test-manual-cash-20260917-001',
  }
  const reservioPayload = {
    practitioner_id: TEST_PRACTITIONER_ID,
    source: 'reservio',
    service_id: TEST_SERVICE_ID,
    customer_name: 'TEST Reservio',
    customer_email: 'test-reservio@example.invalid',
    gross_cents: 7000,
    payment_method: 'check',
    occurred_at: now,
    appointment_starts_at: '2026-10-02T10:00:00.000Z',
    note: 'TEST E2E rendez-vous Reservio payé par chèque',
    client_request_id: 'test-reservio-check-20260917-001',
  }

  const bookingFirst = await createManualPayment({ supabase, userId: TEST_OWNER_ID, body: bookingPayload })
  const bookingReplay = await createManualPayment({ supabase, userId: TEST_OWNER_ID, body: bookingPayload })
  const reservioFirst = await createManualPayment({ supabase, userId: TEST_OWNER_ID, body: reservioPayload })
  const reservioReplay = await createManualPayment({ supabase, userId: TEST_OWNER_ID, body: reservioPayload })

  const refs = [
    'manual:test-manual-cash-20260917-001',
    'manual:test-reservio-check-20260917-001',
  ]
  const { data: entries, error } = await supabase
    .from('rdv_financial_entries')
    .select('booking_id, source, entry_kind, payment_method, gross_cents, net_cents, vat_cents, vat_rate_bps, customer_name, appointment_starts_at, external_payment_ref')
    .in('external_payment_ref', refs)
    .order('external_payment_ref')

  if (error) return res.status(500).json({ error: 'verification_failed', code: error.code })
  return res.status(200).json({
    ok: true,
    booking: {
      first_status: bookingFirst.status,
      replay_status: bookingReplay.status,
      replay_already_recorded: bookingReplay.body?.already_recorded === true,
    },
    reservio: {
      first_status: reservioFirst.status,
      replay_status: reservioReplay.status,
      replay_already_recorded: reservioReplay.body?.already_recorded === true,
    },
    entries,
  })
}

`
  source = source.replace(marker, helper + marker)
  changed = true
}

if (!source.includes("req.query.action === 'manual-payment-e2e-test'")) {
  const marker = "  const auth = await requireAuth(req)\n"
  if (!source.includes(marker)) throw new Error('manual_payment_e2e_auth_marker_missing')
  source = source.replace(marker, "  if (req.query.action === 'manual-payment-e2e-test') return handleManualPaymentE2ETest(req, res)\n\n" + marker)
  changed = true
}

if (changed) fs.writeFileSync(apiPath, source)
console.log('MediumIA RDV: temporary manual payment E2E harness applied')
