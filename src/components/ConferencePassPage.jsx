import { useEffect, useMemo, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'

const API = '/api/rdv-config?conferencePassAction='
const PAYPAL_SCRIPT_ID = 'mediumia-paypal-sdk'
const IS_PREVIEW = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')
const STUDENT_SPACE_URL = IS_PREVIEW
  ? 'https://mediumnia-app-git-test-confere-90e299-seguins-projects-a1d4673f.vercel.app'
  : 'https://espace.mediumia.fr'

function formatPrice(cents, currency = 'EUR') {
  if (!Number.isInteger(cents)) return '—'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100)
}

function timeLeftLabel(expiresAt) {
  const expiry = expiresAt ? new Date(expiresAt).getTime() : NaN
  const diff = expiry - Date.now()
  if (!Number.isFinite(expiry) || diff <= 0) return 'Expiré'
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} j ${hours % 24} h`
  return `${hours} h ${minutes} min`
}

function readPassToken() {
  const hash = window.location.hash || ''
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('pass') || ''
  if (token) window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)
  return token
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(PAYPAL_SCRIPT_ID)
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('paypal_sdk_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = PAYPAL_SCRIPT_ID
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
    script.async = true
    script.onload = resolve
    script.onerror = () => reject(new Error('paypal_sdk_load_failed'))
    document.head.appendChild(script)
  })
}

function messageForState(state, error) {
  if (state === 'expired') return 'Ce Pass a expiré. Il était valable 1 mois après émission.'
  if (state === 'already_redeemed') return 'Ce Pass a déjà été utilisé pour activer un accès MediumIA.'
  if (state === 'invalid') return 'Ce Pass est introuvable ou invalide.'
  if (state === 'offer_disabled') return 'L’offre spéciale conférence n’est pas encore configurée.'
  if (error) return 'Une erreur récupérable est survenue. Vous pouvez réessayer sans perdre votre Pass.'
  return ''
}

export default function ConferencePassPage({ onBack, onNavigate }) {
  const [passToken, setPassToken] = useState('')
  const [state, setState] = useState('loading')
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const paypalRef = useRef(null)
  const renderedRef = useRef(null)

  async function captureExistingOrder(orderId) {
    const res = await fetch(`${API}capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')
    setState(result.alreadyProvisioned ? 'already_provisioned' : 'success')
    return result
  }

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        let token = readPassToken()

        if (cancelled) return
        setPassToken(token)

        if (!token) {
          setState('invalid')
          return
        }

        const res = await fetch(`${API}config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passToken: token }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'invalid_pass')
        if (cancelled) return
        setConfig(data)
        setState(data.offer?.enabled ? 'valid' : 'offer_disabled')
      } catch (err) {
        if (cancelled) return
        const code = err.message || 'invalid_pass'
        setState(code === 'expired' || code === 'already_redeemed' || code === 'offer_disabled' ? code : 'invalid')
      }
    })()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setTick(Date.now()), 0)
    const timer = window.setInterval(() => setTick(Date.now()), 30000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (state !== 'valid' || !config?.paypal?.clientId || !passToken || !paypalRef.current) return
    if (renderedRef.current === passToken) return

    let cancelled = false
    paypalRef.current.innerHTML = ''
    loadPayPalSdk(config.paypal.clientId)
      .then(() => {
        if (cancelled || !window.paypal?.Buttons) return
        renderedRef.current = passToken
        return window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
          createOrder: async () => {
            setError('')
            const res = await fetch(`${API}create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ passToken }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.id) throw new Error(data.error || 'paypal_create_order_failed')
            if (data.completed) {
              await captureExistingOrder(data.id)
              throw new Error('conference_pass_reconciled')
            }
            return data.id
          },
          onApprove: async (data) => {
            setState('payment')
            await captureExistingOrder(data.orderID)
          },
          onCancel: () => setState('valid'),
          onError: (err) => {
            if (err?.message === 'conference_pass_reconciled') return
            setError(err?.message || 'paypal_error')
            setState('valid')
          },
        }).render(paypalRef.current)
      })
      .catch((err) => {
        setError(err.message || 'paypal_sdk_load_failed')
        setState('valid')
      })

    return () => { cancelled = true }
  }, [state, config, passToken])

  const expired = useMemo(() => {
    if (!config?.pass?.expiresAt) return false
    return new Date(config.pass.expiresAt).getTime() <= tick
  }, [config, tick])

  const visibleState = expired && state === 'valid' ? 'expired' : state
  const notice = messageForState(visibleState, error)
  const currency = config?.offer?.currency || 'EUR'

  return (
    <div className="cosmic-page cosmic-page--formation min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 md:px-6">
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← MediumIA</button>
          <div className="flex items-center gap-2.5">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-8 w-auto" />
            <span className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">PASS MEDIUMIA</span>
          </div>
          <a href="/formation" className="rounded-lg border border-gold/45 px-3 py-2 font-georgia text-xs font-semibold text-deep transition-colors hover:bg-gold/10">Formation</a>
        </div>
      </header>

      <main className="relative isolate overflow-hidden px-6 py-16 md:py-24">
        <div className="pointer-events-none absolute left-1/2 top-20 h-[520px] w-[520px] -translate-x-1/2 rounded-full border border-gold/20 bg-white/25 blur-sm" />
        <section className="relative mx-auto max-w-5xl">
          <div className="rounded-[2rem] border border-gold/30 bg-white/75 p-6 shadow-[0_20px_70px_rgba(26,21,53,.08)] backdrop-blur md:p-10">
            <div className="grid gap-9 md:grid-cols-[1.15fr_.85fr] md:items-center">
              <div>
                <p className="font-georgia text-[11px] uppercase tracking-[0.24em] text-gold">Après-conférence · personnel</p>
                <h1 className="mt-4 font-georgia text-4xl font-medium leading-tight text-deep md:text-6xl">Votre Pass Conférence MediumIA</h1>
                <p className="mt-5 font-georgia text-base leading-relaxed text-mist md:text-lg">
                  Ce Pass est personnel, lié à l’adresse e-mail de votre inscription et valable 1 mois. Il vous permet d’accéder à l’offre spéciale conférence si elle est active.
                </p>
                {config?.pass?.firstName && (
                  <p className="mt-6 font-georgia text-lg text-deep">Bonjour {config.pass.firstName}, votre Pass est prêt.</p>
                )}
              </div>

              <aside className="rounded-3xl border border-gold/35 bg-deep p-6 text-cream shadow-[0_18px_44px_rgba(26,21,53,.18)]">
                <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Offre conférence</p>
                <p className="mt-4 font-georgia text-sm text-cream/60">Prix normal</p>
                <p className="font-georgia text-2xl line-through decoration-gold/60">{formatPrice(config?.offer?.normalAmountCents || 39700, currency)}</p>
                <p className="mt-5 font-georgia text-sm text-cream/60">Offre spéciale conférence</p>
                <p className="font-georgia text-4xl font-medium text-gold">{formatPrice(config?.offer?.displayAmountCents, currency)}</p>
                <p className="mt-5 rounded-2xl border border-gold/25 bg-white/5 px-4 py-3 font-georgia text-sm text-cream/75">
                  Temps restant : <strong className="text-gold">{timeLeftLabel(config?.pass?.expiresAt)}</strong>
                </p>
              </aside>
            </div>

            <div className="mt-9 rounded-3xl border border-gold/25 bg-cream/75 p-5 md:p-6">
              {visibleState === 'loading' && <p className="font-georgia text-mist">Vérification de votre Pass…</p>}
              {['invalid', 'expired', 'already_redeemed', 'offer_disabled'].includes(visibleState) && (
                <p className="font-georgia text-sm leading-relaxed text-mist">{notice}</p>
              )}
              {visibleState === 'payment' && <p className="mb-4 font-georgia text-sm text-mist">Paiement en cours de confirmation…</p>}
              {['success', 'already_provisioned'].includes(visibleState) && (
                <div className="font-georgia text-mist">
                  <p className="text-xl text-deep">{visibleState === 'already_provisioned' ? 'Votre accès est déjà activé.' : 'Paiement confirmé, accès MediumIA activé.'}</p>
                  <p className="mt-3 text-sm leading-relaxed">Connectez-vous à l’Espace élèves avec l’adresse e-mail utilisée lors de votre inscription à la conférence.</p>
                  <a href={STUDENT_SPACE_URL} className="mt-5 inline-flex rounded-lg bg-gold px-6 py-3 font-bold text-deep">Accéder à mon espace élève →</a>
                </div>
              )}
              {visibleState === 'valid' && (
                <>
                  <p className="mb-4 font-georgia text-sm leading-relaxed text-mist">
                    Ce Pass n’est consommé qu’après paiement PayPal réussi et activation effective de l’accès. Un simple affichage de cette page ne l’utilise pas.
                  </p>
                  {error && <p className="mb-4 font-georgia text-xs text-mist">{notice}</p>}
                  <div ref={paypalRef} className="min-h-[52px]" />
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
