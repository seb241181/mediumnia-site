import { useState } from 'react'
import './index.css'
import AgentsPlatform from './components/AgentsPlatform'

function Nav({ onOpenPro }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
      <div className="max-w-6xl mx-auto px-5 md:px-6 py-4 flex items-center justify-between gap-4">
        <a href="#top" className="font-georgia text-deep tracking-[0.2em] text-sm md:text-base font-semibold">✦ MEDIUMIA</a>
        <nav className="hidden md:flex items-center gap-6 font-georgia text-sm text-mist">
          <a href="#decouvrir" className="hover:text-deep">Découvrir</a>
          <a href="#formation" className="hover:text-deep">Se former</a>
          <a href="#reseau" className="hover:text-deep">Trouver un praticien</a>
        </nav>
        <button onClick={onOpenPro} className="font-georgia text-xs md:text-sm tracking-wide px-4 py-2.5 md:px-5 rounded-lg bg-deep text-gold font-bold">Espace Pro →</button>
      </div>
    </header>
  )
}

function UniverseCard({ icon, eyebrow, title, children, action, onClick, href, dark = false, badge }) {
  const classes = dark ? 'bg-deep text-cream border-deep' : 'bg-white/55 text-deep border-gold/25'
  const buttonClasses = dark ? 'text-gold' : 'text-deep'
  return (
    <article className={`rounded-3xl border p-7 md:p-8 shadow-sm flex flex-col min-h-[300px] ${classes}`}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <span className="text-gold text-3xl">{icon}</span>
        {badge && <span className={`font-georgia text-[10px] uppercase tracking-[0.16em] rounded-full px-3 py-1 ${dark ? 'bg-white/10 text-gold' : 'bg-deep/5 text-mist'}`}>{badge}</span>}
      </div>
      <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-3">{eyebrow}</p>
      <h2 className="font-georgia text-2xl md:text-3xl leading-tight mb-4">{title}</h2>
      <p className={`font-georgia leading-relaxed flex-1 ${dark ? 'text-cream/70' : 'text-mist'}`}>{children}</p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`font-georgia text-sm font-bold mt-7 ${buttonClasses}`}>{action} →</a>
      ) : (
        <button onClick={onClick} className={`font-georgia text-sm font-bold text-left mt-7 ${buttonClasses}`}>{action} →</button>
      )}
    </article>
  )
}

