import { useEffect, useState } from 'react'

// Agenda du tableau de bord : état de règlement de chaque rendez-vous et bouton
// « Encaisser sur place » rapproché du reste à payer. Les lignes affichées
// ensemble sont chargées en une seule requête (action=booking-balances).

export const FINANCE_SAVED_EVENT = 'mediumia:finance-saved'

const money = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)

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

export default function BookingPaymentStatus({ booking, practitionerId, session }) {
  const [balance, setBalance] = useState(null)
  const [nonce, setNonce] = useState(0)

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

  const settled = balance && balance.total_cents > 0 && balance.remaining_cents === 0

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {balance && (settled
        ? <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-georgia text-[11px] font-semibold text-emerald-800">Réglé ✓</span>
        : (
          <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-right font-georgia text-[11px] font-semibold text-deep">
            Reste {money(balance.remaining_cents)}
            {balance.online_cents > 0 && <span className="font-normal text-mist"> · {money(balance.online_cents)} payé en ligne</span>}
          </span>
        ))}
      {!settled && (
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
      )}
    </div>
  )
}
