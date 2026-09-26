import { useEffect, useState } from 'react'

// Offre publique du parcours au mois (page Formation) : lue une seule fois par
// page auprès du serveur, qui répond 404 tant que le parcours est fermé.

export const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',').replace(',00', '')}\u00a0€`

// One request per page for both the offer block and the FAQ answer.
let offerRequest = null
function loadOffer() {
  offerRequest ||= fetch('/api/rdv-config?formationPathAction=offer', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data?.enabled) return null
      const { capCents, discoveryCents, stepCents, regularCount, finalCents } = data
      // Shown only if the amounts add up to the Formation price, never more.
      if (discoveryCents + regularCount * stepCents + finalCents !== capCents) return null
      return { capCents, discoveryCents, stepCents, regularCount, finalCents }
    })
    .catch(() => null)
  return offerRequest
}

// The public offer when the parcours is open, otherwise null (closed: 404).
export function useParcoursOffer() {
  const [offer, setOffer] = useState(null)
  useEffect(() => {
    let cancelled = false
    loadOffer().then((value) => { if (!cancelled) setOffer(value) })
    return () => { cancelled = true }
  }, [])
  return offer
}

// FAQ « Puis-je payer en plusieurs fois ? » once the parcours is open.
export function parcoursFaqAnswer(offer) {
  return `Oui, de deux façons. Le parcours progressif : ${money(offer.discoveryCents)} pour commencer avec la Découverte, puis ${money(offer.stepCents)} par mois (deux nouveaux modules à chaque fois), dernière mensualité ${money(offer.finalCents)}, soit ${money(offer.capCents)} TTC au total au maximum, le même prix que la Formation complète. Vous pouvez arrêter à tout moment (les modules ouverts restent à vous), reprendre plus tard, ou tout débloquer en ne payant que le reste. Votre coach MediumIA reste ouvert 12 mois après votre dernier paiement. Pour la Formation complète en une fois (${money(offer.capCents)} TTC), PayPal peut aussi proposer un paiement fractionné selon votre éligibilité.`
}

