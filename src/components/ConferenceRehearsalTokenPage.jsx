import { useEffect, useMemo, useState } from 'react'

const COPILOT_AGENT_ID = '2f5dcd1d-fb05-4623-80d6-8779aa5f561d'

const SCRIPT = [
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
].map(([firstName, question], index) => ({ id: `rehearsal-q${String(index + 1).padStart(2, '0')}`, firstName, question }))

function tokenFromHash() {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('rehearsal') || ''
}

function clock(value) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(value))
}

function promptFor(questions) {
  const active = questions.filter((q) => !['answered', 'dismissed'].includes(q.status)).slice(0, 45)
  const lines = active.map((q, i) => `${i + 1}. heure=${clock(q.created_at)} | id=${q.id} | prénom=${q.firstName} | question=${q.question}`)
  return `Tu pilotes avec Sébastien une RÉPÉTITION fictive de conférence MediumIA. Analyse seulement les questions fournies. Ne réponds jamais aux questions. Regroupe les questions similaires, détecte le thème dominant et ce qui monte récemment, puis recommande jusqu'à 3 questions. Pour chaque recommandation, réutilise strictement l'id exact fourni. Réponds uniquement en JSON valide, sans markdown : {"theme":{"label":"thème","count":0},"recommendations":[{"id":"id exact","similarCount":1,"reason":"raison courte"}],"watch":"ce qui monte ou Rien pour l'instant"}. QUESTIONS :\n${lines.join('\n').slice(0, 3150)}`
}

