import { useEffect, useState } from 'react'
import AgentChat from './AgentChat.jsx'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

function FounderSignIn({ signIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError('')
    const { error: signInError } = await signIn(email.trim(), password)
    if (signInError) setError('Connexion impossible. Vérifiez vos identifiants.')
    setBusy(false)
  }

  return (
    <div className="rounded-3xl border border-gold/25 bg-white/70 p-7 md:p-10 shadow-xl max-w-md mx-auto">
      <p className="text-gold text-4xl text-center mb-4">✦</p>
      <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase text-center mb-3">Pilote privé</p>
      <h1 className="font-georgia text-3xl text-deep text-center mb-3">Accès Founder</h1>
      <p className="font-georgia text-sm text-mist text-center leading-relaxed mb-7">
        Cet espace n’est pas ouvert au public. Connectez-vous avec un compte Founder déjà autorisé.
      </p>

      {!isSupabaseConfigured() ? (
        <p className="font-georgia text-sm text-red-500 text-center">Configuration Supabase indisponible.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-gold/25 bg-white px-4 py-3 font-georgia text-deep outline-none focus:border-gold/60"
            />
          </div>
          <div>
            <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">Mot de passe</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-gold/25 bg-white px-4 py-3 font-georgia text-deep outline-none focus:border-gold/60"
            />
          </div>
          {error && <p className="font-georgia text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-gold px-6 py-3.5 font-georgia font-bold text-deep disabled:opacity-50">
            {busy ? 'Connexion…' : 'Entrer dans mon espace Founder'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function FounderCopilotAccess({ onBack }) {
  const { user, loading: authLoading, signIn, signOut } = useAuth()
  const [state, setState] = useState('loading')
  const [agentId, setAgentId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setState('signed-out')
      setAgentId(null)
      setError('')
      return
    }
    if (!supabase) {
      setState('error')
      setError('Configuration Supabase indisponible.')
      return
    }

    let active = true

    async function loadFounderAccess() {
      setState('loading')
      setError('')
      setAgentId(null)

      const { data: membership, error: membershipError } = await supabase
        .from('pro_memberships')
        .select('id, access_level, status, expires_at')
        .maybeSingle()

      if (!active) return
      if (membershipError) {
        setState('error')
        setError('Impossible de vérifier votre accès Founder.')
        return
      }

      const expired = membership?.expires_at && new Date(membership.expires_at) <= new Date()
      if (!membership || membership.access_level !== 'founder' || membership.status !== 'active' || expired) {
        setState('denied')
        return
      }

      const { data: agents, error: agentError } = await supabase
        .from('agents')
        .select('id, name, status, mission, created_at')
        .neq('status', 'archived')
        .order('created_at', { ascending: true })
        .limit(1)

      if (!active) return
      if (agentError) {
        setState('error')
        setError('Impossible d’ouvrir votre copilote.')
        return
      }

      const agent = agents?.[0]
      if (!agent) {
        setState('no-agent')
        return
      }

      setAgentId(agent.id)
      setState('ready')
    }

    loadFounderAccess()
    return () => { active = false }
  }, [authLoading, user])

  async function handleSignOut() {
    await signOut()
    setState('signed-out')
    setAgentId(null)
  }

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 flex items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">← MediumIA</button>
          <div className="flex items-center gap-3">
            <span className="font-georgia text-[10px] uppercase tracking-[0.18em] rounded-full border border-gold/40 px-3 py-1 text-gold">Founder pilot</span>
            {user && <button onClick={handleSignOut} className="font-georgia text-xs md:text-sm border border-gold/35 rounded-lg px-3 py-2 text-deep">Déconnexion</button>}
          </div>
        </div>
      </header>

      <main className="px-4 md:px-6 py-10">
        {authLoading || state === 'loading' ? (
          <p className="font-georgia text-mist text-center py-20">Vérification de votre accès Founder…</p>
        ) : state === 'signed-out' ? (
          <FounderSignIn signIn={signIn} />
        ) : state === 'denied' ? (
          <div className="max-w-xl mx-auto rounded-3xl border border-gold/25 bg-white/70 p-8 text-center shadow-sm">
            <p className="text-gold text-4xl mb-4">◇</p>
            <h1 className="font-georgia text-2xl text-deep mb-3">Accès Founder non actif</h1>
            <p className="font-georgia text-sm text-mist leading-relaxed mb-6">Ce compte ne dispose pas d’un accès Founder actif à ce pilote privé.</p>
            <button onClick={handleSignOut} className="font-georgia rounded-lg border border-gold/40 px-5 py-3 font-bold text-deep">Changer de compte</button>
          </div>
        ) : state === 'no-agent' ? (
          <div className="max-w-xl mx-auto rounded-3xl border border-gold/25 bg-white/70 p-8 text-center shadow-sm">
            <p className="text-gold text-4xl mb-4">✦</p>
            <h1 className="font-georgia text-2xl text-deep mb-3">Aucun copilote Founder</h1>
            <p className="font-georgia text-sm text-mist leading-relaxed">Votre accès est actif, mais aucun copilote n’est encore attaché à ce membership.</p>
          </div>
        ) : state === 'error' ? (
          <div className="max-w-xl mx-auto rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="font-georgia text-red-600">{error || 'Impossible d’ouvrir le pilote Founder.'}</p>
          </div>
        ) : agentId ? (
          <>
            <div className="max-w-5xl mx-auto mb-5 rounded-2xl border border-gold/25 bg-gold/5 px-5 py-4">
              <p className="font-georgia text-sm text-deep"><strong>Pilote Founder :</strong> conversation sécurisée activée. Création d’assistants, documents et actions externes restent désactivés pendant cette phase.</p>
            </div>
            <AgentChat agentId={agentId} onBack={onBack} backLabel="MediumIA" documentsEnabled={false} />
          </>
        ) : null}
      </main>
    </div>
  )
}
