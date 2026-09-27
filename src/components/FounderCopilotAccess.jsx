import { useCallback, useEffect, useRef, useState } from 'react'
import AgentChat from './AgentChat.jsx'
import ProAssistantCreator from './ProAssistantCreator.jsx'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'
import { buildAssistantDraft } from '../lib/proAssistantDraft.js'
import { reseauPractitioners } from '../data/reseauPractitioners.js'
import { clearProOnboarding, markProOnboarding, proConfirmationRedirectUrl } from '../lib/proOnboarding.js'

// Espace MediumIA Pro (/agents). L'accès se fait sur invitation : le compte
// seul ne donne aucun droit, le serveur vérifie l'invitation et l'adresse
// confirmée avant d'activer l'espace. Le copilote Founder existant reste
// ouvert tel quel.

const API = '/api/agent-chat'

function SignInOrUp({ signIn, signUp }) {
  // Arrivée depuis l'e-mail d'invitation : création du compte en premier.
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).has('invitation') ? 'signup' : 'signin'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError('')
    setInfo('')
    if (mode === 'signin') {
      const { error: signInError } = await signIn(email.trim(), password)
      if (signInError) setError('Connexion impossible. Vérifiez votre adresse et votre mot de passe.')
    } else {
      if (password.length < 8) {
        setError('Choisissez un mot de passe d’au moins 8 caractères.')
      } else {
        const { data, error: signUpError } = await signUp(email.trim(), password, { emailRedirectTo: proConfirmationRedirectUrl() })
        if (signUpError) setError('Création du compte impossible. Si vous avez déjà un compte, connectez-vous.')
        else if (!data?.session) {
          markProOnboarding()
          setInfo('Dernière étape : ouvrez l’e-mail de confirmation que vous venez de recevoir et cliquez sur le lien. Vous reviendrez directement ici, dans votre espace pro.')
        }
      }
    }
    setBusy(false)
  }

  const field = 'w-full rounded-xl border border-gold/25 bg-white px-4 py-3 font-georgia text-deep outline-none focus:border-gold/60'
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-gold/25 bg-white/75 p-7 shadow-xl md:p-10">
      <p className="text-center font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Espace MediumIA Pro</p>
      <h1 className="mt-3 text-center font-georgia text-3xl text-deep">{mode === 'signin' ? 'Connexion' : 'Créer mon compte'}</h1>
      <p className="mt-3 text-center font-georgia text-sm leading-relaxed text-mist">
        {mode === 'signin'
          ? 'Accès réservé aux professionnels invités du Réseau MediumIA.'
          : 'Utilisez l’adresse e-mail à laquelle vous avez reçu votre invitation.'}
      </p>
      {!isSupabaseConfigured() ? (
        <p className="mt-6 text-center font-georgia text-sm text-red-600">Configuration indisponible.</p>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div>
            <label htmlFor="pro-email" className="mb-1.5 block font-georgia text-xs uppercase tracking-wider text-mist">E-mail</label>
            <input id="pro-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="pro-password" className="mb-1.5 block font-georgia text-xs uppercase tracking-wider text-mist">Mot de passe</label>
            <input id="pro-password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </div>
          {error && <p role="alert" className="font-georgia text-sm text-red-600">{error}</p>}
          {info && <p role="status" className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 font-georgia text-sm text-deep">{info}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-deep px-6 py-3.5 font-georgia font-bold text-gold disabled:opacity-50">
            {busy ? 'Un instant…' : mode === 'signin' ? 'Entrer dans mon espace' : 'Créer mon compte'}
          </button>
        </form>
      )}
      <p className="mt-5 text-center font-georgia text-sm text-mist">
        {mode === 'signin' ? 'Vous avez reçu une invitation ? ' : 'Déjà un compte ? '}
        <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo('') }} className="font-semibold text-deep underline decoration-gold/50 underline-offset-4">
          {mode === 'signin' ? 'Créer mon compte' : 'Me connecter'}
        </button>
      </p>
    </div>
  )
}

function Panel({ icon = '✦', title, children }) {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-gold/25 bg-white/75 p-8 text-center shadow-sm">
      <p className="mb-4 text-4xl text-gold" aria-hidden="true">{icon}</p>
      <h1 className="mb-3 font-georgia text-2xl text-deep">{title}</h1>
      {children}
    </div>
  )
}

