import fs from 'node:fs'

const apiPath = 'api/rdv-config.js'
let source = fs.readFileSync(apiPath, 'utf8')
let changed = false

if (!source.includes("from '../lib/conferencePassPayPal.js'")) {
  source = "import { handleConferencePassPayPal } from '../lib/conferencePassPayPal.js'\n" + source
  changed = true
}

const correctRoute = 'if (req.query.conferencePassAction) return handleConferencePassPayPal(req, res, req.query.conferencePassAction)'
const legacyRoute = 'if (req.query.conferencePassAction) return handleConferencePassPayPal(req, res)'

if (source.includes(legacyRoute)) {
  source = source.replace(legacyRoute, correctRoute)
  changed = true
} else if (!source.includes(correctRoute)) {
  const marker = 'export default async function handler(req, res) {\n'
  if (!source.includes(marker)) throw new Error('conference_pass_api_handler_marker_missing')
  source = source.replace(marker, marker + `  ${correctRoute}\n`)
  changed = true
}

if (changed) fs.writeFileSync(apiPath, source)

// Temporary Preview diagnostic: log only non-secret Supabase error metadata so
// TEST environment wiring can be verified without ever exposing credentials.
const passPath = 'lib/conferencePassPayPal.js'
let passSource = fs.readFileSync(passPath, 'utf8')
const validateMarker = "  if (error) throw new Error('pass_validate_failed')"
const validateDiagnostic = "  if (error) {\n    console.error('[conference-pass-paypal] validate_supabase_error', { code: error.code, message: error.message, details: error.details, hint: error.hint })\n    throw new Error('pass_validate_failed')\n  }"
if (passSource.includes(validateMarker)) {
  passSource = passSource.replace(validateMarker, validateDiagnostic)
  fs.writeFileSync(passPath, passSource)
}

console.log('MediumIA conferences: conference Pass API route applied safely on current main')
