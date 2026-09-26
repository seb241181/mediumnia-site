import { useState, useEffect } from 'react'
import './index.css'
import './styles/cosmic-design-system.css'
import AgentsPlatform from './components/AgentsPlatform'
import BoutiqueEcommerce from './components/BoutiqueEcommerce'
import ConsultationSection from './components/ConsultationSection'
import FormationPage from './components/FormationPage'
import LegalFooter from './components/LegalFooter'
import { MentionsLegales, PolitiqueConfidentialite, CgvOracle, CgvChronosphere, Retractation } from './components/LegalPages'
import OraclePage from './components/OraclePage'
import ProWaitlistPage from './components/ProWaitlistPage'
import ReseauDirectory from './components/ReseauDirectory'
import ReseauJoindre from './components/ReseauJoindre'
import RdvDashboard from './components/rdv/RdvDashboard'
import RdvPublic from './components/rdv/RdvPublic'
import RdvCancellation from './components/rdv/RdvCancellation'
import ChronospherePage from './components/ChronospherePage'
import ChronosphereExamplePage from './components/ChronosphereExamplePage'
import ChronosphereMaxPage from './components/ChronosphereMaxPage'
import SiteGuardian from './components/SiteGuardian'
import CosmicLibraryHero from './components/CosmicLibraryHero'
import ConferencePassPage from './components/ConferencePassPage'
import ReviewsPage, { ReviewsHighlight } from './components/ReviewsPage'
import GiftCardsPage from './components/GiftCardsPage'
import DefiIntuitionPage from './components/DefiIntuitionPage'
import FormationParcoursPage from './components/FormationParcoursPage'
import SiteNav from './components/SiteNav'
import PageRail from './components/PageRail'
import DiscoverSection from './components/DiscoverSection'
import PractitionersBand from './components/PractitionersBand'
import { money, useParcoursOffer } from './lib/parcoursOffer.js'

function Nav({ onOpenPro, onOpenFormation, onOpenReseauDir, onOpenConferences }) {
  return <SiteNav current="home" onOpenFormation={onOpenFormation} onOpenConferences={onOpenConferences} onOpenReseauDir={onOpenReseauDir} />
}

