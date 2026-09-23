import { useEffect, useMemo, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'
import { chronosphereMaxDemoProfile, chronosphereMaxDemoTimeline, chronosphereMaxDemoTimelines } from '../data/chronosphereMaxDemo.js'
import { getSolarTemperament } from '../../lib/chronosphereSolarTemperament.js'
import { summarizeChronosphereLine } from '../../lib/chronosphereMaxCompare.js'
import { useAuth } from '../lib/useAuth.js'

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function shortDate(value) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date)
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('mediumia-paypal-sdk')
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('paypal_sdk_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = 'mediumia-paypal-sdk'
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
    script.onload = resolve
    script.onerror = () => reject(new Error('paypal_sdk_load_failed'))
    document.head.appendChild(script)
  })
}

function maxTokenKey(userId) {
  return userId ? `chronosphere_max_packToken:${userId}` : ''
}

function maxPendingKey(userId) {
  return userId ? `chronosphere_max_pending:${userId}` : ''
}

function followedDays(createdAt) {
  if (!createdAt) return 0
  const start = new Date(createdAt)
  if (Number.isNaN(start.getTime())) return 0
  return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1)
}

function normalizeLiveTimeline(value) {
  if (!value) return null
  const entries = (value.entries || []).map((entry) => ({
    id: entry.id,
    timelineTitle: value.title,
    sequenceNumber: entry.sequenceNumber,
    readAt: entry.readAt,
    snapshot: entry.snapshot,
  }))
  const last = value.entries?.at?.(-1) || value.entries?.[value.entries.length - 1]
  return {
    id: value.id,
    title: value.title,
    theme: value.theme,
    status: value.status,
    followedSinceDays: followedDays(value.createdAt),
    lastReadingLabel: last?.readAt ? formatDate(last.readAt) : 'Pas encore commencée',
    entries,
    comparison: last?.comparison || { summary: { persistent: [], moved: [], opened: [], noLongerAppears: [] } },
    finalSynthesis: entries.length >= 3 ? summarizeChronosphereLine(entries) : null,
  }
}

function FactCard({ fact }) {
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/85 p-4 shadow-sm md:p-5">
      <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">{fact.label}</p>
      <div className="mt-3 space-y-3 font-georgia text-sm leading-relaxed text-deep/78">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Donnée comparée</p>
          <p className="mt-1 text-deep">{fact.dataCompared}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Interprétation symbolique</p>
          <p className="mt-1">{fact.symbolicInterpretation}</p>
        </div>
      </div>
    </article>
  )
}

function SolarTemperamentPanel({ sign, timelineTitle }) {
  const temperament = getSolarTemperament(sign)
  if (!temperament) return null

  const traits = [
    ['Force naturelle', temperament.naturalForce],
    ['Réflexe sous tension', temperament.tensionReflex],
    ['Façon d’avancer', temperament.movement],
    ['Point de vigilance', temperament.vigilance],
  ]

  return (
    <section className="rounded-3xl border-2 border-gold/60 bg-gradient-to-br from-white via-cream to-gold/[.08] p-5 shadow-md md:p-8">
      <div className="grid gap-6 md:grid-cols-[.72fr_1.28fr] md:items-start">
        <div className="rounded-3xl border border-gold/30 bg-deep p-6 text-cream">
          <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Votre tempérament solaire</p>
          <div className="mt-5 flex items-center gap-4">
            <span className="font-georgia text-6xl leading-none text-gold" aria-hidden="true">{temperament.symbol}</span>
            <div>
              <h2 className="font-georgia text-3xl font-medium">{temperament.sign}</h2>
              <p className="mt-1 font-georgia text-sm text-cream/65">{temperament.element} · {temperament.modality}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {temperament.keywords.map((keyword) => (
              <span key={keyword} className="rounded-full border border-gold/25 bg-white/[.06] px-3 py-1 font-georgia text-xs text-cream/80">
                {keyword}
              </span>
            ))}
          </div>
          <p className="mt-5 font-georgia text-xs leading-relaxed text-cream/55">
            Lecture symbolique du signe solaire : un langage de tempérament, pas une vérité psychologique ni un diagnostic.
          </p>
        </div>

        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Signature personnelle</p>
          <h2 className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep md:text-3xl">Comment votre signe colore votre manière de traverser le temps.</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {traits.map(([label, text]) => (
              <article key={label} className="rounded-2xl border border-gold/20 bg-white/75 p-4">
                <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">{label}</p>
                <p className="mt-2 font-georgia text-sm leading-relaxed text-deep/75">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-gold/25 bg-white/80 p-5">
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Votre rythme de bifurcation</p>
          <h3 className="mt-2 font-georgia text-xl font-medium text-deep">{temperament.bifurcationRhythm?.label}</h3>
          <p className="mt-3 font-georgia text-sm leading-relaxed text-deep/76">{temperament.bifurcationRhythm?.text}</p>
        </article>
        <article className="rounded-2xl border border-deep bg-deep p-5 text-cream">
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Votre signature ChronoSphère</p>
          <p className="mt-3 font-georgia text-lg italic leading-relaxed text-cream/90">« {temperament.signatureQuote} »</p>
          <p className="mt-4 font-georgia text-xs text-cream/55">{temperament.element} : {temperament.elementPath}.</p>
        </article>
      </div>

      <div className="mt-4 rounded-2xl border border-gold/25 bg-white/80 p-5">
        <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Comment ce tempérament colore cette Ligne de Temps</p>
        <p className="mt-2 font-georgia text-sm text-mist">{timelineTitle}</p>
        <p className="mt-3 max-w-4xl font-georgia text-base leading-relaxed text-deep/78">{temperament.lineTimeLens}</p>
      </div>
    </section>
  )
}

