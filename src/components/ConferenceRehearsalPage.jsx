import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/useAuth.js'

const LIVE_API = 'https://uotkpygeqqnekpolezts.supabase.co/functions/v1/conference-live'
const COPILOT_AGENT_ID = '2f5dcd1d-fb05-4623-80d6-8779aa5f561d'

const PARTICIPANTS = [
  'Sophie', 'Julie', 'Marc', 'Claire', 'Nathalie', 'Thomas', 'Élodie', 'Karine', 'David', 'Céline',
  'Aurore', 'Mélanie', 'Fabien', 'Isabelle', 'Laurent', 'Sandrine', 'Anaïs', 'Nicolas', 'Valérie', 'Émilie',
  'Romain', 'Stéphanie', 'Alexandre', 'Caroline', 'Mickaël', 'Audrey', 'Christophe', 'Laetitia', 'Jérôme', 'Virginie',
]

const REHEARSAL_SCRIPT = [
  ['Sophie', "Comment distinguer une vraie intuition d'une pensée que mon mental fabrique ?"],
  ['Julie', "Pourquoi je ressens facilement les autres mais presque jamais ce qui me concerne ?"],
  ['Marc', "Est-ce que tout le monde peut développer sa médiumnité ou faut-il avoir un don dès le départ ?"],
  ['Claire', "Quand une information arrive très vite dans ma tête, comment savoir si c'est intuitif ou imaginé ?"],
  ['Nathalie', "J'ai peur de me tromper quand je ressens quelque chose pour quelqu'un. Comment dépasser cette peur ?"],
  ['Thomas', "Est-ce qu'on peut développer ses perceptions sans voir ni entendre clairement des défunts ?"],
  ['Élodie', "Comment différencier mon intuition de mes envies personnelles ?"],
  ['Karine', "Peut-on apprendre la médiumnité même si on n'a jamais eu de phénomène spectaculaire ?"],
  ['David', "Pourquoi mes perceptions sont plus fortes quand je suis fatigué ou juste avant de dormir ?"],
  ['Céline', "Comment savoir si un signe vient vraiment d'un proche décédé et pas d'une coïncidence ?"],
  ['Aurore', "Quand je pense à quelqu'un juste avant qu'il m'appelle, est-ce déjà une forme de perception ?"],
  ['Mélanie', "Je sens beaucoup les ambiances des lieux. Est-ce de l'hypersensibilité ou de la médiumnité ?"],
  ['Fabien', "Comment ne pas projeter ses propres problèmes quand on fait une guidance pour quelqu'un ?"],
  ['Isabelle', "J'ai souvent une première impression juste puis je la corrige et je me trompe. Pourquoi ?"],
  ['Laurent', "Peut-on couper ses perceptions quand on ne veut pas être sollicité toute la journée ?"],
  ['Sandrine', "Comment travailler l'intuition sans devenir obsédé par les signes partout ?"],
  ['Anaïs', "Les rêves peuvent-ils être un vrai canal médiumnique ou sont-ils surtout symboliques ?"],
  ['Nicolas', "Est-ce normal de ne rien ressentir certains jours alors que d'autres fois tout semble évident ?"],
  ['Valérie', "Comment savoir si une image intérieure est une perception ou simplement mon imagination visuelle ?"],
  ['Émilie', "Pourquoi la peur de donner une mauvaise information bloque-t-elle parfois complètement les ressentis ?"],
  ['Romain', "La médiumnité peut-elle se développer avec une méthode structurée comme n'importe quelle compétence ?"],
  ['Stéphanie', "Que faire quand deux ressentis contradictoires arrivent sur la même personne ?"],
  ['Alexandre', "Comment protéger son énergie sans entrer dans la peur de tout ce qui est invisible ?"],
  ['Caroline', "Les enfants perçoivent-ils naturellement davantage ou est-ce une impression d'adulte ?"],
  ['Mickaël', "Peut-on ressentir les animaux de la même façon que les personnes ?"],
  ['Audrey', "Comment faire la différence entre empathie très forte et réception d'une information précise ?"],
  ['Christophe', "Est-ce que noter ses ressentis avant de vérifier aide vraiment à progresser ?"],
  ['Laetitia', "Pourquoi une perception juste est parfois très banale alors que j'attends quelque chose de spectaculaire ?"],
  ['Jérôme', "Est-ce qu'on peut entraîner la médiumnité sans pratiquer sur des inconnus au début ?"],
  ['Virginie', "Quel est le meilleur premier exercice pour quelqu'un qui doute complètement de ses perceptions ?"],
].map(([firstName, question], index) => ({
  id: `rehearsal-q${String(index + 1).padStart(2, '0')}`,
  firstName,
  question,
}))

function getSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[2] || 'premiere-conference-mediumia'
}

function formatClock(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(value))
}

function buildCopilotPrompt(questions = []) {
  const active = questions
    .filter((q) => !['answered', 'dismissed'].includes(q.status))
    .slice(0, 45)

  const lines = active.map((q, index) => (
    `${index + 1}. heure=${formatClock(q.created_at)} | id=${q.id} | prénom=${q.firstName} | question=${String(q.question || '').replace(/\s+/g, ' ').trim()}`
  ))

  return `Tu pilotes avec Sébastien une RÉPÉTITION de conférence MediumIA. Toutes les questions ci-dessous sont fictives et servent uniquement à tester la régie. Analyse uniquement ces questions, sans en inventer.

OBJECTIF
- regrouper les questions réellement similaires ;
- identifier le thème dominant ;
- tenir compte de l'heure des questions pour repérer ce qui monte récemment ;
- recommander jusqu'à 3 questions à traiter maintenant ;
- privilégier les questions utiles à plusieurs personnes, humaines, claires et complémentaires ;
- ne réponds jamais aux questions : aide seulement Sébastien à choisir ;
- pour chaque recommandation, réutilise STRICTEMENT l'id exact d'une question fournie.

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
{
  "theme": { "label": "thème majeur en une ligne", "count": 0 },
  "recommendations": [
    { "id": "id exact de la question", "similarCount": 0, "reason": "raison très courte" }
  ],
  "watch": "thème ou angle qui monte dans les questions les plus récentes, ou Rien pour l'instant"
}

RÈGLES
- maximum 3 recommandations ;
- n'invente aucune question ;
- similarCount compte la question retenue ;
- theme.count correspond au nombre réel de questions du thème majeur ;
- watch s'appuie sur la récence des heures fournies ;
- reason = 8 mots maximum.

QUESTIONS FICTIVES DE LA RÉPÉTITION
${lines.join('\n').slice(0, 3150) || 'Aucune question active.'}`
}

function parseCopilotPlan(reply, questions = []) {
  const raw = String(reply || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Réponse IA non structurée.')

  const parsed = JSON.parse(raw.slice(start, end + 1))
  const activeIds = new Set(
    questions
      .filter((q) => !['answered', 'dismissed'].includes(q.status))
      .map((q) => q.id),
  )
  const seen = new Set()
  const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : [])
    .filter((item) => item && activeIds.has(item.id) && !seen.has(item.id) && seen.add(item.id))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      similarCount: Math.max(1, Number(item.similarCount) || 1),
      reason: String(item.reason || '').trim().slice(0, 120),
    }))

  if (!recommendations.length) throw new Error('Aucune recommandation exploitable reçue.')

  return {
    theme: {
      label: String(parsed?.theme?.label || 'Thème en cours').trim().slice(0, 180),
      count: Math.max(1, Number(parsed?.theme?.count) || recommendations[0].similarCount || 1),
    },
    recommendations,
    watch: String(parsed?.watch || "Rien pour l'instant").trim().slice(0, 220),
  }
}

