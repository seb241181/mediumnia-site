import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const prebuild = "node scripts/apply-rdv-next-availability.mjs && node scripts/apply-rdv-calendar-view-fix.mjs && node scripts/apply-rdv-balance-system.mjs && node scripts/apply-rdv-accounting-dashboard.mjs && node scripts/apply-rdv-manual-payments.mjs && node scripts/apply-rdv-manual-payment-context-fix.mjs && node scripts/apply-rdv-manual-payment-ui.mjs && node scripts/apply-ecosystem-pathways.mjs && node scripts/apply-astra-audit-sprint.mjs && node scripts/apply-mobile-seo-sprint.mjs && node scripts/apply-formation-proof-sprint.mjs && node scripts/apply-performance-measurement.mjs && node scripts/apply-pilotage-dashboard.mjs && node scripts/apply-funnel-measurement.mjs && node scripts/apply-conferences-foundation.mjs && node scripts/apply-conference-pass-current-main.mjs && node scripts/apply-conference-shortlist-retention.mjs && node scripts/apply-conference-selection-feedback.mjs && node scripts/apply-conference-rehearsal-ux.mjs && node scripts/apply-conference-copilot-preview-fallback.mjs && node scripts/apply-reseau-profile-pages.mjs && node scripts/apply-route-seo-cro.mjs && node scripts/apply-oracle-email-sequence-v2.mjs && node scripts/apply-oracle-email-sequence-hardening.mjs && node scripts/apply-oracle-email-sequence-pilotage.mjs && node scripts/apply-oracle-multi-spreads.mjs && node scripts/apply-formation-email-lead.mjs && node scripts/apply-audit2-polish.mjs && node scripts/apply-clara-profile-update.mjs && node scripts/apply-discovery-offer.mjs && node --test tests/*.test.js"
const build = "vite build && node scripts/verify-chronosphere-v2-bundle.mjs && node scripts/prerender-route-meta.mjs"
const steps = [
  ...prebuild.split(' && ').map((command, i) => ({ phase: 'prebuild', i: i + 1, command })),
  ...build.split(' && ').map((command, i) => ({ phase: 'build', i: i + 1, command })),
]
const rows = []
let failure = null
for (const step of steps) {
  try {
    const output = execSync(step.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    rows.push({ ...step, ok: true, output })
  } catch (error) {
    failure = {
      ...step,
      ok: false,
      status: error.status,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
      message: String(error.message || ''),
    }
    rows.push(failure)
    break
  }
}
mkdirSync('dist', { recursive: true })
const esc = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const report = JSON.stringify({ failure, rows }, null, 2)
writeFileSync('dist/index.html', `<!doctype html><meta charset="utf-8"><title>Formation build diagnostic</title><pre style="white-space:pre-wrap;font:13px/1.45 monospace;padding:24px">${esc(report)}</pre>`)
writeFileSync('dist/build-debug.json', report)
console.log(failure ? 'Diagnostic captured failure' : 'Diagnostic completed without failure')
