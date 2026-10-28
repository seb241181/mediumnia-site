// Information sur le paiement invité : PayPal décide de sa disponibilité
// pour chaque transaction. N'invente pas un second système d'encaissement CB.
export default function PayPalGuestNotice({ className = '' }) {
  return (
    <aside role="note" aria-label="Payer sans compte PayPal" className={`rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 font-georgia text-deep ${className}`}>
      <p className="text-sm font-semibold leading-relaxed">Pas de compte PayPal ? Ce n’est pas forcément nécessaire !</p>
      <p className="mt-1 text-xs leading-relaxed text-mist">
        Si PayPal affiche « Carte bancaire » ou « Carte de débit ou de crédit », choisissez cette option pour payer en une fois sans créer de compte PayPal. L’option dépend de PayPal et peut ne pas être proposée pour certains paiements.
      </p>
    </aside>
  )
}
