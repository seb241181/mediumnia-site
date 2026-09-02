import { useState, useRef, useEffect } from 'react'
import LegalFooter from './LegalFooter'

const THEMES = [
  { value: 'amour', label: 'Amour' },
  { value: 'travail', label: 'Travail' },
  { value: 'finances', label: 'Finances' },
  { value: 'energie', label: 'Energie' },
  { value: 'direction de vie', label: 'Direction de vie' },
  { value: 'projet', label: 'Projet' },
  { value: 'autre', label: 'Autre — question personnelle' },
]

function esc(s) {
  return String(s ?? '')
}

function parseYmd(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function shortDate(value) {
  const d = parseYmd(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d)
}

function dateRange(window) {
  if (!window) return ''
  const start = shortDate(window.start)
  const end = shortDate(window.end)
  return start && end && start !== end ? `${start} → ${end}` : start || end
}

function peakLabel(window) {
  const peak = shortDate(window?.peak)
  return peak ? `pic ${peak}` : ''
}

function splitTendency(value) {
  const text = String(value || '').trim()
  const photoMatch = text.match(/(?:^|\n)(?:#+\s*)?(?:\*\*)?1\.\s*La photographie de l'instant(?:\*\*)?/i)
  if (!photoMatch) return { direction: null, summary: null, reading: text }
  const photoIndex = photoMatch.index + (photoMatch[0].startsWith('\n') ? 1 : 0)
  const head = text
    .slice(0, photoIndex)
    .replace(/^\s*#+\s*La tendance du tirage\s*/i, '')
    .replace(/^\s*---\s*$/gm, '')
    .trim()
  const directionMatch = head.match(
    /\*{0,2}(Tendance (?:favorable(?: mais en construction)?|mitigée|peu porteuse actuellement))\.?\*{0,2}/i,
  )
  if (!directionMatch) return { direction: null, summary: null, reading: text }
  const summary = head.replace(directionMatch[0], '').replace(/\*\*/g, '').trim()
  return {
    direction: directionMatch[1].replace(/\.$/, ''),
    summary,
    reading: text.slice(photoIndex).trim(),
  }
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

function TimelineFrise({ timing }) {
  if (!timing?.primary) return null

  const primaryPeak = parseYmd(timing.primary.peak)?.getTime() || 0
  const stages = [
    { kind: 'now', label: 'Maintenant', range: '', note: 'Observer, ajuster, préparer le terrain', order: Date.now() },
  ]

  if (timing.caution) {
    stages.push({
      kind: 'caution',
      label: 'Prudence',
      range: dateRange(timing.caution),
      note: peakLabel(timing.caution) || 'Plus de discernement',
      order: parseYmd(timing.caution.peak)?.getTime() || 0,
    })
  }

  ;(timing.alternatives || []).slice(0, 2).forEach((w) => {
    const peak = parseYmd(w.peak)?.getTime() || 0
    stages.push({
      kind: 'alternative',
      label: peak && primaryPeak && peak < primaryPeak ? 'Préparer / avancer' : 'Fenêtre secondaire',
      range: dateRange(w),
      note: peakLabel(w),
      order: peak || 0,
    })
  })

  stages.push({
    kind: 'primary',
    label: 'Fenêtre prioritaire',
    range: dateRange(timing.primary),
    note: peakLabel(timing.primary) || 'Période la plus porteuse',
    order: primaryPeak,
  })

  const future = stages.slice(1).sort((a, b) => a.order - b.order)
  const ordered = [stages[0], ...future]

  return (
    <div className="mb-5 rounded-[22px] border border-gold/[.38] bg-white/70 p-6 md:p-7">
      <div className="mb-5 flex flex-col gap-1 md:flex-row md:items-end md:justify-between md:gap-5">
        <span className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Ta ligne de temps</span>
        <span className="font-georgia text-[11px] text-mist">
          Fenêtres calculées sur {Number(timing.horizonDays) || 120} jours
        </span>
      </div>

      {/* Desktop: horizontal track */}
      <div className="hidden md:block">
        <div className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` }}>
          <div
            className="pointer-events-none absolute left-[7%] right-[7%] top-4 h-px bg-gold/45"
            aria-hidden="true"
          />
          {ordered.map((s, i) => (
            <div key={i} className="relative pt-9 text-center">
              <span
                className={`absolute left-1/2 -translate-x-1/2 rounded-full shadow-[0_0_0_4px_rgba(248,245,238,.95)] ${
                  s.kind === 'primary'
                    ? 'top-[6px] h-[21px] w-[21px] bg-gold'
                    : 'top-[9px] h-[15px] w-[15px] bg-cream border-[3px] border-gold'
                } ${s.kind === 'caution' ? 'border-double' : ''}`}
              />
              <span className="block font-georgia text-sm">{s.label}</span>
              {s.range && <time className="block font-georgia text-xs text-gold leading-snug">{s.range}</time>}
              {s.note && <span className="mt-1 block font-georgia text-[11px] text-mist leading-snug">{s.note}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: vertical track */}
      <div className="md:hidden">
        <div className="relative pl-11">
          <div className="absolute left-4 top-2 bottom-2 w-px bg-gold/45" aria-hidden="true" />
          {ordered.map((s, i) => (
            <div key={i} className="relative pb-5 last:pb-0">
              <span
                className={`absolute -left-7 rounded-full shadow-[0_0_0_4px_rgba(248,245,238,.95)] ${
                  s.kind === 'primary'
                    ? 'top-[2px] h-[21px] w-[21px] bg-gold'
                    : 'top-[5px] h-[15px] w-[15px] bg-cream border-[3px] border-gold'
                } ${s.kind === 'caution' ? 'border-double' : ''}`}
              />
              <span className="block font-georgia text-sm font-medium">{s.label}</span>
              {s.range && <time className="block font-georgia text-xs text-gold">{s.range}</time>}
              {s.note && <span className="block font-georgia text-[11px] text-mist">{s.note}</span>}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-5 text-center font-georgia text-[11px] leading-relaxed text-mist">
        Ces fenêtres indiquent le climat astrologique calculé du tirage : elles servent à choisir quand préparer, ajuster ou agir, sans figer le résultat.
      </p>
    </div>
  )
}

const SESSION_KEY = 'chronosphere_drawToken'

export default function ChronospherePage({ onBack, onNavigate }) {
  const [fullName, setFullName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [birthTime, setBirthTime] = useState('')
  const [birthPlace, setBirthPlace] = useState('')
  const [theme, setTheme] = useState('amour')
  const [customTheme, setCustomTheme] = useState('')
  const [numbers, setNumbers] = useState(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const resultsRef = useRef(null)

  const [paypalConfig, setPaypalConfig] = useState(null)
  const [paymentStatus, setPaymentStatus] = useState('loading')
  const [paymentMessage, setPaymentMessage] = useState('')
  const [drawToken, setDrawToken] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) || null } catch { return null }
  })
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const paypalContainerRef = useRef(null)
  const drawTokenRef = useRef(drawToken)
  const launchRef = useRef(null)

  useEffect(() => { drawTokenRef.current = drawToken }, [drawToken])

  useEffect(() => {
    let cancelled = false
    fetch('/api/rdv-config?chronospherePayPalAction=config', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return null
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'paypal_unavailable')
        return data
      })
      .then((data) => {
        if (cancelled) return
        if (!data) { setPaymentStatus('disabled'); return }
        setPaypalConfig(data)
        setPaymentStatus('ready')
      })
      .catch(() => { if (!cancelled) setPaymentStatus('error') })
    return () => { cancelled = true }
  }, [])

  function validateForm() {
    if (!fullName.trim() || fullName.trim().length < 2) return 'Indiquez votre prénom et votre nom.'
    if (!birthDate) return 'Indiquez votre date de naissance.'
    if (!birthTime) return 'Indiquez votre heure exacte de naissance.'
    if (!birthPlace.trim() || birthPlace.trim().length < 2) return 'Indiquez votre lieu de naissance (ville et pays).'
    const ids = numbers.map((v) => Number.parseInt(v, 10))
    if (ids.some(Number.isNaN) || ids.some((n) => n < 1 || n > 58) || new Set(ids).size !== 3) {
      return 'Choisissez trois nombres différents entre 1 et 58.'
    }
    if (theme === 'autre' && customTheme.trim().length < 3) {
      return 'Écrivez votre sujet personnel en une phrase courte.'
    }
    return null
  }

  function buildPayload(token) {
    const ids = numbers.map((v) => Number.parseInt(v, 10))
    return {
      drawToken: token,
      theme: theme === 'autre' ? customTheme.trim() : theme,
      numbers: ids,
      profile: {
        fullName: fullName.trim(),
        birthDate,
        birthTime,
        birthPlace: birthPlace.trim(),
      },
    }
  }

  async function launchInterpretation(token) {
    setError('')
    const err = validateForm()
    if (err) { setError(err); return }

    setLoading(true)
    try {
      const response = await fetch('/api/oracle-interpret?mode=chronosphere', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(token)),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.error === 'draw_token_payment_pending') {
          try { sessionStorage.removeItem(SESSION_KEY) } catch {}
          setDrawToken(null)
          drawTokenRef.current = null
          throw new Error('Le paiement n\'a pas encore été finalisé. Veuillez réessayer.')
        }
        throw new Error(data.message || data.error || 'Le moteur est momentanément indisponible.')
      }
      setResult(data)
      try { sessionStorage.removeItem(SESSION_KEY) } catch {}
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      setError(err?.message || 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  launchRef.current = launchInterpretation

  useEffect(() => {
    if (!paypalConfig || !consentAccepted || drawToken || !showPayment) return
    let cancelled = false
    const node = paypalContainerRef.current
    if (!node) return
    node.innerHTML = ''

    loadPayPalSdk(paypalConfig.clientId)
      .then(() => {
        if (cancelled || !window.paypal?.Buttons) return
        return window.paypal.Buttons({
          createOrder: async () => {
            setPaymentMessage('Création de la commande...')
            const res = await fetch('/api/rdv-config?chronospherePayPalAction=create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ consentAccepted: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.id || !data.drawToken) throw new Error(data.error || 'paypal_create_order_failed')
            drawTokenRef.current = data.drawToken
            try { sessionStorage.setItem(SESSION_KEY, data.drawToken) } catch {}
            return data.id
          },
          onApprove: async (data) => {
            setPaymentMessage('Paiement en cours de validation...')
            const res = await fetch('/api/rdv-config?chronospherePayPalAction=capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderID }),
            })
            const captureResult = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(captureResult.error || 'capture_failed')
            const token = drawTokenRef.current
            setDrawToken(token)
            setPaymentMessage('')
            if (node) node.innerHTML = ''
            if (token && launchRef.current) launchRef.current(token)
          },
          onCancel: () => setPaymentMessage('Paiement annulé.'),
          onError: () => setPaymentMessage('Le paiement n\'a pas abouti. Vous pouvez réessayer.'),
        }).render(node)
      })
      .catch(() => setPaymentMessage('PayPal est momentanément indisponible.'))

    return () => {
      cancelled = true
      if (node) node.innerHTML = ''
    }
  }, [paypalConfig, consentAccepted, drawToken, showPayment])

  function updateNumber(index, raw) {
    const next = [...numbers]
    if (raw === '') {
      next[index] = ''
    } else {
      const parsed = Number.parseInt(raw, 10)
      next[index] = Number.isNaN(parsed) ? '' : String(Math.min(58, Math.max(1, parsed)))
    }
    setNumbers(next)
  }

  function handleValidateAndPay(event) {
    event.preventDefault()
    setError('')
    const err = validateForm()
    if (err) { setError(err); return }
    setShowPayment(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!drawToken) {
      setError('Le paiement est requis avant de lancer le tirage.')
      return
    }
    await launchInterpretation(drawToken)
  }

  const parts = result ? splitTendency(result.interpretation) : null
  const hasToken = !!drawToken

  return (
    <div className="min-h-screen bg-cream text-deep">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">
            ✦ MEDIUMIA
          </button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">
            ← Retour
          </button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-6 pb-8 pt-14 text-center md:pt-20">
          <img
            src="/images/brand/MEDIUMIA_symbol_header.png"
            alt=""
            aria-hidden="true"
            className="mx-auto mb-6 h-10 w-auto opacity-50"
          />
          <p className="mb-4 font-georgia text-xs uppercase tracking-[0.28em] text-gold">
            Oracle des Lignes de Temps
          </p>
          <h1 className="mb-5 font-georgia text-4xl font-medium leading-tight md:text-6xl">
            CHRONOSPHERE 999
          </h1>
          <p className="mx-auto max-w-2xl font-bodoni text-lg italic leading-relaxed text-deep/80 md:text-xl">
            « Éclairez la dynamique présente et les fenêtres qui s'ouvrent devant vous. »
          </p>
        </section>

        {/* Form + Payment + Results */}
        <section className="mx-auto max-w-3xl px-6 pb-20">

          {/* Form — always visible */}
          <form
            onSubmit={hasToken ? handleSubmit : handleValidateAndPay}
            className="rounded-3xl border-2 border-gold/25 bg-white/60 p-6 shadow-sm md:p-9"
          >

            {/* Birth profile */}
            <p className="mb-1 font-georgia text-[13px] uppercase tracking-[0.14em] text-gold">
              Empreinte de naissance
            </p>
            <p className="mb-5 font-georgia text-xs leading-relaxed text-mist">
              Ces informations servent aux calculs astrologiques du tirage : ciel natal, Ascendant, Milieu du Ciel, maisons et fenêtres temporelles.
            </p>

            <div className="mb-6 grid gap-x-4 gap-y-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="chrono-name" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                  Prénom et nom
                </label>
                <input
                  id="chrono-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Prénom Nom"
                  disabled={loading}
                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="chrono-bdate" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                  Date de naissance
                </label>
                <input
                  id="chrono-bdate"
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="chrono-btime" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                  Heure exacte
                </label>
                <input
                  id="chrono-btime"
                  type="time"
                  required
                  value={birthTime}
                  onChange={(e) => setBirthTime(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="chrono-bplace" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                  Lieu de naissance
                </label>
                <input
                  id="chrono-bplace"
                  type="text"
                  required
                  value={birthPlace}
                  onChange={(e) => setBirthPlace(e.target.value)}
                  placeholder="Ex. Dunkerque, France"
                  disabled={loading}
                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"
                />
                <p className="mt-1.5 font-georgia text-xs leading-relaxed text-mist">
                  Indiquez la ville et le pays. Le lieu permet de déterminer les coordonnées et le fuseau horaire historique.
                </p>
              </div>
            </div>

            <div className="my-6 h-px bg-gold/20" />

            {/* Theme */}
            <p className="mb-4 font-georgia text-[13px] uppercase tracking-[0.14em] text-gold">Tirage</p>

            <div className="mb-5">
              <label htmlFor="chrono-theme" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                Thème du tirage
              </label>
              <select
                id="chrono-theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"
              >
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {theme === 'autre' && (
              <div className="mb-5">
                <label htmlFor="chrono-custom" className="mb-2 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
                  Votre sujet personnel
                </label>
                <textarea
                  id="chrono-custom"
                  value={customTheme}
                  onChange={(e) => setCustomTheme(e.target.value.slice(0, 120))}
                  maxLength={120}
                  rows={3}
                  placeholder="Ex. Dois-je accepter cette proposition malgré mon hésitation actuelle ?"
                  disabled={loading}
                  className="w-full resize-vertical rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base leading-relaxed text-deep outline-none focus:border-gold/60 disabled:opacity-60"
                />
                <p className="mt-1 font-georgia text-xs text-mist">
                  Une phrase courte et précise suffit. {customTheme.length} / 120
                </p>
              </div>
            )}

            {/* Numbers */}
            <div className="mb-7 grid grid-cols-3 gap-3 md:gap-5">
              {['Carte principale', 'Résonance I', 'Résonance II'].map((label, index) => (
                <label key={label} className="block">
                  <span className="mb-2 block text-center font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">
                    {label}
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="58"
                    value={numbers[index]}
                    onChange={(e) => updateNumber(index, e.target.value)}
                    placeholder="1–58"
                    required
                    disabled={loading}
                    className="w-full rounded-xl border-2 border-gold/25 bg-white px-3 py-4 text-center font-georgia text-xl text-deep outline-none focus:border-gold/70 disabled:opacity-60"
                  />
                </label>
              ))}
            </div>

            {/* Validate-and-pay button — before payment */}
            {!result && !showPayment && !hasToken && (
              <button
                type="submit"
                disabled={loading || !paypalConfig}
                className="w-full rounded-xl bg-gold px-6 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Procéder au paiement →
              </button>
            )}

            {/* Direct submit — token available (sessionStorage recovery or post-capture retry) */}
            {!result && hasToken && (
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gold px-6 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Calcul du ciel, des fenêtres et lecture...' : 'Ouvrir ma ligne de temps →'}
              </button>
            )}

            {error && (
              <p className="mt-4 text-center font-georgia text-sm text-red-600">{error}</p>
            )}
          </form>

          {/* Payment section — appears below form after local validation */}
          {showPayment && !hasToken && !result && (
            <div className="mt-6 rounded-3xl border-2 border-gold/25 bg-white/60 p-6 shadow-sm md:p-9">
              <p className="mb-2 font-georgia text-[13px] uppercase tracking-[0.14em] text-gold">
                Tirage payant
              </p>
              <p className="mb-5 font-georgia text-sm leading-relaxed text-deep/80">
                Chaque tirage CHRONOSPHERE 999 comprend le calcul de votre ciel natal, vos fenêtres temporelles personnalisées et une interprétation approfondie par intelligence artificielle.
              </p>
              <p className="mb-6 text-center font-georgia text-2xl font-medium text-deep">
                {Number(paypalConfig?.amount || 5)} €
                <span className="ml-2 text-base font-normal text-mist">TTC — tirage unique</span>
              </p>

              {paypalConfig?.env === 'sandbox' && (
                <div className="mb-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-center">
                  <p className="font-georgia text-xs font-medium text-deep/70">
                    Sandbox — test {Number(paypalConfig.amount)} €
                  </p>
                </div>
              )}

              {paymentStatus === 'loading' && (
                <p className="text-center font-georgia text-sm text-mist">Chargement du paiement...</p>
              )}

              {paymentStatus === 'disabled' && (
                <div className="text-center">
                  <button disabled className="w-full cursor-not-allowed rounded-xl bg-deep/20 px-6 py-4 font-georgia text-base font-bold text-deep/40">
                    Paiement bientôt disponible
                  </button>
                </div>
              )}

              {paymentStatus === 'error' && (
                <p className="text-center font-georgia text-sm text-mist">Le paiement est temporairement indisponible.</p>
              )}

              {paymentStatus === 'ready' && (
                <>
                  <label className="mb-5 flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={consentAccepted}
                      onChange={(e) => setConsentAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-gold/40 accent-gold"
                    />
                    <span className="font-georgia text-xs leading-relaxed text-deep/80">
                      Je demande l'exécution immédiate du tirage numérique CHRONOSPHERE 999 et reconnais que ce contenu numérique personnalisé ne peut faire l'objet d'un droit de rétractation une fois le tirage généré (art. L221-28 du Code de la consommation).
                    </span>
                  </label>

                  {consentAccepted && (
                    <div ref={paypalContainerRef} className="min-h-[50px]" />
                  )}

                  {!consentAccepted && (
                    <p className="text-center font-georgia text-xs text-mist">
                      Cochez la case ci-dessus pour accéder au paiement.
                    </p>
                  )}
                </>
              )}

              {paymentMessage && (
                <p className="mt-4 text-center font-georgia text-sm text-deep/70">{paymentMessage}</p>
              )}
            </div>
          )}

          <p className="mt-6 text-center font-georgia text-xs leading-relaxed text-mist/70">
            Chronosphere propose une lecture symbolique et introspective.
            Il n'établit pas de certitude sur l'avenir et ne remplace aucun conseil médical, juridique ou financier.
          </p>

          {/* Results */}
          {result && parts && (
            <div ref={resultsRef} className="mt-10 space-y-5">

              {/* Tendency */}
              {parts.direction && (
                <div className="rounded-[22px] border-2 border-gold bg-gradient-to-br from-gold/[.14] to-white/90 p-6 shadow-md md:p-7">
                  <span className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">
                    Tendance du tirage
                  </span>
                  <strong className="mt-2 block font-georgia text-2xl font-normal leading-snug md:text-[26px]">
                    {parts.direction}
                  </strong>
                  {parts.summary && (
                    <p className="mt-2.5 font-georgia text-base leading-relaxed text-deep/75">{parts.summary}</p>
                  )}
                </div>
              )}

              {/* Timeline */}
              <TimelineFrise timing={result.sky?.timing} />

              {/* Astro context */}
              <div className="rounded-r-xl border-l-[3px] border-gold bg-white/60 px-4 py-3.5 font-georgia text-[13px] leading-relaxed text-mist">
                <strong className="text-deep">{esc(result.profile.fullName)}</strong>{' '}
                &middot; naissance {esc(result.profile.birthDate)} à {esc(result.profile.birthTime)}
                <br />
                {esc(result.sky.resolvedBirthPlace)} &middot; {esc(result.sky.timeZone)}
                <br />
                Ascendant <strong className="text-deep">{esc(result.sky.ascendant)}</strong> &middot; MC{' '}
                {esc(result.sky.mc)} &middot; maisons {esc(result.sky.houseSystem)}
              </div>

              {/* Cards */}
              <div className="grid gap-4 md:grid-cols-3">
                {result.cards.map((card, i) => (
                  <article
                    key={card.number}
                    className={`rounded-2xl border-2 p-5 ${
                      i === 0 ? 'border-gold bg-gold/[.09]' : 'border-gold/[.35] bg-white'
                    }`}
                  >
                    <p className="font-georgia text-[11px] text-mist">
                      {i === 0 ? 'FRÉQUENCE PRINCIPALE' : `RÉSONANCE ${i}`} &middot; N°
                      {String(card.number).padStart(2, '0')}
                    </p>
                    <p className="mt-1.5 font-georgia text-lg font-medium leading-tight">{esc(card.name)}</p>
                    <p className="mt-1 font-georgia text-[11px] text-mist">
                      {esc(card.block)} &middot; {esc(card.density)}
                      {card.astre ? ` · ${esc(card.astre)}` : ''}
                    </p>
                  </article>
                ))}
              </div>

              {/* Reading */}
              <article className="rounded-3xl border-2 border-gold/25 bg-white p-7 md:p-9">
                <div className="whitespace-pre-line font-georgia text-[15px] leading-[1.85] text-deep/90 md:text-base">
                  {parts.reading}
                </div>
              </article>

              {/* Act */}
              <article className="rounded-2xl bg-deep p-6 text-cream">
                <p className="mb-2 font-georgia text-xs uppercase tracking-[0.16em] text-gold">
                  Acte de réalignement
                </p>
                <p className="font-georgia text-sm leading-relaxed text-cream/80">
                  <strong className="text-cream">Geste :</strong> {esc(result.cards[0].gesture)}
                </p>
                <p className="mt-3 font-bodoni text-lg italic leading-relaxed text-gold">
                  {esc(result.cards[0].decree)}
                </p>
              </article>

            </div>
          )}
        </section>
      </main>

      <p className="mx-auto mt-4 max-w-2xl text-center font-georgia text-[11px] text-mist/50">
        Données de localisation ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-mist/70">
          OpenStreetMap contributors
        </a>
      </p>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
