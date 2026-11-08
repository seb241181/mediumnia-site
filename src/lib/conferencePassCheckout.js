// Règles du paiement du Pass conférence côté navigateur, sans dépendance au DOM.
//
// 1. Les boutons PayPal sont rendus à nouveau dès que leur conteneur a été remonté
//    (retour à l'état « valid » après un échec), que le Pass change ou qu'un nouvel
//    essai est demandé après une erreur PayPal. Sans cela, le conteneur restait vide.
// 2. Après une approbation PayPal dont la confirmation a échoué, aucun bouton n'est
//    réaffiché avant réconciliation : la confirmation est redemandée au serveur (il relit
//    la commande chez PayPal : une commande déjà payée est rapprochée, jamais recapturée),
//    puis l'état connu du Pass est lu. Dans le doute, on bloque tout nouveau paiement.

export function needsButtonsRender(previous, next) {
  if (!next?.token || !next?.container) return false
  return !previous
    || previous.token !== next.token
    || previous.container !== next.container
    || previous.attempt !== next.attempt
}

export async function reconcileApprovedOrder(orderId, { capture, status }) {
  const confirmed = await capture(orderId).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, error }),
  )
  if (confirmed.ok) return { outcome: 'paid', result: confirmed.result }

  const known = await status(orderId).catch(() => null)

  // Serveur injoignable, ou paiement enregistré sans accès confirmé : pas de nouveau paiement.
  if (!known || known.captured || known.redeemed || known.passStatus === 'captured' || known.passStatus === 'redeemed') {
    return { outcome: 'uncertain', error: confirmed.error }
  }

  // Aucune capture connue : un nouvel essai est possible. Le serveur revérifie de toute
  // façon la commande chez PayPal avant de la réutiliser ou d'en créer une autre.
  return { outcome: 'retry', error: confirmed.error }
}
