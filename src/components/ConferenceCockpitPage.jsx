import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/useAuth.js'

const LIVE_API = 'https://uotkpygeqqnekpolezts.supabase.co/functions/v1/conference-live'
const COPILOT_AGENT_ID = '2f5dcd1d-fb05-4623-80d6-8779aa5f561d'

function getSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[2] || 'premiere-conference-mediumia'
}

function formatClock(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(value))
}

function buildCopilotPrompt(questions = []) {
  const active = questions
    .filter((q) => !['answered', 'dismissed'].includes(q.status))
    .slice(0, 45)

  const lines = active.map((q, index) => (
    `${index + 1}. [${q.firstName || 'Participant'}] ${String(q.question || '').replace(/\s+/g, ' ').trim()}`
  ))

  const questionBlock = lines.join('\n').slice(0, 3150)
  return `Tu pilotes avec Sébastien une conférence MediumIA en direct. Analyse uniquement les questions ci-dessous, sans en inventer.

OBJECTIF
- regrouper les questions réellement similaires ;
- identifier le thème qui monte le plus ;
- recommander exactement 3 questions à traiter maintenant ;
- privilégier les questions utiles à plusieurs personnes, humaines, claires et complémentaires ;
- ne réponds pas aux questions : aide seulement Sébastien à choisir.

FORMAT ATTENDU, très court et lisible en direct :
🔥 THÈME MAJEUR — [nombre] questions
[thème en une ligne]

✨ 3 QUESTIONS À PRENDRE MAINTENANT
1. [Prénom] — [question, éventuellement reformulée sans changer le sens]
   ↳ [nombre] question(s) similaire(s) si pertinent
2. ...
3. ...

👀 À SURVEILLER
[un autre thème émergent en une ligne, ou « Rien pour l’instant »]

QUESTIONS RÉELLES DU PUBLIC
${questionBlock || 'Aucune question active.'}`
}