function TimelineCard({ timeline, selected, onSelect }) {
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${selected ? 'border-gold bg-gold/[.08]' : 'border-gold/20 bg-white/75'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Ligne de Temps</p>
          <h2 className="mt-1 font-georgia text-2xl font-medium leading-tight text-deep">{timeline.title}</h2>
        </div>
        <span className="rounded-full border border-gold/25 bg-cream px-3 py-1 font-georgia text-[11px] text-mist">
          {timeline.status === 'active' ? 'Active' : 'Clôturée'}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-cream/80 p-3">
          <p className="font-georgia text-xl text-deep">{timeline.entries.length}</p>
          <p className="font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">lectures</p>
        </div>
        <div className="rounded-xl bg-cream/80 p-3">
          <p className="font-georgia text-xl text-deep">{timeline.followedSinceDays}</p>
          <p className="font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">jours</p>
        </div>
        <div className="rounded-xl bg-cream/80 p-3">
          <p className="font-georgia text-xl text-deep">V2</p>
          <p className="font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">source</p>
        </div>
      </div>
      <p className="mt-4 font-georgia text-sm text-mist">Dernière lecture : {timeline.lastReadingLabel}</p>
      <button onClick={() => onSelect(timeline.id)} className="mt-5 w-full rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90">
        Continuer cette Ligne de Temps
      </button>
    </article>
  )
}

