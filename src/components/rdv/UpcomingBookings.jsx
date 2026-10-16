import { useEffect, useState } from 'react'
import { partitionBookings } from './rdvCoulissesHelpers.js'
import SettledBookings from './SettledBookings.jsx'
import OwnerCancellationPreview from './OwnerCancellationPreview.jsx'

const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export default function UpcomingBookings({ bookings, services, practitionerId, session, onResend, resendingBookingId, videoLabel }) {
  const [result, setResult] = useState(null)
  const [nonce, setNonce] = useState(0)
  const ids = bookings.map(booking => booking.id).join(',')
  const key = `${practitionerId}:${ids}`
  useEffect(() => {
    const refresh = () => setNonce(value => value + 1)
    window.addEventListener('mediumia:finance-saved', refresh)
    return () => window.removeEventListener('mediumia:finance-saved', refresh)
  }, [])
  useEffect(() => {
    if (!ids) return
    const controller = new AbortController()
    const query = new URLSearchParams({ action: 'booking-balances', practitioner_id: practitionerId, ids })
    fetch(`/api/rdv-admin?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error('balances_unavailable'); return body })
      .then(body => { if (!controller.signal.aborted) setResult({ key, balances: body.balances }) })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, error: true }) })
    return () => controller.abort()
  }, [ids, practitionerId, key, session.access_token, nonce])
  const current = result?.key === key ? result : null
  const groups = partitionBookings(bookings, current?.balances || {})
  const rows = list => (
    <ul className="space-y-3">
      {list.map(booking => {
        const service = services.find(item => item.id === booking.service_id)
        const balance = current?.balances?.[booking.id]
        const date = new Date(booking.starts_at)
        const visio = videoLabel?.(booking)
          || (service?.modality?.length > 0 && service.modality.every(modality => modality === 'video') ? 'Visio — canal à confirmer' : null)
        return (
          <li key={booking.id} className="rounded-lg border border-gold/20 p-4">
            <p className="font-georgia text-sm font-semibold text-deep">{booking.customer_first_name} {booking.customer_last_name}</p>
            <p className="mt-1 font-georgia text-xs text-mist">{service?.title || 'Prestation'} · {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} à {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}{visio ? ` · ${visio}` : ''}</p>
            <p className="mt-2 font-georgia text-xs text-deep">{balance
              ? balance.paid_cents > balance.total_cents ? 'Trop-perçu enregistré : à vérifier' : balance.remaining_cents > 0 ? `Reste ${money(balance.remaining_cents)}` : 'Réglé dans MediumIA'
              : 'Règlement à vérifier'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {balance?.remaining_cents > 0 && booking.status === 'confirmed' && (
                <button type="button" onClick={() => {
                  window.dispatchEvent(new CustomEvent('mediumia:manual-payment', { detail: { bookingId: booking.id } }))
                  document.getElementById('mediumia-accounting')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }} className="min-h-11 rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-deep">
                  Encaisser sur place
                </button>
              )}
              <button type="button" onClick={() => onResend(booking)} disabled={resendingBookingId === booking.id}
                className="min-h-11 rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-deep disabled:opacity-50">
                {resendingBookingId === booking.id ? 'Envoi…' : 'Renvoyer la confirmation'}
              </button>
              <OwnerCancellationPreview bookingId={booking.id} practitionerId={practitionerId} session={session} />
            </div>
          </li>
        )
      })}
    </ul>
  )
  return (
    <section className="border-t border-gold/25 pt-5">
      <h2 className="mb-4 font-georgia text-lg font-medium">Rendez-vous des prochains jours</h2>
      {current?.error && <p role="alert" className="mb-4 font-georgia text-sm text-amber-800">Soldes indisponibles : tous les rendez-vous restent visibles.</p>}
      {!bookings.length ? <p className="font-georgia text-sm text-mist">Aucun autre rendez-vous prévu après aujourd’hui.</p>
        : groups.main.length ? rows(groups.main) : <p className="font-georgia text-sm text-mist">Tous ces rendez-vous sont réglés.</p>}
      <SettledBookings key={practitionerId} count={groups.settled.length}>{rows(groups.settled)}</SettledBookings>
    </section>
  )
}
