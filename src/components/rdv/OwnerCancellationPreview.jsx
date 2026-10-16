import { useEffect, useRef, useState } from 'react'

const money = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value / 100)
const BLOCKERS = {
  booking_not_confirmed: 'Ce rendez-vous n’est plus confirmé.',
  external_booking_requires_review: 'Réservation externe : intervention manuelle à examiner.',
  payment_state_uncertain: 'Un paiement n’est pas stabilisé : vérification prestataire nécessaire.',
  refund_in_progress: 'Un remboursement est en cours de traitement.',
  refund_requires_manual_review: 'Historique de remboursement : vérification manuelle nécessaire.',
  gift_card_requires_manual_review: 'Carte cadeau utilisée : vérification manuelle nécessaire.',
  transfer_requires_review: 'Un transfert doit être vérifié.',
}

export default function OwnerCancellationPreview({ bookingId, practitionerId, session }) {
  const dialog = useRef(null)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const element = dialog.current
    element?.showModal()
    const query = new URLSearchParams({ action: 'booking-cancel-preview', booking_id: bookingId, practitioner_id: practitionerId })
    fetch(`/api/rdv-admin?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error('Contrôle indisponible : aucune annulation possible.')
        return body
      })
      .then(body => { if (!controller.signal.aborted) setData(body) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => { controller.abort(); element?.close() }
  }, [open, bookingId, practitionerId, session.access_token])
  function close() { dialog.current?.close(); setOpen(false) }
  function start() {
    setData(null)
    setError(null)
    setConfirmed(false)
    setAcknowledged(false)
    setOpen(true)
  }
  return (
    <>
      <button type="button" onClick={start} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 font-georgia text-xs text-red-800">
        Examiner l’annulation
      </button>
      {open && (
        <dialog ref={dialog} onCancel={close} aria-labelledby={`cancel-title-${bookingId}`}
          className="w-[calc(100%-2rem)] max-w-lg max-h-[85dvh] overflow-y-auto rounded-lg border border-gold/30 bg-white p-5 text-deep backdrop:bg-black/40">
          <div className="flex items-start justify-between gap-3">
            <h3 id={`cancel-title-${bookingId}`} className="font-georgia text-lg font-semibold">Préparer l’annulation</h3>
            <button type="button" onClick={close} aria-label="Fermer" className="h-11 w-11 shrink-0 rounded-lg text-xl">×</button>
          </div>
          <p role="status" className="mt-3 font-georgia text-sm text-amber-800">Préparation uniquement. Aucune annulation ni notification client.</p>
          {!data && !error && <p className="mt-4 font-georgia text-sm">Contrôle des paiements…</p>}
          {error && <p role="alert" className="mt-4 font-georgia text-sm text-red-800">{error}</p>}
          {data && (
            <div className="mt-4 space-y-4 font-georgia text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <dt>Net enregistré MediumIA</dt><dd className="text-right">{money(data.finance.net_recorded_cents)}</dd>
                <dt>Écritures conservées</dt><dd className="text-right">{data.finance.entries}</dd>
                <dt>Cartes cadeaux utilisées</dt><dd className="text-right">{data.finance.gift_card_redemptions}</dd>
                <dt>Vérification prestataire</dt><dd className="text-right">Non effectuée</dd>
                <dt>Google Agenda</dt><dd className="text-right">{data.google.required ? 'Synchronisation à prévoir' : 'Aucun événement lié'}</dd>
              </dl>
              <p>Aucun remboursement automatique. La réservation et son historique financier seront conservés.</p>
              {data.requires_financial_review && <p className="text-amber-800">Historique de paiement présent : décision financière séparée obligatoire.</p>}
              {data.blockers.length > 0 && <ul className="list-disc space-y-2 pl-5 text-red-800">{data.blockers.map(code => <li key={code}>{BLOCKERS[code] || 'Vérification manuelle nécessaire.'}</li>)}</ul>}
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setAcknowledged(false) }} className="mt-1 h-5 w-5 shrink-0" />
                Je confirme avoir examiné le rendez-vous et ses paiements. Cette validation ne l’annule pas.
              </label>
              <button type="button" disabled={!confirmed || data.blockers.length > 0} onClick={() => setAcknowledged(true)}
                className="min-h-11 rounded-lg bg-deep px-4 py-2 text-white disabled:opacity-40">Valider le contrôle</button>
              {acknowledged && <p role="status" className="text-emerald-800">Contrôle validé localement. Annulation non activée ; réservation inchangée.</p>}
            </div>
          )}
        </dialog>
      )}
    </>
  )
}
