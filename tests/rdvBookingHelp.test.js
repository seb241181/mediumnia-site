import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const text = (source) => source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('aide à la réservation : texte, contact cliquable et signature', () => {
  const help = read('src/components/rdv/RdvBookingHelp.jsx')
  const visible = text(help)
  for (const line of [
    'Une difficulté pour réserver ?',
    'Si vous rencontrez un problème lors du paiement ou si vous ne parvenez pas à finaliser votre réservation, n’hésitez pas à me contacter directement par e-mail :',
    'Je vous aiderai à finaliser votre prise de rendez-vous.',
    'Merci de votre confiance et de votre compréhension.',
    'Sébastien Seguin',
  ]) assert.ok(visible.includes(line), line)
  assert.match(help, /href="mailto:contact@mediumia\.fr"[^>]*>contact@mediumia\.fr<\/a>/)
  // Lisible sur iPhone : pas de texte plus petit que 14 px, adresse qui peut passer à la ligne.
  assert.doesNotMatch(help, /text-(xs|\[1[0-3]px\])/)
  assert.match(help, /break-all/)
  // Ne suggère pas que PayPal serait défaillant.
  assert.doesNotMatch(visible, /PayPal/)
})

test('aide à la réservation : juste au-dessus des boutons de paiement, sans toucher au paiement', () => {
  const checkout = read('src/components/rdv/RdvDepositCheckout.jsx')
  const help = checkout.indexOf('<RdvBookingHelp')
  const buttons = checkout.indexOf('<div ref={containerRef}>')
  const consents = checkout.indexOf('{!consentsReady ? (')
  assert.ok(help > 0 && help < consents && consents < buttons, 'encadré placé avant le paiement')
  assert.equal((checkout.match(/<RdvBookingHelp/g) || []).length, 1)
  assert.doesNotMatch(read('src/components/rdv/RdvBookingHelp.jsx'), /onClick|fetch\(|useEffect/)
})
