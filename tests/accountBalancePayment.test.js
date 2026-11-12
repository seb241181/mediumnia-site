import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BALANCE_HANDOFF_KEY,
  balancePaymentPath,
  canPayBalanceFromAccount,
  openBalancePayment,
} from '../src/lib/accountView.js'

// Règlement du solde depuis l'espace client : le parcours sécurisé existant
// est réutilisé ; seule la preuve d'accès change (session au lieu du jeton).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const NOW = new Date('2026-11-12T10:00:00Z')
const booking = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'confirmed',
  mode: 'video',
  startsAt: '2026-12-01T10:00:00Z',
  amounts: { dueCents: 6000, paidCents: 3000 },
  ...over,
})

test('le bouton n’est proposé que pour un rendez-vous à distance confirmé, à venir, avec un reste dû', () => {
  assert.equal(canPayBalanceFromAccount(booking(), NOW), true)
  assert.equal(canPayBalanceFromAccount(booking({ mode: 'cabinet' }), NOW), false)
  assert.equal(canPayBalanceFromAccount(booking({ status: 'cancelled' }), NOW), false)
  assert.equal(canPayBalanceFromAccount(booking({ startsAt: '2026-11-01T10:00:00Z' }), NOW), false)
  assert.equal(canPayBalanceFromAccount(booking({ amounts: { dueCents: 0, paidCents: 9000 } }), NOW), false)
  assert.equal(canPayBalanceFromAccount(booking({ amounts: { dueCents: 9000, paidCents: 0 } }), NOW), false)
  assert.equal(canPayBalanceFromAccount(null, NOW), false)
})

test('la session passe par l’onglet, jamais par l’adresse', () => {
  const saved = {}
  const visited = []
  const ok = openBalancePayment(booking(), 'jeton-de-session', {
    storage: { setItem: (key, value) => { saved[key] = value } },
    navigate: (url) => visited.push(url),
  })
  assert.equal(ok, true)
  assert.deepEqual(JSON.parse(saved[BALANCE_HANDOFF_KEY]), { bookingId: booking().id, accessToken: 'jeton-de-session' })
  assert.deepEqual(visited, [`/rdv/solde#compte=${booking().id}`])
  assert.ok(!visited[0].includes('jeton-de-session'))
  assert.equal(balancePaymentPath('a b'), '/rdv/solde#compte=a%20b')
})

test('sans session ou sans stockage, rien ne s’ouvre', () => {
  const visited = []
  const navigate = (url) => visited.push(url)
  assert.equal(openBalancePayment(booking(), '', { storage: { setItem() {} }, navigate }), false)
  assert.equal(openBalancePayment(null, 'jeton', { storage: { setItem() {} }, navigate }), false)
  assert.equal(openBalancePayment(booking(), 'jeton', { storage: { setItem() { throw new Error('bloqué') } }, navigate }), false)
  assert.deepEqual(visited, [])
})

test('serveur : accès par compte vérifié et propriété contrôlée avant toute lecture', () => {
  const source = read('lib/rdvBalanceApiHandler.js')
  const access = source.slice(source.indexOf('async function accountBookingAccess'), source.indexOf('async function handleStatus'))
  assert.match(access, /requireVerifiedAccount\(req, supabase\)/)
  assert.match(access, /UUID_RE\.test\(bookingId\)/)
  assert.match(access, /rpc\('mediumia_account_owns_booking', \{ p_user_id: auth\.user\.id, p_booking_id: bookingId \}\)/)
  // Rendez-vous d'un autre compte : même réponse qu'un lien inconnu.
  assert.match(access, /owned !== true\) \{ publicError\(res, 'balance_token_not_found', 404\)/)
  assert.ok(access.indexOf('requireVerifiedAccount') < access.indexOf('mediumia_account_owns_booking'))
  assert.match(source, /action === 'accountStatus'\) return await handleStatus\(req, res, supabase, \{ account: true \}\)/)
  assert.match(source, /action === 'accountCreate'\) return await handleCreate\(req, res, supabase, \{ account: true \}\)/)
  assert.match(source, /rpc\('create_or_get_rdv_balance_payment_for_account'/)
  // La capture reste celle du parcours existant, sans variante « compte ».
  assert.doesNotMatch(source, /accountCapture/)
  assert.match(source, /account && context\.booking\.booking_source !== 'mediumia'/)
})

test('base : même paiement unique, mêmes contrôles, fonctions réservées au serveur', () => {
  const sql = read('supabase/migrations/20261112100000_rdv_balance_payment_for_account.sql')
  assert.match(sql, /function public\.mediumia_account_owns_booking\(p_user_id uuid, p_booking_id uuid\)/)
  assert.match(sql, /function public\.create_or_get_rdv_balance_payment_for_account\(/)
  for (const code of ['booking_not_found', 'booking_not_payable', 'balance_cancel_in_progress', 'balance_payment_expired', 'balance_video_only', 'balance_payment_intent_mismatch']) {
    assert.ok(sql.includes(code), code)
  }
  assert.match(sql, /rdv_booking_paid_cents/)
  assert.match(sql, /for update/i)
  assert.match(sql, /revoke all on function public\.create_or_get_rdv_balance_payment_for_account[^;]+from public/i)
  assert.match(sql, /grant execute on function public\.create_or_get_rdv_balance_payment_for_account[^;]+to service_role/i)
  // Les fonctions du parcours existant ne sont pas redéfinies.
  assert.doesNotMatch(sql, /function public\.(claim|finalize|release)_rdv_balance_capture/)
  assert.doesNotMatch(sql, /function public\.create_or_get_rdv_balance_payment\(/)
})

test('page de règlement : mode compte sans jeton dans l’adresse', () => {
  const page = read('public/rdv-solde.html')
  assert.ok(page.includes(`'${BALANCE_HANDOFF_KEY}'`))
  assert.match(page, /get\('compte'\)/)
  assert.match(page, /saved\.bookingId === accountBookingId && saved\.accessToken/)
  assert.match(page, /headers\.Authorization = `Bearer \$\{accessToken\}`/)
  assert.match(page, /api\('accountStatus', \{ bookingId: accountBookingId \}, accountAccess\.accessToken\)/)
  assert.match(page, /accountBookingId && !accountAccess\) \{ show\('accountState'\)/)
  assert.doesNotMatch(page, /localStorage/)
})

test('espace : bouton « Régler mon solde » sur la carte du rendez-vous', () => {
  const page = read('src/components/account/AccountPage.jsx')
  assert.match(page, /canPayBalanceFromAccount\(booking\)/)
  assert.match(page, /openBalancePayment\(booking, token\)/)
  assert.match(page, /Régler mon solde/)
})
