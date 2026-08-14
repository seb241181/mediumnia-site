import { useMemo, useState } from 'react'

const templates = [
  { id: 'commerce', icon: '◈', category: 'Commerce', name: 'Assistant Boutique', description: 'Répond aux questions clients, présente vos produits, explique vos horaires et oriente vers l’achat.', tag: 'Prêt à personnaliser' },
  { id: 'cabinet', icon: '✦', category: 'Bien-être', name: 'Assistant Cabinet', description: 'Présente vos accompagnements, répond aux questions fréquentes et prépare la prise de rendez-vous.', tag: 'Prêt à personnaliser' },
  { id: 'formation', icon: '◇', category: 'Formation', name: 'Assistant Formation', description: 'Accompagne vos élèves à partir de vos contenus, méthodes, règles et documents.', tag: 'Mémoire métier' },
  { id: 'tourisme', icon: '⌖', category: 'Tourisme', name: 'Assistant Tourisme', description: 'Informe les visiteurs, recommande des activités et répond à partir de vos informations locales.', tag: 'Multicanal' },
  { id: 'immobilier', icon: '⌂', category: 'Immobilier', name: 'Assistant Immobilier', description: 'Qualifie les demandes, présente vos biens et prépare les informations utiles avant un échange humain.', tag: 'Professionnel' },
  { id: 'social', icon: '✺', category: 'Marketing', name: 'Assistant Réseaux', description: 'Aide à préparer publications, idées de contenus et réponses cohérentes avec votre identité.', tag: 'Création' },
]

const categories = ['Tous', ...new Set(templates.map((item) => item.category))]

export default function AgentsPlatform({ onBack }) {
  const [category, setCategory] = useState('Tous')
  const [tab, setTab] = useState('explorer')
  const visible = useMemo(() => category === 'Tous' ? templates : templates.filter((item) => item.category === category), [category])

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm md:text-base font-semibold">✦ MEDIUMIA</button>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={() => setTab('explorer')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'explorer' ? 'bg-deep text-gold' : 'text-mist'}`}>Explorer</button>
            <button onClick={() => setTab('create')} className={`font-georgia text-xs md:text-sm px-3 py-2 rounded-lg ${tab === 'create' ? 'bg-deep text-gold' : 'text-mist'}`}>Créer</button>
            <button className="font-georgia text-xs md:text-sm px-4 py-2 rounded-lg bg-gold text-deep font-bold">Connexion</button>
          </div>
        </div>
      </header>

      <main>
        <section className="px-6 pt-16 pb-12 text-center max-w-4xl mx-auto">
          <p className="font-georgia text-gold tracking-[0.25em] text-xs uppercase mb-5">MediumIA Agents</p>
          <h1 className="font-georgia text-4xl md:text-6xl leading-tight font-medium mb-6">Votre savoir. Votre façon de travailler.<br /><span className="text-gold">Votre agent IA.</span></h1>
          <p className="font-georgia text-mist text-base md:text-xl leading-relaxed max-w-2xl mx-auto mb-9">Choisissez un agent prêt à l’emploi ou créez le vôtre. MediumIA lui transmet votre métier, vos documents, vos règles et votre manière d’accompagner.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => setTab('explorer')} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Explorer les agents</button>
            <button onClick={() => setTab('create')} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Créer mon agent</button>
          </div>
        </section>

        {tab === 'explorer' ? (
          <section className="px-6 pb-20 max-w-6xl mx-auto">
            <div className="flex gap-2 overflow-x-auto pb-5">
              {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 font-georgia text-sm px-4 py-2 rounded-full border ${category === item ? 'bg-deep text-gold border-deep' : 'border-gold/30 text-mist'}`}>{item}</button>)}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {visible.map((agent) => (
                <article key={agent.id} className="rounded-2xl border border-gold/25 bg-white/55 p-6 flex flex-col min-h-[300px] shadow-sm">
                  <div className="flex items-start justify-between mb-6"><span className="text-gold text-3xl">{agent.icon}</span><span className="font-georgia text-[11px] uppercase tracking-wider text-mist bg-deep/5 rounded-full px-3 py-1">{agent.category}</span></div>
                  <h2 className="font-georgia text-2xl mb-3">{agent.name}</h2>
                  <p className="font-georgia text-mist text-sm leading-relaxed flex-1">{agent.description}</p>
                  <div className="mt-6 pt-5 border-t border-gold/15 flex items-center justify-between gap-3"><span className="font-georgia text-xs text-gold">{agent.tag}</span><button onClick={() => setTab('create')} className="font-georgia text-sm font-bold">Personnaliser →</button></div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="px-6 pb-24 max-w-3xl mx-auto">
            <div className="rounded-3xl bg-deep text-cream p-7 md:p-10 shadow-xl">
              <p className="text-gold text-3xl mb-5">✦</p>
              <p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-3">Créateur MediumIA</p>
              <h2 className="font-georgia text-3xl md:text-4xl mb-5">Commençons simplement.</h2>
              <p className="font-georgia text-cream/75 leading-relaxed mb-8">Vous n’avez pas besoin de connaître l’intelligence artificielle. Décrivez votre activité comme vous le feriez à une personne qui vient travailler avec vous.</p>
              <label className="font-georgia text-sm text-gold block mb-3">Que voulez-vous confier à votre agent ?</label>
              <textarea rows="6" placeholder="Exemple : Je suis thérapeute. Je voudrais un agent qui présente mes accompagnements, répond aux questions courantes et aide mes clients à préparer leur rendez-vous..." className="w-full rounded-xl bg-white/10 border border-gold/25 px-5 py-4 text-cream placeholder:text-cream/35 outline-none font-georgia leading-relaxed" />
              <button className="mt-5 w-full sm:w-auto font-georgia px-7 py-4 rounded-lg bg-gold text-deep font-bold">Construire mon agent →</button>
              <p className="font-georgia text-xs text-cream/40 mt-5">Prototype : aucune création ni facturation n’est encore déclenchée depuis cette page.</p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
