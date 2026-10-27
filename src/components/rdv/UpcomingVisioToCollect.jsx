import { useEffect, useMemo, useState } from 'react'
import { pendingVisioBookings } from '../../../lib/rdvUnpaidVisio.js'

const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)

export default function UpcomingVisioToCollect({ practitionerId, session, bookings = [], services = [], requests = [], resendingBookingId, onResend }) {
  const [balances, setBalances] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [nonce, setNonce] = useState(0)
  const videoBookings = useMemo(() => bookings.filter(b => b.modality === 'video' && b.status === 'confirmed'), [bookings])
  const ids = videoBookings.map(b => b.id).join(',')

  useEffect(() => {
    const refresh = () => setNonce(v => v + 1)
    window.addEventListener('mediumia:finance-saved', refresh)
    window.addEventListener('focus', refresh)
    const whenVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', whenVisible)
    return () => {
      window.removeEventListener('mediumia:finance-saved', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [])

  useEffect(() => {
    if (!ids || !practitionerId || !session?.access_token) {
      setBalances({})
      setLoadError(false)
      return
    }
    let active = true
    setBalances(null)
    setLoadError(false)
    const bookingIds = ids.split(',')
    Promise.all(Array.from({ length: Math.ceil(bookingIds.length / 100) }, (_, i) => {
      const params = new URLSearchParams({
        action: 'booking-balances', practitioner_id: practitionerId,
        ids: bookingIds.slice(i * 100, (i + 1) * 100).join(','),
      })
      return fetch(`/api/rdv-admin?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      }).then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'balances_unavailable')
        return body.balances || {}
      })
    })).then(groups => {
      if (!active) return
      const result = Object.assign({}, ...groups)
      // A missing balance is not proof of payment.
      if (bookingIds.some(id => !result[id] || result[id].total_cents <= 0)) throw new Error('balances_incomplete')
      setBalances(result)
    }).catch(() => {
      if (!active) return
      setLoadError(true)
      setBalances(null)
    })
    return () => { active = false }
  }, [ids, practitionerId, session?.access_token, nonce])

  const toCollect = balances ? pendingVisioBookings(videoBookings, balances) : []
  const serviceTitles = new Map(services.map(s => [s.id, s.title]))
  const channelLabels = { whatsapp: 'WhatsApp', facetime: 'FaceTime', a_preciser: 'canal à confirmer' }

  return (
    <section className="rounded-2xl border border-gold/25 bg-white/60 p-4 sm:p-6">
      <div className="mb-4">
        <p className="mb-1 font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Suivi des règlements</p>
        <h2 className="font-georgia text-lg font-medium text-deep">Visios des prochains jours à régler</h2>
        <p className="mt-1 font-georgia text-xs text-mist">Les visios entièrement réglées quittent cette liste, mais restent dans l’agenda.</p>
      </div>
      {loadError ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-georgia text-xs text-amber-900">
          Impossible de vérifier les soldes pour le moment. Réactualise la page : aucun rendez-vous n’a été modifié.
        </div>
      ) : balances === null ? (
        <p role="status" className="py-6 text-center font-georgia text-xs text-mist">Vérification des paiements…</p>
      ) : toCollect.length === 0 ? (
        <div className="rounded-xl border border-gold/15 bg-deep/3 px-4 py-8 text-center">
          <p className="font-georgia text-sm text-mist">Aucune visio des prochains jours avec un solde à régler.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {toCollect.map(booking => {
            const date = new Date(booking.starts_at)
            const request = requests.find(r => r.confirmed_booking_id === booking.id && r.requested_modality === 'video')
            const channel = request ? channelLabels[request.video_channel] || 'canal à confirmer' : 'canal à confirmer'
            const balance = balances[booking.id]
            return (
              <div key={booking.id} className="flex flex-col gap-3 rounded-xl border border-gold/15 bg-white/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-georgia text-sm font-semibold text-deep [overflow-wrap:anywhere]">{booking.customer_first_name} {booking.customer_last_name}</p>
                  <p className="font-georgia text-xs leading-relaxed text-mist">
                    {serviceTitles.get(booking.service_id) || 'Consultation'}
                    {' · '}{date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' })}
                    {' à '}{date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}
                    {' · Visio — '}{channel}
                  </p>
                  <p className="mt-1 font-georgia text-xs font-semibold text-amber-800">Reste à régler : {money(balance.remaining_cents)}</p>
                </div>
                <button type="button" onClick={() => onResend(booking)} disabled={resendingBookingId === booking.id}
                  className="min-h-10 shrink-0 rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-deep hover:bg-gold/10 disabled:opacity-50">
                  {resendingBookingId === booking.id ? 'Envoi…' : 'Renvoyer la confirmation'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
