// Découverte « éligible » : mêmes critères que le crédit 568 € (lib/paypalSandbox.js) :
// achat enregistré par le serveur, provisionné, du même compte, dans le même
// environnement PayPal (live en production, jamais un achat Sandbox), et confirmé
// par PayPal comme toujours payé : ni remboursé, ni partiellement remboursé.

export const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}

// Montant encaissé d'une Découverte : 29 € en live, 1 € de test en Sandbox.
export const DISCOVERY_AMOUNT_CENTS = { live: 2900, sandbox: 100 }

export function isEligibleDiscoveryPurchase(purchase, { userId, env }) {
  return Boolean(purchase)
    && purchase.product_code === 'discovery'
    && purchase.paypal_env === env
    && purchase.status === 'provisioned'
    && purchase.user_id === userId
    && purchase.amount_cents === DISCOVERY_AMOUNT_CENTS[env]
    && Boolean(purchase.paypal_capture_id)
}

// 'paid' | 'refunded' | 'unknown'. Throws when PayPal cannot answer: the caller
// then refuses to charge (never a price based on an unverified Découverte).
export async function discoveryCaptureStatus(env, accessToken, captureId) {
  const res = await fetch(`${PAYPAL_BASE[env]}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) return 'unknown'
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error('discovery_check_unavailable')
  if (data.status === 'REFUNDED' || data.status === 'PARTIALLY_REFUNDED') return 'refunded'
  const expected = (DISCOVERY_AMOUNT_CENTS[env] / 100).toFixed(2)
  if (data.status === 'COMPLETED' && data.amount?.currency_code === 'EUR' && data.amount?.value === expected) return 'paid'
  return 'unknown'
}
