import { useEffect, useState } from 'react'
import OfflinePaymentPanel from './OfflinePaymentPanel.jsx'
import { OFFLINE_METHODS, PAYMENT_STATE_LABELS, displayState, money, postOfflinePayment } from './offlinePayments.js'

// Agenda du tableau de bord : état de règlement de chaque rendez-vous et actions
// associées. Les lignes affichées ensemble sont chargées en une seule requête
// (action=booking-balances). Quatre états :
//   Solde à régler · Virement annoncé, en attente de vérification ·
//   Paiement reçu et confirmé · Paiement à vérifier (capture PayPal en cours).

export const FINANCE_SAVED_EVENT = 'mediumia:finance-saved'

const methodLabel = (value) => (OFFLINE_METHODS.find(([key]) => key === value)?.[1] || 'Règlement').toLowerCase()

let queue = new Map()
let timer = null

function flush(practitionerId, token) {
  const batch = queue
  queue = new Map()
  timer = null
  const ids = [...batch.keys()]
  const params = new URLSearchParams({ action: 'booking-balances', practitioner_id: practitionerId, ids: ids.join(',') })
  fetch(`/api/rdv-admin?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('balances_unavailable'))))
    .then(body => { for (const [id, resolvers] of batch) resolvers.forEach(fn => fn(body.balances?.[id] || null)) })
    .catch(() => { for (const resolvers of batch.values()) resolvers.forEach(fn => fn(null)) })
}

function loadBalance(bookingId, practitionerId, token) {
  return new Promise(resolve => {
    if (!queue.has(bookingId)) queue.set(bookingId, [])
    queue.get(bookingId).push(resolve)
    if (!timer) timer = setTimeout(() => flush(practitionerId, token), 0)
  })
}

const CHIP = {
  settled: 'bg-emerald-100 text-emerald-800',
  announced: 'bg-sky-100 text-sky-900',
  to_verify: 'bg-amber-100 text-amber-900',
  due: 'bg-gold/15 text-deep',
}

export default function BookingPaymentStatus({ booking, practitionerId, session }) {
  const [balance, setBalance] = useState(null)
  const [nonce, setNonce] = useState(0)
  const [panel, setPanel] = useState(null)
  const [withdrawStep, setWithdrawStep] = useState(false)
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    const refresh = () => setNonce(n => n + 1)
    window.addEventListener(FINANCE_SAVED_EVENT, refresh)
    return () => window.removeEventListener(FINANCE_SAVED_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (!session?.access_token || !practitionerId || !booking?.id) return
    let active = true
    loadBalance(booking.id, practitionerId, session.access_token).then(value => { if (active) setBalance(value) })
    return () => { active = false }
  }, [booking?.id, practitionerId, session?.access_token, nonce])

  const state = displayState(balance)
  const saved = () => {
    setPanel(null)
    setWithdrawStep(false)
    window.dispatchEvent(new CustomEvent(FINANCE_SAVED_EVENT))
  }

  async function withdraw() {
    setActionError(null)
    try {
      await postOfflinePayment(session, { op: 'withdraw', offline_payment_id: balance.announcement.id, reason: 'Retiré depuis l’agenda' })
      saved()
    } catch (err) {
      setActionError(err.message)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {state && (
        <span className={`rounded-full px-2.5 py-0.5 text-right font-georgia text-[11px] font-semibold ${CHIP[state]}`} data-payment-state={state}>
          {state === 'settled' && <>✓ {PAYMENT_STATE_LABELS.settled}</>}
          {state === 'due' && <>{PAYMENT_STATE_LABELS.due} : {money(balance.remaining_cents)}</>}
          {state === 'announced' && (
            <>{methodLabel(balance.announcement?.payment_method) === 'virement' ? 'Virement annoncé' : `Règlement annoncé (${methodLabel(balance.announcement?.payment_method)})`}
              {' '}{money(balance.announcement?.amount_cents)} · en attente de vérification</>
          )}
          {state === 'to_verify' && <>{PAYMENT_STATE_LABELS.to_verify} : paiement PayPal en cours</>}
          {balance?.online_cents > 0 && state !== 'settled' && <span className="font-normal text-mist"> · {money(balance.online_cents)} payé en ligne</span>}
        </span>
      )}

      {state === 'due' && !panel && (
        <div className="flex flex-wrap justify-end gap-1.5">
          <button type="button" onClick={() => setPanel('announce')} className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep hover:bg-gold/10">
            Virement annoncé…
          </button>
          <button type="button" onClick={() => setPanel('confirm')} className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep hover:bg-gold/10">
            Règlement reçu…
          </button>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('mediumia:manual-payment', { detail: { bookingId: booking.id } }))
              document.getElementById('mediumia-accounting')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep hover:bg-gold/10"
          >
            Encaisser sur place{balance?.remaining_cents > 0 ? ` (${money(balance.remaining_cents)})` : ''}
          </button>
        </div>
      )}

      {state === 'announced' && !panel && (
        <div className="flex flex-wrap justify-end gap-1.5">
          <button type="button" onClick={() => setPanel('confirm')} className="rounded-lg bg-deep px-3 py-1.5 font-georgia text-xs text-white">
            Confirmer la réception
          </button>
          {!withdrawStep
            ? <button type="button" onClick={() => setWithdrawStep(true)} className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep hover:bg-gold/10">Retirer l’annonce</button>
            : <button type="button" onClick={withdraw} className="rounded-lg border border-red-300 px-3 py-1.5 font-georgia text-xs text-red-800 hover:bg-red-50">Confirmer le retrait (règlement non reçu)</button>}
        </div>
      )}

      {state === 'to_verify' && (
        <p className="max-w-xs text-right font-georgia text-[11px] text-mist">Un paiement PayPal du solde est en cours de confirmation : aucun autre règlement ne peut être enregistré avant sa vérification.</p>
      )}

      {actionError && <p role="alert" className="max-w-xs text-right font-georgia text-[11px] text-red-800">{actionError}</p>}

      {panel && balance && (
        <OfflinePaymentPanel mode={panel} booking={booking} balance={balance} session={session} onDone={saved} onCancel={() => setPanel(null)} />
      )}
    </div>
  )
}
