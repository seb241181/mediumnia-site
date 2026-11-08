import { useEffect, useState } from 'react'
import PaymentIssueReport from './PaymentIssueReport.jsx'
import { journeyForPath, PAYMENT_ISSUE_OPEN_EVENT } from '../lib/paymentAttempt.js'

// Bouton global « Signaler un problème de paiement », affiché sur chaque page de
// paiement (ChronoSphère, réservations, formation, mensualités, guidances,
// cartes cadeaux, conférences, Oracle). Ouvrable aussi depuis n'importe quelle
// page par l'événement PAYMENT_ISSUE_OPEN_EVENT (lien près des boutons PayPal).

export default function PaymentIssueLauncher() {
  const [path, setPath] = useState(() => window.location.pathname)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    // La navigation interne ne déclenche pas d'événement : on relit l'adresse.
    const tick = () => setPath(window.location.pathname)
    const timer = window.setInterval(tick, 1000)
    window.addEventListener('popstate', tick)
    const onOpen = (event) => setOpen({ journey: event.detail?.journey || journeyForPath(window.location.pathname) })
    window.addEventListener(PAYMENT_ISSUE_OPEN_EVENT, onOpen)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('popstate', tick)
      window.removeEventListener(PAYMENT_ISSUE_OPEN_EVENT, onOpen)
    }
  }, [])

  const journey = journeyForPath(path)
  return (
    <>
      {journey && !open && (
        <button
          type="button"
          onClick={() => setOpen({ journey })}
          className="fixed z-[60] rounded-full border border-gold/40 bg-white/95 px-3 py-2 font-georgia text-xs text-deep shadow-md hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          style={{ left: 'calc(16px + env(safe-area-inset-left, 0px))', bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))' }}
        >
          Signaler un problème de paiement
        </button>
      )}
      {open && <PaymentIssueReport journey={open.journey} onClose={() => setOpen(null)} />}
    </>
  )
}
