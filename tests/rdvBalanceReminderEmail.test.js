import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildRdvBalanceReminder, balancePaymentUrl } from '../lib/rdvBalanceEmail.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const H = 3_600_000
const startsAt = new Date('2026-10-20T08:00:00Z')
const deadlineAt = new Date(startsAt.getTime() - 48 * H)
const paymentUrl = balancePaymentUrl('jeton-reel_ABC-123')
const base = { firstName: 'Claire', serviceTitle: 'Guidance visio', startsAt, balanceCents: 5000, deadlineAt, paymentUrl }

test('rappel de solde : le vrai lien personnel est conservé (bouton, lien de secours, texte brut)', () => {
  const { html, text, subject } = buildRdvBalanceReminder({ ...base, priceCents: 7000, paidCents: 2000 })
  assert.equal(subject, 'MediumIA — Règlement du solde de votre rendez-vous')
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(hrefs, [paymentUrl, paymentUrl], 'uniquement le lien réel, aucun lien fictif')
  assert.match(paymentUrl, /\/rdv\/solde#token=jeton-reel_ABC-123$/)
  assert.ok(text.includes(paymentUrl))
})

test('rappel de solde : identité ChronoSphère, sans dégradé ni feuille de style', () => {
  const { html } = buildRdvBalanceReminder({ ...base, priceCents: 7000, paidCents: 2000 })
  for (const color of ['#F3EFE6', '#1A1535', '#D4B469', '#FFFDF8']) assert.ok(html.includes(color), color)
  assert.match(html, />MEDIUMIA</)
  assert.match(html, /Régler mon solde — 50,00 €/)
  assert.match(html, /Date limite de paiement/)
  assert.match(html, /Sébastien Seguin<\/strong> <span[^>]*>·<\/span> MediumIA/)
  assert.doesNotMatch(html, /gradient|<style|display:\s*(flex|grid)/i)
  assert.match(html, /<!--\[if mso\]>/, 'largeur fixe pour Outlook')
  assert.match(html, /<td bgcolor="#D4B469"[^>]*>\s*<a href=/, 'bouton « bulletproof » (cellule colorée)')
})

test('rappel de solde : prix total, arrhes et solde affichés seulement s’ils concordent', () => {
  const full = buildRdvBalanceReminder({ ...base, priceCents: 7000, paidCents: 2000 })
  assert.match(full.html, /Prix total[\s\S]*70,00 €[\s\S]*Arrhes déjà réglées[\s\S]*− 20,00 €[\s\S]*Solde restant[\s\S]*50,00 €/)
  assert.match(full.text, /Prix total : 70,00 €\nArrhes déjà réglées : 20,00 €\nSolde restant : 50,00 €/)
  // Montants absents ou incohérents : le solde fourni par l'appelant reste la seule référence.
  for (const extra of [{}, { priceCents: 8000, paidCents: 2000 }, { priceCents: 7000, paidCents: 0 }]) {
    const msg = buildRdvBalanceReminder({ ...base, ...extra })
    assert.doesNotMatch(msg.html, /Prix total|Arrhes déjà réglées/)
    assert.match(msg.html, /Solde restant[\s\S]*50,00 €/)
  }
})

test('rappel de solde : contenu échappé, échéance et conditions d’annulation conservées', () => {
  const { html, text } = buildRdvBalanceReminder({ ...base, firstName: '<script>x</script>', serviceTitle: 'Séance "spéciale" & <b>' })
  assert.doesNotMatch(html, /<script>|<b>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Dimanche 18 octobre 2026 à 10:00/)
  assert.match(html, /rendez-vous sera automatiquement annulé et le créneau libéré/)
  assert.match(html, /conditions de réservation acceptées et aux droits légaux applicables/)
  assert.match(text, /Date limite de paiement : Dimanche 18 octobre 2026 à 10:00/)
  assert.match(text, /automatiquement annulé/)
  assert.match(buildRdvBalanceReminder({ ...base, firstName: '' }).text, /^MEDIUMIA\n\nBonjour,\n/)
})

test('rappel de solde : appels inchangés (solde calculé, lien, clé anti-doublon) — seul l’affichage reçoit le détail', () => {
  for (const file of ['lib/rdvBalanceCronHandler.js', 'lib/rdvBalanceApiHandler.js']) {
    const src = read(file)
    assert.match(src, /balanceCents: dueCents,\s+priceCents: Number\(booking\.booked_price_cents \|\| 0\),\s+paidCents: item\.paidCents,\s+deadlineAt,\s+paymentUrl: balancePaymentUrl\(token\),/)
    assert.match(src, /idempotencyKey: `rdv-balance-reminder\/\$\{booking\.id\}`/)
  }
})
