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

function ThemeCard({ eyebrow, title, children }) {
  return (
    <article className="rounded-3xl border border-gold/20 bg-white/65 p-6 shadow-[0_10px_28px_rgba(26,21,53,.04)] md:p-7">
      <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">{eyebrow}</p>
      <h3 className="mt-3 font-georgia text-xl font-medium leading-tight text-deep">{title}</h3>
      <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">{children}</p>
    </article>
  )
}

export default function ConferencesPage({ onBack, onNavigate }) {
  useEffect(() => { trackMediumiaMetric('conference_page_view', 'conferences') }, [])

  const registerInterest = () => {
    trackMediumiaMetric('conference_interest_click', 'conferences:notify')
    document.getElementById('programmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-40 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 md:px-6">
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← MediumIA</button>
          <div className="flex items-center gap-2.5">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-8 w-auto" />
            <span className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">CONFÉRENCES</span>
          </div>
          <button onClick={registerInterest} className="rounded-lg border border-gold/45 px-3 py-2 font-georgia text-xs font-semibold text-deep transition-colors hover:bg-gold/10">Être prévenu</button>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden bg-deep px-6 py-20 text-cream md:py-28">
          <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full border border-gold/10" />
          <div className="pointer-events-none absolute right-[18%] top-[22%] h-2 w-2 rounded-full bg-gold/80 shadow-[0_0_30px_rgba(201,168,76,.9)]" />
          <div className="relative mx-auto max-w-5xl text-center">
            <p className="font-georgia text-[11px] uppercase tracking-[0.28em] text-gold">MEDIUMIA · EN DIRECT</p>
            <h1 className="mx-auto mt-5 max-w-4xl font-georgia text-4xl font-medium leading-tight md:text-6xl">Des rencontres pour comprendre, ressentir et aller plus loin.</h1>
            <p className="mx-auto mt-6 max-w-2xl font-georgia text-base leading-relaxed text-cream/70 md:text-lg">
              Les conférences MediumIA réuniront transmission, échanges en direct et questions du public dans un même espace, accessible simplement depuis MediumIA.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button onClick={registerInterest} className="rounded-lg bg-gold px-7 py-4 font-georgia text-sm font-bold text-deep transition-opacity hover:opacity-90">Voir la prochaine programmation</button>
              <a href="#fonctionnement" className="rounded-lg border border-gold/45 px-7 py-4 font-georgia text-sm font-bold text-gold transition-colors hover:bg-gold/10">Comment ça fonctionnera</a>
            </div>
          </div>
        </section>

        <section id="programmation" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="rounded-3xl border border-gold/30 bg-white/75 p-7 shadow-[0_16px_42px_rgba(26,21,53,.06)] md:p-10">
            <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
              <div className="max-w-3xl">
                <span className="inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Programmation en préparation</span>
                <h2 className="mt-5 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">La prochaine conférence sera annoncée ici.</h2>
                <p className="mt-4 font-georgia leading-relaxed text-mist">
                  Nous préparons la première programmation en ligne. Dès qu’une date sera ouverte, cette page affichera le thème, l’horaire, le tarif, le nombre de places et la réservation.
                </p>
              </div>
              <div className="shrink-0 rounded-2xl border border-gold/20 bg-deep px-6 py-5 text-center text-cream md:w-60">
                <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Bientôt</p>
                <p className="mt-2 font-georgia text-xl font-medium">Réservation MediumIA</p>
                <p className="mt-2 font-georgia text-xs leading-relaxed text-cream/55">Paiement, confirmation et lien de direct réunis au même endroit.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="fonctionnement" className="border-y border-gold/15 bg-white/35 px-6 py-16 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">LE JOUR J</p>
              <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Une expérience simple de la réservation au direct.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Step number="1" title="Choisir">Consultez le thème, la date et toutes les informations avant de réserver.</Step>
              <Step number="2" title="Réserver">Votre place sera réservée directement depuis MediumIA, sans parcours compliqué.</Step>
              <Step number="3" title="Recevoir">Après confirmation, vous recevrez automatiquement les informations d’accès au direct.</Step>
              <Step number="4" title="Participer">Pendant la rencontre, posez vos questions et profitez du temps d’échange en direct.</Step>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mb-10 max-w-3xl">
            <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">LES RENCONTRES MEDIUMIA</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Des formats pensés pour aller plus loin qu’une simple vidéo.</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <ThemeCard eyebrow="Transmission" title="Comprendre un thème en profondeur">Médiumnité, conscience, perceptions, pratique et discernement : un sujet développé avec une vraie progression.</ThemeCard>
            <ThemeCard eyebrow="Échange" title="Poser les questions qui comptent">Une place importante sera gardée pour les questions du public afin que la conférence reste vivante et concrète.</ThemeCard>
            <ThemeCard eyebrow="Continuité" title="Relier la conférence à votre parcours">Selon le thème, MediumIA pourra ensuite vous orienter vers un contenu, un praticien ou un accompagnement pertinent, sans parcours imposé.</ThemeCard>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-5xl rounded-3xl border border-gold/25 bg-deep px-7 py-10 text-center text-cream md:px-12 md:py-12">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">MEDIUMIA CONFÉRENCES</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium">La programmation arrive.</h2>
            <p className="mx-auto mt-4 max-w-2xl font-georgia text-sm leading-relaxed text-cream/65">Cette première version pose l’espace public. La réservation, le paiement et l’envoi automatique du lien de direct viendront s’y brancher ensuite.</p>
            <button onClick={onBack} className="mt-7 rounded-lg bg-gold px-7 py-3.5 font-georgia text-sm font-bold text-deep">Retour à l’univers MediumIA</button>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
