import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

const API = '/api/rdv-config?conferenceFiveAction='
const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export default function ConferenceFiveTestPage({ onBack }) {
  const { session, loading } = useAuth()
  const [offer, setOffer] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [report, setReport] = useState(null)
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)

  const call = useCallback(async (action, body) => {
    if (!session?.access_token) throw new Error('Connectez-vous pour continuer.')
    const res = await fetch(`${API}${action}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Opération indisponible')
    return data
  }, [session?.access_token])

  const refresh = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([call('offer'), call('status')])
      setOffer(o)
      setStatus(s)
      setError('')
    } catch (e) {
      setOffer(null)
      setStatus(null)
      setError(e?.message || 'Accès TEST indisponible')
    }
  }, [call])

  useEffect(() => {
    if (session) { refresh() }
  }, [session, refresh])

  async function requestLink(e) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/formation/conference-5x-test`,
      },
    })
    setBusy(false)
    if (sendError) setError(sendError.status === 429 ? 'Trop de demandes. Réessayez plus tard.' : 'Lien de connexion indisponible.')
    else setEmailSent(true)
  }

  async function beginSandboxSubscription() {
    setBusy(true)
    setError('')
    try {
      const res = await call('subscribe', { consent: true })
      if (!res.approveUrl) throw new Error('Page PayPal Sandbox indisponible')
      // Only opens the sandbox provider's consent page after an explicit click.
      window.location.assign(res.approveUrl)
    } catch (e) {
      setError(e?.message || 'Essai indisponible')
      setBusy(false)
    }
  }

  async function syncPayment() {
    setBusy(true)
    setError('')
    try {
      const report = await call('sync', {})
      setReport(report)
      await refresh()
    } catch (e) {
      setError(e?.message || 'Synchronisation impossible')
    } finally {
      setBusy(false)
    }
  }

  // The preview screen is never a second public offer on the live site.
  const inTestProject = String(import.meta.env.VITE_SUPABASE_URL || '').startsWith('https://wnbwhnqiulsdjcvkuwos.supabase.co')
    && window.location.hostname === 'mediumia-pr156-seguins-projects-a1d4673f.vercel.app'
  if (!inTestProject) return <main className="p-10 text-center">Page de démonstration non disponible.</main>

  return (
    <main className="min-h-screen bg-cream px-5 py-10 font-georgia text-deep">
      <div className="mx-auto max-w-2xl rounded-3xl border border-gold/35 bg-white p-6 shadow-lg sm:p-10">
        <button onClick={onBack} className="mb-8 text-sm text-mist">← Retour à MediumIA</button>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Laboratoire MediumIA · TEST uniquement</p>
        <h1 className="mb-4 text-3xl">Pass conférence en cinq fois</h1>
        <p className="mb-6 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
          Environnement PayPal Sandbox. Aucun achat réel et aucune place aux visios activée depuis cette page.
          Une offre réelle nécessitera la validation juridique et des CGV.
        </p>
        <div className="mb-6 rounded-2xl bg-cream p-5">
          <p className="text-2xl font-semibold">{money(9980)} × 5</p>
          <p className="mt-1 text-sm text-mist">Prix total TEST : {money(49900)} (au lieu de {money(59700)}).</p>
          <p className="mt-2 text-sm text-mist">Participation aux visios si les mensualités exigibles sont payées, sous réserve de validation.</p>
        </div>
        {loading ? <p>Vérification de votre connexion…</p> : !session ? (
          emailSent ? <p role="status">Un lien de connexion TEST vous a été envoyé. Vérifiez vos e-mails.</p> : (
            <form onSubmit={requestLink} className="space-y-3">
              <label htmlFor="conf-five-email" className="block text-sm">Adresse e-mail du compte élève TEST</label>
              <input id="conf-five-email" required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gold/40 p-3" />
              <button disabled={busy} className="rounded-xl bg-deep px-5 py-3 text-white disabled:opacity-50">Recevoir un lien de connexion</button>
            </form>
          )
        ) : offer ? (
          <div className="space-y-5">
            <p className="text-sm">Invitation personnelle : <strong>{offer.status}</strong></p>
            <p className="text-xs text-mist">Compte connecté : {session.user?.email}</p>
            {status?.status === 'invited' && (
              <div className="space-y-3">
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  <span>Je comprends qu’il s’agit uniquement d’un test technique avec PayPal Sandbox, sans achat réel et sans ouverture automatique de formation.</span>
                </label>
                <button disabled={!consent || busy} onClick={beginSandboxSubscription}
                  className="rounded-xl bg-deep px-5 py-3 text-white disabled:opacity-50">
                  Tester un abonnement PayPal Sandbox
                </button>
              </div>
            )}
            {status?.paypalSubscriptionPresent && (
              <button disabled={busy} onClick={syncPayment} className="rounded-xl border border-gold/50 px-5 py-3 disabled:opacity-50">
                Vérifier les mensualités Sandbox
              </button>
            )}
            {report && (
              <div role="status" className="rounded-xl border border-gold/35 p-4 text-sm">
                {report.paidInstalments} sur 5 échéances reconnues · reste {money(report.remainingCents)}.
                <p className="mt-2 text-xs">État PayPal : {report.paypalStatus} · aucun accès réel attribué.</p>
              </div>
            )}
            <button className="text-sm underline" onClick={refresh}>Actualiser</button>
          </div>
        ) : <p className="text-sm">Aucune invitation de test active pour ce compte.</p>}
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      </div>
    </main>
  )
}
