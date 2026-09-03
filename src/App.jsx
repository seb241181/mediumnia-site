import { useState, useEffect } from 'react'
import './index.css'
import AgentsPlatform from './components/AgentsPlatform'
import BoutiqueEcommerce from './components/BoutiqueEcommerce'
import ConsultationSection from './components/ConsultationSection'
import FormationPage from './components/FormationPage'
import LegalFooter from './components/LegalFooter'
import { MentionsLegales, PolitiqueConfidentialite, CgvOracle, Retractation } from './components/LegalPages'
import OraclePage from './components/OraclePage'
import ProWaitlistPage from './components/ProWaitlistPage'
import ReseauDirectory from './components/ReseauDirectory'
import ReseauJoindre from './components/ReseauJoindre'
import RdvDashboard from './components/rdv/RdvDashboard'
import RdvPublic from './components/rdv/RdvPublic'
import RdvCancellation from './components/rdv/RdvCancellation'
import ChronospherePage from './components/ChronospherePage'
import SiteGuardian from './components/SiteGuardian'

function Nav({ onOpenPro, onOpenFormation, onOpenReseauDir }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
      <div className="max-w-6xl mx-auto px-5 md:px-6 py-4 md:py-5 flex items-center justify-between gap-5">
        <a href="#top" className="shrink-0 flex items-center gap-2.5" aria-label="MediumIA — retour en haut">
          <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-9 md:h-12 w-auto" />
          <span className="font-georgia text-deep tracking-[0.2em] text-base md:text-lg font-semibold">MEDIUMIA</span>
        </a>
        <nav className="hidden md:flex items-center gap-7 font-georgia text-[15px] text-deep font-medium">
          <a href="#decouvrir" className="hover:text-gold transition-colors">Découvrir</a>
          <button onClick={onOpenFormation} className="hover:text-gold transition-colors">Se former</button>
          <a href="#consulter" className="hover:text-gold transition-colors">Consulter</a>
          <a href="#boutique" className="hover:text-gold transition-colors">Boutique</a>
          <button onClick={onOpenReseauDir} className="hover:text-gold transition-colors">Trouver un praticien</button>
        </nav>
        <div className="shrink-0 flex items-center gap-2">
          <a
            href="https://espace.mediumia.fr"
            className="font-georgia text-[10px] sm:text-xs md:text-sm tracking-wide px-3 py-3 sm:px-4 md:px-5 rounded-lg border border-gold/60 text-deep font-bold whitespace-nowrap hover:bg-gold/10 transition-colors"
          >
            Espace élèves →
          </a>
          <button onClick={onOpenPro} className="font-georgia text-[10px] sm:text-xs md:text-sm tracking-wide px-3 py-3 sm:px-4 md:px-5 rounded-lg bg-deep text-gold font-bold whitespace-nowrap">Espace Pro →</button>
        </div>
      </div>
    </header>
  )
}

