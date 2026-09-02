import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../lib/useAuth'

// ── Helpers ──────────────────────────────────────────────────────────────────

function authHeader(session) {
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function slugify(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function formatPrice(cents) {
  if (cents == null) return 'Tarif à confirmer'
  return `${(cents / 100).toFixed(0)} €`
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MODALITIES = [
  { value: 'video', label: 'Vidéo' },
  { value: 'phone', label: 'Téléphone' },
  { value: 'in-person', label: 'Présentiel' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  if (status === 'ok') return (
    <span className="font-georgia text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">✓ Actif</span>
  )
  if (status === 'warn') return (
    <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">⚠ Configuration requise</span>
  )
  return (
    <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/20 rounded-full px-3 py-1">— Non configuré</span>
  )
}

function Spinner({ size = 'sm' }) {
  const cls = size === 'lg'
    ? 'w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin'
    : 'w-4 h-4 border border-gold/30 border-t-gold rounded-full animate-spin'
  return <div className={cls} />
}

function Notice({ notice, onClose }) {
  if (!notice) return null
  return (
    <div className={`rounded-xl border px-5 py-3.5 mb-4 flex items-center justify-between gap-4 ${
      notice.type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-red-200 bg-red-50 text-red-800'
    }`}>
      <p className="font-georgia text-xs">{notice.msg}</p>
      <button onClick={onClose} className="font-georgia text-xs opacity-60 hover:opacity-100 shrink-0">✕</button>
    </div>
  )
}

// ── LoginForm ─────────────────────────────────────────────────────────────────

function LoginForm({ signIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await signIn(email, password)
    if (err) {
      setError(err.message || 'Identifiants incorrects.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-3">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-2xl text-deep mb-2">MediumIA Rendez-vous</h1>
          <p className="font-georgia text-sm text-mist">Connexion praticien</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-gold/25 bg-white/60 p-7 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">
              {error}
            </div>
          )}
          <div>
            <label className="font-georgia text-xs text-mist block mb-1.5">Adresse email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm text-deep bg-white/80 focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20"
              placeholder="votre@email.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="font-georgia text-xs text-mist block mb-1.5">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm text-deep bg-white/80 focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-deep text-gold font-georgia text-sm py-3 rounded-xl hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : null}
            {loading ? 'Connexion…' : 'Se connecter →'}
          </button>
        </form>

        <p className="font-georgia text-[10px] text-mist/50 text-center mt-5">
          Accès réservé aux praticiens MediumIA
        </p>
      </div>
    </div>
  )
}

// ── ServiceModal ──────────────────────────────────────────────────────────────

function ServiceModal({ service, practitionerId, session, onSave, onClose }) {
  const isNew = !service?.id
  const [form, setForm] = useState({
    title: service?.title || '',
    slug: service?.slug || '',
    description: service?.description || '',
    duration_min: service?.duration_min || 60,
    price_euros: service?.price_cents != null ? service.price_cents / 100 : '',
    modality: service?.modality || [],
    is_active: service?.is_active !== false,
    sort_order: service?.sort_order || 0,
    booking_mode: service?.booking_mode || 'instant',
  })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  function handleTitleChange(v) {
    setForm(f => ({ ...f, title: v, slug: isNew ? slugify(v) : f.slug }))
  }

  function toggleModality(val) {
    setForm(f => ({
      ...f,
      modality: f.modality.includes(val) ? f.modality.filter(m => m !== val) : [...f.modality, val],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)

    const body = {
      practitioner_id: practitionerId,
      title: form.title,
      slug: form.slug,
      description: form.description,
      duration_min: Number(form.duration_min),
      price_cents: form.price_euros === '' ? null : Math.round(Number(form.price_euros) * 100),
      modality: form.modality,
      is_active: form.is_active,
      sort_order: Number(form.sort_order),
      booking_mode: form.booking_mode,
    }

    if (!isNew) body.id = service.id

    const method = isNew ? 'POST' : 'PUT'
    try {
      const res = await fetch('/api/rdv-admin?action=services', {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur lors de la sauvegarde'); setSaving(false); return }
      onSave(data.service)
    } catch {
      setError('Erreur réseau')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-deep/50 flex items-center justify-center px-4">
      <div className="bg-cream rounded-2xl border border-gold/25 w-full max-w-lg p-7 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-georgia text-lg font-medium">{isNew ? 'Nouvelle prestation' : 'Modifier la prestation'}</h3>
          <button onClick={onClose} className="text-mist hover:text-deep">✕</button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800 mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="font-georgia text-xs text-mist block mb-1.5">Titre *</label>
              <input
                value={form.title}
                onChange={e => handleTitleChange(e.target.value)}
                required
                className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
                placeholder="Consultation médiumnité"
              />
            </div>
            <div className="col-span-2">
              <label className="font-georgia text-xs text-mist block mb-1.5">Slug (URL) *</label>
              <input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                required
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60 font-mono text-xs"
                placeholder="consultation-mediumnite"
              />
            </div>
            <div>
              <label className="font-georgia text-xs text-mist block mb-1.5">Durée (min) *</label>
              <input
                type="number"
                value={form.duration_min}
                onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))}
                required min="5"
                className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
              />
            </div>
            <div>
              <label className="font-georgia text-xs text-mist block mb-1.5">Prix (€) <span className="opacity-60">optionnel</span></label>
              <input
                type="number"
                value={form.price_euros}
                onChange={e => setForm(f => ({ ...f, price_euros: e.target.value }))}
                min="0" step="0.01"
                className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
                placeholder="80"
              />
            </div>
          </div>

          <div>
            <label className="font-georgia text-xs text-mist block mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60 resize-none"
            />
          </div>

          <div>
            <label className="font-georgia text-xs text-mist block mb-2">Modalités</label>
            <div className="flex gap-3">
              {MODALITIES.map(m => (
                <label key={m.value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.modality.includes(m.value)}
                    onChange={() => toggleModality(m.value)}
                    className="accent-gold"
                  />
                  <span className="font-georgia text-xs text-deep">{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-georgia text-xs text-mist block mb-1.5">Mode de réservation</label>
            <select
              value={form.booking_mode}
              onChange={e => setForm(f => ({ ...f, booking_mode: e.target.value }))}
              className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
            >
              <option value="instant">Instant — créneau choisi par le client</option>
              <option value="request">Sur demande — formulaire de demande (présentiel)</option>
            </select>
            {form.booking_mode === 'request' && (
              <p className="font-georgia text-[10px] text-mist/70 mt-1.5 leading-relaxed">
                Le client soumet une demande avec son adresse et ses coordonnées. Vous convenez de la date manuellement depuis le dashboard.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="accent-gold"
              />
              <span className="font-georgia text-xs text-deep">Prestation active (visible sur la page publique)</span>
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-deep text-gold font-georgia text-sm py-3 rounded-xl hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner /> : null}
              {saving ? 'Sauvegarde…' : (isNew ? 'Créer la prestation' : 'Sauvegarder')}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-3 rounded-xl border border-gold/25 font-georgia text-sm text-mist hover:text-deep">
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── AvailabilityEditor ────────────────────────────────────────────────────────

function AvailabilityEditor({ rules, practitionerId, session, onSave, onCancel }) {
  // draft: array of {day_of_week, start_time, end_time}
  const [draft, setDraft] = useState(() => rules.map(r => ({ ...r })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function addSlot(day) {
    setDraft(d => [...d, { day_of_week: day, start_time: '09:00', end_time: '17:00' }])
  }

  function removeSlot(day, idx) {
    let count = -1
    setDraft(d => d.filter(r => {
      if (r.day_of_week !== day) return true
      count++
      return count !== idx
    }))
  }

  function updateSlot(day, idx, field, val) {
    let count = -1
    setDraft(d => d.map(r => {
      if (r.day_of_week !== day) return r
      count++
      return count === idx ? { ...r, [field]: val } : r
    }))
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/rdv-admin?action=availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({ practitioner_id: practitionerId, rules: draft }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur'); setSaving(false); return }
      onSave(data.rules)
    } catch {
      setError('Erreur réseau')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">{error}</div>
      )}

      {DAYS.map((dayLabel, dayIdx) => {
        const daySlots = draft.filter(r => r.day_of_week === dayIdx)
        return (
          <div key={dayIdx} className="rounded-xl border border-gold/15 bg-white/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-georgia text-xs font-semibold text-deep w-10">{dayLabel}</span>
              <button
                onClick={() => addSlot(dayIdx)}
                className="font-georgia text-[10px] text-gold border border-gold/30 px-2 py-1 rounded-lg hover:bg-gold/10"
              >
                + Créneau
              </button>
            </div>
            {daySlots.length === 0 ? (
              <p className="font-georgia text-[10px] text-mist/50 italic">Indisponible ce jour</p>
            ) : (
              <div className="space-y-1.5">
                {daySlots.map((slot, slotIdx) => {
                  let count = -1
                  // find global index for this slot
                  const globalIdx = draft.findIndex((r, i) => {
                    if (r.day_of_week !== dayIdx) return false
                    count++
                    return count === slotIdx
                  })
                  return (
                    <div key={slotIdx} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={slot.start_time.slice(0, 5)}
                        onChange={e => updateSlot(dayIdx, slotIdx, 'start_time', e.target.value)}
                        className="border border-gold/20 rounded-lg px-2 py-1 font-georgia text-xs bg-white/80 focus:outline-none focus:border-gold/60"
                      />
                      <span className="text-mist text-xs">→</span>
                      <input
                        type="time"
                        value={slot.end_time.slice(0, 5)}
                        onChange={e => updateSlot(dayIdx, slotIdx, 'end_time', e.target.value)}
                        className="border border-gold/20 rounded-lg px-2 py-1 font-georgia text-xs bg-white/80 focus:outline-none focus:border-gold/60"
                      />
                      <button
                        onClick={() => removeSlot(dayIdx, slotIdx)}
                        className="text-red-400 hover:text-red-600 font-georgia text-xs px-1"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-deep text-gold font-georgia text-sm py-2.5 rounded-xl hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? <Spinner /> : null}
          {saving ? 'Sauvegarde…' : 'Sauvegarder les disponibilités'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-gold/25 font-georgia text-sm text-mist hover:text-deep">
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── SettingsEditor ────────────────────────────────────────────────────────────

function SettingsEditor({ practitioner, session, onSave, onCancel }) {
  const [form, setForm] = useState({
    booking_horizon_days: practitioner.booking_horizon_days ?? 60,
    buffer_before_min: practitioner.buffer_before_min ?? 0,
    buffer_after_min: practitioner.buffer_after_min ?? 15,
    min_advance_hours: practitioner.min_advance_hours ?? 24,
    max_per_day: practitioner.max_per_day ?? '',
    booking_enabled: practitioner.booking_enabled ?? false,
    timezone: practitioner.timezone ?? 'Europe/Paris',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setError(null)
    setSaving(true)
    const body = {
      practitioner_id: practitioner.id,
      booking_horizon_days: Number(form.booking_horizon_days),
      buffer_before_min: Number(form.buffer_before_min),
      buffer_after_min: Number(form.buffer_after_min),
      min_advance_hours: Number(form.min_advance_hours),
      max_per_day: form.max_per_day === '' ? null : Number(form.max_per_day),
      booking_enabled: form.booking_enabled,
      timezone: form.timezone,
    }
    try {
      const res = await fetch('/api/rdv-admin?action=settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur'); setSaving(false); return }
      onSave(data.settings)
    } catch {
      setError('Erreur réseau')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'booking_horizon_days', label: 'Horizon (jours)', min: 1 },
          { key: 'buffer_before_min', label: 'Tampon avant (min)', min: 0 },
          { key: 'buffer_after_min', label: 'Tampon après (min)', min: 0 },
          { key: 'min_advance_hours', label: 'Délai min. (heures)', min: 0 },
        ].map(({ key, label, min }) => (
          <div key={key}>
            <label className="font-georgia text-[11px] text-mist block mb-1">{label}</label>
            <input
              type="number"
              min={min}
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              className="w-full border border-gold/20 rounded-xl px-3 py-2 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
            />
          </div>
        ))}
        <div>
          <label className="font-georgia text-[11px] text-mist block mb-1">Max/jour <span className="opacity-60">(vide = illimité)</span></label>
          <input
            type="number"
            min="1"
            value={form.max_per_day}
            onChange={e => setForm(f => ({ ...f, max_per_day: e.target.value }))}
            className="w-full border border-gold/20 rounded-xl px-3 py-2 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
            placeholder="illimité"
          />
        </div>
        <div>
          <label className="font-georgia text-[11px] text-mist block mb-1">Fuseau horaire</label>
          <input
            type="text"
            value={form.timezone}
            onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
            className="w-full border border-gold/20 rounded-xl px-3 py-2 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60"
          />
        </div>
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={form.booking_enabled}
          onChange={e => setForm(f => ({ ...f, booking_enabled: e.target.checked }))}
          className="accent-gold"
        />
        <span className="font-georgia text-xs text-deep">Réservations ouvertes (les clients peuvent réserver)</span>
      </label>

      <div className="flex gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-deep text-gold font-georgia text-sm py-2.5 rounded-xl hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? <Spinner /> : null}
          {saving ? 'Sauvegarde…' : 'Sauvegarder les paramètres'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-gold/25 font-georgia text-sm text-mist hover:text-deep">
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── ExceptionsEditor ──────────────────────────────────────────────────────────

function ExceptionsEditor({ exceptions, practitionerId, session, onChanged }) {
  const [list, setList] = useState(exceptions || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ exception_date: '', exception_type: 'closed', note: '', slots: [] })
  const [showForm, setShowForm] = useState(false)
  const dateRef = useRef()

  useEffect(() => { setList(exceptions || []) }, [exceptions])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.exception_date) { setError('Date requise'); return }
    setError(null)
    setSaving(true)
    try {
      const body = {
        practitioner_id: practitionerId,
        exception_date: form.exception_date,
        exception_type: form.exception_type,
        note: form.note || null,
        slots: form.exception_type === 'modified' && form.slots.length ? form.slots : null,
      }
      const res = await fetch('/api/rdv-admin?action=exceptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erreur'); setSaving(false); return }
      const updated = data.exception
      setList(prev => {
        const idx = prev.findIndex(x => x.exception_date === updated.exception_date)
        return idx >= 0 ? prev.map((x, i) => i === idx ? updated : x) : [...prev, updated]
          .sort((a, b) => a.exception_date.localeCompare(b.exception_date))
      })
      setForm({ exception_date: '', exception_type: 'closed', note: '', slots: [] })
      setShowForm(false)
      if (onChanged) onChanged()
    } catch {
      setError('Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(exc) {
    if (!window.confirm(`Supprimer l'exception du ${exc.exception_date} ?`)) return
    try {
      const res = await fetch(`/api/rdv-admin?action=exceptions&id=${exc.id}`, {
        method: 'DELETE',
        headers: authHeader(session),
      })
      if (res.ok) {
        setList(prev => prev.filter(x => x.id !== exc.id))
        if (onChanged) onChanged()
      }
    } catch {
      // Non-fatal
    }
  }

  const inputCls = "border border-gold/20 rounded-xl px-3 py-2 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60 w-full"

  return (
    <div>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800 mb-3">{error}</div>
      )}

      {list.length === 0 && !showForm && (
        <p className="font-georgia text-xs text-mist/50 italic mb-3">Aucune exception — congés, jours fériés, fermetures ponctuelles.</p>
      )}

      {list.length > 0 && (
        <div className="space-y-2 mb-3">
          {list.map(exc => (
            <div key={exc.id} className="rounded-xl border border-gold/15 bg-white/30 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <span className="font-georgia text-sm font-semibold text-deep mr-3">{exc.exception_date}</span>
                <span className={`font-georgia text-[10px] uppercase tracking-wide rounded-full px-2.5 py-0.5 ${
                  exc.exception_type === 'closed' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {exc.exception_type === 'closed' ? 'Fermé' : 'Horaires modifiés'}
                </span>
                {exc.note && <span className="font-georgia text-xs text-mist ml-2 italic">{exc.note}</span>}
              </div>
              <button
                onClick={() => handleDelete(exc)}
                className="font-georgia text-xs text-red-500 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleAdd} className="rounded-xl border border-gold/20 bg-white/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-georgia text-[11px] text-mist block mb-1">Date *</label>
              <input type="date" ref={dateRef} value={form.exception_date}
                onChange={e => setForm(f => ({ ...f, exception_date: e.target.value }))}
                className={inputCls} required />
            </div>
            <div>
              <label className="font-georgia text-[11px] text-mist block mb-1">Type</label>
              <select value={form.exception_type}
                onChange={e => setForm(f => ({ ...f, exception_type: e.target.value }))}
                className={inputCls}>
                <option value="closed">Fermeture complète</option>
                <option value="modified">Horaires modifiés</option>
              </select>
            </div>
          </div>
          <div>
            <label className="font-georgia text-[11px] text-mist block mb-1">Note <span className="opacity-60">(facultatif)</span></label>
            <input type="text" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className={inputCls} placeholder="Congés d'été, jour férié…" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 bg-deep text-gold font-georgia text-xs py-2.5 rounded-xl hover:bg-deep/90 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner /> : null}
              {saving ? 'Ajout…' : 'Ajouter l\'exception'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(null) }}
              className="px-4 py-2.5 rounded-xl border border-gold/25 font-georgia text-xs text-mist hover:text-deep">
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="font-georgia text-xs text-gold border border-gold/30 px-4 py-2 rounded-xl hover:bg-gold/10 transition-colors">
          + Ajouter une exception
        </button>
      )}
    </div>
  )
}

// ── RequestsSection ───────────────────────────────────────────────────────────

function RequestsSection({ requests, services, practitionerId, session, onChanged }) {
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({ date: '', time: '', travelFee: '', finalPrice: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState(null)
  const [syncingId, setSyncingId] = useState(null)
  const [error, setError] = useState(null)

  const STATUS_CONFIG = {
    pending:   { label: 'En attente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    contacted: { label: 'Contacté',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    scheduled: { label: 'Planifié',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected:  { label: 'Refusé',     cls: 'bg-red-50 text-red-700 border-red-200' },
    cancelled: { label: 'Annulé',     cls: 'bg-deep/5 text-mist border-gold/20' },
  }

  function statusBadge(status) {
    const s = STATUS_CONFIG[status] || { label: status, cls: 'bg-deep/5 text-mist border-gold/20' }
    return (
      <span className={`font-georgia text-[10px] uppercase tracking-wide rounded-full px-2.5 py-0.5 border ${s.cls}`}>
        {s.label}
      </span>
    )
  }

  async function updateStatus(req, newStatus) {
    setUpdating(req.id)
    setError(null)
    try {
      const res = await fetch('/api/rdv-admin?action=requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({ id: req.id, practitioner_id: practitionerId, status: newStatus }),
      })
      if (res.ok) { onChanged(); setExpandedId(null) }
      else { const d = await res.json(); setError(d.error || 'Erreur') }
    } catch { setError('Erreur réseau') }
    finally { setUpdating(null) }
  }

  async function handleConfirm(req) {
    if (!form.date || !form.time) { setError('Date et heure requises'); return }
    setSaving(true)
    setError(null)
    try {
      const scheduled_at = new Date(`${form.date}T${form.time}:00`).toISOString()
      const res = await fetch('/api/rdv-admin?action=requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({
          id: req.id,
          practitioner_id: practitionerId,
          status: 'scheduled',
          scheduled_at,
          travel_fee_cents:  form.travelFee  ? Math.round(parseFloat(form.travelFee)  * 100) : 0,
          final_price_cents: form.finalPrice ? Math.round(parseFloat(form.finalPrice) * 100) : null,
          practitioner_notes: form.notes || null,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        onChanged()
        setExpandedId(null)
        setForm({ date: '', time: '', travelFee: '', finalPrice: '', notes: '' })
        if (d.google_sync && d.google_sync !== 'synced') {
          setError(
            d.google_sync === 'not_connected'
              ? 'Rendez-vous confirmé. Google Agenda non connecté — synchronisez manuellement depuis la fiche.'
              : 'Rendez-vous confirmé. La synchronisation Google a échoué — relancez-la depuis la fiche.'
          )
        }
      } else {
        setError(d.error || 'Erreur lors de la confirmation')
      }
    } catch { setError('Erreur réseau') }
    finally { setSaving(false) }
  }

  async function handleSyncGoogle(req) {
    setSyncingId(req.id)
    setError(null)
    try {
      const res = await fetch('/api/rdv-admin?action=requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({ id: req.id, practitioner_id: practitionerId, operation: 'sync_google' }),
      })
      const d = await res.json()
      if (res.ok && d.google_sync === 'synced') {
        onChanged()
      } else {
        const msg = d.error || (
          d.google_sync === 'permission_missing'
            ? "Google Agenda n'autorise pas encore MediumIA à créer des événements. Déconnectez puis reconnectez Google Agenda."
            : d.google_sync === 'not_connected'
              ? 'Google Agenda non connecté.'
              : 'Synchronisation Google échouée — réessayez.'
        )
        setError(msg)
      }
    } catch { setError('Erreur réseau lors de la synchronisation Google.') }
    finally { setSyncingId(null) }
  }

  const inp = "border border-gold/20 rounded-xl px-3 py-2 font-georgia text-sm bg-white/80 focus:outline-none focus:border-gold/60 w-full"

  if (!requests || requests.length === 0) {
    return (
      <div className="rounded-xl border border-gold/15 bg-deep/3 px-6 py-8 text-center">
        <p className="font-georgia text-sm text-mist">Aucune demande d'intervention en cours.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">{error}</div>
      )}
      {requests.map(req => {
        const svc = services.find(s => s.id === req.service_id)
        const isExpanded = expandedId === req.id
        const canConfirm = req.status === 'pending' || req.status === 'contacted'

        return (
          <div key={req.id} className="rounded-xl border border-gold/20 bg-white/40 overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/60 transition-colors"
              onClick={() => {
                const next = isExpanded ? null : req.id
                setExpandedId(next)
                setError(null)
                if (next) setForm({ date: '', time: '', travelFee: '', finalPrice: '', notes: req.practitioner_notes || '' })
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="font-georgia text-sm font-semibold text-deep">{req.customer_first_name} {req.customer_last_name}</p>
                <p className="font-georgia text-xs text-mist">{svc?.title || '—'} · {req.city} ({req.postal_code}) · {new Date(req.created_at).toLocaleDateString('fr-FR')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {statusBadge(req.status)}
                <span className="text-mist text-xs select-none">{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-gold/15 px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-georgia">
                  <div><span className="text-mist">Email : </span><a href={`mailto:${req.customer_email}`} className="text-deep underline">{req.customer_email}</a></div>
                  <div><span className="text-mist">Tél : </span><a href={`tel:${req.customer_phone}`} className="text-deep">{req.customer_phone}</a></div>
                  <div className="col-span-2">
                    <span className="text-mist">Adresse : </span>
                    <span className="text-deep">{req.address_line1}{req.address_line2 ? `, ${req.address_line2}` : ''}, {req.postal_code} {req.city}</span>
                  </div>
                  {req.preferred_period && (
                    <div className="col-span-2"><span className="text-mist">Préférence : </span><span className="text-deep italic">{req.preferred_period}</span></div>
                  )}
                  {req.customer_message && (
                    <div className="col-span-2"><span className="text-mist">Message : </span><span className="text-deep italic">{req.customer_message}</span></div>
                  )}
                </div>

                {canConfirm && (
                  <div className="flex flex-wrap gap-2">
                    {req.status === 'pending' && (
                      <button
                        onClick={() => updateStatus(req, 'contacted')}
                        disabled={updating === req.id}
                        className="font-georgia text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                      >
                        Marquer comme contacté
                      </button>
                    )}
                    <button
                      onClick={() => updateStatus(req, 'rejected')}
                      disabled={updating === req.id}
                      className="font-georgia text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                    >
                      Refuser
                    </button>
                    <button
                      onClick={() => updateStatus(req, 'cancelled')}
                      disabled={updating === req.id}
                      className="font-georgia text-xs px-3 py-1.5 rounded-lg border border-gold/25 text-mist hover:text-deep disabled:opacity-50"
                    >
                      Annuler
                    </button>
                  </div>
                )}

                {canConfirm && (
                  <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 space-y-3">
                    <p className="font-georgia text-xs font-semibold text-deep">Planifier et confirmer l'intervention</p>
                    <p className="font-georgia text-[11px] text-mist leading-relaxed">
                      Un rendez-vous MediumIA sera créé, pris en compte dans vos disponibilités, synchronisé avec Google Agenda (si connecté) et un email de confirmation sera envoyé au client.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-georgia text-[11px] text-mist block mb-1">Date *</label>
                        <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className="font-georgia text-[11px] text-mist block mb-1">Heure *</label>
                        <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className={inp} />
                      </div>
                      <div>
                        <label className="font-georgia text-[11px] text-mist block mb-1">Frais de déplacement (€)</label>
                        <input type="number" min="0" step="0.01" value={form.travelFee} onChange={e => setForm(f => ({ ...f, travelFee: e.target.value }))} className={inp} placeholder="0" />
                      </div>
                      <div>
                        <label className="font-georgia text-[11px] text-mist block mb-1">Montant total TTC (€)</label>
                        <input type="number" min="0" step="0.01" value={form.finalPrice} onChange={e => setForm(f => ({ ...f, finalPrice: e.target.value }))} className={inp} placeholder={svc?.price_cents ? (svc.price_cents / 100).toFixed(0) : ''} />
                      </div>
                      <div className="col-span-2">
                        <label className="font-georgia text-[11px] text-mist block mb-1">Notes internes</label>
                        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp} placeholder="Code d'accès, observations…" />
                      </div>
                    </div>
                    <button
                      onClick={() => handleConfirm(req)}
                      disabled={saving}
                      className="w-full font-georgia text-sm py-3 rounded-xl bg-deep text-gold hover:bg-deep/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {saving && <Spinner />}
                      {saving ? 'Confirmation…' : 'Créer le rendez-vous et confirmer →'}
                    </button>
                  </div>
                )}

                {req.status === 'scheduled' && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1.5">
                    <p className="font-georgia text-xs text-emerald-800 font-semibold">
                      Intervention planifiée le {req.scheduled_at
                        ? new Date(req.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                        : '—'}
                      {req.scheduled_at ? ` à ${new Date(req.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                    {req.final_price_cents != null && (
                      <p className="font-georgia text-xs text-emerald-700">Montant confirmé : {(req.final_price_cents / 100).toFixed(0)} €</p>
                    )}
                    {req.practitioner_notes && (
                      <p className="font-georgia text-xs text-emerald-700 italic">{req.practitioner_notes}</p>
                    )}
                    {req.google_event_id ? (
                      <p className="font-georgia text-xs text-emerald-600">✓ Google Agenda synchronisé</p>
                    ) : (
                      <div className="pt-1">
                        <p className="font-georgia text-xs text-amber-700 mb-1.5">Non synchronisé avec Google Agenda.</p>
                        <button
                          onClick={() => handleSyncGoogle(req)}
                          disabled={syncingId === req.id}
                          className="font-georgia text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {syncingId === req.id && <Spinner />}
                          Synchroniser avec Google
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RdvDashboard({ onBack, onOpenPublic }) {
  const { session, loading: authLoading, signIn, signOut } = useAuth()

  // Dashboard data
  const [meData, setMeData] = useState(null)
  const [meLoading, setMeLoading] = useState(false)
  const [activeSlug, setActiveSlug] = useState(null)

  // Calendar section
  const [calStatus, setCalStatus] = useState(null)
  const [calLoading, setCalLoading] = useState(false)

  // Notifications
  const [notice, setNotice] = useState(null)
  const [resendingBookingId, setResendingBookingId] = useState(null)

  // Editing state
  const [editingService, setEditingService] = useState(null)   // null | 'new' | service object
  const [editingAvail, setEditingAvail] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)

  // OAuth URL notice from redirect
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const success = urlParams.get('oauth_success')
    const err = urlParams.get('oauth_error')
    const practSlug = urlParams.get('practitioner')
    if (success) setNotice({ type: 'success', msg: 'Google Agenda connecté avec succès.' })
    if (err) {
      const msg = err === 'calendar_write_scope_missing'
        ? "Google Agenda est connecté sans autorisation d'écriture. Déconnectez puis reconnectez Google Agenda et acceptez l'autorisation de gestion des événements."
        : `Erreur de connexion Google (${err}). Réessayez.`
      setNotice({ type: 'error', msg })
    }
    if (success || err) window.history.replaceState({}, '', window.location.pathname)
    if (practSlug) setActiveSlug(practSlug)
  }, [])

  // Load me data when session is available
  const loadMe = useCallback(async (sess) => {
    if (!sess) { setMeData(null); return }
    setMeLoading(true)
    try {
      const res = await fetch('/api/rdv-admin?action=me', { headers: authHeader(sess) })
      const data = await res.json()
      if (res.ok) {
        setMeData(data)
        if (data.practitioners?.length > 0 && !activeSlug) {
          const urlSlug = new URLSearchParams(window.location.search).get('practitioner')
          const valid = data.practitioners.find(p => p.slug === urlSlug)
          setActiveSlug(valid?.slug || data.practitioners[0].slug)
        }
      }
    } catch {
      // Non-fatal — dashboard shows empty state
    } finally {
      setMeLoading(false)
    }
  }, [activeSlug])

  async function handleResendConfirmation(booking) {
    if (!window.confirm('Régénérer le lien d’annulation et renvoyer la confirmation à cette personne ?')) return
    setResendingBookingId(booking.id)
    setNotice(null)
    try {
      const response = await fetch('/api/rdv-admin?action=bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({
          id: booking.id,
          practitioner_id: booking.practitioner_id,
          operation: 'resend_confirmation',
        }),
      })
      const data = await response.json()
      if (response.ok && data.email_confirmation === 'sent') {
        setNotice({ type: 'success', msg: 'Confirmation renvoyée. Un nouveau lien d’annulation sécurisé a été créé.' })
      } else {
        setNotice({ type: 'error', msg: data.error || 'Impossible de renvoyer la confirmation.' })
      }
    } catch {
      setNotice({ type: 'error', msg: 'Erreur réseau lors du renvoi de la confirmation.' })
    } finally {
      setResendingBookingId(null)
    }
  }

  useEffect(() => { loadMe(session) }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load calendar status when active practitioner changes
  useEffect(() => {
    if (!activeSlug || !session) return
    let cancelled = false
    setCalStatus(null)
    setCalLoading(true)
    fetch(`/api/google-calendar/status?practitioner=${encodeURIComponent(activeSlug)}`, { headers: authHeader(session) })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setCalStatus(d); setCalLoading(false) } })
      .catch(() => { if (!cancelled) { setCalStatus({ connected: false, reason: 'fetch_error' }); setCalLoading(false) } })
    return () => { cancelled = true }
  }, [activeSlug, session])

  // ── Auth loading ──────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!session) {
    return <LoginForm signIn={signIn} />
  }

  // ── Practitioners ─────────────────────────────────────────────────────────

  const practitioners = meData?.practitioners || []
  const activePractitioner = practitioners.find(p => p.slug === activeSlug)

  // ── Google Calendar actions ────────────────────────────────────────────────

  async function handleConnect() {
    try {
      const res = await fetch(`/api/google-calendar/connect?practitioner=${encodeURIComponent(activeSlug)}`, { headers: authHeader(session) })
      if (res.status === 401 || res.status === 403) {
        setNotice({ type: 'error', msg: 'Authentification Supabase requise. Reconnectez-vous.' })
        return
      }
      if (res.status === 503) {
        const data = await res.json()
        setNotice({ type: 'error', msg: `Variables manquantes : ${(data.missing_env_vars || []).join(', ')}` })
        return
      }
      if (!res.ok) { setNotice({ type: 'error', msg: 'Erreur lors de la préparation OAuth. Réessayez.' }); return }
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setNotice({ type: 'error', msg: 'Erreur réseau lors de la connexion Google.' })
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Déconnecter Google Agenda ? Les créneaux passeront en mode démonstration.')) return
    try {
      const res = await fetch('/api/google-calendar/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: JSON.stringify({ practitioner: activeSlug }),
      })
      const data = await res.json()
      if (res.status === 401 || res.status === 403) {
        setNotice({ type: 'error', msg: 'Authentification requise pour déconnecter Google Agenda.' })
        return
      }
      if (data.disconnected) {
        setCalStatus({ connected: false, reason: 'disconnected' })
        setNotice({ type: 'success', msg: 'Google Agenda déconnecté.' })
      }
    } catch {
      setNotice({ type: 'error', msg: 'Erreur lors de la déconnexion.' })
    }
  }

  // ── Services helpers ──────────────────────────────────────────────────────

  function updatePractitionerData(slug, patchFn) {
    setMeData(prev => ({
      ...prev,
      practitioners: prev.practitioners.map(p => p.slug === slug ? { ...p, ...patchFn(p) } : p),
    }))
  }

  function handleServiceSaved(saved) {
    updatePractitionerData(activeSlug, p => {
      const existing = p.services.findIndex(s => s.id === saved.id)
      return {
        services: existing >= 0
          ? p.services.map(s => s.id === saved.id ? saved : s)
          : [...p.services, saved],
      }
    })
    setEditingService(null)
    setNotice({ type: 'success', msg: 'Prestation sauvegardée.' })
  }

  async function handleDeleteService(svc) {
    if (!window.confirm(`Supprimer "${svc.title}" ? Cette action est irréversible.`)) return
    try {
      const res = await fetch(`/api/rdv-admin?action=services&id=${svc.id}&practitioner_id=${activePractitioner.id}`, {
        method: 'DELETE',
        headers: authHeader(session),
      })
      if (!res.ok) { setNotice({ type: 'error', msg: 'Erreur lors de la suppression.' }); return }
      updatePractitionerData(activeSlug, p => ({ services: p.services.filter(s => s.id !== svc.id) }))
      setNotice({ type: 'success', msg: 'Prestation supprimée.' })
    } catch {
      setNotice({ type: 'error', msg: 'Erreur réseau.' })
    }
  }

  function handleAvailSaved(newRules) {
    updatePractitionerData(activeSlug, () => ({ availability_rules: newRules }))
    setEditingAvail(false)
    setNotice({ type: 'success', msg: 'Disponibilités mises à jour.' })
  }

  function handleSettingsSaved(newSettings) {
    updatePractitionerData(activeSlug, () => newSettings)
    setEditingSettings(false)
    setNotice({ type: 'success', msg: 'Paramètres sauvegardés.' })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-cream text-deep">

      {/* Service modal */}
      {editingService !== null && activePractitioner && (
        <ServiceModal
          service={editingService === 'new' ? null : editingService}
          practitionerId={activePractitioner.id}
          session={session}
          onSave={handleServiceSaved}
          onClose={() => setEditingService(null)}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Espace Pro</button>
            <span className="text-gold/30">·</span>
            <span className="font-georgia text-sm font-semibold text-deep">MediumIA Rendez-vous</span>
          </div>
          <div className="flex items-center gap-3">
            {activeSlug && (
              <button
                onClick={() => onOpenPublic(activeSlug)}
                className="font-georgia text-xs text-gold border border-gold/40 px-4 py-2 rounded-lg hover:bg-gold/10 transition-colors"
              >
                Voir ma page publique →
              </button>
            )}
            <button
              onClick={signOut}
              className="font-georgia text-xs text-mist hover:text-deep border border-gold/20 px-3 py-2 rounded-lg"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10 pb-24">

        <Notice notice={notice} onClose={() => setNotice(null)} />

        {/* Page heading */}
        <div className="mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">MediumIA Rendez-vous</h1>
          <p className="font-georgia text-mist">Votre pratique. Votre agenda. Vos rendez-vous réunis.</p>
        </div>

        {/* Loading */}
        {meLoading && (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        )}

        {/* No practitioners */}
        {!meLoading && practitioners.length === 0 && (
          <div className="rounded-2xl border border-gold/25 bg-white/60 p-10 text-center">
            <p className="text-gold text-3xl mb-4">◈</p>
            <p className="font-georgia text-sm text-mist max-w-sm mx-auto leading-relaxed">
              Aucun profil praticien associé à votre compte. Appliquez le SQL dans Supabase et renseignez <code className="font-mono text-xs bg-white/60 px-1 rounded">owner_id</code> avec votre UUID.
            </p>
          </div>
        )}

        {!meLoading && practitioners.length > 0 && (
          <>
            {/* Practitioner tabs */}
            {practitioners.length > 1 && (
              <div className="flex gap-2 mb-8 flex-wrap">
                {practitioners.map(p => (
                  <button
                    key={p.slug}
                    onClick={() => { setActiveSlug(p.slug); setEditingAvail(false); setEditingSettings(false) }}
                    className={`flex items-center gap-2.5 font-georgia text-sm px-4 py-2.5 rounded-xl border transition-all ${
                      activeSlug === p.slug ? 'bg-deep text-gold border-deep' : 'border-gold/30 text-mist hover:border-gold/60 hover:text-deep'
                    }`}
                  >
                    {p.photo_url && <img src={p.photo_url} alt="" className="w-6 h-6 rounded-full object-cover" />}
                    {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            )}

            {activePractitioner && (
              <div className="grid md:grid-cols-3 gap-5">

                {/* Main column */}
                <div className="md:col-span-2 space-y-5">

                  {/* Google Calendar */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Synchronisation</p>
                        <h2 className="font-georgia text-lg font-medium">Google Agenda</h2>
                      </div>
                      {calLoading
                        ? <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/20 rounded-full px-3 py-1">Chargement…</span>
                        : <StatusBadge status={calStatus?.connected ? 'ok' : 'warn'} />
                      }
                    </div>

                    {calStatus?.connected ? (
                      <>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4">
                          <p className="font-georgia text-xs text-emerald-800 font-semibold mb-0.5">Compte Google connecté</p>
                          <p className="font-georgia text-xs text-emerald-700">{calStatus.email}</p>
                        </div>
                        <p className="font-georgia text-xs text-mist leading-relaxed mb-4">
                          Les créneaux disponibles sont calculés en temps réel à partir de vos indisponibilités Google.
                        </p>
                        <button
                          onClick={handleDisconnect}
                          className="font-georgia text-xs px-5 py-2.5 rounded-xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                        >
                          Déconnecter Google Agenda
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="font-georgia text-sm text-mist leading-relaxed mb-4">
                          Connectez votre compte Google pour que vos indisponibilités soient lues automatiquement. Seule la lecture des plages occupées est utilisée.
                        </p>
                        {calStatus?.reason === 'supabase_not_configured' && (
                          <div className="rounded-xl border border-gold/15 bg-deep/5 px-4 py-3 mb-4 font-georgia text-xs">
                            <p className="text-mist mb-1">Variables serveur manquantes</p>
                            <code className="text-deep font-mono text-[10px]">GOOGLE_CLIENT_ID · GOOGLE_REDIRECT_URI · CALENDAR_TOKEN_ENCRYPTION_KEY (64 hex)</code>
                          </div>
                        )}
                        <button
                          onClick={handleConnect}
                          className="font-georgia text-xs px-5 py-2.5 rounded-xl bg-deep text-gold hover:bg-deep/90 transition-colors"
                        >
                          Connecter Google Agenda →
                        </button>
                      </>
                    )}
                  </section>

                  {/* Services */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Prestations</p>
                        <h2 className="font-georgia text-lg font-medium">{activePractitioner.name}</h2>
                      </div>
                      <button
                        onClick={() => setEditingService('new')}
                        className="font-georgia text-xs px-4 py-2 rounded-xl bg-deep text-gold hover:bg-deep/90 transition-colors"
                      >
                        + Ajouter
                      </button>
                    </div>

                    {activePractitioner.services.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gold/25 px-6 py-8 text-center">
                        <p className="font-georgia text-xs text-mist">Aucune prestation — cliquez sur Ajouter pour commencer.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activePractitioner.services.map(svc => (
                          <div key={svc.id} className={`rounded-xl border p-4 flex items-start gap-4 ${svc.is_active ? 'border-gold/20 bg-white/40' : 'border-gold/10 bg-deep/3 opacity-60'}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center flex-wrap gap-2 mb-1.5">
                                <p className="font-georgia text-sm font-semibold text-deep">{svc.title}</p>
                                {!svc.is_active && (
                                  <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/15 rounded px-2 py-0.5">Inactif</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 font-georgia text-xs text-mist mb-1.5">
                                <span>⏱ {svc.duration_min} min</span>
                                <span>·</span>
                                <span>{formatPrice(svc.price_cents)}</span>
                                {svc.modality?.length > 0 && <><span>·</span><span>{svc.modality.join(', ')}</span></>}
                              </div>
                              {svc.description && (
                                <p className="font-georgia text-xs text-mist/80 leading-relaxed line-clamp-2">{svc.description}</p>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                              <button
                                onClick={() => setEditingService(svc)}
                                className="font-georgia text-xs text-deep border border-gold/25 px-3 py-1.5 rounded-lg hover:bg-gold/10"
                              >
                                Modifier
                              </button>
                              <button
                                onClick={() => handleDeleteService(svc)}
                                className="font-georgia text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50"
                              >
                                Supprimer
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Availability */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Disponibilités</p>
                        <h2 className="font-georgia text-lg font-medium">Plages hebdomadaires</h2>
                      </div>
                      {!editingAvail && (
                        <button
                          onClick={() => setEditingAvail(true)}
                          className="font-georgia text-xs px-4 py-2 rounded-xl border border-gold/25 text-deep hover:border-gold/60"
                        >
                          Modifier
                        </button>
                      )}
                    </div>

                    {editingAvail ? (
                      <AvailabilityEditor
                        rules={activePractitioner.availability_rules}
                        practitionerId={activePractitioner.id}
                        session={session}
                        onSave={handleAvailSaved}
                        onCancel={() => setEditingAvail(false)}
                      />
                    ) : activePractitioner.availability_rules.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gold/25 px-6 py-8 text-center">
                        <p className="font-georgia text-xs text-mist">Aucune plage définie — cliquez sur Modifier pour configurer vos disponibilités.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {DAYS.map((dayLabel, dayIdx) => {
                          const slots = activePractitioner.availability_rules.filter(r => r.day_of_week === dayIdx)
                          return (
                            <div key={dayIdx} className="flex items-center gap-4 py-2 border-b border-gold/10 last:border-0">
                              <span className="font-georgia text-xs font-semibold text-deep w-8 shrink-0">{dayLabel}</span>
                              {slots.length === 0 ? (
                                <span className="font-georgia text-xs text-mist/40 italic">Indisponible</span>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {slots.map((s, i) => (
                                    <span key={i} className="font-georgia text-xs bg-gold/10 border border-gold/20 px-2.5 py-1 rounded-lg text-deep">
                                      {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  {/* Demandes de déplacement */}
                  {(activePractitioner.pending_requests?.length > 0 ||
                    activePractitioner.services?.some(s => s.booking_mode === 'request')) && (
                    <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Déplacements</p>
                          <h2 className="font-georgia text-lg font-medium">Demandes d'intervention</h2>
                        </div>
                        {activePractitioner.pending_requests?.filter(r => r.status === 'pending').length > 0 && (
                          <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                            {activePractitioner.pending_requests.filter(r => r.status === 'pending').length} en attente
                          </span>
                        )}
                      </div>
                      <RequestsSection
                        requests={activePractitioner.pending_requests || []}
                        services={activePractitioner.services || []}
                        practitionerId={activePractitioner.id}
                        session={session}
                        onChanged={() => loadMe(session)}
                      />
                    </section>
                  )}

                  {/* Upcoming bookings */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Agenda</p>
                        <h2 className="font-georgia text-lg font-medium">Prochains rendez-vous</h2>
                      </div>
                      {activePractitioner.upcoming_bookings?.length > 0 && (
                        <StatusBadge status="ok" />
                      )}
                    </div>

                    {!activePractitioner.upcoming_bookings?.length ? (
                      <div className="rounded-xl border border-gold/15 bg-deep/3 px-6 py-10 text-center">
                        <p className="text-gold text-3xl mb-3">◈</p>
                        <p className="font-georgia text-sm text-mist leading-relaxed max-w-xs mx-auto">
                          Aucun rendez-vous à venir. Les réservations apparaîtront ici une fois le module activé.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activePractitioner.upcoming_bookings.map(b => {
                          const svc = activePractitioner.services.find(s => s.id === b.service_id)
                          const date = new Date(b.starts_at)
                          return (
                            <div key={b.id} className="rounded-xl border border-gold/15 bg-white/40 px-4 py-3 flex items-center justify-between gap-4">
                              <div>
                                <p className="font-georgia text-sm font-semibold text-deep">{b.customer_first_name} {b.customer_last_name}</p>
                                <p className="font-georgia text-xs text-mist">{svc?.title || '—'} · {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                              <button
                                onClick={() => handleResendConfirmation(b)}
                                disabled={resendingBookingId === b.id}
                                className="font-georgia text-xs text-gold border border-gold/30 px-3 py-1.5 rounded-lg hover:bg-gold/10 disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                              >
                                {resendingBookingId === b.id && <Spinner />}
                                Renvoyer la confirmation
                              </button>
                              {b.google_meet_link && (
                                <a href={b.google_meet_link} target="_blank" rel="noreferrer" className="font-georgia text-xs text-gold border border-gold/30 px-3 py-1.5 rounded-lg hover:bg-gold/10 shrink-0">
                                  Meet →
                                </a>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  {/* Exceptions / congés */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
                    <div className="mb-5">
                      <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Fermetures & Congés</p>
                      <h2 className="font-georgia text-lg font-medium">Exceptions ponctuelles</h2>
                      <p className="font-georgia text-xs text-mist mt-1">Ces jours seront bloqués dans le calendrier de réservation.</p>
                    </div>
                    <ExceptionsEditor
                      exceptions={activePractitioner.exceptions || []}
                      practitionerId={activePractitioner.id}
                      session={session}
                      onChanged={() => loadMe(session)}
                    />
                  </section>
                </div>

                {/* Side column */}
                <div className="space-y-5">

                  {/* Settings */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold">Paramètres</p>
                      {!editingSettings && (
                        <button
                          onClick={() => setEditingSettings(true)}
                          className="font-georgia text-[10px] text-deep border border-gold/20 px-2.5 py-1 rounded-lg hover:border-gold/50"
                        >
                          Modifier
                        </button>
                      )}
                    </div>

                    {editingSettings ? (
                      <SettingsEditor
                        practitioner={activePractitioner}
                        session={session}
                        onSave={handleSettingsSaved}
                        onCancel={() => setEditingSettings(false)}
                      />
                    ) : (
                      <>
                        {[
                          ['Fuseau horaire', activePractitioner.timezone || '—'],
                          ['Horizon', activePractitioner.booking_horizon_days != null ? `${activePractitioner.booking_horizon_days} j` : 'Non configuré'],
                          ['Tampon avant', activePractitioner.buffer_before_min != null ? `${activePractitioner.buffer_before_min} min` : '—'],
                          ['Tampon après', activePractitioner.buffer_after_min != null ? `${activePractitioner.buffer_after_min} min` : '—'],
                          ['Délai min.', activePractitioner.min_advance_hours != null ? `${activePractitioner.min_advance_hours} h` : '—'],
                          ['Max/jour', activePractitioner.max_per_day != null ? activePractitioner.max_per_day : 'Illimité'],
                        ].map(([label, val]) => (
                          <div key={label} className="flex items-center justify-between py-2 border-b border-gold/10 last:border-0">
                            <span className="font-georgia text-xs text-mist">{label}</span>
                            <span className="font-georgia text-xs font-semibold text-deep">{val}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-2 mt-1">
                          <span className="font-georgia text-xs text-mist">Réservations</span>
                          <span className={`font-georgia text-[10px] uppercase tracking-wide rounded-full px-3 py-1 ${
                            activePractitioner.booking_enabled
                              ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                              : 'text-mist bg-deep/5 border border-gold/20'
                          }`}>
                            {activePractitioner.booking_enabled ? '✓ Ouvertes' : '— Fermées'}
                          </span>
                        </div>
                      </>
                    )}
                  </section>

                  {/* Public page */}
                  <section
                    className="rounded-2xl border-2 border-gold/35 p-5"
                    style={{ background: 'linear-gradient(135deg,rgba(201,168,76,.08),rgba(201,168,76,.02))' }}
                  >
                    <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-2">Page publique</p>
                    <p className="font-georgia text-xs text-mist leading-relaxed mb-4">
                      Votre page de réservation — aucune connexion requise pour vos clients.
                    </p>
                    <code className="font-mono text-[10px] text-deep bg-white/60 border border-gold/20 px-3 py-1.5 rounded-lg block mb-4 break-all">
                      /rdv/{activeSlug}
                    </code>
                    <button
                      onClick={() => onOpenPublic(activeSlug)}
                      className="font-georgia text-xs font-bold text-gold w-full text-center hover:text-gold/80 transition-colors"
                    >
                      Voir ma page publique →
                    </button>
                  </section>

                  {/* Account */}
                  <section className="rounded-2xl border border-gold/25 bg-white/60 p-5">
                    <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-3">Compte</p>
                    <p className="font-georgia text-xs text-mist leading-relaxed mb-3 break-all">
                      {session.user?.email}
                    </p>
                    <button
                      onClick={signOut}
                      className="font-georgia text-xs text-mist border border-gold/20 px-3 py-2 rounded-xl hover:border-gold/40 w-full"
                    >
                      Déconnexion
                    </button>
                  </section>

                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
