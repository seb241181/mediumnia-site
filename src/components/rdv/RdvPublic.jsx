import { useState, useEffect } from 'react'
import { getPractitioner } from '../../data/rdvData'

/* ── Step indicator ── */
function StepBar({ step }) {
  const labels = ['Prestation', 'Date', 'Créneau', 'Coordonnées']
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

/* ── Service card ── */
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
        {service.provisional && (
          <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 shrink-0 mt-0.5">
            À confirmer
          </span>
        )}
      </div>
      <p className="font-georgia text-sm text-mist leading-relaxed mb-3">{service.description}</p>
      <div className="flex flex-wrap gap-4 font-georgia text-xs text-mist">
        <span>⏱ {service.durationLabel}</span>
        <span>◈ {service.priceLabel}</span>
        <span>{service.modalityLabel}</span>
      </div>
    </button>
  )
}

/* ── Calendar picker ── */
function CalendarPicker({ selected, onSelect }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minDate = new Date(today)
  minDate.setDate(minDate.getDate() + 1)
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + 42)

  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(viewDate)
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    cells.push({ date, disabled: isWeekend || date < minDate || date > maxDate })
  }

  const canPrev = new Date(year, month - 1, 1) >= new Date(today.getFullYear(), today.getMonth(), 1)

  return (
    <div className="rounded-2xl border border-gold/25 bg-white/60 p-5 select-none">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          disabled={!canPrev}
          className="font-georgia text-sm text-mist px-3 py-1.5 rounded-lg hover:text-deep disabled:opacity-25 disabled:cursor-not-allowed"
        >
          ←
        </button>
        <p className="font-georgia text-sm font-semibold capitalize">{monthLabel}</p>
        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="font-georgia text-sm text-mist px-3 py-1.5 rounded-lg hover:text-deep"
        >
          →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map(d => (
          <div key={d} className="text-center font-georgia text-[10px] uppercase tracking-wide text-mist/60 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`pad-${idx}`} />
          const isSelected = selected && cell.date.toDateString() === selected.toDateString()
          return (
            <button
              key={cell.date.toISOString()}
              onClick={() => !cell.disabled && onSelect(cell.date)}
              disabled={cell.disabled}
              className={`h-9 w-full rounded-lg font-georgia text-sm transition-all ${
                isSelected ? 'bg-gold text-deep font-bold' :
                cell.disabled ? 'text-mist/25 cursor-not-allowed' :
                'text-deep hover:bg-gold/15 hover:font-semibold'
              }`}
            >
              {cell.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Time slots ── */
function TimeSlots({ practitionerSlug, date, service, selected, onSelect }) {
  const [result, setResult] = useState(null)  // { mode, slots, notice }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    setResult(null)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    fetch(`/api/rdv-availability?practitioner=${encodeURIComponent(practitionerSlug)}&date=${dateStr}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) { setResult(data); setLoading(false) } })
      .catch(() => {
        if (!cancelled) {
          setResult({ mode: 'error', slots: [], notice: 'Impossible de charger les créneaux. Réessayez.' })
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [practitionerSlug, date])

  if (loading) {
    return (
      <div className="rounded-xl border border-gold/20 px-5 py-8 text-center">
        <p className="font-georgia text-sm text-mist">Chargement des créneaux…</p>
      </div>
    )
  }

  if (!result || result.slots.length === 0) {
    return (
      <div className="rounded-xl border border-gold/20 px-5 py-8 text-center">
        <p className="font-georgia text-sm text-mist">
          {result?.mode === 'error' && result.notice
            ? result.notice
            : 'Aucun créneau disponible ce jour.'}
        </p>
        {result?.mode === 'demo' && (
          <p className="font-georgia text-xs text-mist/50 mt-1 italic">
            {result.notice || 'Les horaires réels seront affichés après connexion à Google Agenda.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      {result.mode === 'demo' && (
        <p className="font-georgia text-xs text-mist/70 italic mb-3">
          {result.notice || 'Créneaux de démonstration — agenda Google non connecté.'}
        </p>
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

/* ── Contact form ── */
function ContactForm({ onSubmit }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', message: '' })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const e = {}
    if (!form.firstName.trim()) e.firstName = 'Prénom requis'
    if (!form.lastName.trim()) e.lastName = 'Nom requis'
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
      <button type="submit" className="w-full font-georgia py-4 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors">
        Confirmer la réservation →
      </button>
      <p className="font-georgia text-[10px] text-mist/60 text-center leading-relaxed">
        Vos données sont utilisées uniquement pour ce rendez-vous et ne sont pas transmises à des tiers.
      </p>
    </form>
  )
}

/* ── Summary sidebar ── */
function Summary({ practitioner, service, date, time }) {
  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null
  return (
    <div className="rounded-2xl border border-gold/25 bg-white/60 p-5">
      <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-4">Récapitulatif</p>
      <div className="flex items-center gap-3 pb-4 border-b border-gold/10">
        <img src={practitioner.photo} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
        <div>
          <p className="font-georgia text-sm font-semibold leading-snug">{practitioner.name}</p>
          <p className="font-georgia text-xs text-mist">{practitioner.role}</p>
        </div>
      </div>
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

/* ── Main component ── */
export default function RdvPublic({ onBack }) {
  const slug = window.location.pathname.replace(/^\/rdv\//, '').replace(/\/$/, '')
  const practitioner = getPractitioner(slug)

  const [step, setStep] = useState(0)
  const [service, setService] = useState(null)
  const [date, setDate] = useState(null)
  const [time, setTime] = useState(null)

  if (!practitioner) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center">
        <p className="text-gold text-4xl mb-4">◌</p>
        <p className="font-georgia text-mist mb-2">Praticien introuvable.</p>
        <button onClick={onBack} className="font-georgia text-sm text-deep underline">← Retour</button>
      </div>
    )
  }

  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null

  function selectService(svc) { setService(svc); setDate(null); setTime(null); setStep(1) }
  function selectDate(d) { setDate(d); setTime(null); setStep(2) }
  function selectTime(t) { setTime(t); setStep(3) }
  function handleConfirm() { setStep(4) }

  if (step === 4) {
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
            <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-4">Réservation enregistrée</p>
            <h1 className="font-georgia font-medium text-3xl text-deep leading-tight mb-2">Votre demande a bien été prise en compte.</h1>
            <p className="font-georgia text-mist text-base mb-8">Un email de confirmation vous sera envoyé.</p>
            <div className="rounded-2xl border border-gold/25 bg-white/60 px-6 py-5 mb-6 text-left space-y-2.5">
              <p className="font-georgia text-sm"><span className="text-mist">Praticien :</span> <strong>{practitioner.name}</strong></p>
              <p className="font-georgia text-sm"><span className="text-mist">Prestation :</span> <strong>{service.title}</strong></p>
              <p className="font-georgia text-sm capitalize"><span className="text-mist">Date :</span> <strong>{fmt(date)}</strong></p>
              <p className="font-georgia text-sm"><span className="text-mist">Heure :</span> <strong>{time}</strong></p>
              <p className="font-georgia text-sm"><span className="text-mist">Modalité :</span> <strong>{service.modalityLabel}</strong></p>
            </div>
            <div className="rounded-xl border border-gold/20 bg-gold/5 px-5 py-4 mb-8">
              <p className="font-georgia text-xs text-mist leading-relaxed italic">
                Version Preview — la réservation n'est pas encore persistée et aucun email n'est envoyé. Ces fonctionnalités seront actives après configuration de Supabase et du service d'email.
              </p>
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
          <img src={practitioner.photo} alt={practitioner.name} className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover shadow-sm" />
          <div>
            <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-1">Prendre rendez-vous</p>
            <h1 className="font-georgia font-medium text-2xl md:text-3xl text-deep leading-tight">{practitioner.name}</h1>
            <p className="font-georgia text-mist text-sm">{practitioner.tagline}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">

          {/* Main booking flow */}
          <div className="md:col-span-2">
            <StepBar step={step} />

            {/* Step 0 — Service */}
            {step === 0 && (
              <div>
                <h2 className="font-georgia font-medium text-xl mb-5">Choisissez une prestation</h2>
                <div className="space-y-3">
                  {practitioner.services.map(svc => (
                    <ServiceCard key={svc.id} service={svc} selected={service?.id === svc.id} onSelect={selectService} />
                  ))}
                </div>
              </div>
            )}

            {/* Step 1 — Date */}
            {step === 1 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setStep(0)} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Prestation</button>
                  <h2 className="font-georgia font-medium text-xl">Choisissez une date</h2>
                </div>
                <CalendarPicker selected={date} onSelect={selectDate} />
              </div>
            )}

            {/* Step 2 — Time */}
            {step === 2 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setStep(1)} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Date</button>
                  <h2 className="font-georgia font-medium text-xl capitalize">{fmt(date)}</h2>
                </div>
                <TimeSlots practitionerSlug={slug} date={date} service={service} selected={time} onSelect={selectTime} />
                {time && (
                  <button onClick={() => setStep(3)} className="mt-6 w-full font-georgia py-4 rounded-xl bg-gold text-deep font-bold hover:bg-gold/90 transition-colors">
                    Continuer — {time} →
                  </button>
                )}
              </div>
            )}

            {/* Step 3 — Contact form */}
            {step === 3 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setStep(2)} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Créneau</button>
                  <h2 className="font-georgia font-medium text-xl">Vos coordonnées</h2>
                </div>
                <ContactForm onSubmit={handleConfirm} />
              </div>
            )}
          </div>

          {/* Sidebar summary */}
          <div>
            <Summary practitioner={practitioner} service={service} date={date} time={time} />
          </div>

        </div>
      </main>
    </div>
  )
}
