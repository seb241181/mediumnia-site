import { useState } from 'react'
import { OFFLINE_METHODS, OFFLINE_ERRORS as ERRORS, centsFromInput, newRequestId, parisToday, postOfflinePayment } from './offlinePayments.js'

// Agenda propriétaire : déclarer un règlement hors PayPal annoncé par le client
// (« Virement annoncé ») ou confirmer sa réception effective sur le compte.
// Seule la confirmation crée une écriture comptable ; la base vérifie le reste dû,
// refuse pendant une capture PayPal et rejoue sans doublon un double clic.

export default function OfflinePaymentPanel({ mode, booking, balance, session, onDone, onCancel }) {
  const announcement = balance?.announcement || null
  const defaultCents = mode === 'confirm' && announcement?.amount_cents ? announcement.amount_cents : balance?.remaining_cents
  const [requestId] = useState(newRequestId)
  const [amount, setAmount] = useState(defaultCents ? (defaultCents / 100).toFixed(2) : '')
  const [method, setMethod] = useState(announcement?.payment_method || 'transfer')
  const [receivedOn, setReceivedOn] = useState(parisToday)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isConfirm = mode === 'confirm'
  const idPrefix = `offline-${booking.id}-${mode}`

  async function submit(event) {
    event.preventDefault()
    const cents = centsFromInput(amount)
    if (!cents) { setError('Montant invalide.'); return }
    if (isConfirm && !verified) { setError(ERRORS.receipt_confirmation_required); return }
    setSaving(true)
    setError(null)
    try {
      const result = await postOfflinePayment(session, isConfirm
        ? {
          op: 'confirm', booking_id: booking.id, offline_payment_id: announcement?.id || null,
          payment_method: method, amount_cents: cents, received_on: receivedOn,
          reference, note, receipt_verified: true, request_id: requestId,
        }
        : { op: 'announce', booking_id: booking.id, payment_method: method, amount_cents: cents, note, request_id: requestId })
      onDone?.(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 w-full max-w-sm rounded-xl border border-gold/30 bg-white/90 p-3 text-left font-georgia text-xs text-deep shadow-sm">
      <p className="mb-2 font-semibold">
        {isConfirm ? 'Confirmer la réception du règlement' : 'Déclarer un règlement annoncé par le client'}
      </p>
      {!isConfirm && (
        <p className="mb-2 text-mist">Rien n’est encaissé : le solde reste dû jusqu’à votre confirmation. Les relances et l’annulation pour impayé sont suspendues, et le lien PayPal du solde est bloqué.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-amount`}>
          {isConfirm ? 'Montant reçu (€)' : 'Montant annoncé (€)'}
          <input id={`${idPrefix}-amount`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5" required />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-method`}>
          Moyen de paiement
          <select id={`${idPrefix}-method`} value={method} onChange={e => setMethod(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5">
            {OFFLINE_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {isConfirm && (
          <>
            <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-date`}>
              Date d’encaissement
              <input id={`${idPrefix}-date`} type="date" max={parisToday()} value={receivedOn} onChange={e => setReceivedOn(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5" required />
            </label>
            <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-ref`}>
              Référence (facultatif)
              <input id={`${idPrefix}-ref`} maxLength={120} value={reference} onChange={e => setReference(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5" placeholder="ex. libellé du virement" />
            </label>
          </>
        )}
      </div>
      <label className="mt-2 flex flex-col gap-1" htmlFor={`${idPrefix}-note`}>
        Note (facultatif)
        <input id={`${idPrefix}-note`} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5" />
      </label>
      {isConfirm && (
        <label className="mt-2 flex items-start gap-2" htmlFor={`${idPrefix}-verified`}>
          <input id={`${idPrefix}-verified`} type="checkbox" className="mt-0.5 h-4 w-4" checked={verified} onChange={e => setVerified(e.target.checked)} />
          <span>J’ai vérifié que ce montant est bien arrivé sur mon compte (ou que je l’ai reçu en main propre).</span>
        </label>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-800">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-mist hover:bg-gold/10">Fermer</button>
        <button type="submit" disabled={saving} className="rounded-lg bg-deep px-3 py-1.5 text-white disabled:opacity-60">
          {saving ? 'Enregistrement…' : (isConfirm ? 'Confirmer la réception' : 'Enregistrer l’annonce')}
        </button>
      </div>
    </form>
  )
}
