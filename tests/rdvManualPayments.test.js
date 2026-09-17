import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serverPatch = fs.readFileSync('scripts/apply-rdv-manual-payments.mjs', 'utf8')
const contextPatch = fs.readFileSync('scripts/apply-rdv-manual-payment-context-fix.mjs', 'utf8')
const uiPatch = fs.readFileSync('scripts/apply-rdv-manual-payment-ui.mjs', 'utf8')
const modal = fs.readFileSync('src/components/rdv/ManualPaymentModal.jsx', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

test('manual payment API stays owner-scoped and server-calculates VAT', () => {
  assert.match(serverPatch, /verifyOwner\(supabase, userId, practitionerId\)/)
  assert.match(serverPatch, /amountBreakdown\(grossCents, vatRateBps\)/)
  assert.match(serverPatch, /\.from\('booking_services'\)/)
  assert.match(serverPatch, /vat_rate_bps/)
  assert.match(serverPatch, /entry_kind: entryKind/)
  assert.match(serverPatch, /payment_method: paymentMethod/)
})

test('manual payment cannot exceed a MediumIA booking remaining balance', () => {
  assert.match(serverPatch, /remaining_cents <= 0/)
  assert.match(serverPatch, /grossCents > booking\.remaining_cents/)
  assert.match(serverPatch, /montant_superieur_au_solde/)
})

test('manual payment is retry-safe and Preview cannot write to production accounting', () => {
  assert.match(serverPatch, /externalPaymentRef = `manual:\$\{clientRequestId\}`/)
  assert.match(serverPatch, /already_recorded: true/)
  assert.match(serverPatch, /preview_manual_write_disabled/)
  assert.match(serverPatch, /wnbwhnqiulsdjcvkuwos/)
})

test('Reservio and other manual sources are explicit', () => {
  assert.match(serverPatch, /MANUAL_PAYMENT_SOURCES = new Set\(\['reservio', 'manual'\]\)/)
  assert.match(modal, /\['reservio', 'Reservio'\]/)
  assert.match(modal, /source: mode === 'reservio' \? 'reservio'/)
})

test('booking finance context works without month boundaries', () => {
  assert.match(contextPatch, /bookingContextId/)
  assert.match(contextPatch, /!bookingContextId && \(!fromRaw \|\| !toRaw\)/)
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
