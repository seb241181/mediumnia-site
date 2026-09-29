import { useCallback, useEffect, useMemo, useState } from 'react'

// Rendez-vous d'urgence : le praticien propose un créneau précis à une
// personne. Le lien personnel mène directement à ce créneau, avec paiement de
// l'acompte comme sur la page publique. Raccourci : mediumia.fr/rdv#proposer

const VALIDITY = [
  [2, '2 heures'],
  [6, '6 heures'],
  [24, '24 heures'],
  [48, '48 heures'],
  [72, '3 jours'],
]

const ERRORS = {
  invalid_offer: 'Choisissez la prestation, le jour et l’heure.',
  service_without_deposit: 'Cette prestation ne se règle pas par acompte en ligne.',
  service_not_bookable: 'Cette prestation ne se réserve pas en ligne.',
  slot_in_past: 'Ce créneau est déjà passé (ou commence dans moins de 15 minutes).',
  forbidden: 'Action réservée au praticien.',
}

const STATUS = { open: 'En attente', used: 'Réservé ✓', cancelled: 'Annulé', expired: 'Expiré' }

function todayParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

function when(iso) {
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
}

export function offerMessage({ firstName, serviceTitle, startsAt, url }) {
  const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  return `${hello} je vous propose un rendez-vous « ${serviceTitle} » le ${when(startsAt)}. Pour le réserver et régler l’acompte, c’est ici : ${url}\nSébastien — MediumIA`
}

