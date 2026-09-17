import fs from 'node:fs'

const apiPath = 'api/rdv-config.js'
let source = fs.readFileSync(apiPath, 'utf8')
let changed = false

if (!source.includes("from '../lib/conferencePassPayPal.js'")) {
  source = "import { handleConferencePassPayPal } from '../lib/conferencePassPayPal.js'\n" + source
  changed = true
}

if (!source.includes("from '../lib/conferencePayPalSmoke.js'")) {
  source = "import { handleConferencePayPalSmoke } from '../lib/conferencePayPalSmoke.js'\n" + source
  changed = true
}

const correctRoute = 'if (req.query.conferencePassAction) return handleConferencePassPayPal(req, res, req.query.conferencePassAction)'
const legacyRoute = 'if (req.query.conferencePassAction) return handleConferencePassPayPal(req, res)'
const smokeRoute = 'if (req.query.conferencePassSmokeAction) return handleConferencePayPalSmoke(req, res)'

if (source.includes(legacyRoute)) {
  source = source.replace(legacyRoute, correctRoute)
  changed = true
} else if (!source.includes(correctRoute)) {
  const marker = 'export default async function handler(req, res) {\n'
  if (!source.includes(marker)) throw new Error('conference_pass_api_handler_marker_missing')
  source = source.replace(marker, marker + `  ${correctRoute}\n`)
  changed = true
}

if (!source.includes(smokeRoute)) {
  const marker = 'export default async function handler(req, res) {\n'
  if (!source.includes(marker)) throw new Error('conference_pass_smoke_handler_marker_missing')
  source = source.replace(marker, marker + `  ${smokeRoute}\n`)
  changed = true
}

if (changed) fs.writeFileSync(apiPath, source)
console.log('MediumIA conferences: conference Pass API route applied safely on current main')
