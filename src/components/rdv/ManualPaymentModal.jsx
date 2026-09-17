import { useEffect, useMemo, useState } from 'react'

function authHeader(session) {
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function localDateTimeValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function money(cents) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
}

const PAYMENT_METHODS = [
  ['cash', 'Espèces'],
  ['check', 'Chèque'],
  ['card', 'Carte'],
  ['transfer', 'Virement'],
  ['other', 'Autre'],
]

export default function ManualPaymentModal({ practitionerId, session, services = [], upcomingBookings = [], initialBookingId = null, onClose, onSaved }) {
  const initialMode = initialBookingId ? 'booking' : 'reservio'
  const [mode, setMode] = useState(initialMode)
  const [bookingId, setBookingId] = useState(initialBookingId || '')
  const [serviceId, setServiceId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue())
  const [appointmentAt, setAppointmentAt] = useState('')
  const [note, setNote] = useState('')
  const [context, setContext] = useState(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedService = useMemo(() => services.find(service => service.id === serviceId) || null, [services, serviceId])

  useEffect(() => {
    if (mode !== 'booking' || !bookingId || !practitionerId || !session) {
      setContext(null)
      return
    }
    let cancelled = false
    setLoadingContext(true)
    setError(null)
    const params = new URLSearchParams({ action: 'finance', practitioner_id: practitionerId, booking_id: bookingId })
    fetch(`/api/rdv-admin?${params.toString()}`, { headers: authHeader(session) })
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'booking_context_unavailable')
        return body
      })
      .then(body => {
        if (cancelled) return
        setContext(body.booking || null)
        if (body.booking) {
          setAmount((Number(body.booking.remaining_cents || 0) / 100).toFixed(2))
        }
        setLoadingContext(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message || 'booking_context_unavailable')
        setLoadingContext(false)
      })
    return () => { cancelled = true }
  }, [mode, bookingId, practitionerId, session])

  useEffect(() => {
    if (mode === 'booking') return
    if (!selectedService) return
    if (selectedService.price_cents != null) setAmount((Number(selectedService.price_cents) / 100).toFixed(2))
  }, [mode, selectedService])

  function resetExternalFields(nextMode) {
    setMode(nextMode)
    setBookingId('')
    setContext(null)
    setError(null)
    if (nextMode !== 'booking' && services.length && !serviceId) setServiceId(services[0].id)
  }

  async function submit(event) {
    event.preventDefault()
    setError(null)
    const grossCents = Math.round(Number(String(amount).replace(',', '.')) * 100)
    const occurredIso = toIso(occurredAt)
    if (!Number.isInteger(grossCents) || grossCents <= 0) {
      setError('Indique un montant encaissé valide.')
      return
    }
    if (!occurredIso) {
      setError("Indique la date réelle de l'encaissement.")
      return
    }
    if (mode === 'booking' && !bookingId) {
      setError('Choisis le rendez-vous à encaisser.')
      return
    }
    if (mode !== 'booking' && !serviceId) {
      setError('Choisis la prestation concernée.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        practitioner_id: practitionerId,
        booking_id: mode === 'booking' ? bookingId : undefined,
        source: mode === 'reservio' ? 'reservio' : mode === 'manual' ? 'manual' : undefined,
        service_id: mode === 'booking' ? undefined : serviceId,
        customer_name: mode === 'booking' ? undefined : customerName.trim(),
        customer_email: mode === 'booking' ? undefined : customerEmail.trim(),
        gross_cents: grossCents,
        payment_method: paymentMethod,
        occurred_at: occurredIso,
        appointment_starts_at: mode === 'booking' ? undefined : toIso(appointmentAt),
        note: note.trim(),
        client_request_id: crypto.randomUUID(),
      }
      const response = await fetch('/api/rdv-admin?action=finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const labels = {
          preview_manual_write_disabled: "La Preview est volontairement en lecture seule pour éviter d'écrire dans la vraie comptabilité.",
          montant_superieur_au_solde: `Le montant dépasse le solde restant${body.remaining_cents != null ? ` (${money(body.remaining_cents)})` : ''}.`,
          booking_deja_regle: 'Ce rendez-vous est déjà entièrement réglé.',
          booking_non_confirmed: "Ce rendez-vous n'est plus confirmé.",
        }
        throw new Error(labels[body.error] || body.error || 'encaissement_impossible')
      }
      onSaved?.(body)
      onClose?.()
    } catch (err) {
      setError(err.message || 'encaissement_impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-deep/55 px-4 py-6">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-gold/25 bg-cream p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Comptabilité</p>
            <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Ajouter un encaissement</h3>
            <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">Pour un règlement sur place ou un rendez-vous encore géré dans Reservio.</p>
          </div>
          <button type="button" onClick={onClose} className="text-mist hover:text-deep">✕</button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-gold/20 bg-white/50 p-1.5">
          {[
            ['booking', 'RDV MediumIA'],
            ['reservio', 'Reservio'],
            ['manual', 'Autre'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => resetExternalFields(value)}
              className={`rounded-lg px-3 py-2 font-georgia text-xs transition-colors ${mode === value ? 'bg-deep text-gold' : 'text-mist hover:bg-gold/10 hover:text-deep'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === 'booking' ? (
            <div>
              <label className="mb-1.5 block font-georgia text-xs text-mist">Rendez-vous</label>
              <select value={bookingId} onChange={e => setBookingId(e.target.value)} required className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm text-deep focus:outline-none focus:border-gold/60">
                <option value="">Choisir un rendez-vous…</option>
                {upcomingBookings.map(booking => (
                  <option key={booking.id} value={booking.id}>
                    {booking.customer_first_name} {booking.customer_last_name} — {new Date(booking.starts_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
              {loadingContext && <p className="mt-2 font-georgia text-xs text-mist">Calcul du solde restant…</p>}
              {context && (
                <div className="mt-3 rounded-xl border border-gold/20 bg-gold/[.06] px-4 py-3">
                  <p className="font-georgia text-xs font-semibold text-deep">{context.customer_name} · {context.service_title}</p>
                  <p className="mt-1 font-georgia text-xs text-mist">Prix : {money(context.total_cents)} · déjà encaissé : {money(context.paid_cents)} · <strong className="text-deep">reste : {money(context.remaining_cents)}</strong></p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block font-georgia text-xs text-mist">Prestation</label>
                <select value={serviceId} onChange={e => setServiceId(e.target.value)} required className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm text-deep focus:outline-none focus:border-gold/60">
                  <option value="">Choisir une prestation…</option>
                  {services.map(service => <option key={service.id} value={service.id}>{service.title}</option>)}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-georgia text-xs text-mist">Client</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" placeholder="Prénom Nom" />
                </div>
                <div>
                  <label className="mb-1.5 block font-georgia text-xs text-mist">E-mail <span className="opacity-60">optionnel</span></label>
                  <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" placeholder="client@email.fr" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block font-georgia text-xs text-mist">Date du rendez-vous <span className="opacity-60">optionnelle</span></label>
                <input type="datetime-local" value={appointmentAt} onChange={e => setAppointmentAt(e.target.value)} className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" />
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block font-georgia text-xs text-mist">Montant encaissé (€)</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" placeholder="50.00" />
            </div>
            <div>
              <label className="mb-1.5 block font-georgia text-xs text-mist">Règlement</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60">
                {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-georgia text-xs text-mist">Date d'encaissement</label>
              <input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} required className="w-full rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-georgia text-xs text-mist">Note <span className="opacity-60">optionnelle</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full resize-none rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-sm focus:outline-none focus:border-gold/60" placeholder="Ex. règlement du solde en espèces" />
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving || loadingContext} className="flex-1 rounded-xl bg-deep px-4 py-3 font-georgia text-sm text-gold hover:bg-deep/90 disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer l’encaissement'}
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-gold/25 px-5 py-3 font-georgia text-sm text-mist hover:text-deep">Annuler</button>
          </div>
        </form>
      </div>
    </div>
  )
}