export default function ConferenceRehearsalPage() {
  const slug = useMemo(getSlug, [])
  const { session, loading: authLoading, signIn, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [accessState, setAccessState] = useState('idle')
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState([])
  const [cursor, setCursor] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [busyId, setBusyId] = useState('')
  const [aiState, setAiState] = useState('idle')
  const [aiPlan, setAiPlan] = useState(null)
  const [aiRaw, setAiRaw] = useState('')
  const [winner, setWinner] = useState('')

  useEffect(() => {
    if (!session?.access_token) {
      setAccessState('idle')
      return
    }

    let cancelled = false
    setAccessState('checking')
    fetch(`${LIVE_API}?slug=${encodeURIComponent(slug)}&mode=admin`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('admin_required')
        return response.json()
      })
      .then(() => {
        if (!cancelled) setAccessState('ready')
      })
      .catch(() => {
        if (!cancelled) setAccessState('denied')
      })

    return () => { cancelled = true }
  }, [session?.access_token, slug])

  useEffect(() => {
    if (!running || cursor >= REHEARSAL_SCRIPT.length) {
      if (cursor >= REHEARSAL_SCRIPT.length && running) setRunning(false)
      return undefined
    }

    const delay = Math.max(300, 2300 / speed)
    const timer = window.setTimeout(() => {
      const next = REHEARSAL_SCRIPT[cursor]
      setQuestions((current) => [
        ...current,
        {
          ...next,
          status: 'pending',
          priority: 0,
          created_at: new Date().toISOString(),
          answered_at: null,
        },
      ])
      setCursor((value) => value + 1)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [cursor, running, speed])

  const handleLogin = async (event) => {
    event.preventDefault()
    setAuthError('')
    const { error: loginError } = await signIn(email.trim(), password)
    if (loginError) setAuthError('Connexion impossible. Vérifie tes identifiants MediumIA.')
  }

  const injectOne = () => {
    if (cursor >= REHEARSAL_SCRIPT.length) return
    const next = REHEARSAL_SCRIPT[cursor]
    setQuestions((current) => [
      ...current,
      {
        ...next,
        status: 'pending',
        priority: 0,
        created_at: new Date().toISOString(),
        answered_at: null,
      },
    ])
    setCursor((value) => value + 1)
  }

  const resetRoom = () => {
    setRunning(false)
    setQuestions([])
    setCursor(0)
    setBusyId('')
    setAiState('idle')
    setAiPlan(null)
    setAiRaw('')
    setWinner('')
    setError('')
  }

  const runCopilot = async (questionsOverride = null) => {
    const source = questionsOverride || questions
    const active = source.filter((q) => !['answered', 'dismissed'].includes(q.status))
    if (!active.length) {
      setAiState('empty')
      setAiPlan(null)
      setAiRaw('Aucune question active à analyser.')
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
          message: buildCopilotPrompt(active),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Analyse IA indisponible.')
      const reply = payload.reply || ''
      setAiRaw(reply)
      setAiPlan(parseCopilotPlan(reply, active))
      setAiState('success')
    } catch (err) {
      setAiState('error')
      setAiPlan(null)
      setError(err.message)
    }
  }

  const takeQuestion = (questionId) => {
    setBusyId(questionId)
    setQuestions((current) => current.map((question) => {
      if (question.id === questionId) return { ...question, status: 'selected' }
      if (question.status === 'selected') return { ...question, status: 'pending' }
      return question
    }))
    setBusyId('')
  }

  const setQuestionStatus = async (questionId, status) => {
    setBusyId(questionId)
    const fresh = questions.map((question) => {
      if (question.id !== questionId) return question
      return {
        ...question,
        status,
        answered_at: status === 'answered' ? new Date().toISOString() : null,
      }
    })
    setQuestions(fresh)
    setBusyId('')

    if (status === 'answered' && aiPlan) {
      await runCopilot(fresh)
    }
  }

  const drawTestWinner = () => {
    const entryCount = Math.min(PARTICIPANTS.length, Math.max(1, Math.floor(cursor * 0.8)))
    const pool = PARTICIPANTS.slice(0, entryCount)
    if (!pool.length) {
      setError('Fais entrer quelques participants avant le tirage test.')
      return
    }
    setWinner(pool[Math.floor(Math.random() * pool.length)])
  }

  if (authLoading) {
    return <div className="min-h-screen bg-[#0f0d21] text-cream grid place-items-center font-georgia">Ouverture de la salle de répétition…</div>
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0f0d21] px-6 text-cream grid place-items-center">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-3xl border border-purple-300/25 bg-white/5 p-8">
          <p className="font-georgia text-xs uppercase tracking-[.22em] text-purple-200">🎭 RÉPÉTITION MEDIUMIA</p>
          <h1 className="mt-4 font-georgia text-3xl">Connexion Sébastien</h1>
          <p className="mt-3 font-georgia text-sm text-cream/55">Utilise ton compte MediumIA habituel.</p>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="mt-6 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 font-georgia text-sm outline-none" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" className="mt-3 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 font-georgia text-sm outline-none" />
          <button className="mt-4 w-full rounded-xl bg-purple-200 px-5 py-3 font-georgia text-sm font-bold text-[#0f0d21]">Entrer en répétition</button>
          {authError && <p className="mt-4 font-georgia text-xs text-red-200">{authError}</p>}
        </form>
      </div>
    )
  }

  if (accessState === 'checking' || accessState === 'idle') {
    return <div className="min-h-screen bg-[#0f0d21] text-cream grid place-items-center font-georgia">Vérification de la régie…</div>
  }

  if (accessState === 'denied') {
    return (
      <div className="min-h-screen bg-[#0f0d21] px-6 text-cream grid place-items-center">
        <div className="max-w-lg rounded-3xl border border-red-300/25 bg-red-300/5 p-8 text-center">
          <h1 className="font-georgia text-2xl">Accès régie requis</h1>
          <p className="mt-3 font-georgia text-sm text-cream/60">Ce mode est réservé à l’administrateur de la conférence.</p>
          <button onClick={signOut} className="mt-5 rounded-xl border border-white/15 px-5 py-3 font-georgia text-sm">Déconnexion</button>
        </div>
      </div>
    )
  }

  const counts = {
    registrations: 30,
    attendees: Math.min(30, 8 + cursor),
    presentNow: Math.min(30, 6 + cursor),
    questions: questions.length,
    raffleEntries: Math.min(30, Math.floor(cursor * 0.8)),
  }
  const selectedQuestion = questions.find((question) => question.status === 'selected') || null
  const aiRecommendations = (aiPlan?.recommendations || [])
    .map((recommendation) => ({
      ...recommendation,
      question: questions.find((question) => question.id === recommendation.id) || null,
    }))
    .filter((item) => item.question && !['answered', 'dismissed'].includes(item.question.status))
  const repeatedSignal = [...aiRecommendations]
    .filter((item) => item.similarCount > 1)
    .sort((a, b) => b.similarCount - a.similarCount)[0] || null
  const originalSignal = aiRecommendations.find((item) => item.similarCount === 1) || null

  return (
    <div className="min-h-screen bg-[#0f0d21] text-cream">
      <header className="sticky top-0 z-40 border-b border-purple-300/20 bg-[#0f0d21]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[.24em] text-purple-200">🎭 MEDIUMIA · MODE RÉPÉTITION</p>
            <p className="mt-1 font-georgia text-sm text-cream/55">Salle fictive · aucune inscription de conférence n’est créée</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => window.location.assign(`/pro/conference/${slug}`)} className="rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-gold">← Vrai cockpit</button>
            <button onClick={signOut} className="rounded-lg border border-white/10 px-3 py-2 font-georgia text-xs text-cream/60">Déconnexion</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7">
        <section className="rounded-3xl border border-purple-300/25 bg-purple-300/5 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-purple-200">SIMULATEUR DE SALLE</p>
              <h1 className="mt-2 font-georgia text-2xl">{cursor}/30 questions injectées</h1>
              <p className="mt-2 font-georgia text-sm text-cream/50">L’IA est réelle. Les participants, questions et le tirage sont fictifs.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setRunning((value) => !value)} disabled={cursor >= REHEARSAL_SCRIPT.length} className="rounded-xl bg-purple-200 px-4 py-3 font-georgia text-xs font-bold text-[#0f0d21] disabled:opacity-40">{running ? '⏸ Pause' : '▶ Lancer la salle'}</button>
              <button onClick={injectOne} disabled={cursor >= REHEARSAL_SCRIPT.length} className="rounded-xl border border-purple-200/30 px-4 py-3 font-georgia text-xs text-purple-100 disabled:opacity-40">+ 1 question</button>
              <button onClick={resetRoom} className="rounded-xl border border-white/10 px-4 py-3 font-georgia text-xs text-cream/60">↺ Recommencer</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="font-georgia text-xs text-cream/45">Vitesse :</span>
            {[1, 4, 10].map((value) => (
              <button key={value} onClick={() => setSpeed(value)} className={`rounded-lg px-3 py-2 font-georgia text-xs ${speed === value ? 'bg-purple-200 text-[#0f0d21]' : 'border border-white/10 text-cream/55'}`}>×{value}</button>
            ))}
          </div>
        </section>

        {error && <div className="mt-5 rounded-xl border border-red-300/20 bg-red-300/10 p-4 font-georgia text-sm text-red-100">{error}</div>}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[['Faux inscrits', counts.registrations], ['Ont rejoint', counts.attendees], ['Présents', counts.presentNow], ['Questions', counts.questions], ['Tirage', counts.raffleEntries]].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="font-georgia text-[10px] uppercase tracking-[.16em] text-purple-200">{label}</p>
              <p className="mt-2 font-georgia text-3xl font-semibold">{value}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-purple-200">QUESTIONS FICTIVES</p>
                <h2 className="mt-2 font-georgia text-2xl">File de répétition</h2>
              </div>
              <span className={`rounded-full border px-3 py-1 font-georgia text-xs ${running ? 'border-emerald-200/30 text-emerald-100' : 'border-white/10 text-cream/45'}`}>{running ? '● salle en mouvement' : 'pause'}</span>
            </div>

            {selectedQuestion && (
              <div className="mt-5 rounded-3xl border-2 border-gold/70 bg-gold/10 p-6 shadow-[0_0_40px_rgba(201,168,76,.08)]">
                <p className="font-georgia text-[10px] font-bold uppercase tracking-[.24em] text-gold">🔥 QUESTION ACTIVE</p>
                <p className="mt-2 font-georgia text-sm text-gold/80">{selectedQuestion.firstName}</p>
                <p className="mt-4 font-georgia text-2xl leading-relaxed text-cream">{selectedQuestion.question}</p>
                <button disabled={busyId === selectedQuestion.id} onClick={() => setQuestionStatus(selectedQuestion.id, 'answered')} className="mt-5 rounded-xl bg-emerald-200 px-5 py-3 font-georgia text-sm font-bold text-[#0f0d21] disabled:opacity-50">✓ Répondue · suivante</button>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {!questions.length ? (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center font-georgia text-sm text-cream/45">Lance la salle : les premières questions vont arriver progressivement.</div>
              ) : questions.map((question) => (
                <article key={question.id} className={`rounded-2xl border p-5 ${question.status === 'selected' ? 'border-gold/60 bg-gold/10' : question.status === 'answered' ? 'border-emerald-300/20 bg-emerald-300/5' : question.status === 'dismissed' ? 'border-white/5 bg-black/10 opacity-45' : 'border-white/10 bg-black/10'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-georgia text-xs text-purple-200">{question.firstName} · {formatClock(question.created_at)}</p>
                      <p className="mt-2 font-georgia text-base leading-relaxed text-cream">{question.question}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-1 font-georgia text-[10px] uppercase text-cream/45">{question.status}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={question.status === 'answered'} onClick={() => takeQuestion(question.id)} className="rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep disabled:opacity-40">À prendre</button>
                    <button disabled={question.status === 'answered'} onClick={() => setQuestionStatus(question.id, 'answered')} className="rounded-lg border border-emerald-300/25 px-3 py-2 font-georgia text-xs text-emerald-200 disabled:opacity-40">Répondue</button>
                    <button disabled={question.status === 'answered'} onClick={() => setQuestionStatus(question.id, 'dismissed')} className="rounded-lg border border-white/10 px-3 py-2 font-georgia text-xs text-cream/50 disabled:opacity-40">Écarter</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-gold/35 bg-[#1b1738] p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">✨ VRAI COPILOTE IA</p>
              <h2 className="mt-3 font-georgia text-2xl">Teste la régie</h2>
              <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/55">Il analyse cette fausse salle exactement comme le jour J.</p>
              <button onClick={() => runCopilot()} disabled={aiState === 'loading' || !questions.length} className="mt-5 w-full rounded-xl bg-gold px-4 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-40">{aiState === 'loading' ? '✨ Analyse en cours…' : aiPlan ? '✨ Ré-analyser la salle' : '✨ Donne-moi les 3 questions'}</button>

              {aiPlan && (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-gold/30 bg-black/15 p-4">
                    <p className="font-georgia text-[10px] font-bold uppercase tracking-[.18em] text-gold">🔥 THÈME MAJEUR · {aiPlan.theme.count}</p>
                    <p className="mt-2 font-georgia text-base text-cream">{aiPlan.theme.label}</p>
                  </div>

                  <div className="space-y-3">
                    {aiRecommendations.map((item, index) => (
                      <article key={item.id} className={`rounded-2xl border p-4 ${item.question.status === 'selected' ? 'border-gold/70 bg-gold/10' : 'border-white/10 bg-black/10'}`}>
                        <div className="flex items-start gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold font-georgia text-xs font-bold text-deep">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-georgia text-xs text-gold">{item.question.firstName}</p>
                            <p className="mt-1 font-georgia text-sm leading-relaxed text-cream">{item.question.question}</p>
                            <p className="mt-2 font-georgia text-[11px] text-cream/45">↳ {item.similarCount} proche{item.similarCount > 1 ? 's' : ''}{item.reason ? ` · ${item.reason}` : ''}</p>
                            <button disabled={item.question.status === 'selected'} onClick={() => takeQuestion(item.id)} className="mt-3 rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep disabled:opacity-40">{item.question.status === 'selected' ? '✓ Active' : '🔥 Prendre celle-ci'}</button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/5 p-4">
                    <p className="font-georgia text-[10px] uppercase tracking-[.18em] text-cyan-100">📡 RADAR DE SALLE</p>
                    <div className="mt-3 space-y-3 font-georgia text-sm text-cream/70">
                      <div><span className="text-cyan-100">📈 Ça monte :</span> {aiPlan.watch}</div>
                      <div><span className="text-cyan-100">🔁 Répétée :</span> {repeatedSignal ? `${repeatedSignal.question.firstName} · ${repeatedSignal.similarCount} proches` : 'Pas de répétition forte.'}</div>
                      <div><span className="text-cyan-100">💎 Originale :</span> {originalSignal ? `${originalSignal.question.firstName} · ${originalSignal.question.question}` : 'Aucune isolée parmi les priorités.'}</div>
                    </div>
                  </div>
                </div>
              )}

              {!aiPlan && aiRaw && <div className="mt-5 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/15 p-4 font-georgia text-xs text-cream/60">{aiRaw}</div>}
              <p className="mt-3 font-georgia text-[11px] text-cream/35">Après « Répondue · suivante », le copilote recalcule automatiquement si une analyse est déjà active.</p>
            </section>

            <section className="rounded-3xl border border-purple-300/25 bg-purple-300/5 p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[.2em] text-purple-200">🎁 FAUX TIRAGE</p>
              <h2 className="mt-3 font-georgia text-2xl">Formation complète · 597 €</h2>
              <p className="mt-3 font-georgia text-sm text-cream/55">{counts.raffleEntries} faux participants éligibles.</p>
              {winner ? (
                <div className="mt-5 rounded-2xl border border-purple-200/40 bg-purple-200/10 p-5 text-center">
                  <p className="font-georgia text-xs uppercase tracking-[.18em] text-purple-100">GAGNANT TEST</p>
                  <p className="mt-2 font-georgia text-3xl font-semibold">{winner}</p>
                </div>
              ) : (
                <button onClick={drawTestWinner} className="mt-5 w-full rounded-xl bg-purple-200 px-5 py-4 font-georgia text-sm font-bold text-[#0f0d21]">🎁 Tirer un faux gagnant</button>
              )}
              <p className="mt-3 font-georgia text-[11px] text-cream/35">Simulation locale uniquement : aucun gagnant n’est enregistré sur la vraie conférence.</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