export default function FounderCopilotAccess({ onBack }) {
  const { user, session, loading: authLoading, signIn, signUp, signOut } = useAuth()
  const [state, setState] = useState('loading')
  const [workspace, setWorkspace] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const call = useCallback(async (action, body) => {
    const res = await fetch(`${API}?action=${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${session?.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error || 'pro_workspace_unavailable'), { status: res.status })
    return data
  }, [session?.access_token])

  const autoClaimTried = useRef(false)

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      let data = await call('workspace')
      // Invitation en attente et adresse confirmée : l'espace s'active tout
      // seul (le serveur refait toutes les vérifications), puis Lumi démarre.
      if (!data.membership?.live && data.invitation && data.emailConfirmed && !autoClaimTried.current) {
        autoClaimTried.current = true
        try {
          await call('claim', {})
          data = await call('workspace')
        } catch { /* le bouton « Activer mon espace pro » reste proposé */ }
      }
      setWorkspace(data)
      if (data.membership?.live) {
        clearProOnboarding()
        setState(data.agent ? 'ready' : 'create')
      } else setState('no-access')
    } catch {
      setState('error')
    }
  }, [call])

  useEffect(() => {
    if (authLoading) return
    if (!user || !session?.access_token) { setState('signed-out'); setWorkspace(null); return }
    load()
  }, [authLoading, user, session?.access_token, load])

  async function claim() {
    setBusy(true)
    setError('')
    try { await call('claim', {}); await load() } catch (e) { setError(e.message) }
    setBusy(false)
  }

  async function saveAssistant(values) {
    setBusy(true)
    setError('')
    try {
      const data = await call('assistant', { assistant: values })
      setWorkspace((w) => ({ ...w, agent: data.agent }))
      setEditing(false)
      setState('ready')
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  async function handleSignOut() {
    await signOut()
    setState('signed-out')
    setWorkspace(null)
  }

  const agent = workspace?.agent
  const reseauSlug = agent?.reseau_slug || workspace?.reseauSlug || workspace?.invitation?.reseauSlug
  const practitioner = reseauPractitioners.find((p) => p.id === reseauSlug) || null
  const isFounder = workspace?.membership?.accessLevel === 'founder'

  return (
    <div className="cosmic-page cosmic-page--agents min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-6">
          <button onClick={onBack} className="font-georgia text-sm text-mist transition-colors hover:text-deep">← MediumIA</button>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-gold/40 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">{isFounder ? 'Founder' : 'Espace pro'}</span>
            {user && <button onClick={handleSignOut} className="rounded-lg border border-gold/35 px-3 py-2 font-georgia text-xs text-deep md:text-sm">Déconnexion</button>}
          </div>
        </div>
      </header>

      <main className="px-4 py-10 md:px-6">
        {authLoading || state === 'loading' ? (
          <p className="py-20 text-center font-georgia text-mist">Ouverture de votre espace…</p>
        ) : state === 'signed-out' ? (
          <SignInOrUp signIn={signIn} signUp={signUp} />
        ) : state === 'no-access' ? (
          workspace?.invitation ? (
            <Panel title="Votre invitation vous attend">
              <p className="mb-6 font-georgia text-sm leading-relaxed text-mist">
                {practitioner ? `Vous avez été invité·e pour la fiche « ${practitioner.name} » du Réseau MediumIA.` : 'Vous avez été invité·e à rejoindre MediumIA Pro.'}
                {' '}Activez votre espace pour créer votre assistant IA.
              </p>
              {workspace.emailConfirmed ? (
                <button onClick={claim} disabled={busy} className="rounded-xl bg-deep px-6 py-3 font-georgia font-bold text-gold disabled:opacity-60">{busy ? 'Activation…' : 'Activer mon espace pro'}</button>
              ) : (
                <p className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 font-georgia text-sm text-deep">Confirmez d’abord votre adresse grâce à l’e-mail reçu à la création du compte, puis rechargez cette page.</p>
              )}
              {error && <p role="alert" className="mt-4 font-georgia text-sm text-red-600">Activation impossible pour le moment ({error}).</p>}
            </Panel>
          ) : (
            <Panel icon="◇" title="Espace réservé aux membres du Réseau">
              <p className="mb-6 font-georgia text-sm leading-relaxed text-mist">Ce compte n’a pas encore d’accès MediumIA Pro. L’espace s’ouvre sur invitation, avec l’adresse e-mail qui a reçu l’invitation.</p>
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <a href="/pro" className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold">Demander un accès</a>
                <button onClick={handleSignOut} className="rounded-xl border border-gold/40 px-5 py-3 font-georgia text-sm font-semibold text-deep">Changer de compte</button>
              </div>
            </Panel>
          )
        ) : state === 'create' || (state === 'ready' && editing) ? (
          <>
          {state === 'create' && (
            <div className="mx-auto mb-6 max-w-2xl text-center">
              <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Bienvenue dans MediumIA Pro</p>
              <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">Votre espace est activé. Lumi vous pose 6 questions pour créer votre assistant ; vous pourrez tout modifier ensuite. Il reste privé jusqu’à ce que vous décidiez de l’afficher.</p>
            </div>
          )}
          <ProAssistantCreator
            key={editing ? 'edit' : 'create'}
            mode={editing ? 'edit' : 'create'}
            initial={editing && agent ? {
              name: agent.name || '', mission: agent.mission || '', audience: agent.audience || '', tone: agent.tone || '',
              knowledge_summary: agent.knowledge_summary || '', limits: agent.limits || '',
            } : buildAssistantDraft(practitioner)}
            saving={busy}
            error={error}
            onSave={saveAssistant}
            onCancel={editing ? () => { setEditing(false); setError('') } : undefined}
          />
          </>
        ) : state === 'ready' && agent ? (
          <>
            <section className="mx-auto mb-5 max-w-5xl rounded-2xl border border-gold/25 bg-white/70 px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre assistant</p>
                  <p className="font-georgia text-lg font-medium text-deep">{agent.name}</p>
                  <p className="font-georgia text-xs text-mist">
                    {practitioner ? `Rattaché à votre fiche « ${practitioner.name} »` : 'Non rattaché à une fiche du Réseau'}
                    {' · '}{agent.public_enabled ? 'Visible sur votre fiche' : 'Privé : testez-le ici avant sa mise en ligne sur votre fiche'}
                  </p>
                </div>
                <button onClick={() => { setEditing(true); setError('') }} className="shrink-0 rounded-xl border border-gold/40 px-4 py-2.5 font-georgia text-sm font-semibold text-deep">Modifier ses réglages</button>
              </div>
            </section>
            <AgentChat agentId={agent.id} onBack={onBack} backLabel="MediumIA" documentsEnabled={true} />
          </>
        ) : (
          <Panel icon="◇" title="Espace momentanément indisponible">
            <p className="mb-6 font-georgia text-sm text-mist">Nous n’avons pas pu ouvrir votre espace. Réessayez dans un instant.</p>
            <button onClick={load} className="rounded-xl border border-gold/40 px-5 py-3 font-georgia text-sm font-semibold text-deep">Réessayer</button>
          </Panel>
        )}
      </main>
    </div>
  )
}
