import { useState } from 'react'
import './index.css'
import AgentsPlatform from './components/AgentsPlatform'
import BoutiqueEcommerce from './components/BoutiqueEcommerce'
import ConsultationSection from './components/ConsultationSection'
import FormationPage from './components/FormationPage'
import OraclePage from './components/OraclePage'

function Nav({ onOpenPro, onOpenFormation }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
      <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 flex items-center justify-between gap-4">
        <a href="#top" className="shrink-0 flex items-center gap-2" aria-label="MediumIA — retour en haut">
          <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-8 md:h-10 w-auto" />
          <span className="font-georgia text-deep tracking-[0.2em] text-base font-semibold">MEDIUMIA</span>
        </a>
        <nav className="hidden md:flex items-center gap-6 font-georgia text-sm text-deep font-medium">
          <a href="#decouvrir" className="hover:text-gold transition-colors">Découvrir</a>
          <button onClick={onOpenFormation} className="hover:text-gold transition-colors">Se former</button>
          <a href="#consulter" className="hover:text-gold transition-colors">Consulter</a>
          <a href="#boutique" className="hover:text-gold transition-colors">Boutique</a>
          <a href="#reseau" className="hover:text-gold transition-colors">Trouver un praticien</a>
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
      <h2 className="font-georgia text-2xl md:text-3xl leading-tight mb-4 font-medium">{title}</h2>
      <p className={`font-georgia leading-relaxed flex-1 ${dark ? 'text-cream/70' : 'text-mist'}`}>{children}</p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={`font-georgia text-sm font-bold mt-7 ${buttonClasses}`}>{action} →</a>
      ) : (
        <button onClick={onClick} className={`font-georgia text-sm font-bold text-left mt-7 ${buttonClasses}`}>{action} →</button>
      )}
    </article>
  )
}