function parsePlan(reply, questions) {
  const raw = String(reply || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  const active = new Set(questions.filter((q) => !['answered', 'dismissed'].includes(q.status)).map((q) => q.id))
  const seen = new Set()
  const recommendations = (parsed.recommendations || []).filter((x) => x && active.has(x.id) && !seen.has(x.id) && seen.add(x.id)).slice(0, 3).map((x) => ({ id: x.id, similarCount: Math.max(1, Number(x.similarCount) || 1), reason: String(x.reason || '').slice(0, 120) }))
  if (!recommendations.length) throw new Error('Aucune recommandation exploitable reçue.')
  return { theme: { label: String(parsed?.theme?.label || 'Thème en cours').slice(0, 180), count: Math.max(1, Number(parsed?.theme?.count) || 1) }, recommendations, watch: String(parsed?.watch || "Rien pour l'instant").slice(0, 220) }
}

export default function ConferenceRehearsalTokenPage() {
  const token = useMemo(tokenFromHash, [])
  const [questions, setQuestions] = useState([])
  const [cursor, setCursor] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [plan, setPlan] = useState(null)
  const [aiState, setAiState] = useState('idle')
  const [error, setError] = useState('')
  const [winner, setWinner] = useState('')

  useEffect(() => {
    if (!running || cursor >= SCRIPT.length) return undefined
    const timer = window.setTimeout(() => {
      const next = SCRIPT[cursor]
      setQuestions((q) => [...q, { ...next, status: 'pending', created_at: new Date().toISOString() }])
      setCursor((c) => c + 1)
    }, Math.max(300, 2300 / speed))
    return () => window.clearTimeout(timer)
  }, [running, cursor, speed])

  if (!token) return <div className="min-h-screen bg-[#0f0d21] text-cream grid place-items-center p-8"><div className="max-w-lg rounded-3xl border border-red-300/25 bg-red-300/5 p-8 text-center"><h1 className="font-georgia text-2xl">Lien privé requis</h1><p className="mt-3 font-georgia text-sm text-cream/60">Ouvre le lien privé de répétition fourni.</p></div></div>

  const inject = () => {
    if (cursor >= SCRIPT.length) return
    const next = SCRIPT[cursor]
    setQuestions((q) => [...q, { ...next, status: 'pending', created_at: new Date().toISOString() }])
    setCursor((c) => c + 1)
  }

  const analyze = async (source = questions) => {
    const active = source.filter((q) => !['answered', 'dismissed'].includes(q.status))
    if (!active.length) return
    setAiState('loading'); setError('')
    try {
      const response = await fetch('/api/agent-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MediumIA-Rehearsal': token }, body: JSON.stringify({ agentId: COPILOT_AGENT_ID, newConversation: true, message: promptFor(active) }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Analyse IA indisponible.')
      setPlan(parsePlan(payload.reply, active)); setAiState('success')
    } catch (e) { setPlan(null); setAiState('error'); setError(e.message) }
  }

  const take = (id) => setQuestions((all) => all.map((q) => q.id === id ? { ...q, status: 'selected' } : q.status === 'selected' ? { ...q, status: 'pending' } : q))
  const mark = async (id, status) => {
    const fresh = questions.map((q) => q.id === id ? { ...q, status } : q)
    setQuestions(fresh)
    if (status === 'answered' && plan) await analyze(fresh)
  }
  const reset = () => { setRunning(false); setQuestions([]); setCursor(0); setPlan(null); setAiState('idle'); setWinner(''); setError('') }
  const selected = questions.find((q) => q.status === 'selected')
  const recs = (plan?.recommendations || []).map((r) => ({ ...r, question: questions.find((q) => q.id === r.id) })).filter((r) => r.question && !['answered', 'dismissed'].includes(r.question.status))
  const repeated = [...recs].filter((r) => r.similarCount > 1).sort((a, b) => b.similarCount - a.similarCount)[0]
  const original = recs.find((r) => r.similarCount === 1)
  const raffleCount = Math.min(30, Math.floor(cursor * 0.8))

  return <div className="min-h-screen bg-[#0f0d21] text-cream">
    <header className="sticky top-0 z-40 border-b border-purple-300/20 bg-[#0f0d21]/95 backdrop-blur"><div className="mx-auto max-w-7xl px-5 py-4"><p className="font-georgia text-[10px] uppercase tracking-[.24em] text-purple-200">🎭 MEDIUMIA · RÉPÉTITION PRIVÉE</p><p className="mt-1 font-georgia text-sm text-cream/55">Pas de mot de passe · salle 100 % fictive</p></div></header>
    <main className="mx-auto max-w-7xl px-5 py-7">
      <section className="rounded-3xl border border-purple-300/25 bg-purple-300/5 p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="font-georgia text-2xl">{cursor}/30 questions injectées</h1><p className="mt-2 font-georgia text-sm text-cream/50">L’IA est réelle. Les participants et le tirage sont fictifs.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setRunning((v) => !v)} className="rounded-xl bg-purple-200 px-4 py-3 font-georgia text-xs font-bold text-[#0f0d21]">{running ? '⏸ Pause' : '▶ Lancer la salle'}</button><button onClick={inject} className="rounded-xl border border-purple-200/30 px-4 py-3 font-georgia text-xs text-purple-100">+ 1 question</button><button onClick={reset} className="rounded-xl border border-white/10 px-4 py-3 font-georgia text-xs text-cream/60">↺ Recommencer</button></div></div><div className="mt-4 flex gap-2">{[1,4,10].map((v)=><button key={v} onClick={()=>setSpeed(v)} className={`rounded-lg px-3 py-2 font-georgia text-xs ${speed===v?'bg-purple-200 text-[#0f0d21]':'border border-white/10 text-cream/55'}`}>×{v}</button>)}</div></section>
      {error && <div className="mt-5 rounded-xl border border-red-300/20 bg-red-300/10 p-4 font-georgia text-sm text-red-100">{error}</div>}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Faux inscrits',30],['Ont rejoint',Math.min(30,8+cursor)],['Présents',Math.min(30,6+cursor)],['Questions',questions.length],['Tirage',raffleCount]].map(([l,v])=><div key={l} className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="font-georgia text-[10px] uppercase tracking-[.16em] text-purple-200">{l}</p><p className="mt-2 font-georgia text-3xl font-semibold">{v}</p></div>)}</section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-7"><h2 className="font-georgia text-2xl">File de répétition</h2>{selected && <div className="mt-5 rounded-3xl border-2 border-gold/70 bg-gold/10 p-6"><p className="font-georgia text-[10px] font-bold uppercase tracking-[.24em] text-gold">🔥 QUESTION ACTIVE</p><p className="mt-2 font-georgia text-sm text-gold/80">{selected.firstName}</p><p className="mt-4 font-georgia text-2xl leading-relaxed">{selected.question}</p><button onClick={()=>mark(selected.id,'answered')} className="mt-5 rounded-xl bg-emerald-200 px-5 py-3 font-georgia text-sm font-bold text-[#0f0d21]">✓ Répondue · suivante</button></div>}<div className="mt-5 space-y-3">{!questions.length?<div className="rounded-2xl border border-dashed border-white/15 p-8 text-center font-georgia text-sm text-cream/45">Lance la salle : les questions vont arriver.</div>:questions.map((q)=><article key={q.id} className={`rounded-2xl border p-5 ${q.status==='selected'?'border-gold/60 bg-gold/10':q.status==='answered'?'border-emerald-300/20 bg-emerald-300/5':'border-white/10 bg-black/10'}`}><p className="font-georgia text-xs text-purple-200">{q.firstName} · {clock(q.created_at)}</p><p className="mt-2 font-georgia text-base leading-relaxed">{q.question}</p><div className="mt-4 flex gap-2"><button onClick={()=>take(q.id)} className="rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep">À prendre</button><button onClick={()=>mark(q.id,'answered')} className="rounded-lg border border-emerald-300/25 px-3 py-2 font-georgia text-xs text-emerald-200">Répondue</button><button onClick={()=>mark(q.id,'dismissed')} className="rounded-lg border border-white/10 px-3 py-2 font-georgia text-xs text-cream/50">Écarter</button></div></article>)}</div></section>
        <aside className="space-y-6"><section className="rounded-3xl border border-gold/35 bg-[#1b1738] p-6"><p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">✨ COPILOTE IA</p><h2 className="mt-3 font-georgia text-2xl">Teste la régie</h2><button onClick={()=>analyze()} disabled={aiState==='loading'||!questions.length} className="mt-5 w-full rounded-xl bg-gold px-4 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-40">{aiState==='loading'?'✨ Analyse en cours…':plan?'✨ Ré-analyser la salle':'✨ Donne-moi les 3 questions'}</button>{plan&&<div className="mt-5 space-y-4"><div className="rounded-2xl border border-gold/30 bg-black/15 p-4"><p className="font-georgia text-[10px] uppercase tracking-[.18em] text-gold">🔥 THÈME MAJEUR · {plan.theme.count}</p><p className="mt-2 font-georgia">{plan.theme.label}</p></div>{recs.map((r,i)=><div key={r.id} className="rounded-2xl border border-white/10 bg-black/10 p-4"><p className="font-georgia text-xs text-gold">{i+1}. {r.question.firstName}</p><p className="mt-1 font-georgia text-sm">{r.question.question}</p><p className="mt-2 font-georgia text-[11px] text-cream/45">↳ {r.similarCount} proche{r.similarCount>1?'s':''} · {r.reason}</p><button onClick={()=>take(r.id)} className="mt-3 rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep">🔥 Prendre celle-ci</button></div>)}<div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/5 p-4 font-georgia text-sm text-cream/70"><p className="text-cyan-100">📡 RADAR</p><p className="mt-2">📈 {plan.watch}</p><p className="mt-2">🔁 {repeated?`${repeated.question.firstName} · ${repeated.similarCount} proches`:'Pas de répétition forte.'}</p><p className="mt-2">💎 {original?`${original.question.firstName} · ${original.question.question}`:'Aucune isolée parmi les priorités.'}</p></div></div>}</section><section className="rounded-3xl border border-purple-300/25 bg-purple-300/5 p-6"><p className="font-georgia text-[10px] uppercase tracking-[.2em] text-purple-200">🎁 FAUX TIRAGE</p><h2 className="mt-3 font-georgia text-2xl">Formation complète · 397 €</h2><p className="mt-3 font-georgia text-sm text-cream/55">{raffleCount} faux participants éligibles.</p>{winner?<div className="mt-5 rounded-2xl border border-purple-200/40 bg-purple-200/10 p-5 text-center"><p className="font-georgia text-xs uppercase text-purple-100">GAGNANT TEST</p><p className="mt-2 font-georgia text-3xl">{winner}</p></div>:<button onClick={()=>setWinner(SCRIPT[Math.max(0,Math.floor(Math.random()*Math.max(1,Math.min(cursor,SCRIPT.length))))].firstName)} className="mt-5 w-full rounded-xl bg-purple-200 px-5 py-4 font-georgia text-sm font-bold text-[#0f0d21]">🎁 Tirer un faux gagnant</button>}</section></aside>
      </div>
    </main>
  </div>
}