export default function ConferenceCockpitPage() {
  const slug = useMemo(getSlug, [])
  const { session, loading: authLoading, signIn, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [drawState, setDrawState] = useState('idle')
  const [winner, setWinner] = useState('')
  const [aiState, setAiState] = useState('idle')
  const [aiAnalysis, setAiAnalysis] = useState('')

  const call = useCallback(async (method = 'GET', body) => {
    const token = session?.access_token
    if (!token) throw new Error('Connexion requise.')
    const response = await fetch(`${LIVE_API}?slug=${encodeURIComponent(slug)}&mode=admin`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Cockpit indisponible.')
    return payload
  }, [session?.access_token, slug])

  const refresh = useCallback(async () => {
    if (!session?.access_token) return
    try {
      const payload = await call('GET')
      setData(payload)
      setWinner(payload?.raffle?.winnerName || '')
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [call, session?.access_token])

  useEffect(() => {
    if (!session?.access_token) return
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(timer)
  }, [refresh, session?.access_token])

  const handleLogin = async (event) => {
    event.preventDefault()
    setAuthError('')
    const { error } = await signIn(email.trim(), password)
    if (error) setAuthError('Connexion impossible. Vérifie tes identifiants MediumIA.')
  }

  const setQuestionStatus = async (questionId, status) => {
    setBusyId(questionId)
    try {
      await call('POST', { action: 'question_status', questionId, status })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const drawWinner = async () => {
    setDrawState('loading')
    setError('')
    try {
      const payload = await call('POST', { action: 'draw_raffle' })
      setWinner(payload.winnerName || 'Gagnant')
      setDrawState('success')
      await refresh()
    } catch (err) {
      setDrawState('error')
      setError(err.message)
    }
  }

  const runCopilot = async () => {
    const questions = data?.questions || []
    const activeQuestions = questions.filter((q) => !['answered', 'dismissed'].includes(q.status))
    if (activeQuestions.length === 0) {
      setAiState('empty')
      setAiAnalysis('Pas encore assez de matière : aucune question active à analyser.')
      return
    }

    setAiState('loading')
    setError('')
    try {
      const response = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          agentId: COPILOT_AGENT_ID,
          newConversation: true,
          message: buildCopilotPrompt(activeQuestions),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Analyse IA indisponible.')
      setAiAnalysis(payload.reply || 'Analyse reçue sans contenu.')
      setAiState('success')
    } catch (err) {
      setAiState('error')
      setError(err.message)
    }
  }

  if (authLoading) return <div className="min-h-screen bg-deep text-cream grid place-items-center font-georgia">Ouverture du cockpit…</div>

  if (!session) {
    return (
      <div className="min-h-screen bg-deep px-6 text-cream grid place-items-center">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-3xl border border-gold/30 bg-white/5 p-8">
          <p className="font-georgia text-xs uppercase tracking-[.22em] text-gold">COCKPIT CONFÉRENCE</p>
          <h1 className="mt-4 font-georgia text-3xl">Connexion Sébastien</h1>
          <p className="mt-3 font-georgia text-sm text-cream/55">Utilise ton compte MediumIA habituel.</p>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="mt-6 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 font-georgia text-sm outline-none" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" className="mt-3 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 font-georgia text-sm outline-none" />
          <button className="mt-4 w-full rounded-xl bg-gold px-5 py-3 font-georgia text-sm font-bold text-deep">Ouvrir le cockpit</button>
          {authError && <p className="mt-4 font-georgia text-xs text-red-200">{authError}</p>}
        </form>
      </div>
    )
  }

  const counts = data?.counts || {}
  const questions = data?.questions || []
  const raffle = data?.raffle

  return (
    <div className="min-h-screen bg-[#0f0d21] text-cream">
      <header className="sticky top-0 z-40 border-b border-gold/20 bg-[#0f0d21]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[.24em] text-gold">MEDIUMIA · COCKPIT CONFÉRENCE</p>
            <p className="mt-1 font-georgia text-sm text-cream/55">{data?.event?.title || 'Chargement…'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={refresh} className="rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-gold">Actualiser</button>
            <button onClick={signOut} className="rounded-lg border border-white/10 px-3 py-2 font-georgia text-xs text-cream/60">Déconnexion</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7">
        {error && <div className="mb-5 rounded-xl border border-red-300/20 bg-red-300/10 p-4 font-georgia text-sm text-red-100">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[['Inscrits', counts.registrations ?? 0], ['Ont rejoint', counts.attendees ?? 0], ['Présents maintenant', counts.presentNow ?? 0], ['Questions', counts.questions ?? 0], ['Tirage', counts.raffleEntries ?? 0]].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="font-georgia text-[10px] uppercase tracking-[.16em] text-gold">{label}</p>
              <p className="mt-2 font-georgia text-3xl font-semibold">{value}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">QUESTIONS DU PUBLIC</p>
                <h2 className="mt-2 font-georgia text-2xl">File en direct</h2>
              </div>
              <span className="rounded-full border border-gold/25 px-3 py-1 font-georgia text-xs text-gold">mise à jour 10 s</span>
            </div>
            <div className="mt-5 space-y-3">
              {questions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 p-6 text-center font-georgia text-sm text-cream/45">Aucune question pour le moment.</div>
              ) : questions.map((q) => (
                <article key={q.id} className={`rounded-2xl border p-5 ${q.status === 'selected' ? 'border-gold/60 bg-gold/10' : q.status === 'answered' ? 'border-emerald-300/20 bg-emerald-300/5' : 'border-white/10 bg-black/10'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-georgia text-xs text-gold">{q.firstName} · {new Date(q.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                      <p className="mt-2 font-georgia text-base leading-relaxed text-cream">{q.question}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-1 font-georgia text-[10px] uppercase text-cream/45">{q.status}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={busyId === q.id} onClick={() => setQuestionStatus(q.id, 'selected')} className="rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep disabled:opacity-50">À prendre</button>
                    <button disabled={busyId === q.id} onClick={() => setQuestionStatus(q.id, 'answered')} className="rounded-lg border border-emerald-300/25 px-3 py-2 font-georgia text-xs text-emerald-200 disabled:opacity-50">Répondue</button>
                    <button disabled={busyId === q.id} onClick={() => setQuestionStatus(q.id, 'dismissed')} className="rounded-lg border border-white/10 px-3 py-2 font-georgia text-xs text-cream/50 disabled:opacity-50">Écarter</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-gold/35 bg-[#1b1738] p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">✨ COPILOTE IA MEDIUMIA</p>
              <h2 className="mt-3 font-georgia text-2xl">Lis la salle pour moi</h2>
              <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/55">Regroupe les doublons, repère le thème majeur et propose les trois questions à prendre maintenant. Tu gardes toujours la décision finale.</p>
              <button onClick={runCopilot} disabled={aiState === 'loading'} className="mt-5 w-full rounded-xl bg-gold px-4 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-50">
                {aiState === 'loading' ? '✨ Analyse en cours…' : aiAnalysis ? '✨ Ré-analyser les questions' : '✨ Donne-moi les 3 questions à prendre'}
              </button>
              {aiAnalysis && (
                <div className="mt-5 whitespace-pre-wrap rounded-2xl border border-gold/25 bg-black/15 p-5 font-georgia text-sm leading-relaxed text-cream/85">{aiAnalysis}</div>
              )}
              <p className="mt-3 font-georgia text-[11px] leading-relaxed text-cream/35">Analyse déclenchée uniquement quand tu appuies sur le bouton. Les questions répondues ou écartées sont exclues.</p>
            </section>

            <section className="rounded-3xl border border-gold/35 bg-[#1b1738] p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">🎁 TIRAGE AU SORT</p>
              <h2 className="mt-3 font-georgia text-2xl">Formation complète · 597 €</h2>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4 font-georgia text-sm text-cream/65">
                <strong className="text-cream">Fenêtre :</strong> {formatClock(raffle?.opens_at)} → {formatClock(raffle?.closes_at)}<br />
                <strong className="text-cream">Participants :</strong> {counts.raffleEntries ?? 0}
              </div>
              {winner ? (
                <div className="mt-5 rounded-2xl border border-gold/50 bg-gold/10 p-5 text-center">
                  <p className="font-georgia text-xs uppercase tracking-[.18em] text-gold">GAGNANT</p>
                  <p className="mt-2 font-georgia text-3xl font-semibold">{winner}</p>
                </div>
              ) : (
                <button onClick={drawWinner} disabled={drawState === 'loading'} className="mt-5 w-full rounded-xl bg-gold px-5 py-4 font-georgia text-sm font-bold text-deep disabled:opacity-50">{drawState === 'loading' ? 'Tirage…' : '🎁 Tirer le gagnant'}</button>
              )}
              <p className="mt-3 font-georgia text-[11px] leading-relaxed text-cream/40">Le serveur refuse le tirage avant la fermeture prévue et conserve le même gagnant en cas de double clic.</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
