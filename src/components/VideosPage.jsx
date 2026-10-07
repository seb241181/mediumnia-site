import SiteNav from './SiteNav'
import LegalFooter from './LegalFooter'
import VideoInterview from './VideoInterview'

export default function VideosPage({ onBack, onNavigate }) {
  return (
    <div className="min-h-screen bg-cream text-deep">
      <SiteNav current="videos" onHome={onBack} />

      <main className="pt-24 md:pt-28">
        <section className="mx-auto max-w-5xl px-6 pb-12 pt-12 text-center md:pt-16">
          <p className="font-georgia text-[11px] uppercase tracking-[0.24em] text-gold">Vidéos MediumIA</p>
          <h1 className="mx-auto mt-3 max-w-4xl font-georgia text-4xl font-medium leading-tight text-deep md:text-6xl">
            Je réponds à vos questions sur la médiumnité
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-georgia text-base leading-relaxed text-mist md:text-lg">
            Je rassemble ici mes réponses aux questions qui reviennent le plus souvent : ressentis, intuition,
            contact avec les défunts, développement de la médiumnité et compréhension d’une guidance.
          </p>
        </section>

        <section data-videos-hub="v1" className="mx-auto max-w-5xl px-6 pb-4">
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-3xl border border-gold/25 bg-white/75 p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">1 · Vos questions</p>
              <h2 className="mt-2 font-georgia text-xl font-medium text-deep">Vous me dites ce que vous voulez comprendre</h2>
              <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">
                Les sujets partent de vos vraies interrogations, notamment celles laissées sous mes publications.
              </p>
            </article>
            <article className="rounded-3xl border border-gold/25 bg-white/75 p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">2 · Je prends le temps</p>
              <h2 className="mt-2 font-georgia text-xl font-medium text-deep">Je lis ce qui revient vraiment</h2>
              <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">
                Je laisse les réponses arriver avant de préparer une vidéo utile, plutôt qu’une réponse faite à la va-vite.
              </p>
            </article>
            <article className="rounded-3xl border border-gold/25 bg-white/75 p-6">
              <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">3 · Mes réponses</p>
              <h2 className="mt-2 font-georgia text-xl font-medium text-deep">Les vidéos restent disponibles ici</h2>
              <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">
                Même si vous découvrez une publication plus tard, vous pourrez retrouver ici ma réponse complète.
              </p>
            </article>
          </div>
        </section>

        <section id="reponses" className="mx-auto max-w-5xl scroll-mt-28 px-6 py-12" aria-labelledby="videos-reponses-title">
          <div className="rounded-3xl border border-gold/30 bg-deep p-7 text-cream shadow-[0_18px_45px_rgba(26,21,53,.12)] md:p-10">
            <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Mes réponses</p>
            <h2 id="videos-reponses-title" className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-4xl">
              La première vidéo est en préparation
            </h2>
            <p className="mt-4 max-w-2xl font-georgia text-base leading-relaxed text-cream/70">
              Je commence par recueillir vos questions sur la médiumnité. Dès que mon premier retour est prêt,
              il apparaîtra ici, puis les suivants viendront enrichir cette rubrique.
            </p>
          </div>
        </section>

        <section className="border-t border-gold/15">
          <VideoInterview id="videos-interview" compact />
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
