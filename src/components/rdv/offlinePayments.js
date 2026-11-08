// Règlements hors PayPal (agenda propriétaire) : libellés, états et appels API
// partagés par BookingPaymentStatus et OfflinePaymentPanel.

export const OFFLINE_METHODS = [
  ['transfer', 'Virement'],
  ['check', 'Chèque'],
  ['cash', 'Espèces'],
  ['card', 'Carte (sur place)'],
  ['other', 'Autre'],
]

export const OFFLINE_ERRORS = {
  preview_manual_write_disabled: 'La Preview est en lecture seule pour ne pas écrire dans la vraie comptabilité.',
  migration_pending: 'La mise à jour de la base n’est pas encore appliquée.',
  nothing_due: 'Ce rendez-vous est déjà entièrement réglé.',
  amount_exceeds_due: 'Le montant dépasse le solde restant.',
  announcement_exists: 'Un règlement est déjà annoncé pour ce rendez-vous.',
  announcement_not_open: 'Cette annonce n’est plus ouverte (déjà confirmée ou retirée).',
  booking_not_confirmed: 'Ce rendez-vous n’est plus confirmé.',
  booking_not_found: 'Rendez-vous introuvable.',
  paypal_capture_in_progress: 'Un paiement PayPal du solde est en cours de confirmation : vérifiez-le avant d’enregistrer un autre règlement.',
  invalid_received_on: 'Date d’encaissement invalide (pas de date future).',
  invalid_amount: 'Montant invalide.',
  receipt_confirmation_required: 'Cochez la case pour attester la réception effective.',
}

export const money = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
export const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-req`)

export function centsFromInput(value) {
  const normalized = String(value || '').trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const cents = Math.round(Number(normalized) * 100)
  return cents > 0 ? cents : null
}

export async function postOfflinePayment(session, payload) {
  const response = await fetch('/api/rdv-admin?action=offline-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const suffix = body.due_cents != null ? ` (reste dû : ${money(body.due_cents)})` : ''
    throw new Error((OFFLINE_ERRORS[body.error] || 'Enregistrement impossible pour le moment.') + suffix)
  }
  return body
}

export const PAYMENT_STATE_LABELS = {
  due: 'Solde à régler',
  announced: 'Virement annoncé, en attente de vérification',
  settled: 'Paiement reçu et confirmé',
  to_verify: 'Paiement à vérifier',
}

// Compatibilité : une réponse sans payment_state (base sans migration) garde
// l'ancien affichage « Réglé » / « Reste ».
export function displayState(balance) {
  if (!balance) return null
  if (balance.payment_state) return balance.payment_state
  if (balance.total_cents > 0 && balance.remaining_cents === 0) return 'settled'
  return balance.remaining_cents > 0 ? 'due' : null
}
