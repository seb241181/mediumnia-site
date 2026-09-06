import { useEffect, useMemo, useState } from 'react'

const RANGE_OPTIONS = [7, 30, 90]

const LABELS = {
  home_view: 'Visites accueil',
  home_door_click: 'Clics depuis l’accueil',
  ecosystem_door_click: 'Passerelles internes',
  chronosphere_example_view: 'Vues exemple Chronosphère',
  chronosphere_example_cta: 'Clics depuis l’exemple',
  chronosphere_payment_opened: 'Paiements Chronosphère ouverts',
}

function authHeader(session) {
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function pct(value, total) {
  if (!total) return '—'
  return `${Math.round((value / total) * 100)} %`
}

function MetricCard({ eyebrow, value, note }) {
  return (
    <article className="rounded-2xl border border-gold/20 bg-white/65 p-5 shadow-[0_8px_24px_rgba(26,21,53,.04)]">
      <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">{eyebrow}</p>
      <p className="mt-2 font-georgia text-3xl font-medium text-deep">{Number(value || 0).toLocaleString('fr-FR')}</p>
      {note && <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">{note}</p>}
    </article>
  )
}

function FunnelRow({ label, value, reference, detail }) {
  const width = reference > 0 ? Math.max(5, Math.min(100, (value / reference) * 100)) : 0
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-georgia text-sm font-medium text-deep">{label}</p>
          {detail && <p className="mt-0.5 font-georgia text-[11px] text-mist">{detail}</p>}
        </div>
        <p className="font-georgia text-sm font-semibold text-deep">{Number(value || 0).toLocaleString('fr-FR')}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-deep/[.06]">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function MiniBars({ daily }) {
  const max = Math.max(1, ...daily.map(d => d.total || 0))
  return (
    <div className="flex h-36 items-end gap-1.5 overflow-hidden pt-4">
      {daily.map(day => {
        const height = Math.max(4, Math.round(((day.total || 0) / max) * 112))
        const label = new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        return (
          <div key={day.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="relative flex w-full justify-center">
              <div className="w-full max-w-5 rounded-t-md bg-gold/75 transition-opacity group-hover:bg-gold" style={{ height }} />
              <span className="pointer-events-none absolute -top-7 hidden rounded-md bg-deep px-2 py-1 font-georgia text-[10px] text-cream shadow-lg group-hover:block">
                {day.total || 0}
              </span>
            </div>
            <span className="hidden font-georgia text-[9px] text-mist sm:block">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function PilotageDashboard({ session }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/rdv-admin?action=analytics&days=${days}`, { headers: authHeader(session) })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'pilotage_indisponible')
        return body
      })
      .then(body => {
        if (!cancelled) {
          setData(body)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'pilotage_indisponible')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [session, days])

  const totals = data?.totals || {}
  const homeDoors = data?.home_doors || {}
  const daily = data?.daily || []

  const homeClicks = Object.values(homeDoors).reduce((sum, value) => sum + Number(value || 0), 0)
  const chronoClicks = Number(homeDoors.chronosphere || 0)
  const exampleViews = Number(totals.chronosphere_example_view || 0)
  const exampleCta = Number(totals.chronosphere_example_cta || 0)
  const paymentOpened = Number(totals.chronosphere_payment_opened || 0)
  const homeViews = Number(totals.home_view || 0)

  const keyRows = useMemo(() => (
    Object.entries(totals)
      .filter(([event]) => LABELS[event])
      .sort((a, b) => Number(b[1]) - Number(a[1]))
  ), [totals])

  if (loading) {
    return (
      <div className="rounded-2xl border border-gold/20 bg-white/60 px-6 py-16 text-center">
        <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-gold/25 border-t-gold" />
        <p className="mt-4 font-georgia text-sm text-mist">Chargement du pilotage MediumIA…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
        <p className="font-georgia text-sm font-semibold text-red-800">Pilotage indisponible</p>
        <p className="mt-2 font-georgia text-xs leading-relaxed text-red-700">
          Cet espace est réservé à l’administration de la plateforme MediumIA. ({error})
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gold/25 bg-deep px-6 py-6 text-cream md:px-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">PILOTAGE MEDIUMIA</p>
            <h2 className="mt-2 font-georgia text-2xl font-medium md:text-3xl">Voir ce que font réellement les visiteurs.</h2>
            <p className="mt-2 max-w-2xl font-georgia text-sm leading-relaxed text-cream/65">
              Des compteurs agrégés pour comprendre les portes qui attirent, les passages vers Chronosphère et les étapes qui méritent d’être améliorées.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {RANGE_OPTIONS.map(option => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={`rounded-lg border px-3 py-2 font-georgia text-xs transition-colors ${days === option ? 'border-gold bg-gold text-deep' : 'border-gold/30 text-gold hover:bg-white/[.05]'}`}
              >
                {option} j
              </button>
            ))}
          </div>
        </div>
        {data?.preview && (
          <div className="mt-5 rounded-xl border border-gold/30 bg-gold/[.08] px-4 py-3">
            <p className="font-georgia text-xs text-gold">Aperçu Preview · données de démonstration uniquement. La production affichera les vrais compteurs MediumIA.</p>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard eyebrow="Accueil" value={homeViews} note={`Sur les ${days} derniers jours`} />
        <MetricCard eyebrow="Chronosphère" value={chronoClicks} note={`${pct(chronoClicks, homeClicks)} des clics guidés de l’accueil`} />
        <MetricCard eyebrow="Exemple Chronosphère" value={exampleViews} note={`${exampleCta.toLocaleString('fr-FR')} clics vers le tirage`} />
        <MetricCard eyebrow="Paiement ouvert" value={paymentOpened} note={`${pct(paymentOpened, exampleCta || chronoClicks)} après l’étape précédente`} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">
          <div className="mb-6">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">PARCOURS CHRONOSPHÈRE</p>
            <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Entonnoir de découverte</h3>
            <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">Ces repères donnent une direction de conversion ; ils ne suivent pas individuellement les personnes.</p>
          </div>
          <div className="space-y-5">
            <FunnelRow label="Visites de l’accueil" value={homeViews} reference={homeViews} />
            <FunnelRow label="Choix Chronosphère depuis l’accueil" value={chronoClicks} reference={homeViews} detail={pct(chronoClicks, homeViews)} />
            <FunnelRow label="Exemple consulté" value={exampleViews} reference={homeViews} detail={pct(exampleViews, homeViews)} />
            <FunnelRow label="Clic “Faire mon tirage”" value={exampleCta} reference={homeViews} detail={pct(exampleCta, exampleViews)} />
            <FunnelRow label="Étape paiement ouverte" value={paymentOpened} reference={homeViews} detail={pct(paymentOpened, exampleCta || chronoClicks)} />
          </div>
        </article>

        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">PORTES D’ENTRÉE</p>
          <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Ce que les visiteurs recherchent</h3>
          <div className="mt-6 space-y-4">
            {['oracle', 'chronosphere', 'reseau', 'formation'].map(key => {
              const labels = { oracle: 'Oracle', chronosphere: 'Chronosphère', reseau: 'Réseau', formation: 'Formation' }
              const value = Number(homeDoors[key] || 0)
              return (
                <div key={key}>
                  <div className="mb-1.5 flex justify-between gap-4">
                    <span className="font-georgia text-sm text-deep">{labels[key]}</span>
                    <span className="font-georgia text-xs text-mist">{value} · {pct(value, homeClicks)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-deep/[.06]">
                    <div className="h-full rounded-full bg-gold/75" style={{ width: homeClicks ? `${Math.max(3, (value / homeClicks) * 100)}%` : '0%' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </article>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">ACTIVITÉ</p>
              <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Évolution quotidienne</h3>
            </div>
            <p className="font-georgia text-[10px] text-mist">Actions mesurées / jour</p>
          </div>
          {daily.length ? <MiniBars daily={daily} /> : <p className="mt-8 font-georgia text-sm text-mist">Pas encore assez de données.</p>}
        </article>

        <article className="rounded-2xl border border-gold/20 bg-white/65 p-6">
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">DÉTAIL</p>
          <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Compteurs de la période</h3>
          <div className="mt-5 divide-y divide-gold/15">
            {keyRows.map(([event, value]) => (
              <div key={event} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <span className="font-georgia text-xs text-mist">{LABELS[event]}</span>
                <strong className="font-georgia text-sm text-deep">{Number(value || 0).toLocaleString('fr-FR')}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <p className="font-georgia text-[10px] leading-relaxed text-mist/70">
        MediumIA conserve ici uniquement des compteurs agrégés par jour, type d’action et origine. Ce tableau ne permet pas d’identifier ni de suivre un visiteur individuel.
      </p>
    </div>
  )
}
