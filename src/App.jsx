import { useState } from 'react'
import './index.css'
import AgentsPlatform from './components/AgentsPlatform'
import BoutiqueEcommerce from './components/BoutiqueEcommerce'
import ConsultationSection from './components/ConsultationSection'
import FormationPage from './components/FormationPage'
import LegalFooter from './components/LegalFooter'
import { MentionsLegales, PolitiqueConfidentialite, CgvOracle, Retractation } from './components/LegalPages'
import OraclePage from './components/OraclePage'
import ReseauDirectory from './components/ReseauDirectory'
import ReseauJoindre from './components/ReseauJoindre'
import RdvDashboard from './components/rdv/RdvDashboard'
import RdvPublic from './components/rdv/RdvPublic'
import RdvCancellation from './components/rdv/RdvCancellation'

function Nav({ onOpenPro, onOpenFormation, onOpenReseauDir }) {
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
          <button onClick={onOpenReseauDir} className="hover:text-gold transition-colors">Trouver un praticien</button>
        </nav>
        <button onClick={onOpenPro} className="font-georgia text-xs md:text-sm tracking-wide px-4 py-2.5 md:px-5 rounded-lg bg-deep text-gold font-bold">Espace Pro →</button>
      </div>
    </header>
  )
}

function UniverseCard({ icon, eyebrow, title, children, action, onClick, href, dark = false, badge }) {
  const isDark = !!dark
  const classes = typeof dark === 'string'
    ? `${dark} text-cream`
    : dark ? 'bg-deep text-cream border-deep' : 'bg-white/55 text-deep border-gold/25'
  const buttonClasses = isDark ? 'text-gold' : 'text-deep'
  return (
    <article className={`rounded-3xl border p-7 md:p-8 shadow-sm flex flex-col min-h-[300px] ${classes}`}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <span className="text-gold text-3xl">{icon}</span>
        {badge && <span className={`font-georgia text-[10px] uppercase tracking-[0.16em] rounded-full px-3 py-1 ${isDark ? 'bg-white/10 text-gold' : 'bg-deep/5 text-mist'}`}>{badge}</span>}
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

function FeaturedAccompagnement({ onOpen }) {
  const features = [
    { icon: '◇', label: '25 modules PDF', sub: '4 niveaux · 269 pages' },
    { icon: '◌', label: '84 exercices guidés', sub: 'Progressifs et pratiques' },
    { icon: '✦', label: 'Assistant MediumIA', sub: 'Formé sur le parcours' },
    { icon: '◈', label: '12 mois d\'accès', sub: 'Modules PDF à vie' },
  ]
  return (
    <article
      className="rounded-3xl border border-gold/25 p-8 md:p-12 shadow-lg flex flex-col md:flex-row md:items-center gap-8 md:gap-12"
      style={{ background: 'linear-gradient(135deg, #1A1535 0%, #221C45 100%)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-georgia text-gold tracking-[0.28em] text-[11px] uppercase mb-2">MEDIUMIA</p>
        <p className="font-georgia text-gold/55 tracking-[0.14em] text-sm mb-6">Accompagnement à la Médiumnité Consciente</p>
        <h2 className="font-georgia text-cream text-3xl md:text-5xl font-medium leading-tight mb-5">
          Médiumnité Consciente
        </h2>
        <p className="font-georgia text-cream/65 text-base md:text-lg leading-relaxed mb-8 max-w-xl">
          25 modules en 4 niveaux — des fondations à la pratique accomplie — avec un assistant IA dédié et 12 mois d'accès.
          Une transmission née de plus de douze ans de pratique réelle.
        </p>
        <button
          onClick={onOpen}
          className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold text-base hover:bg-gold/90 transition-colors"
        >
          Découvrir l'accompagnement →
        </button>
      </div>
      <div className="shrink-0 grid grid-cols-2 gap-3 md:w-64">
        {features.map(f => (
          <div
            key={f.label}
            className="rounded-2xl border border-gold/20 p-4"
            style={{ background: 'rgba(255,255,255,0.07)' }}
          >
            <span className="text-gold text-xl block mb-2">{f.icon}</span>
            <p className="font-georgia text-xs text-cream font-medium leading-snug mb-1">{f.label}</p>
            <p className="font-georgia text-[10px] leading-tight" style={{ color: 'rgba(250,250,247,0.45)' }}>{f.sub}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {
  return (
    <div id="top" className="bg-cream min-h-screen text-deep">
      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenReseauDir={onOpenReseauDir} />
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
            <button onClick={onOpenFormation} className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir l'accompagnement →</button>
            <button onClick={onOpenReseauForm} className="font-georgia px-8 py-4 rounded-lg border border-gold/50 text-deep font-bold">Rejoindre le réseau →</button>
          </div>
        </section>

        {/* ── Découvrir ── */}
        <section id="decouvrir" className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="h-10 w-auto mx-auto mb-5 opacity-60" />
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">L'univers MediumIA</p>
            <h2 className="font-georgia font-medium text-3xl md:text-5xl leading-tight mb-5">Ce que vous trouverez ici.</h2>
            <p className="font-georgia text-mist text-lg leading-relaxed">Un accompagnement pour apprendre et pratiquer, des praticiens pour être guidé, et pour les professionnels, des outils pensés pour leur activité.</p>
          </div>

          <div className="flex flex-col gap-5">
            <div id="formation">
              <FeaturedAccompagnement onOpen={onOpenFormation} />
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <UniverseCard icon="✦" eyebrow="Réseau" title="Rencontrer un membre du réseau MediumIA" action="Découvrir le réseau" onClick={onOpenReseauDir} dark="bg-mist border-mist">
                Découvrez les praticiens présents sur MediumIA, leur approche, leurs spécialités et leur manière d'accompagner.
              </UniverseCard>
              <UniverseCard icon="✺" eyebrow="Espace Pro" title="Développer son activité sans perdre son identité" action="Entrer dans l'espace Pro" onClick={onOpenPro} dark badge="Prototype privé">
                Assistants IA métier, documents et mémoire professionnelle, aide à la communication, futurs profils du réseau et outils pensés spécialement pour les professionnels de l'accompagnement spirituel.
              </UniverseCard>
            </div>
          </div>
        </section>

        {/* ── Consulter ── */}
        <ConsultationSection id="consulter" onOpenRdv={onOpenRdv} />

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

      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}

const PAYPAL_TEST_PATH = '/test-paypal-mediumia-live-1eur-9f3b2c'

export default function App() {
  const path = window.location.pathname
  const initial = path === '/rdv/annuler' ? 'rdv-cancellation'
    : path.startsWith('/rdv/') ? 'rdv-public'
    : path === '/rdv' ? 'rdv-dashboard'
    : path.startsWith('/agents') ? 'agents'
    : path.startsWith('/formation') ? 'formation'
    : path.startsWith('/oracle') ? 'oracle'
    : path.startsWith('/reseau/rejoindre') ? 'reseau-form'
    : path.startsWith('/reseau') ? 'reseau-dir'
    : path === '/mentions' ? 'mentions'
    : path === '/confidentialite' ? 'confidentialite'
    : path === '/cgv-oracle' ? 'cgv-oracle'
    : path === '/retractation' ? 'retractation'
    : 'home'
  const [view, setView] = useState(initial)

  const nav = (p, v) => { window.history.pushState({}, '', p); window.scrollTo(0, 0); setView(v) }
  const openPro        = () => nav('/agents',           'agents')
  const openFormation  = () => nav('/formation',        'formation')
  const openOracle     = () => nav('/oracle',           'oracle')
  const openReseauDir   = () => nav('/reseau',           'reseau-dir')
  const openReseauForm  = () => nav('/reseau/rejoindre', 'reseau-form')
  const openRdvDashboard = () => nav('/rdv',             'rdv-dashboard')
  const openRdvPublic   = (slug) => nav(`/rdv/${slug}`,  'rdv-public')
  const backHome        = () => nav('/',                 'home')

  const legalNav = (p) => {
    const viewMap = { '/mentions': 'mentions', '/confidentialite': 'confidentialite', '/cgv-oracle': 'cgv-oracle', '/retractation': 'retractation' }
    if (viewMap[p]) nav(p, viewMap[p])
    else backHome()
  }

  if (window.location.pathname === PAYPAL_TEST_PATH) return <PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onNavigate={legalNav} />
  if (view === 'mentions')       return <MentionsLegales onBack={backHome} onNavigate={legalNav} />
  if (view === 'confidentialite') return <PolitiqueConfidentialite onBack={backHome} onNavigate={legalNav} />
  if (view === 'cgv-oracle')     return <CgvOracle onBack={backHome} onNavigate={legalNav} />
  if (view === 'retractation')   return <Retractation onBack={backHome} onNavigate={legalNav} />
  if (view === 'agents')        return <AgentsPlatform onBack={backHome} onOpenReseau={openReseauForm} onOpenRdv={openRdvDashboard} />
  if (view === 'formation')    return <FormationPage onBack={backHome} onNavigate={legalNav} />
  if (view === 'oracle')       return <OraclePage onBack={backHome} onNavigate={legalNav} />
  if (view === 'reseau-dir')   return <ReseauDirectory onBack={backHome} onNavigate={legalNav} />
  if (view === 'reseau-form')  return <ReseauJoindre onBack={backHome} onNavigate={legalNav} />
  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} />
  if (view === 'rdv-cancellation') return <RdvCancellation onBack={backHome} />
  if (view === 'rdv-public')   return <RdvPublic onBack={backHome} onNavigate={legalNav} />
  return <PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onNavigate={legalNav} />
}
