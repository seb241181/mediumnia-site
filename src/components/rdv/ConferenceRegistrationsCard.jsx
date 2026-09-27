import { useCallback, useEffect, useRef, useState } from 'react'
import { previewConferenceStats } from '../../../lib/pilotageConference.js'

// Inscriptions à la conférence, recomptées dans Supabase à chaque appel
// (action=conference-stats). Actualisation toutes les 30 s tant que l'onglet
// est visible, et immédiatement au retour sur l'onglet.
export const CONFERENCE_REFRESH_MS = 30_000

const CHANNEL_LABELS = {
  direct: 'Direct / lien sans suivi',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  newsletter: 'Newsletter',
  email: 'E-mail',
}

const ERROR_LABELS = {
  pilotage_forbidden: 'Accès réservé à l’administration MediumIA.',
  pilotage_access_error: 'Vérification de l’accès impossible pour le moment.',
  conference_data_error: 'Lecture des inscriptions impossible pour le moment.',
}

const fmt = value => Number(value || 0).toLocaleString('fr-FR')

function channelLabel(channel) {
  if (CHANNEL_LABELS[channel]) return CHANNEL_LABELS[channel]
  return channel ? channel.charAt(0).toUpperCase() + channel.slice(1) : 'Autre'
}

function eventDateLabel(startsAt) {
  const date = new Date(startsAt || '')
  if (!Number.isFinite(date.getTime())) return null
  const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
  const hour = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':00', ' h').replace(':', ' h ')
  return `${day} à ${hour}`
}

function timeLabel(value) {
  const date = new Date(value || '')
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' })
}

function sinceLabel(value) {
  const date = new Date(value || '')
  if (!Number.isFinite(date.getTime())) return null
  const sameDay = date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) === new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
  const hour = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
  return sameDay ? `aujourd’hui à ${hour}` : `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} à ${hour}`
}

function Stat({ label, value, note }) {
  return (
    <div className="min-w-0">
      <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">{label}</p>
      <p className="mt-1 font-georgia text-2xl font-medium tabular-nums text-deep">{value}</p>
      {note && <p className="mt-0.5 font-georgia text-[11px] text-mist">{note}</p>}
    </div>
  )
}

function DailyBars({ daily }) {
  const max = Math.max(1, ...daily.map(day => day.total || 0))
  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label={`Inscriptions par jour sur ${daily.length} jours`}>
      {daily.map((day, index) => {
        const isToday = index === daily.length - 1
        const height = day.total ? Math.max(6, Math.round((day.total / max) * 80)) : 2
        const label = new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        return (
          <div key={day.date} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end" title={`${label} : ${day.total} inscription${day.total > 1 ? 's' : ''}`}>
            <div className={`w-full max-w-4 rounded-t ${isToday ? 'bg-gold' : 'bg-gold/45'}`} style={{ height }} />
          </div>
        )
      })}
    </div>
  )
}

