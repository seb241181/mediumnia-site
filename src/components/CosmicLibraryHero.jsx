import { useRef } from 'react'
import '../styles/cosmic-library-home.css'
import '../styles/home-simplified.css'

// Hero simplifié : ce qu'est MediumIA et où cliquer, sans tuiles (le menu suffit).
export const COSMIC_HOME_CONFIG = Object.freeze({
  title: 'Se former à la médiumnité.',
  emphasis: 'Consulter un médium.',
  description: 'MediumIA, c’est la Formation MediumIA de Sébastien Seguin, médium depuis plus de douze ans, et ses consultations : un chemin clair pour comprendre et développer votre sensibilité.',
  primaryAction: 'Découvrir la Formation · 597 €',
})

const LIGHT_PARTICLES = [
  { x: 9, y: 18, size: 3, delay: -2, duration: 9 },
  { x: 16, y: 51, size: 2, delay: -5, duration: 11 },
  { x: 25, y: 28, size: 4, delay: -7, duration: 13 },
  { x: 34, y: 67, size: 2, delay: -1, duration: 10 },
  { x: 42, y: 13, size: 2, delay: -8, duration: 12 },
  { x: 51, y: 39, size: 3, delay: -4, duration: 14 },
  { x: 59, y: 16, size: 2, delay: -6, duration: 9 },
  { x: 67, y: 64, size: 4, delay: -3, duration: 12 },
  { x: 74, y: 25, size: 2, delay: -9, duration: 15 },
  { x: 82, y: 56, size: 3, delay: -2, duration: 11 },
  { x: 89, y: 20, size: 2, delay: -6, duration: 13 },
  { x: 94, y: 70, size: 3, delay: -4, duration: 10 },
]

function CosmicSphereAtmosphere() {
  return (
    <div className="cosmic-sphere-stage cosmic-reveal cosmic-reveal--sphere" aria-hidden="true">
      <div className="cosmic-sphere-stage__halo" />
      <div className="cosmic-sphere-stage__texture" />
      <div className="cosmic-orbit cosmic-orbit--outer"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--middle"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--inner"><span /></div>
    </div>
  )
}

export default function CosmicLibraryHero({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenReseauDir }) {
  const heroRef = useRef(null)

  // Ordered as a path: try for free, go deeper, learn, meet people; the
  // professional space comes last.

  const handlePointerMove = (event) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) - 0.5
    const y = ((event.clientY - bounds.top) / bounds.height) - 0.5
    event.currentTarget.style.setProperty('--scene-x', `${x * -5}px`)
    event.currentTarget.style.setProperty('--scene-y', `${y * -3}px`)
    event.currentTarget.style.setProperty('--sphere-x', `${x * 8}px`)
    event.currentTarget.style.setProperty('--sphere-y', `${y * 5}px`)
    event.currentTarget.style.setProperty('--particle-x', `${x * 12}px`)
    event.currentTarget.style.setProperty('--particle-y', `${y * 8}px`)
  }

  const resetParallax = () => {
    for (const property of ['--scene-x', '--scene-y', '--sphere-x', '--sphere-y', '--particle-x', '--particle-y']) {
      heroRef.current?.style.setProperty(property, '0px')
    }
  }

  return (
    <section
      ref={heroRef}
      className="cosmic-library cosmic-library--simple"
      aria-labelledby="cosmic-home-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
    >
      <div className="cosmic-library__scene" aria-hidden="true">
        <picture>
          <source media="(max-width: 760px)" srcSet="/images/home/mediumia-cosmic-library-hero-mobile.webp" />
          <img
            src="/images/home/mediumia-cosmic-library-hero.webp"
            alt=""
            width="1672"
            height="941"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      </div>
      <div className="cosmic-library__depth" aria-hidden="true" />
      <CosmicSphereAtmosphere />
      <div className="cosmic-library__particles" aria-hidden="true">
        {LIGHT_PARTICLES.map((particle) => (
          <span
            key={`${particle.x}-${particle.y}`}
            style={{
              '--particle-left': `${particle.x}%`,
              '--particle-top': `${particle.y}%`,
              '--particle-size': `${particle.size}px`,
              '--particle-delay': `${particle.delay}s`,
              '--particle-duration': `${particle.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="cosmic-library__content">
        <div className="cosmic-library__centerpiece">
          <div className="cosmic-library__brand cosmic-reveal cosmic-reveal--brand">
            <span className="cosmic-library__brand-aura" aria-hidden="true" />
            <img
              src="/images/brand/MEDIUMIA_logo_officiel_transparent_2026-09-12.png"
              alt="MediumIA, le monde spirituel, relié autrement"
              width="1015"
              height="696"
              fetchPriority="high"
              decoding="async"
            />
          </div>

          <div className="cosmic-library__message cosmic-reveal cosmic-reveal--message">
            <h1 id="cosmic-home-title">
              {COSMIC_HOME_CONFIG.title}
              <span>{COSMIC_HOME_CONFIG.emphasis}</span>
            </h1>
            <p>{COSMIC_HOME_CONFIG.description}</p>
          </div>

          <div className="cosmic-library__actions cosmic-reveal cosmic-reveal--actions">
            <a
              className="cosmic-library__primary"
              href="/formation"
              onClick={(event) => { event.preventDefault(); onOpenFormation() }}
            >
              {COSMIC_HOME_CONFIG.primaryAction}<span aria-hidden="true">→</span>
            </a>
            <a className="cosmic-library__secondary" href="#consulter">
              Prendre rendez-vous<span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

      </div>
    </section>
  )
}
