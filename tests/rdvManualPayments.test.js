import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serverPatch = fs.readFileSync('scripts/apply-rdv-manual-payments.mjs', 'utf8')
const adminService = fs.readFileSync('lib/rdvManualPaymentsAdmin.js', 'utf8')
const contextPatch = fs.readFileSync('scripts/apply-rdv-manual-payment-context-fix.mjs', 'utf8')
const uiPatch = fs.readFileSync('scripts/apply-rdv-manual-payment-ui.mjs', 'utf8')
const modal = fs.readFileSync('src/components/rdv/ManualPaymentModal.jsx', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

test('manual payment API stays owner-scoped and server-calculates VAT', () => {
  assert.match(adminService, /verifyOwner\(supabase, userId, practitionerId\)/)
  assert.match(adminService, /amountBreakdown\(grossCents, vatRateBps\)/)
  assert.match(adminService, /\.from\('booking_services'\)/)
  assert.match(adminService, /vat_rate_bps/)
  assert.match(adminService, /entry_kind: entryKind/)
  assert.match(adminService, /payment_method: paymentMethod/)
  assert.match(serverPatch, /createManualPayment/)
})

test('manual payment cannot exceed a MediumIA booking remaining balance', () => {
  assert.match(adminService, /remaining_cents <= 0/)
  assert.match(adminService, /grossCents > booking\.remaining_cents/)
  assert.match(adminService, /montant_superieur_au_solde/)
})

test('manual payment is retry-safe and Preview cannot write to production accounting', () => {
  assert.match(adminService, /externalPaymentRef = 'manual:' \+ clientRequestId/)
  assert.match(adminService, /already_recorded: true/)
  assert.match(adminService, /preview_manual_write_disabled/)
  assert.match(adminService, /wnbwhnqiulsdjcvkuwos/)
})

test('manual payment replay is resolved before a fully-paid booking can reject it', () => {
  const replayIndex = adminService.indexOf('const earlyReplay = await findExistingManualPayment')
  const paidIndex = adminService.indexOf('booking.remaining_cents <= 0')
  assert.ok(replayIndex >= 0 && paidIndex >= 0 && replayIndex < paidIndex)
  assert.match(adminService, /insertError\?\.code === '23505'/)
})

test('Reservio and other manual sources are explicit', () => {
  assert.match(adminService, /EXTERNAL_SOURCES = new Set\(\['reservio', 'manual'\]\)/)
  assert.match(modal, /\['reservio', 'Reservio'\]/)
  assert.match(modal, /source: mode === 'reservio' \? 'reservio'/)
})

test('booking finance context works without month boundaries', () => {
  assert.match(contextPatch, /bookingContextId/)
  assert.match(contextPatch, /!bookingContextId && \(!fromRaw \|\| !toRaw\)/)
  assert.match(serverPatch, /getManualPaymentBookingContext/)
})

test('accounting UI exposes manual entry and on-site collection', () => {
  assert.match(uiPatch, /\+ Ajouter un encaissement/)
  assert.match(serverPatch, /Encaisser sur place/)
  assert.match(uiPatch, /mediumia:manual-payment/)
  assert.match(uiPatch, /sourceLabel\(entry\.source\)/)
})

test('manual payment patches run after accounting dashboard in every lifecycle', () => {
  for (const name of ['predev', 'pretest', 'prebuild']) {
    const script = pkg.scripts[name]
    const accounting = script.indexOf('apply-rdv-accounting-dashboard.mjs')
    const manual = script.indexOf('apply-rdv-manual-payments.mjs')
    const context = script.indexOf('apply-rdv-manual-payment-context-fix.mjs')
    const ui = script.indexOf('apply-rdv-manual-payment-ui.mjs')
    assert.ok(accounting >= 0 && manual > accounting && context > manual && ui > context)
  }
})