function FeaturedAccompagnement({ onOpen }) {
  const offer = useParcoursOffer()
  const features = [
    { icon: '◇', label: '25 modules PDF', sub: '4 niveaux · 269 pages' },
    { icon: '◌', label: '84 exercices guidés', sub: 'Progressifs et pratiques' },
    { icon: '✦', label: 'Assistant MediumIA', sub: 'Formé sur le parcours' },
    { icon: '◈', label: '12 mois d\'accès', sub: 'Modules PDF à vie' },
  ]
  return (
    <article
      className="cosmic-card-lift rounded-3xl border border-gold/25 p-8 md:p-12 shadow-lg flex flex-col md:flex-row md:items-center gap-8 md:gap-12"
      style={{ background: 'linear-gradient(135deg, #1A1535 0%, #221C45 100%)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-georgia text-gold tracking-[0.28em] text-[11px] uppercase mb-2">L’offre principale</p>
        <p className="font-georgia text-gold/60 tracking-[0.14em] text-sm mb-6">Accompagnement à la médiumnité consciente</p>
        <h2 className="font-georgia text-cream text-3xl md:text-5xl font-medium leading-tight mb-5">
          Formation MediumIA
        </h2>
        <p className="font-georgia text-cream/65 text-base md:text-lg leading-relaxed mb-8 max-w-xl">
          25 modules en 4 niveaux — des fondations à la pratique accomplie — avec un assistant IA dédié et 12 mois d'accès.
          Une transmission née de plus de douze ans de pratique réelle.
        </p>
        {offer ? (
          <div className="mb-7 rounded-2xl border border-gold/30 bg-white/[0.06] p-5 max-w-xl">
            <p className="font-georgia text-gold tracking-[0.18em] text-[10px] uppercase mb-2">Paiement progressif</p>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="font-georgia text-cream text-4xl font-medium">{money(offer.discoveryCents)}</p>
              <p className="font-georgia text-cream/75 text-sm pb-1">pour commencer</p>
            </div>
            <p className="font-georgia text-cream/75 text-sm mt-2">puis {offer.regularCount} × {money(offer.stepCents)} · dernière étape {money(offer.finalCents)}</p>
            <p className="font-georgia text-cream/55 text-xs mt-2">Total maximum {money(offer.capCents)} · arrêt et reprise possibles · ou {money(offer.capCents)} en une fois</p>
          </div>
        ) : (
          <>
            <p className="font-georgia text-cream text-3xl font-medium mb-1">597 € TTC</p>
            <p className="font-georgia text-cream/60 text-sm mb-7">Paiement sécurisé par carte bancaire ou PayPal.</p>
          </>
        )}
        <a
          href="/formation"
          onClick={(event) => { event.preventDefault(); onOpen() }}
          className="inline-block font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold text-base hover:bg-gold/90 transition-colors"
        >
          Voir la formation et les paiements →
        </a>
      </div>
      <div className="shrink-0 md:w-72">
        <div className="mb-3 overflow-hidden rounded-2xl border border-gold/30 bg-cream p-3 shadow-[0_18px_34px_rgba(0,0,0,.2)]">
          <img
            src="/images/brand/MEDIUMIA_logo_maitre_2026-08-16.png"
            alt="MediumIA, accompagnement à la médiumnité consciente"
            className="aspect-[4/3] w-full object-cover object-center"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
      </div>
    </article>
  )
}

const HOME_RAIL = [
  { id: 'formation', label: 'Formation' },
  { id: 'consulter', label: 'Consulter' },
  { id: 'avis', label: 'Avis' },
  { id: 'decouvrir', label: 'Découvrir' },
  { id: 'boutique', label: 'Boutique' },
  { id: 'praticiens', label: 'Praticiens' },
]

function PublicPlatformHome({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenChronosphereExample, onOpenReseauDir, onOpenReseauForm, onOpenRdv, onNavigate }) {
  return (
    <div id="top" className="cosmic-home bg-cream min-h-screen text-deep">
      <Nav onOpenPro={onOpenPro} onOpenFormation={onOpenFormation} onOpenReseauDir={onOpenReseauDir} />
      <PageRail items={HOME_RAIL} />
      <main>

        {/* ── Hero ── */}
        <CosmicLibraryHero
          onOpenPro={onOpenPro}
          onOpenFormation={onOpenFormation}
          onOpenOracle={onOpenOracle}
          onOpenChronosphere={onOpenChronosphere}
          onOpenReseauDir={onOpenReseauDir}
        />

        {/* ── Formation MediumIA : l'offre principale, dès le premier défilement ── */}
        <section id="formation" className="mx-auto max-w-6xl scroll-mt-28 px-6 pt-16">
          <FeaturedAccompagnement onOpen={onOpenFormation} />
        </section>

        {/* ── Consulter ── */}
        <ConsultationSection id="consulter" compact onOpenRdv={onOpenRdv} />

        {/* ── Avis clients (uniquement ceux validés) ── */}
        <ReviewsHighlight />

        {/* ── Découvrir et expérimenter ── */}
        <DiscoverSection id="decouvrir" onOpenOracle={onOpenOracle} onOpenChronosphere={onOpenChronosphere} />

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

        {/* ── Praticiens : réseau et Espace Pro ── */}
        <PractitionersBand onOpenReseauDir={onOpenReseauDir} onOpenReseauForm={onOpenReseauForm} onOpenPro={onOpenPro} />

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
    : p === '/formation/parcours' ? 'formation-parcours'
    : p.startsWith('/formation') ? 'formation'
    : p.startsWith('/chronosphere-max') ? 'chronosphere-max'
    : p.startsWith('/chronosphere/exemple') ? 'chronosphere-example'
    : p.startsWith('/chronosphere') ? 'chronosphere'
    : p.startsWith('/oracle') ? 'oracle'
    : p.startsWith('/pass/mediumia/') ? 'conference-pass'
    : p.startsWith('/reseau/rejoindre') ? 'reseau-form'
    : p.startsWith('/reseau') ? 'reseau-dir'
    : p === '/avis' || p.startsWith('/avis/') ? 'avis'
    : p === '/cartes-cadeaux' || p.startsWith('/carte-cadeau/') ? 'cartes-cadeaux'
    : p === '/defi-intuition' ? 'defi-intuition'
    : p === '/mentions' ? 'mentions'
    : p === '/confidentialite' ? 'confidentialite'
    : p === '/cgv-oracle' ? 'cgv-oracle'
    : p === '/cgv-chronosphere' ? 'cgv-chronosphere'
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
  const openChronosphereExample = () => nav('/chronosphere/exemple', 'chronosphere-example')
  const openReseauDir   = () => nav('/reseau',           'reseau-dir')
  const openReseauForm  = () => nav('/reseau/rejoindre', 'reseau-form')
  const openRdvDashboard = () => nav('/rdv',             'rdv-dashboard')
  const openRdvPublic   = (slug) => nav(`/rdv/${slug}`,  'rdv-public')
  const backHome        = () => nav('/',                 'home')

  const legalNav = (p) => {
    const viewMap = { '/mentions': 'mentions', '/confidentialite': 'confidentialite', '/cgv-oracle': 'cgv-oracle', '/retractation': 'retractation' }
    if (p === '/cgv-chronosphere') nav(p, 'cgv-chronosphere')
    else if (viewMap[p]) nav(p, viewMap[p])
    else backHome()
  }

  const showGuardian = view !== 'rdv-dashboard'

  const guardian = showGuardian ? <SiteGuardian /> : null

  if (view === 'mentions')       return <><MentionsLegales onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'confidentialite') return <><PolitiqueConfidentialite onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'cgv-oracle')     return <><CgvOracle onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'cgv-chronosphere') return <><CgvChronosphere onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'retractation')   return <><Retractation onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'pro')           return <><ProWaitlistPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'formation')    return <><FormationPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'oracle')       return <><OraclePage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'conference-pass') return <><ConferencePassPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'chronosphere') return <><ChronospherePage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'chronosphere-example') return <><ChronosphereExamplePage onBack={backHome} onOpenChronosphere={openChronosphere} onNavigate={legalNav} />{guardian}</>
  if (view === 'chronosphere-max') return <><ChronosphereMaxPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'cartes-cadeaux') return <><GiftCardsPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'formation-parcours') return <><FormationParcoursPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'defi-intuition') return <><DefiIntuitionPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'avis')         return <><ReviewsPage onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'reseau-dir')   return <><ReseauDirectory onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'reseau-form')  return <><ReseauJoindre onBack={backHome} onNavigate={legalNav} />{guardian}</>
  if (view === 'rdv-dashboard') return <RdvDashboard onBack={backHome} onOpenPublic={openRdvPublic} />
  if (view === 'rdv-cancellation') return <><RdvCancellation onBack={backHome} />{guardian}</>
  if (view === 'rdv-public')   return <><RdvPublic onBack={backHome} onNavigate={legalNav} />{guardian}</>
  return <><PublicPlatformHome onOpenPro={openPro} onOpenFormation={openFormation} onOpenOracle={openOracle} onOpenChronosphere={openChronosphere} onOpenChronosphereExample={openChronosphereExample} onOpenReseauDir={openReseauDir} onOpenReseauForm={openReseauForm} onOpenRdv={openRdvPublic} onNavigate={legalNav} />{guardian}</>
}
