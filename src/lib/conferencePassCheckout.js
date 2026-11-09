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

// Statuts PayPal qui prouvent qu'aucun encaissement n'a eu lieu sur cette commande.
const NOT_PAID_STATUSES = new Set(['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED', 'VOIDED', 'NOT_FOUND'])

export async function reconcileApprovedOrder(orderId, { capture, status }) {
  const confirmed = await capture(orderId).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, error }),
  )
  if (confirmed.ok) return { outcome: 'paid', result: confirmed.result }

  const known = await status(orderId).catch(() => null)

  // Nouveau paiement proposé seulement si PayPal confirme qu'il n'y a eu aucun
  // encaissement et que rien n'est enregistré chez nous. Tout autre cas (commande payée
  // ou approuvée, état inconnu, serveur injoignable) : vérification, jamais de bouton.
  const provablyUnpaid = known
    && !known.redeemed && !known.captured && !known.paymentRecorded
    && NOT_PAID_STATUSES.has(String(known.paypalStatus || ''))
  return { outcome: provablyUnpaid ? 'retry' : 'uncertain', error: confirmed.error }
}
