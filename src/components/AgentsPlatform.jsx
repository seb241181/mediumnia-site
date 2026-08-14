import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

const templates = [
  { id: 'commerce', icon: '◈', category: 'Commerce', name: 'Assistant Boutique', description: 'Répond aux questions clients, présente vos produits, explique vos horaires et oriente vers l’achat.', tag: 'Prêt à personnaliser', starter: 'Je tiens une boutique et je veux un agent qui répond aux questions de mes clients, présente mes produits et les aide avant leur achat.' },
  { id: 'cabinet', icon: '✦', category: 'Bien-être', name: 'Assistant Cabinet', description: 'Présente vos accompagnements, répond aux questions fréquentes et prépare la prise de rendez-vous.', tag: 'Prêt à personnaliser', starter: 'Je travaille dans le bien-être et je veux un agent qui présente mes accompagnements, répond aux questions et prépare les rendez-vous.' },
  { id: 'formation', icon: '◇', category: 'Formation', name: 'Assistant Formation', description: 'Accompagne vos élèves à partir de vos contenus, méthodes, règles et documents.', tag: 'Mémoire métier', starter: 'Je propose une formation et je veux un agent qui accompagne mes élèves à partir de mes contenus et de ma méthode.' },
  { id: 'tourisme', icon: '⌖', category: 'Tourisme', name: 'Assistant Tourisme', description: 'Informe les visiteurs, recommande des activités et répond à partir de vos informations locales.', tag: 'Multicanal', starter: 'Je travaille dans le tourisme et je veux un agent qui informe les visiteurs et recommande les bonnes activités.' },
  { id: 'immobilier', icon: '⌂', category: 'Immobilier', name: 'Assistant Immobilier', description: 'Qualifie les demandes, présente vos biens et prépare les informations utiles avant un échange humain.', tag: 'Professionnel', starter: 'Je travaille dans l’immobilier et je veux un agent qui qualifie les prospects, présente les biens et prépare mes rendez-vous.' },
  { id: 'social', icon: '✺', category: 'Marketing', name: 'Assistant Réseaux', description: 'Aide à préparer publications, idées de contenus et réponses cohérentes avec votre identité.', tag: 'Création', starter: 'Je veux un agent qui m’aide à préparer mes publications et à garder une communication cohérente sur mes réseaux.' },
]

const categories = ['Tous', ...new Set(templates.map((item) => item.category))]
const questions = [
  { key: 'mission', label: 'Que voulez-vous confier à votre agent ?', placeholder: 'Décrivez votre activité et ce que vous aimeriez que votre agent fasse pour vous…' },
  { key: 'audience', label: 'Avec qui votre agent va-t-il principalement parler ?', placeholder: 'Exemple : mes clients, mes prospects, mes élèves, les visiteurs de mon site…' },
  { key: 'tone', label: 'Comment voulez-vous qu’il s’exprime ?', placeholder: 'Exemple : chaleureux et rassurant, professionnel et direct, simple et pédagogique…' },
  { key: 'knowledge', label: 'Quelles connaissances devra-t-il maîtriser ?', placeholder: 'Exemple : mes prestations, mes tarifs, mes méthodes, mes produits, mes documents…' },
  { key: 'limits', label: 'Que ne doit-il jamais faire sans votre accord ?', placeholder: 'Exemple : promettre un résultat, modifier un rendez-vous, accorder une remise, donner un avis médical…' },
]

