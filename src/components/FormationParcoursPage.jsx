import { useCallback, useEffect, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

// /formation/parcours : « Mon parcours » — suivre, continuer au mois, tout
// débloquer ou arrêter. Connexion par lien envoyé par e-mail, comme l'espace élève.

const API = '/api/rdv-config?formationPathAction='
const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',').replace(',00', '')} €`
const longDate = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '')
const modulesLabel = (list) => (list.length <= 2 ? `modules ${list.join(' et ')}` : `modules ${list[0]} à ${list[list.length - 1]}`)

function loadSdk(clientId, namespace, query) {
  if (window[namespace]) return Promise.resolve(window[namespace])
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&components=buttons&${query}`
    script.dataset.namespace = namespace
    script.onload = () => resolve(window[namespace])
    script.onerror = () => reject(new Error('paypal_sdk_failed'))
    document.head.appendChild(script)
  })
}

function Header({ onBack }) {
  return (
    <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
        <a href="/formation" className="font-georgia text-xs text-mist hover:text-deep">La formation</a>
      </div>
    </header>
  )
}

function Consent({ id, checked, onChange }) {
  return (
    <label htmlFor={id} className="mt-4 flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-gold" />
      <span className="font-georgia text-xs leading-relaxed text-deep/80">
        J’ai lu et j’accepte les <a href="/cgv-formation.html" target="_blank" rel="noopener noreferrer" className="text-gold underline">conditions générales de vente</a>. Je demande l’ouverture immédiate de chaque étape payée et reconnais qu’une fois ce contenu numérique fourni, je ne peux plus exercer mon droit de rétractation pour cette étape. Je peux arrêter mon parcours à tout moment ; ce que j’ai débloqué reste à moi.
      </span>
    </label>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!supabase) { setStatus('Connexion indisponible pour le moment.'); return }
    setStatus('…')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: `${window.location.origin}/formation/parcours`, shouldCreateUser: false } })
    setStatus(error ? 'Aucun parcours trouvé pour cette adresse. Utilisez l’e-mail de votre achat PayPal.' : 'sent')
  }
  if (status === 'sent') return <p role="status" className="rounded-2xl border border-gold/30 bg-white/80 p-5 font-georgia text-sm text-deep">Un lien de connexion vient de vous être envoyé à {email}. Ouvrez-le sur cet appareil pour revenir ici.</p>
  return (
    <form onSubmit={submit} className="rounded-3xl border border-gold/30 bg-white/80 p-6">
      <h2 className="font-georgia text-xl text-deep">Connexion</h2>
      <p className="mt-1 font-georgia text-sm text-mist">Indiquez l’adresse e-mail utilisée pour votre achat : vous recevez un lien de connexion, sans mot de passe.</p>
      <label htmlFor="parcours-email" className="sr-only">Adresse e-mail</label>
      <input id="parcours-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Votre e-mail" className="mt-4 w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm text-deep" />
      <button type="submit" className="mt-3 w-full rounded-xl bg-[#1a1535] px-5 py-3 font-georgia text-sm font-bold text-gold">Recevoir mon lien de connexion</button>
      {status && status !== '…' && <p role="alert" className="mt-3 font-georgia text-xs text-red-700">{status}</p>}
    </form>
  )
}

function Progress({ state }) {
  const pct = Math.round((state.maxModule / state.totalModules) * 100)
  return (
    <section className="rounded-3xl bg-[#1a1535] p-6 text-cream md:p-8">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Mon parcours</p>
      <p className="mt-2 font-georgia text-3xl">{state.maxModule} / {state.totalModules} modules ouverts</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={state.totalModules} aria-valuenow={state.maxModule}>
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-4 font-georgia text-sm text-cream/80">Déjà investi : {money(state.paidCents)} · votre parcours complet ne dépassera jamais {money(state.capCents)}.</p>
      {state.coachUntil && <p className="mt-1 font-georgia text-xs text-cream/60">Coach MediumIA ouvert jusqu’au {longDate(state.coachUntil)}.</p>}
      {state.coachUntil && !state.complete && (
        <p className="mt-1 font-georgia text-xs text-cream/60">
          {state.paidCents > (state.discoveryCents || 2900)
            ? 'Le coach reste ouvert 12 mois après votre dernier paiement : chaque étape payée repousse cette date, et si vous arrêtez, vous le gardez jusqu’à cette date.'
            : 'Avec la Découverte, le coach est ouvert 30 jours ; ensuite, il reste ouvert 12 mois après chaque étape payée.'}
        </p>
      )}
    </section>
  )
}

