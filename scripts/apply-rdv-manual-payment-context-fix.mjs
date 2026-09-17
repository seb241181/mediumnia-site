import fs from 'node:fs'

const apiPath = 'api/rdv-admin.js'
let source = fs.readFileSync(apiPath, 'utf8')
let changed = false

const requiredMarker = `  const fromRaw = req.query.from\n  const toRaw = req.query.to\n  if (!pid || !fromRaw || !toRaw) {\n    return res.status(400).json({ error: 'practitioner_id, from et to requis' })\n  }`
if (source.includes(requiredMarker)) {
  source = source.replace(requiredMarker, `  const fromRaw = req.query.from\n  const toRaw = req.query.to\n  const bookingContextId = req.query.booking_id ? String(req.query.booking_id) : null\n  if (!pid || (!bookingContextId && (!fromRaw || !toRaw))) {\n    return res.status(400).json({ error: 'practitioner_id requis ; from/to requis hors contexte rendez-vous' })\n  }`)
  changed = true
}

if (source.includes('  if (req.query.booking_id) {\n    const context = await financeBookingContext(supabase, pid, String(req.query.booking_id))')) {
  source = source.replace(
    '  if (req.query.booking_id) {\n    const context = await financeBookingContext(supabase, pid, String(req.query.booking_id))',
    '  if (bookingContextId) {\n    const context = await financeBookingContext(supabase, pid, bookingContextId)'
  )
  changed = true
}

if (changed) fs.writeFileSync(apiPath, source)
console.log('MediumIA RDV: manual payment booking context route fixed')
