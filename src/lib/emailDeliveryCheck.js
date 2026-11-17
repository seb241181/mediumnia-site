import { useEffect } from 'react'

// Espace client (#219) : l'adresse est-elle en difficulté de livraison ?
// Réponses : 'ok' | 'blocked' | 'temporary' | 'unknown'. En cas de panne ou de
// limite atteinte : 'unknown', et l'envoi du code n'est jamais empêché.
export const EMAIL_CHECK_URL = '/api/rdv-config?accountAction=email-check'

export async function checkEmailDelivery(email, { fetchImpl = globalThis.fetch } = {}) {
  if (!email || typeof fetchImpl !== 'function') return 'unknown'
  try {
    const response = await fetchImpl(EMAIL_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) return 'unknown'
    const data = await response.json()
    return ['ok', 'blocked', 'temporary'].includes(data?.delivery) ? data.delivery : 'unknown'
  } catch {
    return 'unknown'
  }
}

// Après un envoi : le rejet arrive quelques secondes plus tard par le webhook
// Resend. On revérifie à ces intervalles (secondes) tant que l'écran est ouvert.
export const DELIVERY_RECHECK_DELAYS = [8, 25, 60]

// Revérifie la livraison après un envoi, sans jamais envoyer de code : un rejet
// signalé par le webhook Resend est remonté à l'écran (onIssue).
export function useDeliveryRecheck(active, email, onIssue, { check = checkEmailDelivery, delays = DELIVERY_RECHECK_DELAYS } = {}) {
  useEffect(() => {
    if (!active || !email) return undefined
    let cancelled = false
    const timers = delays.map((seconds) => setTimeout(async () => {
      const delivery = await check(email)
      if (!cancelled && (delivery === 'blocked' || delivery === 'temporary')) onIssue(delivery)
    }, seconds * 1000))
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [active, email, onIssue, check, delays])
}