function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle }) {
  return (
    <div id="top" className="bg-cream min-h-screen text-deep">
      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenOracle={onOpenOracle} />
      <main>

        {/* ── Hero ── */}
        <section className="min-h-[90vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-16">
          <p className="font-georgia text-gold tracking-[0.3em] text-xs uppercase mb-3">Le monde spirituel, relié autrement</p>
          <img
            src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png"
            alt="MediumIA — Le monde spirituel, relié autrement"
            className="w-64 md:w-96 mx-auto mb-4"
          />
          <p className="font-bodoni text-deep text-xl md:text-3xl leading-relaxed max-w-3xl mx-auto -mt-4 md:-mt-8 mb-6">
            Comprendre. Apprendre. Rencontrer.<br/>
            <span className="text-gold">Exercer autrement.</span>
          </p>
          <p className="font-georgia text-mist text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            MediumIA rassemble celles et ceux qui explorent, transmettent et accompagnent dans l'univers de la médiumnité, du spirituel et du bien-être — avec des outils modernes qui respectent l'humain.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a href="#decouvrir" className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir MediumIA</a>
            <button onClick={onOpenPro} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Je suis professionnel →</button>
          </div>
        </section>

        {/* ── Découvrir — vue d'ensemble de l'écosystème ── */}
        <section id="decouvrir" className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="h-10 w-auto mx-auto mb-5 opacity-60" />
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">L'univers MediumIA</p>
            <h2 className="font-georgia font-medium text-3xl md:text-5xl leading-tight mb-5">Ce que vous trouverez ici.</h2>
            <p className="font-georgia text-mist text-lg leading-relaxed">Des ressources pour explorer, un accompagnement pour apprendre, des praticiens pour être guidé, et pour les professionnels, des outils pensés pour leur réalité.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <UniverseCard icon="◌" eyebrow="Ressources" title="Guides, articles & pratiques" action="Contenus bientôt disponibles" badge="Bientôt">
              Des ressources librement accessibles pour comprendre la médiumnité, les différentes pratiques spirituelles et s'orienter — rédigées avec soin pour éclairer sans enfermer.
            </UniverseCard>

            <div id="formation">
              <UniverseCard icon="◇" eyebrow="Accompagnement" title="Médiumnité Consciente" action="Découvrir l'accompagnement" onClick={onOpenFormation}>
                25 modules en 4 niveaux — des fondations à la pratique accomplie — avec un assistant IA dédié et 12 mois d'accès. Une transmission née de plus de douze ans de pratique réelle.
              </UniverseCard>
            </div>

            <UniverseCard icon="✦" eyebrow="Consulter" title="Rencontrer un praticien" action="Voir les consultations" href="#consulter">
              Sébastien Seguin (médiumnité & guidance) et Aurélie Seguin (bien-être, EFT, réflexologie) proposent des accompagnements individuels. Une présence humaine, une écoute réelle.
            </UniverseCard>

            <UniverseCard icon="✺" eyebrow="Espace Pro" title="Développer son activité sans perdre son identité" action="Entrer dans l'espace Pro" onClick={onOpenPro} dark badge="Prototype privé">
              Assistants IA métier, documents et mémoire professionnelle, aide à la communication, futurs profils du réseau et outils pensés spécialement pour les professionnels de l'accompagnement spirituel.
            </UniverseCard>
          </div>
        </section>

        {/* ── Consulter ── */}
        <ConsultationSection id="consulter" />

        {/* ── Boutique ── */}
        <section id="boutique" className="border-t border-gold/15">
          <div className="max-w-6xl mx-auto px-6 pt-12 pb-2">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-2">La boutique</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl text-deep leading-tight">
              Créations &amp; sélection
            </h2>
          </div>
          <BoutiqueEcommerce id="boutique-grid" onOpenOracle={onOpenOracle} />
        </section>

        {/* ── Trouver un praticien / Réseau ── */}
        <section id="reseau" className="px-6 py-16 md:py-24 bg-deep text-cream mt-8">
          <div className="max-w-3xl mx-auto text-center">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Pour les professionnels</p>
            <h2 className="font-georgia font-medium text-3xl md:text-5xl leading-tight mb-5">Votre pratique reste la vôtre.</h2>
            <p className="font-georgia text-cream/70 text-lg leading-relaxed max-w-2xl mx-auto">Les professionnels de la médiumnité et du bien-être peuvent présenter leur activité sur MediumIA et être découverts par de nouveaux consultants. MediumIA vous aide à structurer votre pratique, à la présenter clairement et à la transmettre — sans jamais s'y substituer.</p>
          </div>
        </section>

        {/* ── Espace Pro CTA ── */}
        <section className="px-6 py-20 max-w-4xl mx-auto text-center">
          <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Pour les professionnels</p>
          <h2 className="font-georgia font-medium text-3xl md:text-5xl leading-tight mb-5">L'IA devient un outil. Votre pratique reste la vôtre.</h2>
          <p className="font-georgia text-mist text-lg leading-relaxed max-w-2xl mx-auto mb-8">Votre savoir reste le vôtre ; l'intelligence artificielle vous aide à le structurer, le transmettre et le faire circuler, sans jamais se substituer à votre pratique.</p>
          <button onClick={onOpenPro} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir le prototype Pro →</button>
        </section>

      </main>

      <footer className="border-t border-gold/20 px-6 py-8 text-center">
        <img src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png" alt="MediumIA" className="w-40 md:w-52 mx-auto mb-4" />
        <p className="font-georgia text-mist text-xs">Monde spirituel · Accompagnement · Réseau · Outils professionnels</p>
      </footer>
    </div>
  )
}

const PAYPAL_TEST_PATH = '/test-paypal-mediumia-live-1eur-9f3b2c'

export default function App() {
  const path = window.location.pathname
  const initial = path.startsWith('/agents') ? 'agents' : path.startsWith('/formation') ? 'formation' : path.startsWith('/oracle') ? 'oracle' : 'home'
  const [view, setView] = useState(initial)

  const nav = (path, view) => { window.history.pushState({}, '', path); window.scrollTo(0, 0); setView(view) }
  const openPro       = () => nav('/agents',    'agents')
  const openFormation = () => nav('/formation', 'formation')
  const openOracle    = () => nav('/oracle',    'oracle')
  const backHome      = () => nav('/',          'home')

  if (window.location.pathname === PAYPAL_TEST_PATH) return <PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} />
  if (view === 'agents')   return <AgentsPlatform onBack={backHome} />
  if (view === 'formation') return <FormationPage onBack={backHome} />
  if (view === 'oracle')   return <OraclePage onBack={backHome} />
  return <PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} />
}