function SequenceRail({ entries }) {
  return (
    <section className="rounded-3xl border border-gold/25 bg-white/75 p-5 md:p-7">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Mémoire de lecture</p>
          <h2 className="mt-1 font-georgia text-2xl font-medium text-deep md:text-3xl">Trajectoire suivie</h2>
        </div>
        <p className="font-georgia text-xs text-mist">Snapshots compacts, sans profil natal dupliqué.</p>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-2xl border border-gold/20 bg-cream/75 p-4">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Lecture {entry.sequenceNumber}</p>
            <p className="mt-1 font-georgia text-sm text-mist">{formatDate(entry.readAt)}</p>
            <h3 className="mt-3 font-georgia text-lg font-medium text-deep">{entry.snapshot.mainCard?.name}</h3>
            <p className="mt-2 font-georgia text-sm leading-relaxed text-deep/72">{entry.snapshot.synthesis}</p>
            <p className="mt-3 font-georgia text-xs text-gold">
              Fenêtre : {shortDate(entry.snapshot.timing?.primary?.start)} {'>'} {shortDate(entry.snapshot.timing?.primary?.end)}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function ComparisonPanel({ comparison }) {
  const groups = [
    ['Ce qui persiste', comparison.summary.persistent],
    ['Ce qui a bougé', comparison.summary.moved],
    ['Ce qui s’ouvre', comparison.summary.opened],
    ['Ce qui ne ressort plus', comparison.summary.noLongerAppears],
  ]

  return (
    <section className="rounded-3xl border-2 border-gold bg-gold/[.08] p-5 shadow-md md:p-8">
      <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Depuis votre dernière lecture</p>
      <h2 className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep md:text-4xl">Ce que MAX compare vraiment.</h2>
      <p className="mt-3 max-w-3xl font-georgia text-sm leading-relaxed text-deep/72 md:text-base">
        Cette synthèse est construite d’abord par comparaison déterministe des snapshots. L’interprétation reste symbolique et ne transforme jamais le timing en annonce du futur.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {groups.map(([title, facts]) => (
          <div key={title} className="rounded-2xl bg-white/70 p-4">
            <h3 className="font-georgia text-lg font-medium text-deep">{title}</h3>
            <div className="mt-3 grid gap-3">
              {facts.length ? facts.map((fact) => <FactCard key={`${title}-${fact.kind}-${fact.dataCompared}`} fact={fact} />) : (
                <p className="font-georgia text-sm leading-relaxed text-mist">Aucune donnée comparée pertinente sur ce bloc dans la fixture actuelle.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function FinalSynthesis({ timeline }) {
  const synthesis = timeline.finalSynthesis
  if (!synthesis) return null
  return (
    <section className="rounded-3xl border border-deep bg-deep p-6 text-cream shadow-md md:p-8">
      <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Troisième lecture</p>
      <h2 className="mt-2 font-georgia text-2xl font-medium md:text-4xl">Votre Ligne de Temps</h2>
      <p className="mt-4 font-georgia text-base leading-relaxed text-cream/78">{synthesis.synthesis}</p>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-gold/25 p-4">
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">Départ</p>
          <p className="mt-2 font-georgia text-sm text-cream/78">{synthesis.fromTheme}</p>
        </div>
        <div className="rounded-2xl border border-gold/25 p-4">
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">Fenêtre déplacée</p>
          <p className="mt-2 font-georgia text-sm text-cream/78">{shortDate(synthesis.firstWindow)} {'>'} {shortDate(synthesis.currentWindow)}</p>
        </div>
        <div className="rounded-2xl border border-gold/25 p-4">
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">Lectures suivies</p>
          <p className="mt-2 font-georgia text-sm text-cream/78">{synthesis.entriesCount} snapshots comparés</p>
        </div>
      </div>
    </section>
  )
}

export default function ChronosphereMaxPage({ onBack, onNavigate }) {
  const { session, user, loading: authLoading, signIn, signUp } = useAuth()
  const [selectedId, setSelectedId] = useState(chronosphereMaxDemoTimeline.id)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [paypalConfig, setPaypalConfig] = useState(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [packToken, setPackToken] = useState('')
  const [creditState, setCreditState] = useState(null)
  const [liveTimeline, setLiveTimeline] = useState(null)
  const [paymentError, setPaymentError] = useState('')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [drawBusy, setDrawBusy] = useState(false)
  const [drawError, setDrawError] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [pendingReadNonce, setPendingReadNonce] = useState('')
  const [form, setForm] = useState({
    timelineTitle: '',
    fullName: '',
    birthDate: '',
    birthTime: '',
    birthPlace: '',
    theme: 'amour',
    number1: '',
    number2: '',
    number3: '',
    deliveryEmail: '',
  })
  const paypalContainerRef = useRef(null)
  const pendingPaymentRef = useRef(null)

  const selected = useMemo(
    () => chronosphereMaxDemoTimelines.find((timeline) => timeline.id === selectedId) || chronosphereMaxDemoTimeline,
    [selectedId],
  )

  const activeTimeline = liveTimeline || selected
  const activeSolarSign = liveTimeline
    ? (liveTimeline.entries.at(-1)?.snapshot?.solarSign || null)
    : chronosphereMaxDemoProfile.solarSign

  useEffect(() => {
    fetch('/api/rdv-config?chronospherePayPalAction=config')
      .then(async (res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((data) => setPaypalConfig(data))
      .catch(() => setPaypalConfig(null))
  }, [])

  useEffect(() => {
    if (!user) {
      setPackToken('')
      setCreditState(null)
      setLiveTimeline(null)
      return
    }
    setForm((current) => ({ ...current, deliveryEmail: current.deliveryEmail || user.email || '' }))
    const key = maxTokenKey(user.id)
    const stored = key ? localStorage.getItem(key) || '' : ''
    setPackToken(stored)
  }, [user])

  async function refreshMaxStatus(token = packToken) {
    if (!token || !session?.access_token) return null
    const res = await fetch('/api/rdv-config?chronospherePayPalAction=status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ packToken: token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.valid || data.product !== 'max3') {
      if (res.status === 404 || res.status === 401) {
        try { localStorage.removeItem(maxTokenKey(user?.id)) } catch {}
        setPackToken('')
      }
      return null
    }
    setCreditState({ creditsRemaining: data.creditsRemaining, creditsTotal: data.creditsTotal, status: data.status })
    setLiveTimeline(normalizeLiveTimeline(data.maxTimeline))
    return data
  }

  useEffect(() => {
    if (!packToken || !session?.access_token) return
    refreshMaxStatus(packToken).catch(() => setPaymentError('Impossible de relire votre suivi MAX pour le moment.'))
  }, [packToken, session?.access_token])

  async function handleAuth(mode) {
    setAuthMessage('')
    const email = authEmail.trim()
    if (!email || authPassword.length < 6) {
      setAuthMessage('Indiquez votre e-mail et un mot de passe d’au moins 6 caractères.')
      return
    }
    const action = mode === 'signup' ? signUp : signIn
    const { data, error } = await action(email, authPassword)
    if (error) {
      setAuthMessage(error.message || 'Connexion impossible.')
      return
    }
    if (mode === 'signup' && !data?.session) {
      setAuthMessage('Compte créé. Vérifiez votre e-mail si MediumIA vous demande de confirmer votre adresse.')
    } else {
      setAuthMessage('Connexion réussie.')
    }
  }

  return (
    <div className="cosmic-page cosmic-page--chronosphere min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <button onClick={onBack} className="flex items-center gap-2.5 font-georgia text-sm font-semibold tracking-[0.18em] text-deep">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="h-8 w-auto" />
            MEDIUMIA
          </button>
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← Retour</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20 pt-10 md:pt-14">
        <section className="grid gap-7 md:grid-cols-[.88fr_1.12fr] md:items-end">
          <div>
            <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">ChronoSphère MAX</p>
            <h1 className="mt-3 font-georgia text-4xl font-medium leading-tight md:text-6xl">Mes Lignes de Temps</h1>
            <p className="mt-5 max-w-xl font-georgia text-base leading-relaxed text-deep/74 md:text-lg">
              MAX suit une situation dans le temps. Chaque lecture ajoute un snapshot compact, puis le moteur compare ce qui persiste, se déplace, disparaît ou s’ouvre.
            </p>
          </div>
          <aside className="rounded-3xl border border-gold/30 bg-white/75 p-5">
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Compte MediumIA requis</p>
            <p className="mt-2 font-georgia text-sm leading-relaxed text-deep/72">
              La mémoire MAX est liée au compte connecté. Elle réutilise le profil MediumIA existant et ne stocke pas de coordonnées exactes ni de profil natal dupliqué dans le snapshot.
            </p>
          </aside>
        </section>

        <div className="mt-7">
          <SolarTemperamentPanel sign={chronosphereMaxDemoProfile.solarSign} timelineTitle={selected.title} />
        </div>

        <section className="mt-9 grid gap-4 md:grid-cols-2">
          {chronosphereMaxDemoTimelines.map((timeline) => (
            <TimelineCard key={timeline.id} timeline={timeline} selected={timeline.id === selected.id} onSelect={setSelectedId} />
          ))}
          <article className="rounded-2xl border border-dashed border-gold/45 bg-white/45 p-5">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Nouvelle trajectoire</p>
            <h2 className="mt-1 font-georgia text-2xl font-medium text-deep">Créer une nouvelle Ligne de Temps</h2>
            <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">Une nouvelle situation démarre sa propre mémoire, sans comparaison avec les autres utilisateurs ni mélange entre thèmes.</p>
            <button className="mt-5 w-full rounded-xl border border-gold/45 px-5 py-3 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/[.08]">
              Créer une nouvelle Ligne de Temps
            </button>
          </article>
        </section>

        <div className="mt-7 space-y-5">
          <SequenceRail entries={selected.entries} />
          <ComparisonPanel comparison={selected.comparison} />
          <FinalSynthesis timeline={selected} />
        </div>

        <section className="mt-6 rounded-3xl border border-gold/25 bg-white/75 p-5 md:p-7">
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Fondation Sprint 1</p>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <p className="font-georgia text-sm leading-relaxed text-deep/75">Modèle prévu : `chronosphere_timelines` pour la Ligne de Temps et `chronosphere_timeline_entries` pour chaque snapshot.</p>
            <p className="font-georgia text-sm leading-relaxed text-deep/75">Comparaison serveur déterministe avant toute prose : cartes, contributeurs, domaines, fenêtres et bifurcation.</p>
            <p className="font-georgia text-sm leading-relaxed text-deep/75">Conservation minimale : pas de profil natal dupliqué dans la mémoire MAX, seulement l’essentiel pour rouvrir et comparer.</p>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
