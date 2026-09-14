import { useEffect } from 'react'
import LegalFooter from './LegalFooter'
import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'

function Step({ number, title, children }) {
  return (
    <div className="rounded-2xl border border-gold/20 bg-white/65 p-5">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-gold/35 bg-gold/10 font-georgia text-sm font-semibold text-gold">{number}</div>
      <h3 className="font-georgia text-lg font-medium text-deep">{title}</h3>
      <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">{children}</p>
    </div>
  )
}

function FeatureCard({ eyebrow, title, children }) {
  return (
    <article className="rounded-3xl border border-gold/20 bg-white/70 p-6 shadow-[0_10px_28px_rgba(26,21,53,.04)] md:p-7">
      <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">{eyebrow}</p>
      <h3 className="mt-3 font-georgia text-xl font-medium leading-tight text-deep">{title}</h3>
      <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">{children}</p>
    </article>
  )
}

export default function ConferencesPage({ onBack, onNavigate }) {
  useEffect(() => { trackMediumiaMetric('conference_page_view', 'conferences') }, [])

  const viewRegistration = () => {
    trackMediumiaMetric('conference_interest_click', 'conferences:registration')
    document.getElementById('inscription')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="cosmic-page cosmic-page--conferences min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-40 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 md:px-6">
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← MediumIA</button>
          <div className="flex items-center gap-2.5">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-8 w-auto" />
            <span className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">CONFÉRENCES</span>
          </div>
          <button onClick={viewRegistration} className="rounded-lg border border-gold/45 px-3 py-2 font-georgia text-xs font-semibold text-deep transition-colors hover:bg-gold/10">Première conférence</button>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden bg-deep px-6 py-20 text-cream md:py-28">
          <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full border border-gold/10" />
          <div className="pointer-events-none absolute left-[12%] top-[18%] h-2 w-2 rounded-full bg-gold/70 shadow-[0_0_30px_rgba(201,168,76,.8)]" />
          <div className="pointer-events-none absolute right-[18%] top-[34%] h-2 w-2 rounded-full bg-gold/80 shadow-[0_0_30px_rgba(201,168,76,.9)]" />
          <div className="relative mx-auto max-w-5xl text-center">
            <p className="font-georgia text-[11px] uppercase tracking-[0.28em] text-gold">MEDIUMIA · EN DIRECT · CONFÉRENCE OFFERTE</p>
            <h1 className="mx-auto mt-5 max-w-4xl font-georgia text-4xl font-medium leading-tight md:text-6xl">La médiumnité se comprend mieux lorsqu’on commence à l’expérimenter.</h1>
            <p className="mx-auto mt-6 max-w-2xl font-georgia text-base leading-relaxed text-cream/70 md:text-lg">
              Une rencontre gratuite avec Sébastien Seguin pour découvrir l’approche MediumIA, expérimenter les premières bases de la pratique et poser vos questions en direct.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button onClick={viewRegistration} className="rounded-lg bg-gold px-7 py-4 font-georgia text-sm font-bold text-deep transition-opacity hover:opacity-90">Découvrir la première conférence</button>
              <a href="#experience" className="rounded-lg border border-gold/45 px-7 py-4 font-georgia text-sm font-bold text-gold transition-colors hover:bg-gold/10">Voir l’expérience</a>
            </div>
          </div>
        </section>

        <section id="inscription" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="overflow-hidden rounded-3xl border border-gold/30 bg-white/80 shadow-[0_18px_48px_rgba(26,21,53,.07)]">
            <div className="grid md:grid-cols-[1.45fr_.75fr]">
              <div className="p-7 md:p-10">
                <span className="inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Première conférence publique MediumIA</span>
                <h2 className="mt-5 max-w-2xl font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Une soirée pour ouvrir la première porte.</h2>
                <p className="mt-4 max-w-2xl font-georgia leading-relaxed text-mist">
                  Le thème, la date et l’horaire définitifs seront publiés ici très prochainement. L’accès sera gratuit sur inscription et chaque participant recevra avant le direct un carnet de préparation MediumIA.
                </p>
                <div className="mt-6 grid gap-3 text-sm text-mist sm:grid-cols-2">
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">Accès gratuit</strong><span className="font-georgia">Sur inscription personnelle.</span></div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">En direct sur Zoom</strong><span className="font-georgia">Lien envoyé aux inscrits.</span></div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">PDF offert</strong><span className="font-georgia">Introduction + Module 1 + 3 exercices.</span></div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">Questions en direct</strong><span className="font-georgia">Via l’espace live MediumIA.</span></div>
                </div>
              </div>
              <div className="flex flex-col justify-center bg-deep p-7 text-cream md:p-8">
                <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">INSCRIPTIONS</p>
                <p className="mt-3 font-georgia text-2xl font-medium">Ouverture prochaine</p>
                <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/60">Nous branchons actuellement l’inscription, l’envoi du carnet, Zoom et l’espace de questions MediumIA.</p>
                <div className="mt-6 rounded-2xl border border-gold/25 bg-white/5 p-4 font-georgia text-xs leading-relaxed text-cream/70">
                  Aucun paiement ne sera demandé pour participer à cette première conférence.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="experience" className="border-y border-gold/15 bg-white/35 px-6 py-16 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">AVANT · PENDANT · APRÈS</p>
              <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Une conférence pensée comme une expérience complète.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Step number="1" title="Vous vous inscrivez">Prénom et e-mail suffisent. Votre place est liée à votre adresse afin de personnaliser la suite du parcours.</Step>
              <Step number="2" title="Vous vous préparez">Vous recevez le carnet MediumIA : introduction, Module 1 « L’Intention comme Porte » et trois exercices pratiques.</Step>
              <Step number="3" title="Vous vivez le direct">Vous rejoignez la conférence sur Zoom et pouvez envoyer vos questions depuis un espace MediumIA dédié.</Step>
              <Step number="4" title="Vous choisissez la suite">À l’issue de la rencontre, les participants pourront recevoir un Pass personnel et temporaire pour poursuivre avec la formation complète.</Step>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mb-10 max-w-3xl">
            <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">LE CARNET DE PRÉPARATION</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Vous ne viendrez pas à la conférence les mains vides.</h2>
            <p className="mt-4 font-georgia leading-relaxed text-mist">Chaque inscrit recevra avant la rencontre une première porte du parcours MediumIA afin d’arriver avec ses propres ressentis, observations et questions.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <FeatureCard eyebrow="Exercice 1" title="L’intention quotidienne">Une pratique courte sur plusieurs jours pour observer ce qui change lorsque vous orientez consciemment votre disponibilité intérieure.</FeatureCard>
            <FeatureCard eyebrow="Exercice 2" title="Votre intention personnelle">Vous construisez votre propre formulation d’ouverture avec direction, qualité recherchée et cadre de sécurité.</FeatureCard>
            <FeatureCard eyebrow="Exercice 3" title="Souhait, prière ou intention ?">Une expérience d’observation pour ressentir la différence entre vouloir, demander et décider intérieurement.</FeatureCard>
          </div>
        </section>

        <section className="bg-deep px-6 py-16 text-cream md:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[.9fr_1.1fr] md:items-center">
            <div>
              <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">QUESTIONS EN DIRECT</p>
              <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Vos questions ne se perdront pas dans un chat qui défile.</h2>
              <p className="mt-4 font-georgia leading-relaxed text-cream/65">Pendant la conférence, un espace MediumIA recueillera les questions du public. Le système pourra regrouper les sujets proches afin de faire émerger les thèmes les plus demandés.</p>
            </div>
            <div className="rounded-3xl border border-gold/25 bg-white/5 p-6 md:p-8">
              <p className="font-georgia text-xs uppercase tracking-[0.18em] text-gold">Exemple cockpit conférence</p>
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="font-georgia text-sm font-semibold">Thème majeur · Intuition ou mental ?</p><p className="mt-1 font-georgia text-xs text-cream/55">Plusieurs questions proches peuvent être regroupées.</p></div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="font-georgia text-sm font-semibold">Question à faire remonter</p><p className="mt-1 font-georgia text-xs text-cream/55">Une formulation claire peut être proposée à Sébastien pendant le direct.</p></div>
                <div className="rounded-2xl border border-gold/25 bg-gold/10 p-4"><p className="font-georgia text-sm font-semibold text-gold">Copilote MediumIA</p><p className="mt-1 font-georgia text-xs text-cream/65">Aide au tri uniquement : la réponse reste humaine, en direct.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="rounded-3xl border border-gold/25 bg-white/75 px-7 py-10 text-center shadow-[0_16px_42px_rgba(26,21,53,.05)] md:px-12 md:py-12">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">APRÈS LA CONFÉRENCE</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium">Un Pass MediumIA personnel, jamais un code public.</h2>
            <p className="mx-auto mt-4 max-w-2xl font-georgia text-sm leading-relaxed text-mist">Si une offre spéciale est ouverte aux participants, chaque Pass sera généré individuellement, lié à l’e-mail d’inscription, utilisable une seule fois et limité dans le temps.</p>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-5xl rounded-3xl border border-gold/25 bg-deep px-7 py-10 text-center text-cream md:px-12 md:py-12">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">MEDIUMIA CONFÉRENCES</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium">La première porte est en train de s’ouvrir.</h2>
            <p className="mx-auto mt-4 max-w-2xl font-georgia text-sm leading-relaxed text-cream/65">Prochaine étape technique : activer l’inscription réelle, l’envoi automatique du carnet, le lien Zoom et l’espace live des questions.</p>
            <button onClick={viewRegistration} className="mt-7 rounded-lg bg-gold px-7 py-3.5 font-georgia text-sm font-bold text-deep">Voir la première conférence</button>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
