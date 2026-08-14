import { useMemo, useState } from 'react'

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

function AgentCreator({ initialMission = '' }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({ mission: initialMission, audience: '', tone: '', knowledge: '', limits: '' })
  const [finished, setFinished] = useState(false)
  const current = questions[step]
  const progress = Math.round(((step + (finished ? 1 : 0)) / questions.length) * 100)

  const next = () => {
    if (!answers[current.key].trim()) return
    if (step === questions.length - 1) setFinished(true)
    else setStep(step + 1)
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
      <div className="mt-7 rounded-xl border border-gold/30 bg-gold/10 p-5"><p className="font-georgia text-sm text-gold font-bold mb-2">Prochaine étape</p><p className="font-georgia text-sm text-cream/70 leading-relaxed">Générer automatiquement le nom, le rôle, les instructions et les permissions de l’agent, puis vous laisser les relire avant création.</p></div>
      <button onClick={() => { setStep(0); setFinished(false) }} className="mt-6 font-georgia text-sm text-gold">← Modifier mes réponses</button>
    </div>
  }

  return <div className="rounded-3xl bg-deep text-cream p-7 md:p-10 shadow-xl">
    <div className="flex items-center justify-between gap-4 mb-7"><div><p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-2">Créateur MediumIA</p><p className="font-georgia text-xs text-cream/45">Étape {step + 1} sur {questions.length}</p></div><span className="text-gold text-3xl">✦</span></div>
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-9"><div className="h-full bg-gold transition-all duration-300" style={{ width: `${progress}%` }} /></div>
    <p className="font-georgia text-cream/55 text-sm mb-3">Lumi vous accompagne</p>
    <h2 className="font-georgia text-2xl md:text-4xl leading-tight mb-7">{current.label}</h2>
    <textarea autoFocus rows="6" value={answers[current.key]} onChange={(e) => setAnswers({ ...answers, [current.key]: e.target.value })} placeholder={current.placeholder} className="w-full rounded-xl bg-white/10 border border-gold/25 px-5 py-4 text-cream placeholder:text-cream/30 outline-none focus:border-gold/60 font-georgia leading-relaxed" />
    <div className="mt-5 flex items-center justify-between gap-4">{step > 0 ? <button onClick={() => setStep(step - 1)} className="font-georgia text-sm text-cream/60">← Retour</button> : <span />}<button disabled={!answers[current.key].trim()} onClick={next} className="font-georgia px-7 py-3.5 rounded-lg bg-gold text-deep font-bold disabled:opacity-30">{step === questions.length - 1 ? 'Préparer mon agent →' : 'Continuer →'}</button></div>
    <p className="font-georgia text-xs text-cream/35 mt-6">Prototype Preview : vos réponses restent uniquement dans cette page et aucun agent réel n’est encore créé.</p>
  </div>
}

export default function AgentsPlatform({ onBack }) {
  const [category, setCategory] = useState('Tous')
  const [tab, setTab] = useState('explorer')
  const [starter, setStarter] = useState('')
  const visible = useMemo(() => category === 'Tous' ? templates : templates.filter((item) => item.category === category), [category])
  const openCreator = (mission = '') => { setStarter(mission); setTab('create'); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return <div className="min-h-screen bg-cream text-deep">
    <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20"><div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4"><button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm md:text-base font-semibold">✦ MEDIUMIA</button><div className="flex items-center gap-2 md:gap-3"><button onClick={() => setTab('explorer')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'explorer' ? 'bg-deep text-gold' : 'text-mist'}`}>Explorer</button><button onClick={() => openCreator('')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'create' ? 'bg-deep text-gold' : 'text-mist'}`}>Créer</button><button className="font-georgia text-xs md:text-sm px-4 py-2 rounded-lg bg-gold text-deep font-bold">Connexion</button></div></div></header>
    <main>
      <section className="px-6 pt-16 pb-12 text-center max-w-4xl mx-auto"><p className="font-georgia text-gold tracking-[0.25em] text-xs uppercase mb-5">MediumIA Agents</p><h1 className="font-georgia text-4xl md:text-6xl leading-tight font-medium mb-6">Votre savoir. Votre façon de travailler.<br/><span className="text-gold">Votre agent IA.</span></h1><p className="font-georgia text-mist text-base md:text-xl leading-relaxed max-w-2xl mx-auto mb-9">Choisissez un agent prêt à l’emploi ou créez le vôtre. MediumIA lui transmet votre métier, vos documents, vos règles et votre manière d’accompagner.</p><div className="flex flex-col sm:flex-row gap-4 justify-center"><button onClick={() => setTab('explorer')} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Explorer les agents</button><button onClick={() => openCreator('')} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Créer mon agent</button></div></section>
      {tab === 'explorer' ? <section className="px-6 pb-20 max-w-6xl mx-auto"><div className="flex gap-2 overflow-x-auto pb-5">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 font-georgia text-sm px-4 py-2 rounded-full border ${category === item ? 'bg-deep text-gold border-deep' : 'border-gold/30 text-mist'}`}>{item}</button>)}</div><div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">{visible.map((agent) => <article key={agent.id} className="rounded-2xl border border-gold/25 bg-white/55 p-6 flex flex-col min-h-[300px] shadow-sm"><div className="flex items-start justify-between mb-6"><span className="text-gold text-3xl">{agent.icon}</span><span className="font-georgia text-[11px] uppercase tracking-wider text-mist bg-deep/5 rounded-full px-3 py-1">{agent.category}</span></div><h2 className="font-georgia text-2xl mb-3">{agent.name}</h2><p className="font-georgia text-mist text-sm leading-relaxed flex-1">{agent.description}</p><div className="mt-6 pt-5 border-t border-gold/15 flex items-center justify-between gap-3"><span className="font-georgia text-xs text-gold">{agent.tag}</span><button onClick={() => openCreator(agent.starter)} className="font-georgia text-sm font-bold">Personnaliser →</button></div></article>)}</div></section> : <section className="px-6 pb-24 max-w-3xl mx-auto"><AgentCreator key={starter} initialMission={starter}/></section>}
    </main>
  </div>
}
