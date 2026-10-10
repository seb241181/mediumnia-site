import { useState } from 'react'
import LegalFooter from './LegalFooter'
import { ArcheLoginPreview, ArcheAppPreview } from './ArcheSocialPrototype'

// L'Arche : maquette interactive, volontairement sans réseau et sans écriture
// dans Supabase. Ne jamais transformer ces exemples fictifs en faux membres.
const SPACES = [
  { title: 'Un profil qui vous ressemble', number: '01', detail: 'Un pseudonyme, une photo facultative, quelques mots sur vos centres d’intérêt et vos pratiques. Vous décidez de ce que vous partagez.' },
  { title: 'Un salon pour se retrouver', number: '02', detail: 'Poser une question, raconter une expérience ou simplement écouter. La bienveillance compte plus que les certitudes.' },
  { title: 'Des échanges à deux', number: '03', detail: 'Une conversation privée ne commence qu’après acceptation d’une demande. Chacun garde le droit de bloquer ou de signaler.' },
]

const PRINCIPLES = [
  { heading: 'Accueillir sans hiérarchie', copy: 'Personne n’a de niveau d’éveil à prouver. Croire, ne pas croire, chercher ou douter : chacun a sa place.' },
  { heading: 'Protéger la liberté', copy: 'Aucun démarchage en privé, aucune pression pour consulter, aucune prédiction destinée à effrayer ou rendre dépendant.' },
  { heading: 'Prendre soin des échanges', copy: 'Des règles explicites, des signalements et une modération humaine avant d’ouvrir les inscriptions.' },
]

function SpaceIllustration() {
  return (
    <div className="flex min-h-[340px] flex-col justify-center gap-4 rounded-2xl bg-[#FAFAF7] p-7">
      <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#9B640B]">Votre place dans L’Arche</p>
      <h2 className="max-w-sm font-georgia text-3xl leading-tight text-[#1A1535]">Un endroit pour les questions. Et pour les rencontres.</h2>
      <div className="mt-3 grid gap-3">
        <div className="rounded-lg border border-[#E2D7BE] bg-white p-4"><strong className="font-georgia text-lg text-[#1A1535]">Le Fil</strong><p className="mt-1 text-xs text-[#4A3F6B]">Partager à son rythme</p></div>
        <div className="rounded-lg border border-[#E2D7BE] bg-white p-4"><strong className="font-georgia text-lg text-[#1A1535]">Le Grand Salon</strong><p className="mt-1 text-xs text-[#4A3F6B]">Échanger simplement, en direct</p></div>
        <div className="rounded-lg border border-[#E2D7BE] bg-white p-4"><strong className="font-georgia text-lg text-[#1A1535]">Les Cercles</strong><p className="mt-1 text-xs text-[#4A3F6B]">Explorer des intérêts communs</p></div>
      </div>
    </div>
  )
}