function UniverseCard({ icon, eyebrow, title, children, action, onClick, href, badge }) {
  const classes = 'border-gold/35 bg-white/75 text-deep shadow-[0_10px_28px_rgba(26,21,53,.06)] transition-shadow hover:shadow-[0_14px_34px_rgba(26,21,53,.1)]'
  const buttonClasses = 'text-deep transition-colors hover:text-gold'
  return (
    <article className={`rounded-3xl border p-7 md:p-8 shadow-sm flex flex-col min-h-[300px] ${classes}`}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <span className="text-gold text-3xl">{icon}</span>
        {badge && <span className="font-georgia text-[10px] uppercase tracking-[0.16em] rounded-full bg-gold/10 px-3 py-1 text-gold">{badge}</span>}
      </div>
      <p className="font-georgia text-gold tracking-[0.2em] text-[11px] uppercase mb-3">{eyebrow}</p>
      <h2 className="font-georgia text-2xl md:text-3xl leading-tight mb-4 font-medium">{title}</h2>
      <p className="font-georgia leading-relaxed text-mist flex-1">{children}</p>
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

function FeaturedChronosphere({ onOpen }) {
  return (
    <article
      className="relative isolate overflow-hidden rounded-3xl border border-gold/35 px-7 py-9 shadow-xl md:px-12 md:py-12"
      style={{ background: 'radial-gradient(circle at 84% 18%, rgba(201,168,76,.2), transparent 26%), linear-gradient(135deg, #0d1730 0%, #1a1535 54%, #241d42 100%)' }}
    >
      <div className="pointer-events-none absolute -left-20 top-12 h-56 w-56 rounded-full border border-gold/15" />
      <div className="pointer-events-none absolute left-24 top-20 h-2 w-2 rounded-full bg-gold/70 shadow-[0_0_26px_rgba(201,168,76,.9)]" />
      <div className="pointer-events-none absolute right-[39%] top-12 h-1.5 w-1.5 rounded-full bg-cream/70" />
      <div className="relative grid gap-10 md:grid-cols-[1.2fr_.8fr] md:items-center md:gap-14">
        <div className="max-w-2xl">
          <span className="inline-flex rounded-full border border-gold/45 bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">
            Nouveau · CHRONOSPHERE 999
          </span>
          <p className="mt-7 font-georgia text-xs uppercase tracking-[0.24em] text-gold/65">Oracle des Lignes de Temps</p>
          <h2 className="mt-3 font-georgia text-3xl font-medium leading-tight text-cream md:text-5xl">Explorez votre ligne de temps</h2>
          <p className="mt-5 font-georgia text-base leading-relaxed text-cream/75 md:text-lg">
            Votre ciel natal, trois fréquences de l’Oracle et une lecture personnalisée pour éclairer les dynamiques présentes et les fenêtres qui s’ouvrent devant vous.
          </p>
          <p className="mt-6 font-georgia text-sm font-medium text-gold">5,00 € TTC · Tirage unique · Compte rendu par e-mail</p>
          <div className="mt-8">
            <button onClick={onOpen} className="rounded-lg bg-gold px-7 py-4 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90">
              Faire mon tirage — 5 €
            </button>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[265px] md:max-w-[310px]">
          <div className="absolute -inset-2 rounded-[34px] bg-gold/10 blur-2xl" />
          <div
            className="relative aspect-[3/4] overflow-hidden rounded-[28px] border border-gold/40 shadow-[0_24px_55px_rgba(0,0,0,.38)]"
            style={{ background: 'radial-gradient(circle at 50% 48%, rgba(201,168,76,.2), transparent 21%), radial-gradient(circle at 50% 42%, #242763 0%, #161943 35%, #091127 76%)' }}
          >
            <div className="absolute left-1/2 top-1/2 h-[40%] w-[40%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/20 blur-3xl" />
            <span className="absolute left-[18%] top-[20%] h-1.5 w-1.5 rounded-full bg-gold/85 shadow-[0_0_12px_rgba(201,168,76,.8)]" />
            <span className="absolute right-[16%] top-[28%] h-1 w-1 rounded-full bg-cream/75" />
            <span className="absolute bottom-[22%] left-[21%] h-1 w-1 rounded-full bg-cream/60" />
            <span className="absolute bottom-[17%] right-[19%] h-1.5 w-1.5 rounded-full bg-gold/75 shadow-[0_0_12px_rgba(201,168,76,.7)]" />
            <div className="absolute inset-8 flex items-center justify-center">
              <img
                src="/images/brand/MEDIUMIA_symbol_header.png"
                alt="Symbole MediumIA au coeur de Chronosphere"
                className="relative w-full max-w-[255px] object-contain brightness-110 saturate-125 drop-shadow-[0_0_24px_rgba(201,168,76,.42)]"
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {
  return (
    <div id="top" className="bg-cream min-h-screen text-deep">
      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenReseauDir={onOpenReseauDir} />
      <main>

        {/* ── Hero ── */}
        <section className="min-h-[90vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-16">
          <p className="font-georgia text-gold tracking-[0.3em] text-xs uppercase mb-4">Le monde spirituel, relié autrement</p>
          <img
            src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png"
            alt="MediumIA — Le monde spirituel, relié autrement"
            className="w-80 md:w-[32rem] mx-auto mb-5"
          />
          <p className="font-bodoni text-deep text-2xl md:text-4xl leading-relaxed max-w-3xl mx-auto -mt-4 md:-mt-8 mb-7">
            Comprendre. Apprendre. Rencontrer.<br/>
            <span className="text-gold">Exercer autrement.</span>
          </p>
          <p className="font-georgia text-mist text-base md:text-lg leading-relaxed max-w-[700px] mx-auto mb-10">
            MediumIA rassemble celles et ceux qui explorent, transmettent et accompagnent dans l'univers de la médiumnité, du spirituel et du bien-être — avec des outils modernes qui respectent l'humain.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={onOpenFormation} className="font-georgia px-9 py-4 rounded-lg bg-gold text-deep font-bold text-base">Découvrir l'accompagnement →</button>
            <button onClick={onOpenReseauForm} className="font-georgia px-9 py-4 rounded-lg border border-gold/50 text-deep font-bold text-base">Rejoindre le réseau →</button>
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
            <FeaturedChronosphere onOpen={onOpenChronosphere} />
            <div className="grid md:grid-cols-2 gap-5">
              <UniverseCard icon="✦" eyebrow="Réseau" title="Rencontrer un membre du réseau MediumIA" action="Découvrir le réseau" onClick={onOpenReseauDir}>
                Découvrez les praticiens présents sur MediumIA, leur approche, leurs spécialités et leur manière d'accompagner.
              </UniverseCard>
              <UniverseCard icon="✺" eyebrow="MediumIA Pro" title="Votre pratique, amplifiée par des outils qui vous ressemblent" action="Découvrir MediumIA Pro" onClick={onOpenPro} badge="Bientôt disponible">
                Assistants IA métier, mémoire professionnelle, aide à la communication, rendez-vous et automatisations — des outils pensés pour les professionnels de l'accompagnement.
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
          <BoutiqueEcommerce id="boutique-grid" onOpenOracle={onOpenOracle} onOpenFormation={onOpenFormation} />
        </section>

      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}

function pathToView(p) {
  return p === '/rdv/annuler' ? 'rdv-cancellation'
    : p.startsWith('/rdv/') ? 'rdv-public'
    : p === '/rdv' ? 'rdv-dashboard'
    : p === '/pro' || p.startsWith('/agents') ? 'pro'
    : p.startsWith('/formation') ? 'formation'
    : p.startsWith('/chronosphere') ? 'chronosphere'
    : p.startsWith('/oracle') ? 'oracle'
    : p.startsWith('/reseau/rejoindre') ? 'reseau-form'
    : p.startsWith('/reseau') ? 'reseau-dir'
    : p === '/mentions' ? 'mentions'
    : p === '/confidentialite' ? 'confidentialite'
    : p === '/cgv-oracle' ? 'cgv-oracle'
    : p === '/retractation' ? 'retractation'
    : 'home'
}

export default function App() {
  const [view, setView] = useState(() => pathToView(window.location.pathname))

  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const nav = (p, v) => { window.history.pushState({}, '', p); setView(v); requestAnimationFrame(() => window.scrollTo(0, 0)) }
  const openPro        = () => nav('/pro',              'pro')
  const openFormation  = () => nav('/formation',        'formation')
  const openOracle     = () => nav('/oracle',           'oracle')
  const openChronosphere = () => nav('/chronosphere',  'chronosphere')
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

  const showGuardian = view !== 'rdv-dashboard'

  const guardian = showGuardian ? <SiteGuardian /> : null

  if (view === 'mentions')       return <><MentionsLegales onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'confidentialite') return <><PolitiqueConfidentialite onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'cgv-oracle')     return <><CgvOracle onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'retractation')   return <><Retractation onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'pro')           return <><ProWaitlistPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'formation')    return <><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'oracle')       return <><OraclePage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'chronosphere') return <><ChronospherePage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'reseau-dir')   return <><ReseauDirectory onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'reseau-form')  return <><ReseauJoindre onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} />
  if (view === 'rdv-cancellation') return <><RdvCancellation onBack={backHome} />{guardian}</>
  if (view === 'rdv-public')   return <><RdvPublic onBack={backHome} onNavigate={legalNav} />{guardian}</>
  return <><PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenChronosphere={openChronosphere} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onNavigate={legalNav} />{guardian}</>
}