export default function ConferenceRegistrationsCard({ session, demoMode = false }) {
  const [stats, setStats] = useState(() => demoMode ? previewConferenceStats() : null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSuccessAt, setLastSuccessAt] = useState(() => demoMode ? new Date().toISOString() : null)
  const inFlight = useRef(null)

  const load = useCallback(async () => {
    if (demoMode) {
      setStats(previewConferenceStats())
      setLastSuccessAt(new Date().toISOString())
      return
    }
    if (!session?.access_token || inFlight.current) return
    const controller = new AbortController()
    inFlight.current = controller
    setRefreshing(true)
    try {
      const res = await fetch('/api/rdv-admin?action=conference-stats', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'conference_data_error')
      setStats(body)
      setError(null)
      setLastSuccessAt(new Date().toISOString())
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err?.message || 'conference_data_error')
    } finally {
      if (inFlight.current === controller) inFlight.current = null
      setRefreshing(false)
    }
  }, [session?.access_token, demoMode])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load()
    }, CONFERENCE_REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [load])

  if (!stats) {
    return (
      <section className="rounded-2xl border border-gold/25 bg-white/70 p-6" aria-busy={!error}>
        <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">INSCRIPTIONS CONFÉRENCE</p>
        <p className="mt-3 font-georgia text-sm text-mist">
          {error ? (ERROR_LABELS[error] || 'Inscriptions indisponibles pour le moment.') : 'Lecture des inscriptions dans Supabase…'}
        </p>
      </section>
    )
  }

  if (!stats.event) {
    return (
      <section className="rounded-2xl border border-gold/25 bg-white/70 p-6">
        <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">INSCRIPTIONS CONFÉRENCE</p>
        <p className="mt-3 font-georgia text-sm text-mist">Aucune conférence publiée pour le moment.</p>
      </section>
    )
  }

  const dateLabel = eventDateLabel(stats.event.starts_at)
  const channels = stats.by_channel || []
  const channelMax = Math.max(1, ...channels.map(item => item.count))
  const stale = Boolean(error)
  const fillPct = stats.fill_rate === null || stats.fill_rate === undefined ? null : Math.round(stats.fill_rate * 1000) / 10
  const last = sinceLabel(stats.last_registration_at)

  return (
    <section className="rounded-2xl border border-gold/35 bg-white/75 p-6 shadow-[0_10px_28px_rgba(26,21,53,.05)] md:p-7" aria-labelledby="pilotage-conference-title">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">INSCRIPTIONS CONFÉRENCE</p>
          <h3 id="pilotage-conference-title" className="mt-1 font-georgia text-xl font-medium text-deep">
            {stats.event.title || 'Conférence MediumIA'}
          </h3>
          {dateLabel && <p className="mt-1 font-georgia text-xs text-mist first-letter:uppercase">{dateLabel}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-georgia text-[11px] ${stats.event.registration_open ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {stats.event.registration_open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-georgia text-[11px] ${stale ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gold/30 bg-cream/70 text-deep'}`} aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'} ${refreshing ? 'animate-pulse' : ''}`} aria-hidden="true" />
            {stale ? `Hors ligne · chiffre de ${timeLabel(lastSuccessAt)}` : `En direct · ${timeLabel(lastSuccessAt)}`}
          </span>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="rounded-full border border-gold/35 px-3 py-1 font-georgia text-[11px] text-deep transition-colors hover:bg-gold/10 disabled:opacity-50"
          >
            Actualiser
          </button>
        </div>
      </div>

      {stats.preview && (
        <p className="mt-4 rounded-xl border border-gold/30 bg-gold/[.08] px-4 py-2.5 font-georgia text-xs text-deep">
          Aperçu Preview · inscriptions de démonstration. En production, le chiffre est lu dans Supabase.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[auto_1fr] lg:items-end">
        <div>
          <p className="font-georgia text-6xl font-medium leading-none tabular-nums text-deep">{fmt(stats.total)}</p>
          <p className="mt-2 font-georgia text-sm text-mist">inscrit{stats.total > 1 ? 's' : ''}{last ? ` · dernière inscription ${last}` : ''}</p>
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Aujourd’hui" value={fmt(stats.today)} note={`Hier : ${fmt(stats.yesterday)}`} />
          <Stat label="7 derniers jours" value={fmt(stats.last_7_days)} />
          <Stat
            label="Places restantes"
            value={stats.capacity === null ? '—' : fmt(stats.remaining)}
            note={stats.capacity === null ? 'Pas de jauge définie' : `sur ${fmt(stats.capacity)} places`}
          />
          <Stat label="Remplissage" value={fillPct === null ? '—' : `${fillPct.toLocaleString('fr-FR')} %`} />
        </div>
      </div>

      {fillPct !== null && (
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-deep/[.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fillPct} aria-label="Taux de remplissage">
          <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${Math.min(100, fillPct)}%` }} />
        </div>
      )}

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">Nouvelles inscriptions · 14 jours</p>
          <div className="mt-3"><DailyBars daily={stats.daily || []} /></div>
          <div className="mt-1 flex justify-between font-georgia text-[10px] text-mist">
            <span>{stats.daily?.[0] ? new Date(`${stats.daily[0].date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}</span>
            <span>aujourd’hui</span>
          </div>
        </div>
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">D’où viennent les inscrits</p>
          {channels.length ? (
            <ul className="mt-3 space-y-2.5">
              {channels.slice(0, 6).map(item => (
                <li key={item.channel}>
                  <div className="mb-1 flex justify-between gap-3 font-georgia text-xs">
                    <span className="text-deep">{channelLabel(item.channel)}</span>
                    <span className="tabular-nums text-mist">{fmt(item.count)} · {Math.round((item.count / Math.max(1, stats.total)) * 100)} %</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-deep/[.06]">
                    <div className="h-full rounded-full bg-gold/75" style={{ width: `${Math.max(3, (item.count / channelMax) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 font-georgia text-xs text-mist">Aucune inscription pour l’instant.</p>
          )}
          <p className="mt-3 font-georgia text-[10px] leading-relaxed text-mist">Canal lu dans le lien de la pub (utm_source=facebook, instagram, tiktok…).</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-gold/15 pt-4 font-georgia text-[11px]">
        <span className="rounded-full border border-gold/25 bg-cream/60 px-3 py-1 text-deep">Carnet envoyé : {fmt(stats.preparation_sent)} / {fmt(stats.total)}</span>
        {stats.preparation_missing > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900">{fmt(stats.preparation_missing)} sans carnet reçu</span>
        )}
        <span className="rounded-full border border-gold/25 bg-cream/60 px-3 py-1 text-deep">Accès Zoom envoyé : {fmt(stats.zoom_sent)}</span>
        {stats.attended > 0 && <span className="rounded-full border border-gold/25 bg-cream/60 px-3 py-1 text-deep">Présents : {fmt(stats.attended)}</span>}
        <span className="rounded-full border border-gold/15 px-3 py-1 text-mist">Annulées : {fmt(stats.cancelled)}</span>
        {stats.excluded_tests > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900">
            {fmt(stats.excluded_tests)} test{stats.excluded_tests > 1 ? 's' : ''} exclu{stats.excluded_tests > 1 ? 's' : ''} du total (occupe{stats.excluded_tests > 1 ? 'nt' : ''} encore une place : à annuler)
          </span>
        )}
        {stats.excluded_invalid > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900">{fmt(stats.excluded_invalid)} ligne{stats.excluded_invalid > 1 ? 's' : ''} invalide{stats.excluded_invalid > 1 ? 's' : ''} exclue{stats.excluded_invalid > 1 ? 's' : ''}</span>
        )}
      </div>

      <p className="mt-4 font-georgia text-[10px] leading-relaxed text-mist/80">
        Source : Supabase, table des inscriptions, recomptée à chaque actualisation (toutes les 30 s, heure de Paris). Hors annulations et inscriptions de test. Aucun nom ni e-mail n’est transmis à cet écran.
      </p>
    </section>
  )
}