export default function SlotOfferModal({ practitionerId, session, onClose }) {
  const [services, setServices] = useState([])
  const [offers, setOffers] = useState([])
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(todayParis())
  const [time, setTime] = useState('')
  const [firstName, setFirstName] = useState('')
  const [validity, setValidity] = useState(24)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)

  const headers = useMemo(() => ({ Authorization: `Bearer ${session?.access_token}` }), [session?.access_token])

  const loadOffers = useCallback(async () => {
    const res = await fetch(`/api/rdv-admin?action=slot-offers&practitioner_id=${encodeURIComponent(practitionerId)}`, { headers, cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (res.ok) setOffers(body.offers || [])
  }, [headers, practitionerId])

  useEffect(() => {
    fetch(`/api/rdv-admin?action=services&practitioner_id=${encodeURIComponent(practitionerId)}`, { headers, cache: 'no-store' })
      .then(r => r.json())
      .then(body => {
        const list = (body.services || []).filter(s => s.is_active !== false && s.booking_mode === 'instant'
          && s.reservation_payment_kind === 'arrhes' && Number(s.reservation_payment_cents) > 0)
        setServices(list)
        if (list.length === 1) setServiceId(list[0].id)
      })
      .catch(() => {})
    loadOffers().catch(() => {})
  }, [headers, practitionerId, loadOffers])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/rdv-admin?action=slot-offers', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', practitioner_id: practitionerId, service_id: serviceId, date, time, customer_first_name: firstName.trim(), validity_hours: validity }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'offer_create_failed')
      setCreated(body)
      setCopied(false)
      loadOffers().catch(() => {})
    } catch (e) {
      setError(ERRORS[e.message] || 'Le lien n’a pas pu être créé. Réessayez.')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(offer) {
    if (!window.confirm('Annuler ce lien ? La personne ne pourra plus réserver ce créneau avec.')) return
    await fetch('/api/rdv-admin?action=slot-offers', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'cancel', practitioner_id: practitionerId, id: offer.id }),
    }).catch(() => {})
    loadOffers().catch(() => {})
  }

  const message = created ? offerMessage({
    firstName: created.offer.customer_first_name,
    serviceTitle: created.offer.service_title,
    startsAt: created.offer.starts_at,
    url: created.url,
  }) : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const titleOf = (id) => services.find(s => s.id === id)?.title || 'Prestation'
  const field = 'w-full min-w-0 rounded-xl border border-gold/25 bg-white/80 px-3 py-2.5 font-georgia text-base text-deep focus:border-gold/60 focus:outline-none sm:text-sm'
  const action = 'flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-georgia text-sm font-semibold'

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-x-hidden bg-deep/55 px-2 pt-6 sm:items-center sm:px-4 sm:py-6">
      <div className="w-full min-w-0 max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-gold/25 bg-cream p-4 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Rendez-vous d’urgence</p>
            <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Proposer un créneau</h3>
            <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">La personne reçoit un lien personnel : elle réserve ce créneau et règle l’acompte en ligne. Vos événements « Urgence » de Google Agenda ne bloquent pas ce lien.</p>
          </div>
          <button type="button" onClick={onClose} className="text-mist hover:text-deep" aria-label="Fermer">✕</button>
        </div>

        {created ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
              <p className="font-georgia text-sm font-semibold text-deep">Lien prêt ✓</p>
              <p className="mt-1 font-georgia text-xs text-mist">{created.offer.service_title} · {when(created.offer.starts_at)} · valable jusqu’au {when(created.offer.expires_at)}</p>
            </div>
            <p className="whitespace-pre-line break-words rounded-xl border border-gold/20 bg-white/80 px-4 py-3 font-georgia text-sm text-deep">{message}</p>
            <div className="grid grid-cols-2 gap-2">
              <a href={`sms:?&body=${encodeURIComponent(message)}`} className={`${action} bg-deep text-gold`}>SMS</a>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className={`${action} bg-deep text-gold`}>WhatsApp</a>
              <a href={`mailto:?subject=${encodeURIComponent('Votre rendez-vous avec Sébastien')}&body=${encodeURIComponent(message)}`} className={`${action} border border-gold/35 text-deep`}>E-mail</a>
              <button type="button" onClick={copy} className={`${action} border border-gold/35 text-deep`}>{copied ? 'Copié ✓' : 'Copier le message'}</button>
            </div>
            <button type="button" onClick={() => { setCreated(null); setTime(''); setFirstName('') }} className="w-full pt-1 font-georgia text-xs text-mist underline decoration-gold/40 underline-offset-4">Proposer un autre créneau</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block font-georgia text-xs text-mist" htmlFor="offer-service">Prestation</label>
              <select id="offer-service" value={serviceId} onChange={e => setServiceId(e.target.value)} required className={field}>
                <option value="">Choisir une prestation…</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="mb-1.5 block font-georgia text-xs text-mist" htmlFor="offer-date">Jour</label>
                <input id="offer-date" type="date" value={date} min={todayParis()} onChange={e => setDate(e.target.value)} required className={`${field} block max-w-full appearance-none`} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block font-georgia text-xs text-mist" htmlFor="offer-time">Heure</label>
                <input id="offer-time" type="time" step="300" value={time} onChange={e => setTime(e.target.value)} required className={`${field} block max-w-full appearance-none`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="mb-1.5 block font-georgia text-xs text-mist" htmlFor="offer-name">Prénom <span className="opacity-60">optionnel</span></label>
                <input id="offer-name" value={firstName} maxLength={80} onChange={e => setFirstName(e.target.value)} placeholder="Marie" className={field} />
              </div>
              <div className="min-w-0">
                <label className="mb-1.5 block font-georgia text-xs text-mist" htmlFor="offer-validity">Lien valable</label>
                <select id="offer-validity" value={validity} onChange={e => setValidity(Number(e.target.value))} className={field}>
                  {VALIDITY.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
                </select>
              </div>
            </div>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-deep px-4 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-50">
              {busy ? 'Création du lien…' : 'Créer le lien personnel'}
            </button>
          </form>
        )}

        {offers.length > 0 && (
          <div className="mt-6 border-t border-gold/15 pt-4">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-mist">Liens récents</p>
            <ul className="mt-2 divide-y divide-gold/10">
              {offers.map(o => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-georgia text-sm text-deep">{when(o.starts_at)}{o.customer_first_name ? ` · ${o.customer_first_name}` : ''}</p>
                    <p className="font-georgia text-[11px] text-mist">{titleOf(o.service_id)} · {STATUS[o.status] || o.status}</p>
                  </div>
                  {o.status === 'open' && (
                    <button type="button" onClick={() => cancel(o)} className="shrink-0 rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep">Annuler</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
