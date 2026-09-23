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
  const day = String(value).slice(0, 10)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00`) : new Date(NaN)
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

// Stored comparison facts keep raw values (ISO dates, "->"); show them readably.
function readableFact(value) {
  return String(value || '')
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (day) => shortDate(day))
    .replace(/\s*->\s*/g, ' → ')
}

function FactCard({ fact }) {
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/85 p-4 shadow-sm md:p-5">
      <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">{fact.label}</p>
      <div className="mt-3 space-y-3 font-georgia text-sm leading-relaxed text-deep/78">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Donnée comparée</p>
          <p className="mt-1 text-deep">{readableFact(fact.dataCompared)}</p>
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
          <p className="font-georgia text-xl text-deep">{timeline.entries.length >= 3 ? '✓' : 3 - timeline.entries.length}</p>
          <p className="font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">{timeline.entries.length >= 3 ? 'synthèse' : 'avant synthèse'}</p>
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
        <p className="font-georgia text-xs text-mist">L’essentiel de chaque lecture, conservé pour comparer.</p>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-2xl border border-gold/20 bg-cream/75 p-4">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Lecture {entry.sequenceNumber}</p>
            <p className="mt-1 font-georgia text-sm text-mist">{formatDate(entry.readAt)}</p>
            <h3 className="mt-3 font-georgia text-lg font-medium text-deep">{entry.snapshot.mainCard?.name}</h3>
            <p className="mt-2 font-georgia text-sm leading-relaxed text-deep/72">{entry.snapshot.synthesis}</p>
            <p className="mt-3 font-georgia text-xs text-gold">
              Fenêtre : du {shortDate(entry.snapshot.timing?.primary?.start)} au {shortDate(entry.snapshot.timing?.primary?.end)}
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
        Cette synthèse compare d’abord, point par point, vos lectures successives : les mêmes données, calculées de la même façon. L’interprétation reste symbolique et ne transforme jamais une période en annonce du futur.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {groups.map(([title, facts]) => (
          <div key={title} className="rounded-2xl bg-white/70 p-4">
            <h3 className="font-georgia text-lg font-medium text-deep">{title}</h3>
            <div className="mt-3 grid gap-3">
              {facts.length ? facts.map((fact) => <FactCard key={`${title}-${fact.kind}-${fact.dataCompared}`} fact={fact} />) : (
                <p className="font-georgia text-sm leading-relaxed text-mist">Rien de significatif sur ce point entre ces deux lectures.</p>
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
          <p className="mt-2 font-georgia text-sm text-cream/78">{shortDate(synthesis.firstWindow)} → {shortDate(synthesis.currentWindow)}</p>
        </div>
        <div className="rounded-2xl border border-gold/25 p-4">
          <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">Lectures suivies</p>
          <p className="mt-2 font-georgia text-sm text-cream/78">{synthesis.entriesCount} lectures comparées</p>
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
  const [pendingPayment, setPendingPayment] = useState(null)
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

  const hasMaxAccess = Boolean(packToken || creditState?.product === 'max3')

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
    try {
      const raw = localStorage.getItem(maxPendingKey(user.id))
      setPendingPayment(raw ? JSON.parse(raw) : null)
    } catch {
      setPendingPayment(null)
    }
  }, [user])

  async function refreshMaxStatus(token = packToken, allowAccountFallback = true) {
    if (!session?.access_token) return null
    const payload = token ? { packToken: token } : { product: 'max3' }
    const res = await fetch('/api/rdv-config?chronospherePayPalAction=status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data.valid || data.product !== 'max3') {
      if (token && allowAccountFallback && (res.status === 404 || res.status === 401)) {
        try { localStorage.removeItem(maxTokenKey(user?.id)) } catch {}
        setPackToken('')
        return refreshMaxStatus('', false)
      }
      if (!token && res.status === 404) {
        setCreditState(null)
        setLiveTimeline(null)
      }
      return null
    }

    if (data.packToken && user?.id) {
      try { localStorage.setItem(maxTokenKey(user.id), data.packToken) } catch {}
      setPackToken(data.packToken)
    }
    setCreditState({
      product: 'max3',
      creditsRemaining: data.creditsRemaining,
      creditsTotal: data.creditsTotal,
      status: data.status,
      resumeMode: data.resumeMode || (token ? 'token' : 'account'),
    })
    const normalizedTimeline = normalizeLiveTimeline(data.maxTimeline)
    setLiveTimeline(normalizedTimeline)
    setForm((current) => ({
      ...current,
      fullName: current.fullName || data.maxProfile?.fullName || '',
      birthDate: current.birthDate || data.maxProfile?.birthDate || '',
      birthTime: current.birthTime || data.maxProfile?.birthTime || '',
      birthPlace: current.birthPlace || data.maxProfile?.birthPlace || '',
      deliveryEmail: current.deliveryEmail || user?.email || '',
      theme: normalizedTimeline?.theme || current.theme,
    }))
    return data
  }

  useEffect(() => {
    if (!session?.access_token || !user) return
    refreshMaxStatus(packToken, true).catch(() => setPaymentError('Impossible de relire votre suivi MAX pour le moment.'))
  }, [packToken, session?.access_token, user?.id])

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

async function captureMaxOrder(orderId, token) {
    if (!session?.access_token || !user) throw new Error('auth_required')
    const res = await fetch('/api/rdv-config?chronospherePayPalAction=capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.product !== 'max3') throw new Error(data.error || 'capture_failed')
    try {
      localStorage.setItem(maxTokenKey(user.id), token)
      localStorage.removeItem(maxPendingKey(user.id))
    } catch {}
    pendingPaymentRef.current = null
    setPendingPayment(null)
    setPackToken(token)
    setCreditState({ product: 'max3', creditsRemaining: data.creditsRemaining, creditsTotal: data.creditsTotal, status: data.packStatus || 'active', resumeMode: 'token' })
    await refreshMaxStatus(token)
    return data
  }

  async function verifyPendingMaxPayment() {
    const pending = pendingPayment || pendingPaymentRef.current
    if (!pending?.orderId || !pending?.packToken) return
    setPaymentBusy(true)
    setPaymentError('')
    try {
      await captureMaxOrder(pending.orderId, pending.packToken)
    } catch (error) {
      setPaymentError(error?.message === 'paypal_capture_failed'
        ? 'Le paiement n’est pas encore confirmé par PayPal.'
        : 'Impossible de vérifier ce paiement pour le moment.')
    } finally {
      setPaymentBusy(false)
    }
  }

  useEffect(() => {
    const offer = paypalConfig?.products?.max3
    if (!user || !session?.access_token || !paypalConfig?.clientId || !offer || hasMaxAccess || !consentAccepted) return
    const node = paypalContainerRef.current
    if (!node) return

    let cancelled = false
    node.innerHTML = ''
    loadPayPalSdk(paypalConfig.clientId)
      .then(() => {
        if (cancelled || !window.paypal?.Buttons) return null
        return window.paypal.Buttons({
          style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
          createOrder: async () => {
            setPaymentError('')
            const res = await fetch('/api/rdv-config?chronospherePayPalAction=create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ product: 'max3', consentAccepted: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.product !== 'max3' || !data.id || !data.packToken) throw new Error(data.error || 'paypal_create_order_failed')
            const pending = { orderId: data.id, packToken: data.packToken }
            pendingPaymentRef.current = pending
            setPendingPayment(pending)
            try { localStorage.setItem(maxPendingKey(user.id), JSON.stringify(pending)) } catch {}
            return data.id
          },
          onApprove: async (data) => {
            const pending = pendingPaymentRef.current
            if (!pending?.packToken) throw new Error('max_payment_token_missing')
            setPaymentBusy(true)
            try {
              await captureMaxOrder(data.orderID, pending.packToken)
            } finally {
              setPaymentBusy(false)
            }
          },
          onCancel: () => setPaymentError('Paiement annulé. Aucun crédit MAX n’a été consommé.'),
          onError: () => setPaymentError('PayPal n’a pas pu finaliser le paiement. Vous pouvez réessayer.'),
        }).render(node)
      })
      .catch(() => setPaymentError('Le paiement PayPal est momentanément indisponible.'))

    return () => {
      cancelled = true
      if (node) node.innerHTML = ''
    }
  }, [paypalConfig, user, session?.access_token, hasMaxAccess, consentAccepted])

  async function submitMaxReading(event) {
    event.preventDefault()
    if (!packToken || !session?.access_token || !user) return
    setDrawError('')
    const numbers = [form.number1, form.number2, form.number3].map((value) => Number(value))
    if (numbers.some((value) => !Number.isInteger(value) || value < 1 || value > 58) || new Set(numbers).size !== 3) {
      setDrawError('Choisissez trois nombres différents entre 1 et 58.')
      return
    }
    if (!liveTimeline && form.timelineTitle.trim().length < 2) {
      setDrawError('Donnez un nom à cette Ligne de Temps.')
      return
    }
    if (!form.fullName.trim() || !form.birthDate || !form.birthTime || form.birthPlace.trim().length < 2 || !form.deliveryEmail.trim()) {
      setDrawError('Complétez votre identité de lecture, votre naissance et votre e-mail.')
      return
    }

    const nonce = pendingReadNonce || (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    setPendingReadNonce(nonce)
    setDrawBusy(true)
    try {
      const res = await fetch('/api/oracle-interpret?mode=chronosphere', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          numbers,
          theme: form.theme,
          profile: {
            fullName: form.fullName.trim(),
            birthDate: form.birthDate,
            birthTime: form.birthTime,
            birthPlace: form.birthPlace.trim(),
          },
          deliveryEmail: form.deliveryEmail.trim(),
          packToken,
          maxTimelineId: liveTimeline?.id || '',
          maxTimelineTitle: liveTimeline?.title || form.timelineTitle.trim(),
          maxReadNonce: nonce,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || data.error || 'max_read_failed')
      setLastResult(data)
      setPendingReadNonce('')
      setForm((current) => ({ ...current, number1: '', number2: '', number3: '' }))
      await refreshMaxStatus(packToken, true)
    } catch (error) {
      setDrawError(error?.message || 'La lecture MAX n’a pas pu être générée.')
    } finally {
      setDrawBusy(false)
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
              MAX suit une situation dans le temps. Chaque nouvelle lecture est mise en regard des précédentes : vous voyez ce qui persiste, ce qui se déplace, ce qui disparaît et ce qui s’ouvre.
            </p>
          </div>
          <aside className="rounded-3xl border border-gold/30 bg-white/75 p-5">
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Compte MediumIA requis</p>
            <p className="mt-2 font-georgia text-sm leading-relaxed text-deep/72">
              La mémoire MAX est liée au compte connecté. Elle réutilise votre profil MediumIA : ni votre lieu de naissance ni vos coordonnées exactes ne sont recopiés dans l’historique des lectures.
            </p>
          </aside>
        </section>

        <section className="mt-8 overflow-hidden rounded-3xl border-2 border-gold bg-deep text-cream shadow-xl">
          <div className="grid gap-0 md:grid-cols-[.86fr_1.14fr]">
            <div className="border-b border-gold/20 p-6 md:border-b-0 md:border-r md:p-8">
              <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Offre de lancement</p>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-georgia text-5xl font-medium text-cream">19,90 €</span>
                <span className="pb-1 font-georgia text-xs text-cream/55">TTC · paiement unique</span>
              </div>
              <p className="mt-5 font-georgia text-sm leading-relaxed text-cream/72">
                Un suivi complet d’une même Ligne de Temps en 3 lectures : point de départ, évolution, puis trajectoire et synthèse finale.
              </p>
              <div className="mt-5 grid gap-2 font-georgia text-sm text-cream/78">
                <p>✦ Mémoire des 3 lectures</p>
                <p>✦ Comparaison de ce qui persiste, bouge ou disparaît</p>
                <p>✦ Évolution des fenêtres et du point de bifurcation</p>
                <p>✦ Tempérament solaire + signature ChronoSphère</p>
                <p>✦ Synthèse finale de la trajectoire</p>
              </div>
            </div>

            <div className="bg-cream p-6 text-deep md:p-8">
              {authLoading ? (
                <p className="font-georgia text-sm text-mist">Lecture de votre compte MediumIA…</p>
              ) : !user ? (
                <>
                  <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Votre mémoire reste avec vous</p>
                  <h2 className="mt-2 font-georgia text-2xl font-medium">Connectez-vous ou créez votre compte</h2>
                  <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">Le compte est nécessaire pour rattacher les trois lectures à la même Ligne de Temps.</p>
                  <div className="mt-5 grid gap-3">
                    <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} type="email" autoComplete="email" placeholder="Votre e-mail" className="rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                    <input value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Mot de passe · 6 caractères minimum" className="rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => handleAuth('signin')} className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold">Se connecter</button>
                      <button type="button" onClick={() => handleAuth('signup')} className="rounded-xl border border-gold/45 px-5 py-3 font-georgia text-sm font-bold text-deep">Créer mon compte</button>
                    </div>
                    {authMessage && <p className="font-georgia text-xs leading-relaxed text-mist">{authMessage}</p>}
                  </div>
                </>
              ) : !hasMaxAccess ? (
                <>
                  <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Compte connecté</p>
                  <h2 className="mt-2 font-georgia text-2xl font-medium">Ouvrir votre suivi MAX</h2>
                  <p className="mt-2 font-georgia text-sm text-mist">{user.email}</p>
                  <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-gold/25 bg-white/70 p-4">
                    <input type="checkbox" checked={consentAccepted} onChange={(e) => setConsentAccepted(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-gold" />
                    <span className="font-georgia text-xs leading-relaxed text-deep/78">
                      Je demande l’exécution immédiate du service numérique ChronoSphère MAX et reconnais que ce contenu numérique personnalisé ne peut faire l’objet d’un droit de rétractation une fois la première lecture générée (art. L221-28 du Code de la consommation). Je comprends que la mémoire du suivi est rattachée à mon compte MediumIA.
                    </span>
                  </label>
                  {consentAccepted ? <div ref={paypalContainerRef} className="mt-5 min-h-[50px]" /> : <p className="mt-4 text-center font-georgia text-xs text-mist">Cochez la case pour afficher le paiement PayPal.</p>}
                  {pendingPayment && (
                    <button type="button" disabled={paymentBusy} onClick={verifyPendingMaxPayment} className="mt-3 w-full rounded-xl border border-gold/45 px-5 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-50">
                      {paymentBusy ? 'Vérification…' : 'Vérifier un paiement en cours'}
                    </button>
                  )}
                  {paymentError && <p className="mt-3 font-georgia text-xs leading-relaxed text-red-700">{paymentError}</p>}
                  {paypalConfig?.env === 'sandbox' && <p className="mt-3 font-georgia text-[11px] text-mist">Preview : PayPal Sandbox facture 1,00 € de test. La production est configurée à 19,90 €.</p>}
                </>
              ) : (
                <>
                  <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">ChronoSphère MAX activé</p>
                  <h2 className="mt-2 font-georgia text-2xl font-medium">{liveTimeline?.title || 'Votre Ligne de Temps est prête'}</h2>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-gold/25 bg-white p-4 text-center">
                      <p className="font-georgia text-3xl text-deep">{creditState?.creditsRemaining ?? 3}</p>
                      <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">lectures restantes</p>
                    </div>
                    <div className="rounded-2xl border border-gold/25 bg-white p-4 text-center">
                      <p className="font-georgia text-3xl text-deep">{liveTimeline?.entries?.length || 0}/3</p>
                      <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">trajectoire suivie</p>
                    </div>
                  </div>
                  <p className="mt-4 font-georgia text-xs leading-relaxed text-mist">Votre achat, vos lectures et votre mémoire MAX sont liés à ce compte MediumIA.</p>
                </>
              )}
            </div>
          </div>
        </section>

        {user && packToken && (creditState?.creditsRemaining ?? 0) > 0 && (
          <section className="mt-7 rounded-3xl border border-gold/30 bg-white/80 p-5 shadow-sm md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Lecture {liveTimeline?.entries?.length ? liveTimeline.entries.length + 1 : 1} / 3</p>
            <h2 className="mt-2 font-georgia text-2xl font-medium text-deep md:text-3xl">{liveTimeline ? 'Continuer cette Ligne de Temps' : 'Créer votre Ligne de Temps'}</h2>
            <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">Chaque nouvelle lecture repart du ciel du moment et compare ensuite sa structure aux lectures précédentes.</p>

            <form onSubmit={submitMaxReading} className="mt-6 grid gap-4">
              {!liveTimeline && (
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">Nom de la Ligne de Temps</span>
                  <input value={form.timelineTitle} onChange={(e) => setForm({ ...form, timelineTitle: e.target.value })} placeholder="Ex. Relation / séparation" className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">Nom complet</span>
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">E-mail du compte rendu</span>
                  <input value={form.deliveryEmail} onChange={(e) => setForm({ ...form, deliveryEmail: e.target.value })} type="email" className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">Date de naissance</span>
                  <input value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} type="date" className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">Heure exacte</span>
                  <input value={form.birthTime} onChange={(e) => setForm({ ...form, birthTime: e.target.value })} type="time" className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
                <label className="grid gap-1.5">
                  <span className="font-georgia text-xs font-semibold text-deep">Lieu de naissance</span>
                  <input value={form.birthPlace} onChange={(e) => setForm({ ...form, birthPlace: e.target.value })} placeholder="Ville, pays" className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold" />
                </label>
              </div>

              <label className="grid gap-1.5">
                <span className="font-georgia text-xs font-semibold text-deep">Thème de la lecture</span>
                <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} className="rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm outline-none focus:border-gold">
                  <option value="amour">Amour</option>
                  <option value="relation">Relation</option>
                  <option value="travail">Travail</option>
                  <option value="finances">Finances</option>
                  <option value="projet">Projet</option>
                  <option value="energie">Énergie</option>
                  <option value="direction de vie">Direction de vie</option>
                  <option value="autre">Autre</option>
                </select>
              </label>

              <div>
                <p className="font-georgia text-xs font-semibold text-deep">Vos 3 nombres · de 1 à 58</p>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  {['number1', 'number2', 'number3'].map((key, index) => (
                    <input key={key} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} inputMode="numeric" min="1" max="58" type="number" placeholder={String(index + 1)} className="rounded-xl border border-gold/30 bg-cream px-4 py-3 text-center font-georgia text-lg outline-none focus:border-gold" />
                  ))}
                </div>
              </div>

              {drawError && <p className="font-georgia text-sm leading-relaxed text-red-700">{drawError}</p>}
              <button disabled={drawBusy} className="rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold disabled:opacity-50">
                {drawBusy ? 'ChronoSphère ouvre la Ligne de Temps…' : liveTimeline ? 'Générer la prochaine lecture MAX' : 'Ouvrir ma Ligne de Temps'}
              </button>
            </form>
          </section>
        )}

        {lastResult && (
          <section className="mt-7 rounded-3xl border-2 border-gold bg-gold/[.08] p-5 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Lecture {lastResult.max?.sequenceNumber || ''} générée</p>
            <h2 className="mt-2 font-georgia text-2xl font-medium text-deep">Votre tirage en 30 secondes</h2>
            <p className="mt-3 max-w-4xl font-georgia text-base leading-relaxed text-deep/78">{lastResult.reading?.summary30s}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {(lastResult.cards || []).map((card, index) => (
                <article key={`${card.number}-${index}`} className="rounded-2xl border border-gold/25 bg-white/80 p-4">
                  <p className="font-georgia text-[10px] uppercase tracking-[0.14em] text-gold">{index === 0 ? 'Fréquence principale' : `Résonance ${index}`}</p>
                  <h3 className="mt-2 font-georgia text-lg font-medium text-deep">N°{card.number} · {card.name}</h3>
                  <p className="mt-2 font-georgia text-xs text-mist">{card.block} · {card.astre || 'astre non indiqué'}</p>
                </article>
              ))}
            </div>
            {lastResult.sky?.timing?.primary && <p className="mt-5 font-georgia text-sm text-deep/75">Fenêtre prioritaire : {shortDate(lastResult.sky.timing.primary.start)} → {shortDate(lastResult.sky.timing.primary.end)} · pic {shortDate(lastResult.sky.timing.primary.peak)}</p>}
          </section>
        )}

        {liveTimeline ? (
          <>
            {activeSolarSign ? (
              <div className="mt-7">
                <SolarTemperamentPanel sign={activeSolarSign} timelineTitle={liveTimeline.title} />
              </div>
            ) : (
              <section className="mt-7 rounded-3xl border border-gold/25 bg-white/70 p-5">
                <p className="font-georgia text-sm text-mist">Votre signature solaire apparaîtra après la première lecture calculée.</p>
              </section>
            )}
            <div className="mt-7 space-y-5">
              <SequenceRail entries={liveTimeline.entries} />
              {liveTimeline.entries.length >= 2 && <ComparisonPanel comparison={liveTimeline.comparison} />}
              <FinalSynthesis timeline={liveTimeline} />
            </div>
            {(creditState?.creditsRemaining ?? 0) === 0 && (
              <section className="mt-6 rounded-3xl border border-deep bg-deep p-6 text-cream md:p-8">
                <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Suivi terminé</p>
                <h2 className="mt-2 font-georgia text-2xl font-medium md:text-3xl">Vos trois lectures sont réunies.</h2>
                <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/70">La synthèse finale ferme ce premier parcours MAX. Une extension de Ligne de Temps pourra être proposée plus tard sans effacer ce suivi.</p>
              </section>
            )}
          </>
        ) : !hasMaxAccess ? (
          <>
            <div className="mt-8 flex items-center gap-3">
              <span className="h-px flex-1 bg-gold/25" />
              <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Aperçu de l’expérience MAX</p>
              <span className="h-px flex-1 bg-gold/25" />
            </div>
            <div className="mt-7">
              <SolarTemperamentPanel sign={chronosphereMaxDemoProfile.solarSign} timelineTitle={selected.title} />
            </div>
            <section className="mt-9 grid gap-4 md:grid-cols-2">
              {chronosphereMaxDemoTimelines.map((timeline) => (
                <TimelineCard key={timeline.id} timeline={timeline} selected={timeline.id === selected.id} onSelect={setSelectedId} />
              ))}
            </section>
            <div className="mt-7 space-y-5">
              <SequenceRail entries={selected.entries} />
              <ComparisonPanel comparison={selected.comparison} />
              <FinalSynthesis timeline={selected} />
            </div>
          </>
        ) : null}

        <section className="mt-7 rounded-3xl border border-gold/25 bg-white/75 p-5 md:p-7">
          <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Cadre ChronoSphère MAX</p>
          <p className="mt-3 font-georgia text-sm leading-relaxed text-deep/75">
            Les positions astrologiques et les comparaisons de données sont calculées ; leur lecture reste symbolique. MAX décrit des dynamiques, des fenêtres et des bifurcations possibles sans annoncer avec certitude ce qu’une autre personne fera ni transformer un score en annonce du futur.
          </p>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
