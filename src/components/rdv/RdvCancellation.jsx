import { useEffect, useState } from 'react'

function formatWhen(startsAt, timezone = 'Europe/Paris') {
  if (!startsAt) return { date: '', time: '' }
  const value = new Date(startsAt)
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
  }).format(value)
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(value)
  return { date: date.charAt(0).toUpperCase() + date.slice(1), time }
}

export default function RdvCancellation({ onBack }) {
  const [token] = useState(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const value = params.get('token') || ''
    window.history.replaceState({}, '', window.location.pathname)
    return value
  })
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(token))
  const [error, setError] = useState(() => token ? null : 'Ce lien d’annulation est incomplet ou invalide.')
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let active = true
    if (!token) return () => { active = false }

    fetch('/api/rdv-book?action=cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'inspect', token }),
    })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Impossible de vérifier ce lien.')
        if (active) setBooking(data)
      })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [token])

  async function cancelBooking() {
    setCancelling(true)
    setError(null)
    try {
      const response = await fetch('/api/rdv-book?action=cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'cancel', token }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Impossible d’annuler le rendez-vous.')
      setBooking(data)
      setConfirming(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setCancelling(false)
    }
  }

  const when = formatWhen(booking?.starts_at, booking?.timezone)
  const isCancelled = booking?.status === 'cancelled'

  return (
    <div className="min-h-screen bg-cream text-deep flex flex-col">
      <header className="border-b border-gold/20 bg-cream/95">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">✦ MEDIUMIA</button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep">← Retour</button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-14">
        <div className="max-w-lg w-full rounded-3xl border border-gold/25 bg-white/60 p-7 md:p-10 text-center shadow-sm">
          {loading ? (
            <>
              <div className="w-7 h-7 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-5" />
              <p className="font-georgia text-sm text-mist">Vérification du rendez-vous…</p>
            </>
          ) : error && !booking ? (
            <>
              <p className="text-gold text-4xl mb-5">◌</p>
              <h1 className="font-georgia text-2xl font-medium mb-3">Lien non disponible</h1>
              <p className="font-georgia text-sm text-mist leading-relaxed">{error}</p>
            </>
          ) : isCancelled ? (
            <>
              <p className="text-gold text-5xl mb-5">✓</p>
              <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-3">Annulation confirmée</p>
              <h1 className="font-georgia text-3xl font-medium mb-4">Votre rendez-vous est annulé.</h1>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Le créneau a été libéré.
                {booking?.email_status === 'sent' ? ' Un e-mail de confirmation vous a été envoyé.' : ''}
              </p>
            </>
          ) : (
            <>
              <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-3">Votre rendez-vous</p>
              <h1 className="font-georgia text-3xl font-medium mb-6">Annuler ce rendez-vous ?</h1>
              <div className="rounded-2xl bg-cream border border-gold/20 p-5 text-left mb-6 space-y-2">
                <p className="font-georgia text-sm"><span className="text-mist">Prestation :</span> <strong>{booking?.service}</strong></p>
                <p className="font-georgia text-sm"><span className="text-mist">Date :</span> <strong>{when.date}</strong></p>
                <p className="font-georgia text-sm"><span className="text-mist">Heure :</span> <strong>{when.time}</strong></p>
              </div>

              {!booking?.can_cancel ? (
                <div className="rounded-xl border border-gold/25 bg-gold/5 px-5 py-4">
                  <p className="font-georgia text-sm text-mist leading-relaxed">Le délai d’annulation automatique de 24 heures est dépassé. Contactez directement Sébastien.</p>
                </div>
              ) : confirming ? (
                <div>
                  <p className="font-georgia text-sm text-mist mb-5">Cette action supprimera aussi l’événement de Google Agenda et libérera immédiatement le créneau.</p>
                  {error && <p className="font-georgia text-sm text-red-600 mb-4">{error}</p>}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button onClick={() => { setConfirming(false); setError(null) }} disabled={cancelling} className="flex-1 font-georgia py-3 rounded-xl border border-gold/30 text-mist hover:text-deep disabled:opacity-50">Garder le rendez-vous</button>
                    <button onClick={cancelBooking} disabled={cancelling} className="flex-1 font-georgia py-3 rounded-xl bg-deep text-gold font-bold disabled:opacity-60">
                      {cancelling ? 'Annulation…' : 'Oui, annuler définitivement'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="w-full font-georgia py-4 rounded-xl bg-deep text-gold font-bold">Annuler mon rendez-vous</button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