function AccountPreview() {
  const [choice, setChoice] = useState('existing')
  return (
    <section id="compte" className="scroll-mt-24 border-y border-[#E2D7BE] bg-[#F3EFE6] px-5 py-16 md:px-8" aria-labelledby="arche-account-title">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9B640B]">L'accès à la communauté</p>
          <h2 id="arche-account-title" className="mt-3 font-georgia text-3xl leading-tight text-[#1A1535] md:text-5xl">Un seul compte MediumIA.<br/>Une place à vous.</h2>
          <p className="mt-5 text-sm leading-[1.85] text-[#4A3F6B]">Vous utiliserez votre compte MediumIA habituel ou en créerez un gratuitement. Aucun achat ni aucune formation ne sera nécessaire pour participer à L'Arche.</p>
          <p className="mt-3 text-sm leading-[1.85] text-[#4A3F6B]">Votre profil sur L'Arche sera séparé des données de votre compte MediumIA. Vous déciderez de votre pseudonyme, de ce que vous partagez et du moment de rejoindre le réseau.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#E2D7BE] bg-white">
          <div className="border-b border-[#E2D7BE] bg-[#FAFAF7] px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#9B640B]">Parcours prévu · démonstration</p>
            <h3 className="mt-1 font-georgia text-xl text-[#1A1535]">Comment rejoindre L'Arche</h3>
          </div>
          <div className="p-6">
            <div role="group" aria-label="Exemple de parcours MediumIA" className="grid gap-2 sm:grid-cols-2">
              <button type="button" aria-pressed={choice === 'existing'} onClick={() => setChoice('existing')} className={choice === 'existing' ? 'min-h-11 rounded-lg bg-[#1A1535] px-3 py-3 text-xs font-semibold text-white' : 'min-h-11 rounded-lg border border-[#E2D7BE] bg-white px-3 py-3 text-xs font-semibold text-[#1A1535]'}>J'ai déjà un compte</button>
              <button type="button" aria-pressed={choice === 'new'} onClick={() => setChoice('new')} className={choice === 'new' ? 'min-h-11 rounded-lg bg-[#1A1535] px-3 py-3 text-xs font-semibold text-white' : 'min-h-11 rounded-lg border border-[#E2D7BE] bg-white px-3 py-3 text-xs font-semibold text-[#1A1535]'}>Je découvre MediumIA</button>
            </div>
            <div className="mt-5 space-y-4" role="status">
              {[
                choice === 'existing' ? 'Je me connecte à mon compte MediumIA.' : 'Je crée mon compte MediumIA gratuit et confirme mon e-mail.',
                "J'accepte librement la charte de L'Arche.",
                'Je choisis mon pseudonyme et les informations de mon profil avant de participer.',
              ].map((line, index) => (
                <div key={index} className="flex gap-3 text-sm leading-relaxed text-[#4A3F6B]">
                  <span className="font-georgia text-xl text-[#9B640B]">0{index + 1}</span><span>{line}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-[#E2D7BE] pt-4 text-xs leading-relaxed text-[#4A3F6B]">Le parcours est illustré uniquement : cette maquette ne demande pas vos identifiants et ne crée aucun compte réel.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function ArchePage({ onBack, onNavigate }) {
  const [appNickname, setAppNickname] = useState(null)
  const [screen, setScreen] = useState('landing')
  if (screen === 'login') return <ArcheLoginPreview onBack={() => setScreen('landing')} onEnter={(nickname) => { setAppNickname(nickname); setScreen('app') }} />
  if (screen === 'app') return <ArcheAppPreview nickname={appNickname} onExit={() => setScreen('landing')} />
  return (
    <div data-arche-prototype="v2" className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
      <header className="border-b border-[#E2D7BE] bg-[#FAFAF7]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <a href="/arche" className="flex items-center gap-3 text-[#1A1535]">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-10 w-10 object-contain" />
            <span className="font-georgia text-xl font-semibold tracking-[0.075em]">L’ARCHE</span>
          </a>
          <nav aria-label="Navigation de L'Arche" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs font-semibold md:text-sm">
            <a href="#vision" className="hover:underline">La vision</a>
            <a href="#compte" className="hover:underline">Le compte</a>
            <button type="button" onClick={() => setScreen('login')} className="hover:underline">Se connecter</button>
            <a href="#charte" className="hover:underline">Nos engagements</a>
            <a href="/" onClick={(event) => { if (!event.metaKey && !event.ctrlKey && onBack) { event.preventDefault(); onBack() } }} className="border border-[#B9A77E] bg-white px-4 py-3 transition-colors hover:bg-[#F3EFE6]">MediumIA ↗</a>
          </nav>
        </div>
      </header>

      <main>
        <section id="vision" className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 pt-14 md:grid-cols-[1.06fr_.94fr] md:px-8 md:pb-24 md:pt-24">
          <div>
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.22em] text-[#4A3F6B]">Le réseau social spirituel · gratuit · en création</p>
            <h1 className="max-w-[690px] font-georgia text-[clamp(2.7rem,5.5vw,5.6rem)] font-normal leading-[1.08] tracking-[-0.035em] text-[#1A1535]">
              Différents dans nos chemins.<br /><span className="italic text-[#9B640B]">Reliés dans nos vies.</span>
            </h1>
            <p className="mt-7 max-w-xl font-georgia text-lg leading-relaxed text-[#1A1535] md:text-xl">Pour celles et ceux qui ont parfois l’impression de ne pouvoir parler à personne de leurs ressentis, de leurs questions ou de leur spiritualité.</p>
            <p className="mt-4 max-w-xl text-sm leading-[1.85] text-[#4A3F6B]">L’Arche est imaginée comme un lieu où l’on peut se présenter, rencontrer d’autres personnes, partager librement et apprendre les uns des autres. Sans devoir convaincre. Sans se faire juger. Sans rien acheter pour appartenir à la communauté.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setScreen('login')} className="inline-flex min-h-12 items-center justify-center bg-[#1A1535] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#2B254D]">Se connecter à L’Arche →</button>
              <a href="#charte" className="inline-flex min-h-12 items-center justify-center border border-[#B9A77E] px-6 py-3 font-semibold text-[#1A1535] transition-colors hover:bg-[#F3EFE6]">Notre engagement</a>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-[#4A3F6B]">Une initiative de Sébastien Seguin, créateur de MediumIA. Pas encore ouverte aux inscriptions.</p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-[#E2D7BE] bg-[#F3EFE6] p-3 shadow-[0_22px_55px_rgba(41,69,52,.07)]">
            <SpaceIllustration />
          </div>
        </section>

        <section className="border-y border-[#E2D7BE] bg-[#F3EFE6] px-5 py-20 md:px-8">
          <div className="mx-auto max-w-6xl">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.23em] text-[#4A3F6B]">Simplement pouvoir se parler</p>
            <h2 className="max-w-2xl font-georgia text-3xl leading-tight text-[#1A1535] md:text-5xl">Ni plateforme de voyance.<br />Ni concours de spiritualité.</h2>
            <p className="mt-5 max-w-2xl text-base leading-[1.8] text-[#4A3F6B]">Un espace de rencontre gratuit, où la liberté de chercher et le respect des autres passent avant les réponses toutes faites.</p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {SPACES.map((space) => (
                <article key={space.number} className="border border-[#E2D7BE] bg-[#FFFFFF] p-7">
                  <p className="font-georgia text-2xl text-[#9B640B]">{space.number}</p>
                  <h3 className="mt-5 font-georgia text-xl text-[#1A1535]">{space.title}</h3>
                  <p className="mt-3 text-sm leading-[1.8] text-[#4A3F6B]">{space.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <AccountPreview />

        <section id="connexion" className="border-y border-[#E2D7BE] bg-[#FAFAF7] px-5 py-16 md:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#9B640B]">Découvrez l’application</p><h2 className="mt-2 font-georgia text-3xl text-[#1A1535]">Après la découverte, votre espace communautaire.</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-[#4A3F6B]">Accédez à une page de connexion de démonstration, puis explorez le Fil, le Grand Salon, les Cercles et les conversations privées fictives.</p></div>
            <button type="button" onClick={() => setScreen('login')} className="min-h-12 shrink-0 bg-[#1A1535] px-6 py-3 text-sm font-semibold text-white hover:bg-[#2B254D]">Essayer l’application →</button>
          </div>
        </section>

        <section id="charte" className="scroll-mt-24 px-5 py-20 md:px-8">
          <div className="mx-auto max-w-6xl">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.23em] text-[#4A3F6B]">Notre charte fondatrice</p>
            <h2 className="max-w-3xl font-georgia text-3xl leading-tight text-[#1A1535] md:text-5xl">On n’a rien à prouver pour mériter d’être écouté.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-[1.9] text-[#4A3F6B]">L’Arche accueillera les personnes qui croient, celles qui doutent et celles qui explorent. Les échanges devront rester respectueux ; aucune expérience personnelle ne donne le droit d’imposer sa vérité à quelqu’un d’autre.</p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <article key={p.heading} className="border-t-2 border-[#4A3F6B] pt-5">
                  <h3 className="font-georgia text-xl text-[#1A1535]">{p.heading}</h3>
                  <p className="mt-3 text-sm leading-[1.85] text-[#4A3F6B]">{p.copy}</p>
                </article>
              ))}
            </div>
            <div className="mt-12 border-l-4 border-[#4A3F6B] bg-[#F3EFE6] px-6 py-6">
              <p className="font-georgia text-lg italic leading-relaxed text-[#1A1535]">« Je souhaite rendre confiance à celui qui n’y croit plus, alors qu’il est juste différent. »</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#4A3F6B]">L’intention de Sébastien Seguin</p>
            </div>
          </div>
        </section>

        <section className="bg-[#1A1535] px-5 py-16 text-[#FAFAF7] md:px-8">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-semibold uppercase tracking-[0.23em] text-[#C9A84C]">Bientôt, après les tests et la modération</p>
            <h2 className="mt-4 max-w-3xl font-georgia text-3xl leading-tight md:text-5xl">Des liens humains. Un espace libre. Une communauté qui se construit avec soin.</h2>
            <p className="mt-5 max-w-2xl text-sm leading-[1.85] text-[#E2D7BE]">Cette page est une première maquette interactive. Avant d’ouvrir le réseau, nous devons sécuriser l’inscription, les profils, les conversations, la modération et la confidentialité. Aucune inscription n’est proposée à ce stade.</p>
            <a href="https://mediumia.fr" className="mt-7 inline-flex min-h-11 items-center border border-[#E2D7BE] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">Découvrir MediumIA ↗</a>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
