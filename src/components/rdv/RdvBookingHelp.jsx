// Aide en cas de difficulté au moment de payer : un contact direct plutôt qu'un
// abandon. Purement informatif, n'interfère jamais avec le paiement.
export default function RdvBookingHelp({ className = '' }) {
  return (
    <aside role="note" aria-label="Une difficulté pour réserver ?" className={`rounded-xl border border-gold/25 bg-cream/60 px-4 py-4 font-georgia text-deep ${className}`}>
      <p className="text-sm font-semibold leading-relaxed">Une difficulté pour réserver ?</p>
      <p className="mt-1.5 text-sm leading-relaxed text-mist">
        Si vous rencontrez un problème lors du paiement ou si vous ne parvenez pas à finaliser votre réservation, n’hésitez pas à me contacter directement par e-mail :
      </p>
      <p className="mt-2 text-sm">
        <a href="mailto:contact@mediumia.fr" className="inline-block break-all py-1 font-semibold text-deep underline decoration-gold/60 underline-offset-4 hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 rounded">contact@mediumia.fr</a>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-mist">Je vous aiderai à finaliser votre prise de rendez-vous.</p>
      <p className="mt-1 text-sm leading-relaxed text-mist">Merci de votre confiance et de votre compréhension.</p>
      <p className="mt-2 text-sm italic text-deep">Sébastien Seguin</p>
    </aside>
  )
}
