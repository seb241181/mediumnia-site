import fs from 'node:fs'

const apiPath = 'api/rdv-config.js'
let source = fs.readFileSync(apiPath, 'utf8')
let changed = false

if (!source.includes("from '../lib/conferencePassPayPal.js'")) {
  const marker = "import { handleRdvFullPaymentApi } from '../lib/rdvFullPaymentApiHandler.js'\n"
  if (!source.includes(marker)) throw new Error('conference_pass_api_import_marker_missing')
  source = source.replace(marker, marker + "import { handleConferencePassPayPal } from '../lib/conferencePassPayPal.js'\n")
  changed = true
}

if (!source.includes('if (req.query.conferencePassAction)')) {
  const marker = 'export default async function handler(req, res) {\n'
  if (!source.includes(marker)) throw new Error('conference_pass_api_handler_marker_missing')
  source = source.replace(marker, marker + '  if (req.query.conferencePassAction) return handleConferencePassPayPal(req, res)\n')
  changed = true
}

if (changed) fs.writeFileSync(apiPath, source)
console.log('MediumIA conferences: conference Pass API route applied safely on current main')
