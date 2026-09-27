import { SOCIAL_LINKS } from '../data/mediumiaMedia.js'
import { SocialIcon } from './VideoInterview.jsx'

export default function LegalFooter({ onNavigate }) {
  const go = (path) => (e) => {
    e.preventDefault()
    if (onNavigate) onNavigate(path)
  }
  return (
    <footer className="border-t border-gold/20 px-6 py-10 text-center">
      <img src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png" alt="MediumIA" className="w-32 md:w-40 mx-auto mb-4" />
      <div className="font-georgia text-[11px] text-mist space-y-0.5 mb-5">
        <p>Sébastien Seguin, entrepreneur individuel — SIRET 81918584400027</p>
        <p>contact@mediumia.fr</p>
      </div>
      <div className="mb-5 flex items-center justify-center gap-3" aria-label="Sébastien sur les réseaux sociaux">
        {SOCIAL_LINKS.map((link) => (
          <a key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`Sébastien Seguin sur ${link.label}`} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gold/35 text-deep transition-colors hover:border-gold hover:text-gold">
            <SocialIcon id={link.id} className="h-5 w-5" />
          </a>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-georgia text-[11px] text-mist/60">
        <a href="/mentions" onClick={go('/mentions')} className="hover:text-gold transition-colors">Mentions légales</a>
        <span className="hidden sm:inline">·</span>
        <a href="/confidentialite" onClick={go('/confidentialite')} className="hover:text-gold transition-colors">Confidentialité</a>
        <span className="hidden sm:inline">·</span>
        <a href="/cgv-oracle" onClick={go('/cgv-oracle')} className="hover:text-gold transition-colors">CGV Oracle</a>
        <span className="hidden sm:inline">·</span>
        <a href="/cgv-chronosphere" onClick={go('/cgv-chronosphere')} className="hover:text-gold transition-colors">CGV ChronoSphère</a>
        <span className="hidden sm:inline">·</span>
        <a href="/retractation" onClick={go('/retractation')} className="hover:text-gold transition-colors">Rétractation</a>
        <span className="hidden sm:inline">·</span>
        <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors">Contact</a>
      </div>
    </footer>
  )
}
