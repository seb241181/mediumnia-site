import fs from 'node:fs'

const dashboardPath = 'src/components/rdv/RdvDashboard.jsx'
const apiPath = 'api/rdv-admin.js'

function patchDashboard() {
  let source = fs.readFileSync(dashboardPath, 'utf8')
  let changed = false

  if (!source.includes("import AccountingSection from './AccountingSection.jsx'")) {
    const marker = "import { useAuth } from '../../lib/useAuth'\n"
    if (!source.includes(marker)) throw new Error('rdv_accounting_dashboard_import_marker_missing')
    source = source.replace(marker, `${marker}import AccountingSection from './AccountingSection.jsx'\n`)
    changed = true
  }

  if (!source.includes('<AccountingSection')) {
    const marker = '                  {/* Google Calendar */}'
    if (!source.includes(marker)) throw new Error('rdv_accounting_dashboard_section_marker_missing')
    source = source.replace(marker, `                  {/* Comptabilité */}\n                  <AccountingSection\n                    practitionerId={activePractitioner.id}\n                    session={session}\n                  />\n\n${marker}`)
    changed = true
  }

  if (changed) fs.writeFileSync(dashboardPath, source)
}

function patchApi() {
  let source = fs.readFileSync(apiPath, 'utf8')
  let changed = false

  if (!source.includes('async function handleFinance(')) {
    const marker = '// ── Router principal ──────────────────────────────────────────────────────────'
    if (!source.includes(marker)) throw new Error('rdv_accounting_api_router_marker_missing')

    const handler = String.raw`// ── action=finance ────────────────────────────────────────────────────────────

async function handleFinance(req, res, supabase, userId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const pid = req.query.practitioner_id
  const fromRaw = req.query.from
  const toRaw = req.query.to
  if (!pid || !fromRaw || !toRaw) {
    return res.status(400).json({ error: 'practitioner_id, from et to requis' })
  }
  if (!await verifyOwner(supabase, userId, pid)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const from = new Date(fromRaw)
  const to = new Date(toRaw)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return res.status(400).json({ error: 'periode_invalide' })
  }
  if (to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'periode_trop_longue' })
  }

  const { data: entries, error } = await supabase
    .from('rdv_financial_entries')
    .select('id, booking_id, service_id, source, entry_kind, direction, payment_method, occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency, service_price_cents, appointment_starts_at, customer_name, external_payment_ref, note')
    .eq('practitioner_id', pid)
    // Gift card uses are not revenue: the card was counted (with VAT) when sold.
    .neq('payment_method', 'gift_card')
    .gte('occurred_at', from.toISOString())
    .lt('occurred_at', to.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(5000)

  if (error) return res.status(500).json({ error: 'db_error', code: error.code })

  const fromDate = from.toISOString().slice(0, 10)
  const toDate = to.toISOString().slice(0, 10)
  const { data: kdpReports, error: kdpError } = await supabase
    .from('kdp_income_reports')
    .select('period_month, snapshot_date, title, paperback_units, ebook_units, hardcover_units, unclassified_units, free_ebook_units, paperback_royalty_cents, ebook_royalty_cents, hardcover_royalty_cents, royalty_cents, currency, payout_status, paid_at')
    .eq('practitioner_id', pid)
    .gte('period_month', fromDate)
    .lt('period_month', toDate)
    .order('period_month', { ascending: false })

  if (kdpError) return res.status(500).json({ error: 'kdp_lookup_error', code: kdpError.code })

  const kdp = (kdpReports || []).reduce((acc, report) => {
    acc.paperback_units += Number(report.paperback_units || 0)
    acc.ebook_units += Number(report.ebook_units || 0)
    acc.hardcover_units += Number(report.hardcover_units || 0)
    acc.unclassified_units += Number(report.unclassified_units || 0)
    acc.free_ebook_units += Number(report.free_ebook_units || 0)
    acc.royalty_cents += Number(report.royalty_cents || 0)
    acc.paid_royalty_cents += report.payout_status === 'paid' ? Number(report.royalty_cents || 0) : 0
    acc.pending_royalty_cents += report.payout_status === 'paid' ? 0 : Number(report.royalty_cents || 0)
    acc.reports.push(report)
    return acc
  }, {
    paperback_units: 0,
    ebook_units: 0,
    hardcover_units: 0,
    unclassified_units: 0,
    free_ebook_units: 0,
    royalty_cents: 0,
    paid_royalty_cents: 0,
    pending_royalty_cents: 0,
    reports: [],
  })
  kdp.total_units = kdp.paperback_units + kdp.ebook_units + kdp.hardcover_units + kdp.unclassified_units

  const serviceIds = [...new Set((entries || []).map(entry => entry.service_id).filter(Boolean))]
  let serviceMap = {}
  if (serviceIds.length) {
    const { data: services, error: serviceError } = await supabase
      .from('booking_services')
      .select('id, title')
      .in('id', serviceIds)
    if (serviceError) return res.status(500).json({ error: 'service_lookup_error', code: serviceError.code })
    serviceMap = Object.fromEntries((services || []).map(service => [service.id, service.title]))
  }

  const normalized = (entries || []).map(entry => ({
    ...entry,
    service_title: entry.service_id ? (serviceMap[entry.service_id] || null) : null,
  }))

  const totals = normalized.reduce((acc, entry) => {
    const sign = entry.direction === 'refund' ? -1 : 1
    acc.gross_cents += sign * Number(entry.gross_cents || 0)
    acc.net_cents += sign * Number(entry.net_cents || 0)
    acc.vat_cents += sign * Number(entry.vat_cents || 0)
    acc.entry_count += 1
    if (entry.direction === 'refund') acc.refund_count += 1
    else acc.income_count += 1
    return acc
  }, { gross_cents: 0, net_cents: 0, vat_cents: 0, entry_count: 0, income_count: 0, refund_count: 0 })

  return res.status(200).json({
    period: { from: from.toISOString(), to: to.toISOString() },
    totals,
    kdp,
    activity_generated_cents: Number(totals.gross_cents || 0) + Number(kdp.royalty_cents || 0),
    entries: normalized,
  })
}

`

    source = source.replace(marker, `${handler}${marker}`)
    changed = true
  }

  if (!source.includes("case 'finance':")) {
    const marker = "    case 'requests':     return handleRequests(req, res, supabase, userId)\n"
    if (!source.includes(marker)) throw new Error('rdv_accounting_api_switch_marker_missing')
    source = source.replace(marker, `${marker}    case 'finance':      return handleFinance(req, res, supabase, userId)\n`)
    changed = true
  }

  if (changed) fs.writeFileSync(apiPath, source)
}

patchDashboard()
patchApi()