/* ─── Modal d'authentification (design MediumIA) ─── */
function AuthModal({ onClose, signIn, signUp }) {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setInfo('')
    const action = mode === 'signin' ? signIn : signUp
    const { data, error: err } = await action(email.trim(), password)
    setBusy(false)
    if (err) { setError(err.message || 'Une erreur est survenue.'); return }
    if (mode === 'signup' && !data?.session) {
      setInfo('Compte créé. Vérifiez votre email pour confirmer votre adresse, puis connectez-vous.')
      setMode('signin')
      return
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-deep/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl bg-deep text-cream p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-cream/50 hover:text-cream text-2xl leading-none" aria-label="Fermer">×</button>
        <p className="text-gold text-3xl mb-3 text-center">✦</p>
        <h3 className="font-georgia text-2xl text-center mb-1">{mode === 'signin' ? 'Connexion' : 'Créer un compte'}</h3>
        <p className="font-georgia text-cream/55 text-sm text-center mb-6">MediumIA Agents</p>

        {!isSupabaseConfigured() ? (
          <p className="font-georgia text-sm text-cream/70 leading-relaxed text-center bg-white/5 border border-gold/20 rounded-xl p-4">
            L’espace de connexion sera bientôt disponible. La configuration est en cours de finalisation.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="font-georgia text-xs text-cream/50 uppercase tracking-wider block mb-1.5">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr"
                className="w-full rounded-lg bg-white/10 border border-gold/25 px-4 py-3 text-cream placeholder:text-cream/30 outline-none focus:border-gold/60 font-georgia" />
            </div>
            <div>
              <label className="font-georgia text-xs text-cream/50 uppercase tracking-wider block mb-1.5">Mot de passe</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                className="w-full rounded-lg bg-white/10 border border-gold/25 px-4 py-3 text-cream placeholder:text-cream/30 outline-none focus:border-gold/60 font-georgia" />
            </div>
            {error && <p className="font-georgia text-sm text-red-300">{error}</p>}
            {info && <p className="font-georgia text-sm text-gold">{info}</p>}
            <button type="submit" disabled={busy} className="w-full font-georgia px-6 py-3.5 rounded-lg bg-gold text-deep font-bold disabled:opacity-50">
              {busy ? 'Un instant…' : (mode === 'signin' ? 'Se connecter' : 'Créer mon compte')}
            </button>
            <p className="font-georgia text-sm text-cream/55 text-center">
              {mode === 'signin' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
              <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo('') }} className="text-gold underline">
                {mode === 'signin' ? 'Créer un compte' : 'Se connecter'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

/* ─── Onglet « Mes agents » (lecture réelle, RLS) ─── */
function MyAgents({ user, onCreate }) {
  const [status, setStatus] = useState('loading') // loading | error | ready
  const [agents, setAgents] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !supabase) { setStatus('ready'); setAgents([]); return }
    let active = true
    setStatus('loading'); setError('')
    supabase
      .from('agents')
      .select('id, name, status, mission, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) { setError(err.message); setStatus('error'); return }
        setAgents(data || [])
        setStatus('ready')
      })
    return () => { active = false }
  }, [user])

  return (
    <section className="px-6 pb-24 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <h2 className="font-georgia text-3xl text-deep">Mes agents</h2>
        <button onClick={onCreate} className="font-georgia text-sm px-5 py-2.5 rounded-lg bg-deep text-gold font-bold">+ Nouvel agent</button>
      </div>

      {status === 'loading' && (
        <p className="font-georgia text-mist text-center py-16">Chargement de vos agents…</p>
      )}

      {status === 'error' && (
        <div className="rounded-2xl border border-red-300/40 bg-red-50 p-6 text-center">
          <p className="font-georgia text-red-500 mb-1">Impossible de charger vos agents.</p>
          <p className="font-georgia text-mist text-sm">{error}</p>
        </div>
      )}

      {status === 'ready' && agents.length === 0 && (
        <div className="rounded-3xl border border-gold/25 bg-white/55 p-10 text-center">
          <p className="text-gold text-4xl mb-4">✦</p>
          <p className="font-georgia text-deep text-xl mb-2">Aucun agent pour l’instant.</p>
          <p className="font-georgia text-mist mb-6">Créez votre premier agent : MediumIA le construit à partir de votre métier.</p>
          <button onClick={onCreate} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Créer mon premier agent</button>
        </div>
      )}

      {status === 'ready' && agents.length > 0 && (
        <div className="grid md:grid-cols-2 gap-5">
          {agents.map((agent) => (
            <article key={agent.id} className="rounded-2xl border border-gold/25 bg-white/55 p-6 shadow-sm">
              <div className="flex items-start justify-between mb-3 gap-3">
                <h3 className="font-georgia text-xl text-deep">{agent.name}</h3>
                <span className="font-georgia text-[11px] uppercase tracking-wider text-gold bg-deep/5 rounded-full px-3 py-1 shrink-0">{agent.status}</span>
              </div>
              <p className="font-georgia text-mist text-sm leading-relaxed line-clamp-4">{agent.mission || 'Agent en préparation.'}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

/* ─── Créateur d'agent (design conservé) + sauvegarde réelle ─── */
function AgentCreator({ initialMission = '', user, onRequireAuth, onCreated }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({ mission: initialMission, audience: '', tone: '', knowledge: '', limits: '' })
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const current = questions[step]
  const progress = Math.round(((step + (finished ? 1 : 0)) / questions.length) * 100)

  const next = () => {
    if (!answers[current.key].trim()) return
    if (step === questions.length - 1) setFinished(true)
    else setStep(step + 1)
  }

  async function createAgent() {
    // Sécurité : on ne fait JAMAIS confiance à un owner_id de formulaire.
    // L'ID provient toujours de la session Supabase (RLS le revérifie côté serveur).
    if (!user) { onRequireAuth(); return }
    if (!supabase) { setSaveError('Configuration Supabase manquante.'); return }
    setSaving(true); setSaveError('')
    const name = (answers.mission.trim().split('\n')[0].slice(0, 60)) || 'Mon agent'
    const { error } = await supabase.from('agents').insert({
      owner_id: user.id,
      name,
      mission: answers.mission,
      audience: answers.audience,
      tone: answers.tone,
      knowledge_summary: answers.knowledge,
      limits: answers.limits,
      status: 'draft',
      // permissions : valeur par défaut définie dans le schéma (jsonb) — non fournie ici.
    })
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setSaved(true)
  }

  if (finished) {
    return <div className="rounded-3xl bg-deep text-cream p-7 md:p-10 shadow-xl">
      <p className="text-gold text-4xl mb-5">✦</p>
      <p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-3">Première identité construite</p>
      <h2 className="font-georgia text-3xl md:text-4xl mb-4">Votre agent commence à prendre forme.</h2>
      <p className="font-georgia text-cream/70 leading-relaxed mb-7">MediumIA a maintenant assez d’éléments pour préparer sa première fiche. Rien n’est publié : vous garderez toujours la validation finale.</p>
      <div className="space-y-4">
        {questions.map((q) => <div key={q.key} className="rounded-xl border border-gold/20 bg-white/5 p-4"><p className="font-georgia text-xs text-gold mb-2">{q.label}</p><p className="font-georgia text-sm text-cream/85 leading-relaxed">{answers[q.key]}</p></div>)}
      </div>

      {saved ? (
        <div className="mt-7 rounded-xl border border-gold/40 bg-gold/10 p-5 text-center">
          <p className="text-gold text-3xl mb-2">✓</p>
          <p className="font-georgia text-cream font-bold mb-1">Agent enregistré.</p>
          <p className="font-georgia text-sm text-cream/70 mb-4">Votre agent est sauvegardé en brouillon dans votre espace.</p>
          <button onClick={() => onCreated?.()} className="font-georgia px-6 py-3 rounded-lg bg-gold text-deep font-bold">Voir mes agents →</button>
        </div>
      ) : (
        <>
          <div className="mt-7 rounded-xl border border-gold/30 bg-gold/10 p-5"><p className="font-georgia text-sm text-gold font-bold mb-2">Prochaine étape</p><p className="font-georgia text-sm text-cream/70 leading-relaxed">Enregistrer cet agent dans votre espace personnel. Il restera en brouillon, prêt à être affiné puis activé quand vous le déciderez.</p></div>
          {saveError && <p className="font-georgia text-sm text-red-300 mt-4">{saveError}</p>}
          <div className="mt-6 flex flex-col sm:flex-row items-center gap-4">
            <button onClick={createAgent} disabled={saving} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold disabled:opacity-50">
              {saving ? 'Enregistrement…' : (user ? 'Créer mon agent' : 'Se connecter pour créer mon agent')}
            </button>
            <button onClick={() => { setStep(0); setFinished(false); setSaveError('') }} className="font-georgia text-sm text-gold">← Modifier mes réponses</button>
          </div>
        </>
      )}
    </div>
  }

  return <div className="rounded-3xl bg-deep text-cream p-7 md:p-10 shadow-xl">
    <div className="flex items-center justify-between gap-4 mb-7"><div><p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-2">Créateur MediumIA</p><p className="font-georgia text-xs text-cream/45">Étape {step + 1} sur {questions.length}</p></div><span className="text-gold text-3xl">✦</span></div>
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-9"><div className="h-full bg-gold transition-all duration-300" style={{ width: `${progress}%` }} /></div>
    <p className="font-georgia text-cream/55 text-sm mb-3">Lumi vous accompagne</p>
    <h2 className="font-georgia text-2xl md:text-4xl leading-tight mb-7">{current.label}</h2>
    <textarea autoFocus rows="6" value={answers[current.key]} onChange={(e) => setAnswers({ ...answers, [current.key]: e.target.value })} placeholder={current.placeholder} className="w-full rounded-xl bg-white/10 border border-gold/25 px-5 py-4 text-cream placeholder:text-cream/30 outline-none focus:border-gold/60 font-georgia leading-relaxed" />
    <div className="mt-5 flex items-center justify-between gap-4">{step > 0 ? <button onClick={() => setStep(step - 1)} className="font-georgia text-sm text-cream/60">← Retour</button> : <span />}<button disabled={!answers[current.key].trim()} onClick={next} className="font-georgia px-7 py-3.5 rounded-lg bg-gold text-deep font-bold disabled:opacity-30">{step === questions.length - 1 ? 'Préparer mon agent →' : 'Continuer →'}</button></div>
    <p className="font-georgia text-xs text-cream/35 mt-6">Vos réponses restent dans cette page tant que vous n’avez pas cliqué sur « Créer mon agent ».</p>
  </div>
}

export default function AgentsPlatform({ onBack }) {
  const [category, setCategory] = useState('Tous')
  const [tab, setTab] = useState('explorer') // explorer | create | mes-agents
  const [starter, setStarter] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const { user, signIn, signUp, signOut } = useAuth()
  const visible = useMemo(() => category === 'Tous' ? templates : templates.filter((item) => item.category === category), [category])
  const openCreator = (mission = '') => { setStarter(mission); setTab('create'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const openMyAgents = () => {
    if (!user) { setAuthOpen(true); return }
    setTab('mes-agents'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <div className="min-h-screen bg-cream text-deep">
    <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20"><div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4"><button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm md:text-base font-semibold">✦ MEDIUMIA</button><div className="flex items-center gap-2 md:gap-3">
      <button onClick={() => setTab('explorer')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'explorer' ? 'bg-deep text-gold' : 'text-mist'}`}>Explorer</button>
      <button onClick={() => openCreator('')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'create' ? 'bg-deep text-gold' : 'text-mist'}`}>Créer</button>
      {user && <button onClick={openMyAgents} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'mes-agents' ? 'bg-deep text-gold' : 'text-mist'}`}>Mes agents</button>}
      {user ? (
        <div className="flex items-center gap-2">
          <span className="hidden md:inline font-georgia text-xs text-mist/70 max-w-[140px] truncate" title={user.email}>{user.email}</span>
          <button onClick={() => signOut()} className="font-georgia text-xs md:text-sm px-3 py-2 rounded-lg border border-gold/40 text-deep font-bold">Déconnexion</button>
        </div>
      ) : (
        <button onClick={() => setAuthOpen(true)} className="font-georgia text-xs md:text-sm px-4 py-2 rounded-lg bg-gold text-deep font-bold">Connexion</button>
      )}
    </div></div></header>
    <main>
      <section className="px-6 pt-16 pb-12 text-center max-w-4xl mx-auto"><p className="font-georgia text-gold tracking-[0.25em] text-xs uppercase mb-5">MediumIA Agents</p><h1 className="font-georgia text-4xl md:text-6xl leading-tight font-medium mb-6">Votre savoir. Votre façon de travailler.<br/><span className="text-gold">Votre agent IA.</span></h1><p className="font-georgia text-mist text-base md:text-xl leading-relaxed max-w-2xl mx-auto mb-9">Choisissez un agent prêt à l’emploi ou créez le vôtre. MediumIA lui transmet votre métier, vos documents, vos règles et votre manière d’accompagner.</p><div className="flex flex-col sm:flex-row gap-4 justify-center"><button onClick={() => setTab('explorer')} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Explorer les agents</button><button onClick={() => openCreator('')} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Créer mon agent</button></div></section>
      {tab === 'explorer' && <section className="px-6 pb-20 max-w-6xl mx-auto"><div className="flex gap-2 overflow-x-auto pb-5">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 font-georgia text-sm px-4 py-2 rounded-full border ${category === item ? 'bg-deep text-gold border-deep' : 'border-gold/30 text-mist'}`}>{item}</button>)}</div><div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">{visible.map((agent) => <article key={agent.id} className="rounded-2xl border border-gold/25 bg-white/55 p-6 flex flex-col min-h-[300px] shadow-sm"><div className="flex items-start justify-between mb-6"><span className="text-gold text-3xl">{agent.icon}</span><span className="font-georgia text-[11px] uppercase tracking-wider text-mist bg-deep/5 rounded-full px-3 py-1">{agent.category}</span></div><h2 className="font-georgia text-2xl mb-3">{agent.name}</h2><p className="font-georgia text-mist text-sm leading-relaxed flex-1">{agent.description}</p><div className="mt-6 pt-5 border-t border-gold/15 flex items-center justify-between gap-3"><span className="font-georgia text-xs text-gold">{agent.tag}</span><button onClick={() => openCreator(agent.starter)} className="font-georgia text-sm font-bold">Personnaliser →</button></div></article>)}</div></section>}
      {tab === 'create' && <section className="px-6 pb-24 max-w-3xl mx-auto"><AgentCreator key={starter} initialMission={starter} user={user} onRequireAuth={() => setAuthOpen(true)} onCreated={openMyAgents}/></section>}
      {tab === 'mes-agents' && <MyAgents user={user} onCreate={() => openCreator('')}/>}
    </main>
    {authOpen && <AuthModal onClose={() => setAuthOpen(false)} signIn={signIn} signUp={signUp}/>}
  </div>
}
