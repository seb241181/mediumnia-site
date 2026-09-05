import { useState, useEffect, useRef } from 'react'
import LegalFooter from '../LegalFooter'

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODALITY_LABELS = { video: 'Vidéo', phone: 'Téléphone', 'in-person': 'Présentiel' }

function formatService(svc) {
  return {
    ...svc,
    durationLabel:  `${svc.duration_min} min`,
    priceLabel:     svc.price_cents != null ? `${(svc.price_cents / 100).toFixed(0)} €` : 'Tarif à confirmer',
    modalityLabel:  (svc.modality || []).map(m => MODALITY_LABELS[m] || m).join(' · ') || '—',
    bookingMode:    svc.booking_mode || 'instant',
  }
}

function toDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step }) {
  const labels = ['Prestation', 'Date & Heure', 'Coordonnées']
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-none">
          <div className={`flex flex-col items-center gap-1 ${i === step ? 'opacity-100' : i < step ? 'opacity-60' : 'opacity-30'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-georgia font-bold transition-colors ${i < step ? 'bg-gold text-deep' : i === step ? 'bg-deep text-gold' : 'bg-deep/10 text-mist'}`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className="font-georgia text-[10px] text-mist hidden sm:block whitespace-nowrap">{label}</span>
          </div>
          {i < labels.length - 1 && (
            <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-gold' : 'bg-gold/15'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Step indicator (mode request) ────────────────────────────────────────────

function RequestStepBar() {
  const labels = ['Prestation', 'Votre demande', 'Envoyée']
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-none">
          <div className={`flex flex-col items-center gap-1 ${i === 1 ? 'opacity-100' : i < 1 ? 'opacity-60' : 'opacity-30'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-georgia font-bold transition-colors ${i < 1 ? 'bg-gold text-deep' : i === 1 ? 'bg-deep text-gold' : 'bg-deep/10 text-mist'}`}>
              {i < 1 ? '✓' : i + 1}
            </div>
            <span className="font-georgia text-[10px] text-mist hidden sm:block whitespace-nowrap">{label}</span>
          </div>
          {i < labels.length - 1 && (
            <div className={`flex-1 h-px mx-2 ${i < 1 ? 'bg-gold' : 'bg-gold/15'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Service card ──────────────────────────────────────────────────────────────

function ServiceCard({ service, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(service)}
      className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
        selected ? 'border-gold bg-gold/10' : 'border-gold/20 bg-white/60 hover:border-gold/50 hover:bg-white/80'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-georgia text-base font-semibold text-deep leading-snug">{service.title}</h3>
        {service.bookingMode === 'request' && (
          <span className="font-georgia text-[10px] uppercase tracking-wide bg-gold/10 text-gold border border-gold/30 rounded-full px-2.5 py-0.5 shrink-0 mt-0.5">Sur demande</span>
        )}
      </div>
      <p className="font-georgia text-sm text-mist leading-relaxed mb-3">{service.description}</p>
      <div className="flex flex-wrap gap-4 font-georgia text-xs text-mist">
        <span>⏱ {service.durationLabel}</span>
        <span>◈ {service.priceLabel}</span>
        <span>{service.modalityLabel}</span>
        {service.bookingMode === 'request' && (
          <span className="text-gold/70 italic">→ Réservation sur demande</span>
        )}
      </div>
    </button>
  )
}

// ── Calendar grid (monthly view with availability dots) ──────────────────────

function CalendarGrid({ practitionerSlug, serviceSlug, selected, onSelect, config, dayAvail, onDayAvailUpdate }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minDate = new Date(today)
  minDate.setDate(minDate.getDate() + 1)
  const horizonDays = config?.horizonDays ?? 42
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + horizonDays)

  const [viewDate, setViewDate] = useState(() => selected
    ? new Date(selected.getFullYear(), selected.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), 1))
  const [loadingMonths, setLoadingMonths] = useState({})
  const [fetchError, setFetchError] = useState(null)
  const dayAvailRef = useRef(dayAvail)
  dayAvailRef.current = dayAvail

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function isDayEnabled(date) {
    if (date < minDate || date > maxDate) return false
    const wd = date.getDay()
    if (config?.availableWeekdays === null) return wd !== 0 && wd !== 6
    return config?.availableWeekdays ? config.availableWeekdays.includes(wd) : (wd !== 0 && wd !== 6)
  }

  // Fetches availability per day because rdv-availability depends on per-date
  // Google FreeBusy, booking_exceptions, and day-of-week rules — a monthly
  // batch would require refactoring the validated availability engine.
  // Batches of 5 keep latency manageable (~4-5 rounds for a typical month).
  useEffect(() => {
    if (!serviceSlug || !config || config.mode === 'configuration_required') return

    const candidates = []
    const dim = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(year, month, d)
      if (dt < minDate || dt > maxDate) continue
      const wd = dt.getDay()
      const weekdayOpen = config.availableWeekdays === null
        ? (wd !== 0 && wd !== 6)
        : (config.availableWeekdays ? config.availableWeekdays.includes(wd) : (wd !== 0 && wd !== 6))
      if (weekdayOpen) candidates.push(dt)
    }

    if (candidates.length === 0) return
    const allKnown = candidates.every(d => dayAvailRef.current[toDateStr(d)] !== undefined)
    if (allKnown) return

    let cancelled = false
    setFetchError(null)
    setLoadingMonths(prev => ({ ...prev, [monthKey]: true }))

    async function run() {
      for (let i = 0; i < candidates.length; i += 5) {
        if (cancelled) return
        const batch = candidates.slice(i, i + 5)
        const results = await Promise.all(batch.map(async dt => {
          const dateStr = toDateStr(dt)
          if (dayAvailRef.current[dateStr] !== undefined) return null
          try {
            const params = new URLSearchParams({
              practitioner: practitionerSlug,
              date: dateStr,
              service_slug: serviceSlug,
            })
            const res = await fetch(`/api/rdv-availability?${params}`)
            if (!res.ok) return { dateStr, has: false }
            const data = await res.json()
            if (data?.mode === 'error' || data?.mode === 'configuration_required') {
              return { dateStr, has: false, blocking: data.notice || 'Impossible de charger les disponibilités.' }
            }
            return { dateStr, has: Array.isArray(data?.slots) && data.slots.some(s => s.available) }
          } catch {
            return { dateStr, has: false }
          }
        }))
        if (cancelled) return

        const blocking = results.find(r => r?.blocking)
        if (blocking) {
          setFetchError(blocking.blocking)
          setLoadingMonths(prev => ({ ...prev, [monthKey]: false }))
          return
        }

        const update = {}
        for (const r of results) {
          if (r) update[r.dateStr] = r.has
        }
        if (Object.keys(update).length > 0) onDayAvailUpdate(update)
      }
      if (!cancelled) setLoadingMonths(prev => ({ ...prev, [monthKey]: false }))
    }

    run()
    return () => { cancelled = true }
  }, [monthKey, serviceSlug, practitionerSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (config === null) {
    return (
      <div className="rounded-2xl border border-gold/25 bg-white/60 p-5 text-center">
        <p className="font-georgia text-sm text-mist py-8">Chargement du calendrier…</p>
      </div>
    )
  }

  if (config.mode === 'configuration_required') {
    return (
      <div className="rounded-2xl border border-gold/25 bg-white/60 px-5 py-8 text-center">
        <p className="font-georgia text-sm text-mist mb-2">Configuration requise</p>
        <p className="font-georgia text-xs text-mist/50 italic leading-relaxed">
          {config.notice || 'Les paramètres de disponibilité doivent être configurés.'}
        </p>
      </div>
    )
  }

  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(viewDate)
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7

  const cells = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dateStr = toDateStr(date)
    const enabled = isDayEnabled(date)
    const hasAvail = dayAvail[dateStr]
    const isMonthLoading = !!loadingMonths[monthKey]
    cells.push({ date, dateStr, enabled, hasAvail, isLoading: isMonthLoading && hasAvail === undefined && enabled })
  }

  const canPrev = new Date(year, month - 1, 1) >= new Date(today.getFullYear(), today.getMonth(), 1)

  return (
    <div className="rounded-2xl border border-gold/25 bg-white/60 p-4 sm:p-5 select-none">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          disabled={!canPrev}
          className="w-10 h-10 flex items-center justify-center rounded-xl text-mist hover:text-deep hover:bg-gold/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          aria-label="Mois précédent"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <p className="font-georgia text-base font-semibold capitalize text-deep">{monthLabel}</p>
        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-xl text-mist hover:text-deep hover:bg-gold/10 transition-colors"
          aria-label="Mois suivant"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map(d => (
          <div key={d} className="text-center font-georgia text-[10px] uppercase tracking-wider text-mist/50 py-1.5">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`pad-${idx}`} className="aspect-square" />
          const isSelected = selected && cell.date.toDateString() === selected.toDateString()
          return (
            <button
              key={cell.dateStr}
              onClick={() => cell.enabled && cell.hasAvail !== false && onSelect(cell.date)}
              disabled={!cell.enabled || cell.hasAvail === false}
              className={`relative aspect-square flex flex-col items-center justify-center rounded-xl font-georgia text-sm transition-all ${
                isSelected
                  ? 'bg-gold text-deep font-bold shadow-sm'
                  : !cell.enabled || cell.hasAvail === false
                    ? 'text-mist/20 cursor-not-allowed'
                    : 'text-deep hover:bg-gold/10'
              }`}
            >
              <span>{cell.date.getDate()}</span>
              {cell.enabled && !isSelected && cell.hasAvail === true && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-gold" />
              )}
              {cell.isLoading && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-gold/30 animate-pulse" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gold/10">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-gold inline-block" />
          <span className="font-georgia text-[10px] text-mist/60">Disponible</span>
        </div>
        {loadingMonths[monthKey] && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gold/30 animate-pulse inline-block" />
            <span className="font-georgia text-[10px] text-mist/40">Vérification…</span>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="mt-3 rounded-xl border border-gold/20 bg-gold/5 px-4 py-2.5">
          <p className="font-georgia text-xs text-mist">{fetchError}</p>
        </div>
      )}
    </div>
  )
}

// ── Time slots ────────────────────────────────────────────────────────────────

function TimeSlots({ practitionerSlug, date, service, selected, onSelect }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    setResult(null)
    const params = new URLSearchParams({
      practitioner: practitionerSlug,
      date: toDateStr(date),
      service_slug: service.slug,
    })
    fetch(`/api/rdv-availability?${params}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) { setResult(data); setLoading(false) } })
      .catch(() => {
        if (!cancelled) {
          setResult({ mode: 'error', slots: [], notice: 'Impossible de charger les créneaux.' })
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [practitionerSlug, date, service])

  if (loading) {
    return (
      <div className="rounded-xl border border-gold/20 px-5 py-8 text-center">
        <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-2" />
        <p className="font-georgia text-sm text-mist">Chargement des créneaux…</p>
      </div>
    )
  }

  if (!result || result.slots.length === 0) {
    let msg = 'Aucun créneau disponible ce jour.'
    let sub = null
    if (result?.mode === 'configuration_required') {
      msg = 'Les horaires ne sont pas encore configurés.'
      sub = 'Connectez Google Agenda et configurez vos disponibilités dans le dashboard.'
    } else if (result?.mode === 'error') {
      msg = result.notice || 'Impossible de synchroniser avec Google Agenda.'
    } else if (result?.closed) {
      msg = 'Fermé ce jour (fermeture exceptionnelle).'
    }
    return (
      <div className="rounded-xl border border-gold/20 px-5 py-8 text-center">
        <p className="font-georgia text-sm text-mist">{msg}</p>
        {sub && <p className="font-georgia text-xs text-mist/50 mt-1 italic">{sub}</p>}
      </div>
    )
  }

  return (
    <div>
      {result.mode === 'demo' && (
        <p className="font-georgia text-xs text-mist/70 italic mb-3">Créneaux de démonstration — agenda réel non connecté.</p>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {result.slots.map(slot => (
          <button
            key={slot.time}
            onClick={() => slot.available && onSelect(slot.time)}
            disabled={!slot.available}
            className={`rounded-xl border py-3 font-georgia text-sm font-semibold transition-all ${
              selected === slot.time
                ? 'border-gold bg-gold text-deep shadow-sm'
                : slot.available
                  ? 'border-gold/30 text-deep hover:border-gold hover:bg-gold/10'
                  : 'border-gold/10 text-mist/30 cursor-not-allowed line-through'
            }`}
          >
            {slot.time}
          </button>
        ))}
      </div>
      <p className="font-georgia text-xs text-mist/50 mt-3">
        {service.durationLabel} · {service.modalityLabel}
      </p>
    </div>
  )
}

// ── Contact form ──────────────────────────────────────────────────────────────

function ContactForm({ onSubmit, loading, error }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', message: '' })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const e = {}
    if (!form.firstName.trim()) e.firstName = 'Prénom requis'
    if (!form.lastName.trim())  e.lastName  = 'Nom requis'
    if (!form.email.trim() || !form.email.includes('@')) e.email = 'Email invalide'
    return e
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit(form)
  }

  const input = "w-full font-georgia text-sm text-deep bg-white border border-gold/30 rounded-xl px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors placeholder:text-mist/40"
  const label = "block font-georgia text-xs tracking-[0.12em] uppercase text-mist mb-1.5"

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Prénom <span className="text-gold">*</span></label>
          <input type="text" value={form.firstName} onChange={e => set('firstName', e.target.value)} className={input} placeholder="Marie" />
          {errors.firstName && <p className="font-georgia text-xs text-red-500 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <label className={label}>Nom <span className="text-gold">*</span></label>
          <input type="text" value={form.lastName} onChange={e => set('lastName', e.target.value)} className={input} placeholder="Dupont" />
          {errors.lastName && <p className="font-georgia text-xs text-red-500 mt-1">{errors.lastName}</p>}
        </div>
      </div>
      <div>
        <label className={label}>Email <span className="text-gold">*</span></label>
        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={input} placeholder="vous@exemple.fr" />
        {errors.email && <p className="font-georgia text-xs text-red-500 mt-1">{errors.email}</p>}
      </div>
      <div>
        <label className={label}>Téléphone <span className="text-mist">(facultatif)</span></label>
        <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={input} placeholder="06 12 34 56 78" />
      </div>
      <div>
        <label className={label}>Message <span className="text-mist">(facultatif)</span></label>
        <textarea rows={3} value={form.message} onChange={e => set('message', e.target.value)} className={input} placeholder="Un mot sur votre démarche..." />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full font-georgia py-4 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {loading && <div className="w-4 h-4 border border-gold/40 border-t-gold rounded-full animate-spin" />}
        {loading ? 'Confirmation en cours…' : 'Confirmer la réservation →'}
      </button>
      <p className="font-georgia text-[10px] text-mist/60 text-center leading-relaxed">
        Vos données sont utilisées pour gérer votre rendez-vous et peuvent être traitées par les prestataires techniques nécessaires au service. Consultez notre <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.
      </p>
    </form>
  )
}

// ── Request form (booking_mode='request') ─────────────────────────────────────

function RequestForm({ service, onSubmit, loading, error }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    addressLine1: '', addressLine2: '', postalCode: '', city: '',
    message: '', preferredPeriod: '',
  })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const e = {}
    if (!form.firstName.trim()) e.firstName = 'Prénom requis'
    if (!form.lastName.trim())  e.lastName  = 'Nom requis'
    if (!form.email.trim() || !form.email.includes('@')) e.email = 'Email invalide'
    if (!form.phone.trim()) e.phone = 'Téléphone requis'
    if (!form.addressLine1.trim()) e.addressLine1 = 'Adresse requise'
    if (!form.postalCode.trim()) e.postalCode = 'Code postal requis'
    if (!form.city.trim()) e.city = 'Ville requise'
    return e
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit(form)
  }

  const inp = "w-full font-georgia text-sm text-deep bg-white border border-gold/30 rounded-xl px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors placeholder:text-mist/40"
  const lbl = "block font-georgia text-xs tracking-[0.12em] uppercase text-mist mb-1.5"

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">{error}</div>
      )}
      {service && (
        <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
          <p className="font-georgia text-xs text-mist leading-relaxed">
            <strong className="text-deep">Tarif de base : {service.priceLabel}</strong> · Déplacement inclus jusqu'à 30 km autour de Lederzeele. Au-delà, des frais de déplacement seront définis et confirmés avant l'intervention.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Prénom <span className="text-gold">*</span></label>
          <input type="text" value={form.firstName} onChange={e => set('firstName', e.target.value)} className={inp} placeholder="Marie" />
          {errors.firstName && <p className="font-georgia text-xs text-red-500 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <label className={lbl}>Nom <span className="text-gold">*</span></label>
          <input type="text" value={form.lastName} onChange={e => set('lastName', e.target.value)} className={inp} placeholder="Dupont" />
          {errors.lastName && <p className="font-georgia text-xs text-red-500 mt-1">{errors.lastName}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Email <span className="text-gold">*</span></label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inp} placeholder="vous@exemple.fr" />
          {errors.email && <p className="font-georgia text-xs text-red-500 mt-1">{errors.email}</p>}
        </div>
        <div>
          <label className={lbl}>Téléphone <span className="text-gold">*</span></label>
          <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inp} placeholder="06 12 34 56 78" />
          {errors.phone && <p className="font-georgia text-xs text-red-500 mt-1">{errors.phone}</p>}
        </div>
      </div>
      <div>
        <label className={lbl}>Adresse du lieu d'intervention <span className="text-gold">*</span></label>
        <input type="text" value={form.addressLine1} onChange={e => set('addressLine1', e.target.value)} className={inp} placeholder="12 rue des Lilas" />
        {errors.addressLine1 && <p className="font-georgia text-xs text-red-500 mt-1">{errors.addressLine1}</p>}
      </div>
      <div>
        <label className={lbl}>Complément d'adresse <span className="text-mist font-georgia text-[10px] normal-case tracking-normal">(facultatif)</span></label>
        <input type="text" value={form.addressLine2} onChange={e => set('addressLine2', e.target.value)} className={inp} placeholder="Appartement, bâtiment…" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Code postal <span className="text-gold">*</span></label>
          <input type="text" value={form.postalCode} onChange={e => set('postalCode', e.target.value)} className={inp} placeholder="59000" />
          {errors.postalCode && <p className="font-georgia text-xs text-red-500 mt-1">{errors.postalCode}</p>}
        </div>
        <div>
          <label className={lbl}>Ville <span className="text-gold">*</span></label>
          <input type="text" value={form.city} onChange={e => set('city', e.target.value)} className={inp} placeholder="Lille" />
          {errors.city && <p className="font-georgia text-xs text-red-500 mt-1">{errors.city}</p>}
        </div>
      </div>
      <div>
        <label className={lbl}>Préférence de période <span className="text-mist font-georgia text-[10px] normal-case tracking-normal">(facultatif)</span></label>
        <input type="text" value={form.preferredPeriod} onChange={e => set('preferredPeriod', e.target.value)} className={inp} placeholder="En fin de journée de préférence, plutôt en semaine…" />
      </div>
      <div>
        <label className={lbl}>Description de la situation <span className="text-mist font-georgia text-[10px] normal-case tracking-normal">(facultatif)</span></label>
        <textarea rows={3} value={form.message} onChange={e => set('message', e.target.value)} className={inp} placeholder="Décrivez brièvement le contexte ou vos ressentis concernant le lieu…" />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full font-georgia py-4 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {loading && <div className="w-4 h-4 border border-gold/40 border-t-gold rounded-full animate-spin" />}
        {loading ? 'Envoi en cours…' : 'Envoyer ma demande →'}
      </button>
      <p className="font-georgia text-[10px] text-mist/60 text-center leading-relaxed">
        Vos données sont utilisées pour gérer votre rendez-vous et peuvent être traitées par les prestataires techniques nécessaires au service. Consultez notre <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.
      </p>
    </form>
  )
}

// ── Summary sidebar ───────────────────────────────────────────────────────────

function Summary({ practitioner, service, date, time }) {
  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null
  return (
    <div className="rounded-2xl border border-gold/25 bg-white/60 p-5">
      <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-4">Récapitulatif</p>
      {practitioner && (
        <div className="flex items-center gap-3 pb-4 border-b border-gold/10">
          {practitioner.photo_url && (
            <img src={practitioner.photo_url} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
          )}
          <div>
            <p className="font-georgia text-sm font-semibold leading-snug">{practitioner.name}</p>
            <p className="font-georgia text-xs text-mist">{practitioner.role}</p>
          </div>
        </div>
      )}
      {service && (
        <div className="py-3 border-b border-gold/10">
          <p className="font-georgia text-[10px] uppercase tracking-wide text-mist mb-1">Prestation</p>
          <p className="font-georgia text-sm font-semibold">{service.title}</p>
          <p className="font-georgia text-xs text-mist mt-0.5">{service.durationLabel} · {service.priceLabel}</p>
          <p className="font-georgia text-xs text-mist">{service.modalityLabel}</p>
        </div>
      )}
      {date && (
        <div className="py-3">
          <p className="font-georgia text-[10px] uppercase tracking-wide text-mist mb-1 capitalize">{fmt(date)}</p>
          {time && <p className="font-georgia text-2xl font-bold text-deep">{time}</p>}
        </div>
      )}
      {!service && <p className="font-georgia text-xs text-mist/50 italic py-3">Choisissez une prestation pour commencer.</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RdvPublic({ onBack, onNavigate }) {
  const slug = window.location.pathname.replace(/^\/rdv\//, '').replace(/\/$/, '')

  const [configData, setConfigData]     = useState(null)
  const [configLoading, setConfigLoading] = useState(true)

  const [step, setStep]           = useState(0)
  const [service, setService]     = useState(null)
  const [date, setDate]           = useState(null)
  const [time, setTime]           = useState(null)
  const [bookingResult, setBookingResult] = useState(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError]     = useState(null)

  const [dayAvail, setDayAvail] = useState({})

  useEffect(() => {
    fetch(`/api/rdv-config?practitioner=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(data => { setConfigData(data); setConfigLoading(false) })
      .catch(() => {
        setConfigData({ mode: 'demo', availableWeekdays: null, horizonDays: 42, notice: null, practitioner: null, services: [] })
        setConfigLoading(false)
      })
  }, [slug])

  // ── Chargement ──────────────────────────────────────────────────────────────

  if (configLoading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    )
  }

  // ── Praticien introuvable ───────────────────────────────────────────────────

  if (!configData?.practitioner && configData?.mode !== 'demo') {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center">
        <p className="text-gold text-4xl mb-4">◌</p>
        <p className="font-georgia text-mist mb-2">Praticien introuvable.</p>
        <button onClick={onBack} className="font-georgia text-sm text-deep underline">← Retour</button>
      </div>
    )
  }

  const practitioner = configData.practitioner
  const services     = (configData.services || []).map(formatService)

  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null

  function selectService(svc) {
    setService(svc); setDate(null); setTime(null); setBookingError(null)
    setDayAvail({})
    if (svc.bookingMode === 'request') {
      setStep('request-form')
    } else {
      setStep(1)
    }
  }

  function selectDate(d)  { setDate(d); setTime(null) }
  function selectTime(t)  { setTime(t) }

  async function handleSubmitRequest(requestForm) {
    setBookingLoading(true)
    setBookingError(null)
    try {
      const res = await fetch('/api/rdv-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practitioner_slug: slug,
          service_slug:      service.slug,
          customer: {
            firstName:       requestForm.firstName,
            lastName:        requestForm.lastName,
            email:           requestForm.email,
            phone:           requestForm.phone,
            address_line1:   requestForm.addressLine1,
            address_line2:   requestForm.addressLine2 || null,
            postal_code:     requestForm.postalCode,
            city:            requestForm.city,
            message:         requestForm.message || null,
            preferred_period: requestForm.preferredPeriod || null,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBookingError(data.error || "Erreur lors de l'envoi. Réessayez.")
        return
      }
      setStep('request-sent')
    } catch {
      setBookingError('Erreur réseau. Vérifiez votre connexion et réessayez.')
    } finally {
      setBookingLoading(false)
    }
  }

  async function handleConfirm(contactForm) {
    setBookingLoading(true)
    setBookingError(null)

    try {
      const res = await fetch('/api/rdv-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practitioner_slug: slug,
          service_slug:      service.slug,
          date:              toDateStr(date),
          time,
          customer: {
            firstName: contactForm.firstName,
            lastName:  contactForm.lastName,
            email:     contactForm.email,
            phone:     contactForm.phone || null,
            message:   contactForm.message || null,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setBookingError(data.error || 'Erreur lors de la réservation. Réessayez.')
        setBookingLoading(false)
        return
      }

      setBookingResult(data)
      setStep(3)
    } catch {
      setBookingError('Erreur réseau. Vérifiez votre connexion et réessayez.')
    } finally {
      setBookingLoading(false)
    }
  }

  // ── Demande envoyée (step request-sent) ────────────────────────────────────

  if (step === 'request-sent') {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">✦ MEDIUMIA</button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="max-w-lg w-full text-center">
            <p className="text-gold text-5xl mb-6">✦</p>
            <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-4">Demande envoyée</p>
            <h1 className="font-georgia font-medium text-3xl text-deep leading-tight mb-4">Votre demande a bien été transmise.</h1>
            <p className="font-georgia text-mist text-base mb-8 leading-relaxed">
              Sébastien vous recontactera afin de convenir de la date de l'intervention et de vous confirmer le montant total, frais de déplacement éventuels compris.
            </p>
            {service && (
              <div className="rounded-2xl border border-gold/25 bg-white/60 px-6 py-5 mb-8 text-left space-y-2.5">
                <p className="font-georgia text-sm"><span className="text-mist">Prestation :</span> <strong>{service.title}</strong></p>
                <p className="font-georgia text-sm"><span className="text-mist">Tarif de base :</span> <strong>{service.priceLabel}</strong></p>
              </div>
            )}
            <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">← Retour à MediumIA</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirmation (step 3) — UNIQUEMENT après INSERT réussi ─────────────────

  if (step === 3 && bookingResult) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">✦ MEDIUMIA</button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="max-w-lg w-full text-center">
            <p className="text-gold text-5xl mb-6">✦</p>
            <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-4">Réservation confirmée</p>
            <h1 className="font-georgia font-medium text-3xl text-deep leading-tight mb-2">Votre rendez-vous est enregistré.</h1>
            <p className="font-georgia text-mist text-base mb-8">Un email de confirmation vous sera envoyé prochainement.</p>
            <div className="rounded-2xl border border-gold/25 bg-white/60 px-6 py-5 mb-8 text-left space-y-2.5">
              {practitioner && <p className="font-georgia text-sm"><span className="text-mist">Praticien :</span> <strong>{practitioner.name}</strong></p>}
              <p className="font-georgia text-sm"><span className="text-mist">Prestation :</span> <strong>{service.title}</strong></p>
              <p className="font-georgia text-sm capitalize"><span className="text-mist">Date :</span> <strong>{fmt(date)}</strong></p>
              <p className="font-georgia text-sm"><span className="text-mist">Heure :</span> <strong>{time}</strong></p>
              <p className="font-georgia text-sm"><span className="text-mist">Modalité :</span> <strong>{service.modalityLabel}</strong></p>
            </div>
            <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
              ← Retour à MediumIA
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">✦ MEDIUMIA</button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Retour</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10 pb-24">

        {/* Practitioner hero */}
        <div className="flex items-center gap-5 mb-10">
          {practitioner?.photo_url && (
            <img src={practitioner.photo_url} alt={practitioner?.name || slug} className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover shadow-sm" />
          )}
          <div>
            <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-1">Prendre rendez-vous</p>
            <h1 className="font-georgia font-medium text-2xl md:text-3xl text-deep leading-tight">{practitioner?.name || slug}</h1>
            <p className="font-georgia text-mist text-sm">{practitioner?.tagline || ''}</p>
          </div>
        </div>

        {/* Mode demo notice */}
        {configData.mode === 'demo' && (
          <div className="rounded-xl border border-gold/20 bg-gold/5 px-5 py-3.5 mb-6">
            <p className="font-georgia text-xs text-mist/80 italic">
              Mode démonstration — la connexion Google Agenda et la configuration des disponibilités sont requises pour activer les réservations réelles.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8">

          {/* Main booking flow */}
          <div className="md:col-span-2">
            {typeof step === 'number' ? <StepBar step={step} /> : <RequestStepBar />}

            {/* Step 0 — Service */}
            {step === 0 && (
              <div>
                <h2 className="font-georgia font-medium text-xl mb-5">Choisissez une prestation</h2>
                {services.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gold/25 px-6 py-10 text-center">
                    <p className="font-georgia text-sm text-mist">Aucune prestation disponible pour le moment.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {services.map(svc => (
                      <ServiceCard key={svc.id} service={svc} selected={service?.id === svc.id} onSelect={selectService} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 1 — Date & Time (combined calendar + slots) */}
            {step === 1 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setStep(0)} className="font-georgia text-xs text-mist hover:text-deep">← Prestation</button>
                  <h2 className="font-georgia font-medium text-xl">Choisissez une date</h2>
                </div>
                <CalendarGrid
                  practitionerSlug={slug}
                  serviceSlug={service.slug}
                  selected={date}
                  onSelect={selectDate}
                  config={configData}
                  dayAvail={dayAvail}
                  onDayAvailUpdate={(update) => setDayAvail(prev => ({ ...prev, ...update }))}
                />
                {date && (
                  <div className="mt-6">
                    <p className="font-georgia text-sm font-semibold text-deep capitalize mb-3">{fmt(date)}</p>
                    <TimeSlots
                      practitionerSlug={slug}
                      date={date}
                      service={service}
                      selected={time}
                      onSelect={selectTime}
                    />
                    {time && (
                      <button
                        onClick={() => setStep(2)}
                        className="mt-6 w-full font-georgia py-4 rounded-xl bg-gold text-deep font-bold hover:bg-gold/90 transition-colors"
                      >
                        Continuer — {time} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 2 — Contact form */}
            {step === 2 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setStep(1)} className="font-georgia text-xs text-mist hover:text-deep">← Date & Heure</button>
                  <h2 className="font-georgia font-medium text-xl">Vos coordonnées</h2>
                </div>
                <ContactForm onSubmit={handleConfirm} loading={bookingLoading} error={bookingError} />
              </div>
            )}

            {/* Step request-form — Demande de déplacement */}
            {step === 'request-form' && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => { setStep(0); setBookingError(null) }} className="font-georgia text-xs text-mist hover:text-deep">← Prestation</button>
                  <h2 className="font-georgia font-medium text-xl">Votre demande</h2>
                </div>
                <RequestForm
                  service={service}
                  onSubmit={handleSubmitRequest}
                  loading={bookingLoading}
                  error={bookingError}
                />
              </div>
            )}
          </div>

          {/* Sidebar summary */}
          <div>
            <Summary practitioner={practitioner} service={service} date={date} time={time} />
          </div>
        </div>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