export default function FormationParcoursPage({ onBack, onNavigate }) {
  const { session, loading } = useAuth()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [consentSub, setConsentSub] = useState(false)
  const [consentUnlock, setConsentUnlock] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [busy, setBusy] = useState(false)
  const subRef = useRef(null)
  const unlockRef = useRef(null)
  const token = session?.access_token

  const call = useCallback(async (action, body) => {
    const res = await fetch(`${API}${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  }, [token])

  const refresh = useCallback(async () => {
    if (!token) return
    const { ok, status, data } = await call('status')
    if (ok) { setState(data); setError('') } else setError(status === 404 ? 'closed' : 'Votre parcours est momentanément indisponible. Réessayez dans quelques minutes.')
  }, [token, call])

  useEffect(() => { refresh() }, [refresh])

  const hasLiveSub = state?.subscription?.status === 'active' || state?.subscription?.status === 'approval_pending'
  const canSubscribe = state && !state.complete && (state.hasDiscovery || state.maxModule > 0) && state.schedule?.mode === 'subscription' && !hasLiveSub

  // Monthly progression buttons (PayPal subscription).
  useEffect(() => {
    if (!canSubscribe || !consentSub || !state?.clientId || !subRef.current) return undefined
    const node = subRef.current
    let disposed = false
    loadSdk(state.clientId, 'paypalParcoursSub', 'vault=true&intent=subscription').then((pp) => {
      if (disposed || !pp) return
      node.innerHTML = ''
      pp.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'subscribe' },
        createSubscription: async () => {
          setNotice('')
          const { ok, data } = await call('subscribe', { consent: true })
          if (!ok || !data.id) throw new Error(data.error || 'subscribe_failed')
          return data.id
        },
        onApprove: async (data) => {
          setBusy(true)
          setNotice('Paiement en cours de confirmation…')
          // The first instalment can take a few seconds to be confirmed by PayPal.
          for (let i = 0; i < 8; i += 1) {
            const r = await call('activate', { subscriptionId: data.subscriptionID })
            if (r.ok) setState((s) => ({ ...s, ...r.data }))
            if (r.ok && r.data.maxModule > (state?.maxModule || 0)) { setNotice('C’est parti ✦ Votre nouvelle étape est ouverte dans votre espace élève.'); break }
            if (i === 7) setNotice('Votre parcours est bien enregistré. La nouvelle étape s’ouvrira dès que PayPal aura confirmé le paiement (quelques minutes).')
            await new Promise((r2) => setTimeout(r2, 3000))
          }
          setBusy(false)
          refresh()
        },
        onError: () => setNotice('Le paiement n’a pas pu démarrer. Réessayez dans un instant.'),
      }).render(node)
    }).catch(() => setNotice('Le paiement sécurisé est momentanément indisponible.'))
    return () => { disposed = true; node.innerHTML = '' }
  }, [canSubscribe, consentSub, state?.clientId, state?.maxModule, call, refresh])

  // One-off payment: "unlock everything" or the final step.
  useEffect(() => {
    if (!state || state.complete || !consentUnlock || !state.clientId || !unlockRef.current) return undefined
    const node = unlockRef.current
    let disposed = false
    loadSdk(state.clientId, 'paypalParcoursOrder', 'intent=capture&enable-funding=paylater').then((pp) => {
      if (disposed || !pp) return
      node.innerHTML = ''
      pp.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
        createOrder: async () => {
          setNotice('')
          const { ok, data } = await call('unlock-create', { consent: true })
          if (!ok || !data.id) throw new Error(data.error || 'unlock_failed')
          return data.id
        },
        onApprove: async (data) => {
          setBusy(true)
          const r = await call('unlock-capture', { orderId: data.orderID })
          setBusy(false)
          if (r.ok) { setState((s) => ({ ...s, ...r.data, subscription: null })); setNotice('Votre parcours est entièrement ouvert ✦ Il n’y aura plus aucun prélèvement.') }
          else if (r.data.error === 'amount_changed') { setNotice('Un prélèvement mensuel vient d’être encaissé : le montant restant a changé. Rien n’a été débité, relancez le paiement.'); refresh() }
          else setNotice('Le paiement n’a pas pu être confirmé. Ne repayez pas : écrivez à contact@mediumia.fr.')
        },
        onError: () => setNotice('Le paiement n’a pas abouti. Vous pouvez réessayer.'),
      }).render(node)
    }).catch(() => setNotice('Le paiement sécurisé est momentanément indisponible.'))
    return () => { disposed = true; node.innerHTML = '' }
  }, [state?.complete, state?.remainingCents, consentUnlock, state?.clientId, call, refresh])

  async function stop() {
    setBusy(true)
    const r = await call('cancel', {})
    setBusy(false)
    setConfirmStop(false)
    if (r.ok) { setState((s) => ({ ...s, ...r.data, subscription: null })); setNotice('Votre parcours est arrêté : aucun nouveau prélèvement. Tout ce que vous avez débloqué reste à vous.') }
    else setNotice('L’arrêt n’a pas pu être enregistré. Réessayez, ou écrivez à contact@mediumia.fr.')
  }

  const finalOnly = state?.schedule?.mode === 'single'

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <Header onBack={onBack} />
      <main className="mx-auto max-w-3xl space-y-6 px-5 pb-20 pt-8">
        <div>
          <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Formation MediumIA</p>
          <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-4xl">Mon parcours</h1>
        </div>

        {notice && <p role="status" className="rounded-2xl border border-gold/35 bg-white/85 p-4 font-georgia text-sm text-deep">{notice}</p>}

        {loading ? <p className="font-georgia text-sm text-mist">Chargement…</p> : !session ? <Login /> : error === 'closed' ? (
          <p className="rounded-2xl border border-gold/30 bg-white/80 p-5 font-georgia text-sm text-deep">Le parcours au mois ouvre très bientôt. Votre accès actuel reste inchangé.</p>
        ) : error ? <p role="alert" className="font-georgia text-sm text-red-700">{error}</p> : !state ? <p className="font-georgia text-sm text-mist">Chargement de votre parcours…</p> : (
          <>
            <Progress state={state} />

            {state.complete ? (
              <p className="rounded-2xl border border-gold/30 bg-white/80 p-5 font-georgia text-sm text-deep">Votre parcours est complet : les 25 modules sont à vous. Aucun prélèvement n’est prévu.</p>
            ) : !state.hasDiscovery && state.maxModule === 0 ? (
              <p className="rounded-2xl border border-gold/30 bg-white/80 p-5 font-georgia text-sm text-deep">Votre parcours commence par la Découverte à {money(state.discoveryCents || 2900)} (introduction et module 1). <a href="/formation" className="text-gold underline">La découvrir</a></p>
            ) : (
              <>
                {hasLiveSub && (
                  <section className="rounded-3xl border border-gold/30 bg-white/85 p-6">
                    <h2 className="font-georgia text-xl">Mon parcours avance chaque mois</h2>
                    <p className="mt-2 font-georgia text-sm text-mist">Chaque prélèvement de {money(state.stepCents)} ouvre 2 nouveaux modules, puis l’Étape finale « Intégration » de {money(state.subscription.finalCents)} ouvre les derniers et termine le parcours. Aucun prélèvement au-delà.</p>
                    {!confirmStop ? (
                      <button type="button" onClick={() => setConfirmStop(true)} className="mt-4 w-full rounded-xl border border-gold/40 bg-white px-5 py-3 font-georgia text-sm text-deep">Arrêter mon parcours</button>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-gold/30 bg-cream/70 p-4">
                        <p className="font-georgia text-sm text-deep">Arrêter maintenant ? Plus aucun prélèvement ni nouveau module. Vos {state.maxModule} modules, vos PDF et votre carnet restent à vous{state.coachUntil ? `, votre coach reste ouvert jusqu’au ${longDate(state.coachUntil)}` : ''}, et vous pourrez reprendre quand vous voudrez.</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" disabled={busy} onClick={stop} className="rounded-xl bg-[#1a1535] px-4 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-50">Oui, arrêter</button>
                          <button type="button" onClick={() => setConfirmStop(false)} className="rounded-xl border border-gold/40 bg-white px-4 py-3 font-georgia text-sm text-deep">Continuer</button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {canSubscribe && (
                  <section className="rounded-3xl border border-gold/40 bg-white/90 p-6">
                    <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Étape suivante</p>
                    <h2 className="mt-1 font-georgia text-2xl">Continuer mon parcours · {money(state.stepCents)} / mois</h2>
                    <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
                      Tout de suite : {modulesLabel(state.nextModules)}. Ensuite, 2 nouveaux modules à chaque prélèvement, puis l’Étape finale « Intégration » à {money(state.schedule.finalCents)}.
                      Au total {money(state.schedule.totalCents)} en {state.schedule.regularCount + 1} étapes, jamais plus de {money(state.capCents)} en tout. Arrêt en un clic à tout moment.
                    </p>
                    <Consent id="consent-sub" checked={consentSub} onChange={setConsentSub} />
                    {consentSub ? <div ref={subRef} className="mt-4 min-h-[50px]" /> : <p className="mt-3 font-georgia text-xs text-mist">Cochez la case pour afficher le paiement.</p>}
                  </section>
                )}

                <section className="rounded-3xl border border-gold/25 bg-white/75 p-6">
                  <h2 className="font-georgia text-xl">{finalOnly ? `Étape finale « Intégration » · ${money(state.remainingCents)}` : `Tout débloquer maintenant · ${money(state.remainingCents)}`}</h2>
                  <p className="mt-2 font-georgia text-sm text-mist">
                    {finalOnly
                      ? `Les ${modulesLabel(state.nextModules)} s’ouvrent tout de suite et votre parcours est complet.`
                      : `Les modules ${state.maxModule + 1} à 25 s’ouvrent tout de suite. Vous avez déjà investi ${money(state.paidCents)} : il reste ${money(state.remainingCents)} pour atteindre ${money(state.capCents)}${hasLiveSub ? ', et votre abonnement en cours s’arrête' : ''}.`}
                  </p>
                  <Consent id="consent-unlock" checked={consentUnlock} onChange={setConsentUnlock} />
                  {consentUnlock ? <div ref={unlockRef} className="mt-4 min-h-[50px]" /> : <p className="mt-3 font-georgia text-xs text-mist">Cochez la case pour afficher le paiement.</p>}
                </section>
              </>
            )}

            {state.env === 'sandbox' && <p className="font-georgia text-[11px] text-mist">Préversion : paiements PayPal Sandbox (argent fictif) aux montants réels, pour tester le plafond de {money(state.capCents)}.</p>}
          </>
        )}
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
