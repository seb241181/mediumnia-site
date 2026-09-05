import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'

function readRecoveryParams() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return {
    tokenHash: hash.get('token_hash') || query.get('token_hash'),
    type: hash.get('type') || query.get('type'),
  }
}

export default function RdvPasswordRecovery({ onBack }) {
  const [{ tokenHash, type }] = useState(readRecoveryParams)
  const [email, setEmail] = useState('')
  const [requestSent, setRequestSent] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const hasRecoveryLink = Boolean(tokenHash && type === 'recovery')

  async function handleRecoveryRequest(event) {
    event.preventDefault()
    setError(null)
    setRequestLoading(true)

    try {
      const response = await fetch('/api/rdv-auth-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Impossible d’envoyer l’e-mail pour le moment.')
      setRequestSent(true)
    } catch (err) {
      setError(err?.message || 'Impossible d’envoyer l’e-mail pour le moment.')
    } finally {
      setRequestLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    if (!supabase) {
      setError('Supabase Sandbox n’est pas configuré sur ce Preview.')
      return
    }
    if (password.length < 8) {
      setError('Choisissez un mot de passe d’au moins 8 caractères.')
      return
    }
    if (password !== confirmation) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)
    try {
      let hasRecoverySession = sessionReady

      if (!hasRecoverySession && tokenHash && type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        })
        if (verifyError) throw verifyError
        hasRecoverySession = true
        setSessionReady(true)
        window.history.replaceState({}, '', '/rdv/reset-password')
      }

      if (!hasRecoverySession) {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        hasRecoverySession = Boolean(data?.session)
      }

      if (!hasRecoverySession) {
        throw new Error('Lien invalide ou expiré. Demandez un nouvel e-mail de récupération.')
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setPassword('')
      setConfirmation('')
      setSuccess(true)
    } catch (err) {
      setError(err?.message || 'Impossible de modifier le mot de passe.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-3">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-2xl text-deep mb-2">Nouveau mot de passe</h1>
          <p className="font-georgia text-sm text-mist">MediumIA Rendez-vous</p>
        </div>

        <div className="rounded-2xl border border-gold/25 bg-white/60 p-7">
          {requestSent ? (
            <div className="space-y-5 text-center">
              <p className="font-georgia text-sm leading-relaxed text-emerald-800">
                Si cette adresse correspond à votre compte praticien, un nouvel e-mail vient d’être envoyé.
              </p>
              <p className="font-georgia text-xs leading-relaxed text-mist">
                Ouvrez uniquement le message le plus récent, puis choisissez votre mot de passe.
              </p>
            </div>
          ) : success ? (
            <div className="space-y-5 text-center">
              <p className="font-georgia text-sm text-emerald-800">
                Votre mot de passe a bien été enregistré.
              </p>
              <a
                href="/rdv"
                className="block w-full rounded-xl bg-deep py-3 font-georgia text-sm font-bold text-gold"
              >
                Ouvrir mon espace RDV →
              </a>
            </div>
          ) : !hasRecoveryLink ? (
            <form onSubmit={handleRecoveryRequest} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">
                  {error}
                </div>
              )}

              <p className="font-georgia text-xs leading-relaxed text-mist">
                Indiquez l’adresse de votre compte praticien. Vous recevrez un lien sécurisé pour choisir votre mot de passe.
              </p>

              <div>
                <label className="font-georgia text-xs text-mist block mb-1.5">Adresse e-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="votre@email.com"
                  className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm text-deep bg-white/80 focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20"
                />
              </div>

              <button
                type="submit"
                disabled={requestLoading}
                className="w-full rounded-xl bg-deep py-3 font-georgia text-sm font-bold text-gold disabled:opacity-60"
              >
                {requestLoading ? 'Envoi…' : 'Recevoir le lien sécurisé →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-xs text-red-800">
                  {error}
                </div>
              )}

              <p className="font-georgia text-xs leading-relaxed text-mist">
                Le lien ne sera validé qu’au moment où vous enregistrez votre nouveau mot de passe.
              </p>

              <div>
                <label className="font-georgia text-xs text-mist block mb-1.5">Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                  className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm text-deep bg-white/80 focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="font-georgia text-xs text-mist block mb-1.5">Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                  className="w-full border border-gold/25 rounded-xl px-4 py-2.5 font-georgia text-sm text-deep bg-white/80 focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-deep py-3 font-georgia text-sm font-bold text-gold disabled:opacity-60"
              >
                {loading ? 'Enregistrement…' : 'Enregistrer le mot de passe →'}
              </button>
            </form>
          )}
        </div>

        <button onClick={onBack} className="mt-5 w-full text-center font-georgia text-xs text-mist hover:text-deep">
          Retour à MediumIA
        </button>
      </div>
    </div>
  )
}