function PublicPlatformHome({ onOpenPro }) {
  return (
    <div id="top" className="bg-cream min-h-screen text-deep">
      <Nav onOpenPro={onOpenPro} />
      <main>
        <section className="min-h-[88vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-16">
          <p className="text-gold text-5xl mb-5 opacity-80">✦</p>
          <p className="font-georgia text-gold tracking-[0.3em] text-xs uppercase mb-5">Le monde spirituel, relié autrement</p>
          <h1 className="font-georgia text-5xl md:text-7xl text-deep tracking-[0.18em] font-medium mb-6">MEDIUMIA</h1>
          <p className="font-georgia text-deep text-xl md:text-3xl leading-relaxed max-w-3xl mx-auto mb-6">Comprendre. Apprendre. Rencontrer.<br/><span className="text-gold">Exercer autrement.</span></p>
          <p className="font-georgia text-mist text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">MediumIA rassemble celles et ceux qui explorent, transmettent et accompagnent dans l’univers de la médiumnité, du spirituel et du bien-être — avec des outils modernes qui respectent l’humain.</p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a href="#decouvrir" className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir MediumIA</a>
            <button onClick={onOpenPro} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Je suis professionnel →</button>
          </div>
        </section>

        <section id="decouvrir" className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Un même univers, plusieurs portes</p>
            <h2 className="font-georgia text-3xl md:text-5xl leading-tight mb-5">MediumIA n’est pas un simple outil IA.</h2>
            <p className="font-georgia text-mist text-lg leading-relaxed">C’est un écosystème dédié au monde spirituel : découvrir, se former, trouver des professionnels et donner aux praticiens des outils pensés pour leur réalité.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <UniverseCard icon="◌" eyebrow="Découvrir" title="Explorer le monde spirituel" action="Contenus bientôt disponibles" badge="Bientôt">
              Des ressources accessibles pour mieux comprendre la médiumnité, les pratiques spirituelles, leurs différences et leurs usages sans réduire cet univers à des slogans.
            </UniverseCard>

            <div id="formation">
              <UniverseCard icon="◇" eyebrow="Se former" title="Développer sa médiumnité" action="Découvrir la formation" href="https://mediumia.fr">
                Le parcours MediumIA accompagne l’apprentissage et la pratique avec une méthode structurée, des exercices et un espace élève dédié.
              </UniverseCard>
            </div>

            <div id="reseau">
              <UniverseCard icon="✦" eyebrow="Le réseau MediumIA" title="Trouver un praticien" action="Annuaire en préparation" badge="En construction">
                Demain, MediumIA permettra de découvrir médiums, énergéticiens, astrologues, tarologues, praticiens bien-être, formateurs, boutiques et lieux liés à cet univers.
              </UniverseCard>
            </div>

            <UniverseCard icon="✺" eyebrow="Espace Pro" title="Développer son activité sans perdre son identité" action="Entrer dans l’espace Pro" onClick={onOpenPro} dark badge="Prototype privé">
              Agents IA métier, documents et mémoire professionnelle, aide à la communication, futurs profils du réseau et outils pensés spécialement pour les professionnels de l’accompagnement spirituel.
            </UniverseCard>
          </div>
        </section>

        <section className="px-6 py-16 md:py-24 bg-deep text-cream mt-8">
          <div className="max-w-5xl mx-auto grid md:grid-cols-[1.3fr_0.7fr] gap-10 items-center">
            <div>
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Le réseau</p>
              <h2 className="font-georgia text-3xl md:text-5xl leading-tight mb-5">Un jour, dire « je suis sur MediumIA » devra vouloir dire quelque chose.</h2>
              <p className="font-georgia text-cream/70 text-lg leading-relaxed">Les professionnels pourront présenter leur activité sur MediumIA et partager leur fiche auprès de leur propre communauté. Leur visibilité fera connaître MediumIA ; MediumIA leur apportera à son tour un nouvel espace de découverte et des outils professionnels.</p>
            </div>
            <div className="rounded-3xl border border-gold/35 bg-white/5 p-8 text-center">
              <p className="text-gold text-4xl mb-4">✦</p>
              <p className="font-georgia text-xs tracking-[0.23em] text-gold uppercase mb-3">Badge réseau</p>
              <p className="font-georgia text-2xl mb-2">Présent sur MediumIA</p>
              <p className="font-georgia text-sm text-cream/50">Exemple de signature et de badge professionnel — bientôt.</p>
            </div>
          </div>
        </section>

        <section className="px-6 py-20 max-w-4xl mx-auto text-center">
          <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Pour les professionnels</p>
          <h2 className="font-georgia text-3xl md:text-5xl leading-tight mb-5">L’IA devient un outil. Votre pratique reste la vôtre.</h2>
          <p className="font-georgia text-mist text-lg leading-relaxed max-w-2xl mx-auto mb-8">MediumIA Pro est construit pour les métiers du spirituel, du bien-être et de la transmission. Votre savoir reste dans MediumIA ; l’intelligence artificielle vient l’aider à circuler, pas le remplacer.</p>
          <button onClick={onOpenPro} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir le prototype Pro →</button>
        </section>
      </main>

      <footer className="border-t border-gold/20 px-6 py-8 text-center">
        <p className="font-georgia text-deep tracking-[0.2em] text-sm mb-2">✦ MEDIUMIA</p>
        <p className="font-georgia text-mist text-xs">Monde spirituel · Formation · Réseau · Outils professionnels</p>
      </footer>
    </div>
  )
}

const PAYPAL_TEST_PATH = '/test-paypal-mediumia-live-1eur-9f3b2c'

export default function App() {
  const [view, setView] = useState(window.location.pathname.startsWith('/agents') ? 'agents' : 'home')
  const openPro = () => {
    window.history.pushState({}, '', '/agents')
    setView('agents')
  }
  const backHome = () => {
    window.history.pushState({}, '', '/')
    setView('home')
  }

  if (window.location.pathname === PAYPAL_TEST_PATH) return <PublicPlatformHome onOpenPro={openPro} />
  if (view === 'agents') return <AgentsPlatform onBack={backHome} />
  return <PublicPlatformHome onOpenPro={openPro} />
}
