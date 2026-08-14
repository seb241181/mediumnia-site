import { useEffect, useRef, useState } from 'react'
import './index.css'
import OracleTest from './components/OracleTest'
import AgentsPlatform from './components/AgentsPlatform'

/* ─── Hook d'animation au scroll ─── */
function useFadeIn() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) el.classList.add('visible') },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

function PlatformPreview({ onOpenAgents }) {
  return (
    <section className="px-6 py-16 max-w-5xl mx-auto w-full">
      <div className="rounded-3xl border border-gold/30 bg-white/50 p-8 md:p-12 text-center shadow-sm">
        <p className="font-georgia text-gold tracking-[0.22em] text-xs uppercase mb-4">Un nouvel espace MediumIA</p>
        <h2 className="font-georgia text-3xl md:text-5xl text-deep font-medium leading-tight mb-5">Créez l’agent IA qui connaît votre métier.</h2>
        <p className="font-georgia text-mist text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-8">Explorez des agents prêts à personnaliser ou partez d’une page blanche. Vos clients Agents n’ont pas besoin d’acheter la formation : cet espace devient un produit MediumIA à part entière.</p>
        <button onClick={onOpenAgents} className="font-georgia text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]" style={{ backgroundColor: '#1A1535', color: '#C9A84C', fontWeight: 700 }}>Explorer MediumIA Agents →</button>
      </div>
    </section>
  )
}

/* ─── Composants réutilisables ─── */
function Section({ id, children, className = '' }) {
  const ref = useFadeIn()
  return (
    <section id={id} ref={ref} className={`fade-in px-6 py-12 md:py-16 max-w-3xl mx-auto w-full ${className}`}>
      {children}
    </section>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="font-georgia text-2xl md:text-3xl text-deep font-medium leading-tight mb-6">
      {children}
    </h2>
  )
}

function Ornament() { return <p className="text-gold/40 text-sm tracking-widest text-center my-6">◆ ─────── ◆</p> }
function BtnPrimary({ href = 'https://www.paypal.com/ncp/payment/V7G9ELH4LF6YW', children, className = '' }) { return <a href={href} className={`inline-block font-georgia text-sm md:text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02] ${className}`} style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}>{children}</a> }

/* NOTE: Le reste du site public est conservé dans la version précédente. Cette branche sert de prototype plateforme. */
function Nav({ onOpenAgents }) {
  return <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20"><div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between"><a href="#" className="font-georgia text-deep tracking-[0.2em] text-base font-semibold">✦ MEDIUMIA</a><div className="flex items-center gap-2 md:gap-4"><button onClick={onOpenAgents} className="font-georgia text-xs md:text-sm tracking-wide px-3 py-2 md:px-5 md:py-2.5 rounded-lg text-deep border border-gold/40 font-bold">Agents</button><a href="https://mediumnia-app.vercel.app" target="_blank" rel="noopener noreferrer" className="font-georgia text-xs md:text-sm tracking-wide px-3 py-2 md:px-5 md:py-2.5 rounded-lg font-bold" style={{ backgroundColor: '#C9A84C', color: '#1A1535' }}>Espace élève →</a></div></div></header>
}

function PublicPlatformHome({ onOpenAgents }) {
  return <div className="bg-cream min-h-screen"><Nav onOpenAgents={onOpenAgents}/><main><section className="min-h-[78vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-12"><p className="text-gold text-4xl mb-4 opacity-70">✦</p><h1 className="font-georgia text-5xl md:text-7xl text-deep tracking-[0.22em] font-medium mb-5">MEDIUMIA</h1><p className="font-georgia text-mist text-base md:text-xl tracking-widest italic mb-8">L’humain transmet. L’intelligence accompagne.</p><p className="font-georgia text-deep text-xl md:text-2xl leading-relaxed max-w-2xl mx-auto mb-9">Deux univers. Une même maison.<br/>Développez votre médiumnité ou créez l’agent IA qui porte votre savoir.</p><div className="flex flex-col sm:flex-row gap-4"><a href="https://mediumia.fr" className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold">Découvrir la formation</a><button onClick={onOpenAgents} className="font-georgia px-8 py-4 rounded-lg bg-deep text-gold font-bold">Explorer les agents</button></div></section><PlatformPreview onOpenAgents={onOpenAgents}/><section className="px-6 pb-20 max-w-5xl mx-auto grid md:grid-cols-2 gap-5"><div className="rounded-2xl border border-gold/25 bg-white/50 p-7"><p className="text-gold text-2xl mb-4">◇</p><h2 className="font-georgia text-2xl mb-3">MediumIA Formation</h2><p className="font-georgia text-mist leading-relaxed mb-5">Le parcours de médiumnité consciente et son espace élève restent indépendants de la plateforme Agents.</p><a href="https://mediumnia-app.vercel.app" target="_blank" rel="noopener noreferrer" className="font-georgia text-sm font-bold text-deep">Accéder à l’espace élève →</a></div><div className="rounded-2xl border border-gold/25 bg-deep p-7 text-cream"><p className="text-gold text-2xl mb-4">✦</p><h2 className="font-georgia text-2xl mb-3">MediumIA Agents</h2><p className="font-georgia text-cream/70 leading-relaxed mb-5">Une plateforme indépendante pour explorer, personnaliser et bientôt créer vos propres agents professionnels.</p><button onClick={onOpenAgents} className="font-georgia text-sm font-bold text-gold">Entrer dans la plateforme →</button></div></section></main></div>
}

const PAYPAL_TEST_PATH = '/test-paypal-mediumia-live-1eur-9f3b2c'

export default function App() {
  const [view, setView] = useState(window.location.pathname.startsWith('/agents') ? 'agents' : 'home')
  if (window.location.pathname === PAYPAL_TEST_PATH) return <PublicPlatformHome onOpenAgents={() => setView('agents')} />
  if (view === 'agents') return <AgentsPlatform onBack={() => { window.history.pushState({}, '', '/'); setView('home') }} />
  const openAgents = () => { window.history.pushState({}, '', '/agents'); setView('agents') }
  return <PublicPlatformHome onOpenAgents={openAgents} />
}
