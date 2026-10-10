import { useState } from 'react'
import LegalFooter from './LegalFooter'

// L'Arche : maquette interactive, volontairement sans réseau et sans écriture
// dans Supabase. Ne jamais transformer ces exemples fictifs en faux membres.
const DEMO_POSTS = [
  { id: 'demo-1', author: 'Membre A', topic: 'Se présenter', body: 'J’aimerais rencontrer des personnes avec qui parler d’intuition, sans avoir peur de poser des questions.', initial: 'A' },
  { id: 'demo-2', author: 'Membre B', topic: 'Méditation', body: 'Pour moi, la méditation est surtout une manière de ralentir. Comment avez-vous commencé ?', initial: 'B' },
]

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

function Monogram({ letter = 'A', large = false }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center border border-[#B9A77E] bg-[#F3EFE6] font-georgia text-[#1A1535] ${large ? 'h-16 w-16 rounded-2xl text-3xl' : 'h-10 w-10 rounded-xl text-base'}`}>
      {letter}
    </span>
  )
}

function SpaceIllustration() {
  return (
    <svg className="h-auto w-full" viewBox="0 0 560 430" fill="none" role="img" aria-label="Illustration abstraite de personnes reliées autour d'un espace commun">
      <rect x="10" y="10" width="540" height="410" rx="30" fill="#F3EFE6" />
      <rect x="29" y="28" width="502" height="373" rx="23" stroke="#E2D7BE" />
      <circle cx="283" cy="213" r="128" stroke="#B9A77E" strokeWidth="1.5" strokeDasharray="3 7" />
      <circle cx="283" cy="213" r="85" stroke="#B9A77E" strokeWidth="1.5" />
      <path d="M124 163L283 213L437 115M283 213L425 308M283 213L144 317" stroke="#B9A77E" strokeWidth="2" />
      <path d="M250 171C269 145 300 145 321 171C346 203 334 238 283 279C232 238 220 202 250 171Z" fill="#1A1535" />
      <path d="M277 179L283 194L289 179M283 194V250M263 226L283 211L303 226" stroke="#C9A84C" strokeWidth="2" strokeLinecap="round" />
      <circle cx="124" cy="163" r="29" fill="#FFFFFF" stroke="#B9A77E" strokeWidth="2" />
      <circle cx="437" cy="115" r="29" fill="#FFFFFF" stroke="#B9A77E" strokeWidth="2" />
      <circle cx="425" cy="308" r="29" fill="#FFFFFF" stroke="#B9A77E" strokeWidth="2" />
      <circle cx="144" cy="317" r="29" fill="#FFFFFF" stroke="#B9A77E" strokeWidth="2" />
      <circle cx="124" cy="157" r="8" fill="#1A1535" /><path d="M110 177C116 166 133 166 139 177" stroke="#1A1535" strokeWidth="3" strokeLinecap="round" />
      <circle cx="437" cy="109" r="8" fill="#1A1535" /><path d="M422 128C429 117 445 117 452 128" stroke="#1A1535" strokeWidth="3" strokeLinecap="round" />
      <circle cx="425" cy="303" r="8" fill="#1A1535" /><path d="M411 323C417 312 434 312 440 323" stroke="#1A1535" strokeWidth="3" strokeLinecap="round" />
      <circle cx="144" cy="311" r="8" fill="#1A1535" /><path d="M130 331C136 320 153 320 159 331" stroke="#1A1535" strokeWidth="3" strokeLinecap="round" />
      <circle cx="283" cy="213" r="4" fill="#C9A84C" />
      <text x="282" y="373" fill="#1A1535" fontFamily="Georgia, serif" fontSize="14" letterSpacing="2.4" textAnchor="middle">SE RELIER · SANS SE RESSEMBLER</text>
    </svg>
  )
}

function DemoNotice() {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#E2D7BE] bg-[#F3EFE6] px-5 py-3 text-xs leading-relaxed text-[#1A1535]">
      <strong>Maquette interactive</strong>
      <span>·</span>
      <span>Profils et échanges fictifs ; aucune inscription, aucun message transmis ou enregistré en ligne.</span>
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

function Demonstration() {
  const [tab, setTab] = useState('salon')
  const [pseudo, setPseudo] = useState('Votre pseudonyme')
  const [interests, setInterests] = useState('Intuition, méditation et découvertes')
  const [bio, setBio] = useState('Je viens apprendre, partager et rencontrer des personnes bienveillantes.')
  const [draft, setDraft] = useState('')
  const [localPosts, setLocalPosts] = useState([])
  const [requestAccepted, setRequestAccepted] = useState(false)
  const [dmDraft, setDmDraft] = useState('')
  const [dmMessages, setDmMessages] = useState([])
  const [feedback, setFeedback] = useState('')

  const tabs = [
    { id: 'salon', text: 'Salon commun' },
    { id: 'profils', text: 'Mon profil' },
    { id: 'prive', text: 'Conversation privée' },
  ]

  function addLocalPost(event) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    setLocalPosts((current) => [...current.slice(-3), { id: 'local-' + current.length, author: pseudo.trim() || 'Vous', topic: 'Votre essai local', body: trimmed, initial: 'V' }])
    setDraft('')
    setFeedback('Message affiché seulement dans cette maquette. Il n’a pas été envoyé.')
  }

  function addDm(event) {
    event.preventDefault()
    const trimmed = dmDraft.trim()
    if (!trimmed || !requestAccepted) return
    setDmMessages((current) => [...current.slice(-3), { id: 'dm-' + current.length, text: trimmed }])
    setDmDraft('')
  }

  return (
    <section id="explorer" className="scroll-mt-24 bg-[#F3EFE6] px-5 py-20 md:px-8" aria-labelledby="arche-demo-heading">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.23em] text-[#4A3F6B]">Premiers espaces · aperçu du projet</p>
            <h2 id="arche-demo-heading" className="font-georgia text-3xl leading-tight text-[#1A1535] md:text-5xl">Imaginez votre place dans L’Arche.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#4A3F6B]">Explorez l’expérience imaginée pour les membres, avant l’ouverture officielle du réseau.</p>
          </div>
          <div className="rounded-lg border border-[#B9A77E] bg-white/65 px-4 py-3 text-xs font-semibold text-[#1A1535]">Prototype · accès réel non ouvert</div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#E2D7BE] bg-[#FFFFFF] shadow-[0_20px_50px_rgba(29,52,39,.07)]">
          <DemoNotice />
          <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Explorer la maquette de L'Arche" className="flex flex-wrap gap-2 border-b border-[#E2D7BE] bg-[#F3EFE6] p-4 md:flex-col md:border-b-0 md:border-r md:p-5">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setTab(item.id); setFeedback('') }}
                  aria-pressed={tab === item.id}
                  className={`min-h-11 rounded-lg px-4 py-3 text-left text-sm font-semibold transition-colors ${tab === item.id ? 'bg-[#1A1535] text-white' : 'bg-white text-[#1A1535] hover:bg-[#F3EFE6]'}`}
                >
                  {item.text}
                </button>
              ))}
              <p className="mt-4 hidden text-xs leading-relaxed text-[#4A3F6B] md:block">Tous les contenus sont des exemples. Aucun profil public n’est créé ici.</p>
            </nav>
            <div className="min-h-[440px] p-5 md:p-8">
              {tab === 'salon' && (
                <div>
                  <div className="mb-5">
                    <h3 className="font-georgia text-2xl text-[#1A1535]">Le salon des rencontres</h3>
                    <p className="mt-1 text-sm text-[#4A3F6B]">Un lieu où chacun peut se présenter et engager une conversation, à son rythme.</p>
                  </div>
                  <div className="space-y-3">
                    {[...DEMO_POSTS, ...localPosts].map((post) => (
                      <article key={post.id} className="flex gap-3 rounded-xl border border-[#E2D7BE] bg-[#FFFFFF] p-4">
                        <Monogram letter={post.initial} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <strong className="text-sm text-[#1A1535]">{post.author}</strong>
                            <span className="text-xs text-[#4A3F6B]">{post.topic}</span>
                          </div>
                          <p className="mt-2 break-words text-sm leading-relaxed text-[#1A1535]">{post.body}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  <form onSubmit={addLocalPost} className="mt-5">
                    <label htmlFor="arche-salon-draft" className="mb-2 block text-sm font-semibold text-[#1A1535]">Essayez d’écrire un message fictif</label>
                    <textarea id="arche-salon-draft" rows={2} maxLength={240} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Votre message apparaît uniquement ici, sur cet écran..." className="w-full rounded-lg border border-[#B9A77E] bg-white p-3 text-sm leading-relaxed text-[#1A1535] outline-none focus:border-[#1A1535]" />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-[#4A3F6B]">Ne saisissez aucune information personnelle dans cette démonstration.</span>
                      <button disabled={!draft.trim()} className="rounded-lg bg-[#1A1535] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40" type="submit">Afficher dans la démo</button>
                    </div>
                    {feedback && <p role="status" className="mt-3 text-xs text-[#1A1535]">{feedback}</p>}
                  </form>
                </div>
              )}
              {tab === 'profils' && (
                <div>
                  <h3 className="font-georgia text-2xl text-[#1A1535]">Un profil, à votre image</h3>
                  <p className="mt-1 text-sm text-[#4A3F6B]">Ici, vous choisissez ce que vous souhaitez montrer. Une photo n’est jamais obligatoire.</p>
                  <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold text-[#1A1535]">Pseudonyme
                        <input maxLength={40} value={pseudo} onChange={(e) => setPseudo(e.target.value)} className="mt-2 w-full rounded-lg border border-[#B9A77E] bg-white px-3 py-3 text-sm font-normal outline-none focus:border-[#1A1535]" />
                      </label>
                      <label className="block text-sm font-semibold text-[#1A1535]">Centres d’intérêt
                        <input maxLength={100} value={interests} onChange={(e) => setInterests(e.target.value)} className="mt-2 w-full rounded-lg border border-[#B9A77E] bg-white px-3 py-3 text-sm font-normal outline-none focus:border-[#1A1535]" />
                      </label>
                      <label className="block text-sm font-semibold text-[#1A1535]">Présentation
                        <textarea maxLength={220} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="mt-2 w-full rounded-lg border border-[#B9A77E] bg-white px-3 py-3 text-sm font-normal leading-relaxed outline-none focus:border-[#1A1535]" />
                      </label>
                      <p className="text-xs leading-relaxed text-[#4A3F6B]">Prévisualisation uniquement : rien n’est enregistré, publié ou transmis.</p>
                    </div>
                    <article aria-label="Prévisualisation du profil fictif" className="self-start rounded-xl border border-[#E2D7BE] bg-[#F3EFE6] p-5">
                      <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4A3F6B]">Aperçu de votre fiche</p>
                      <Monogram letter={(pseudo.trim().charAt(0) || 'V').toUpperCase()} large />
                      <h4 className="mt-4 break-words font-georgia text-2xl text-[#1A1535]">{pseudo.trim() || 'Votre pseudonyme'}</h4>
                      <p className="mt-1 break-words text-xs font-semibold text-[#4A3F6B]">{interests.trim() || 'Centres d’intérêt facultatifs'}</p>
                      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#4A3F6B]">{bio.trim() || 'Quelques mots sur votre parcours, si vous en avez envie.'}</p>
                    </article>
                  </div>
                </div>
              )}
              {tab === 'prive' && (
                <div>
                  <h3 className="font-georgia text-2xl text-[#1A1535]">Des conversations avec consentement</h3>
                  <p className="mt-1 text-sm text-[#4A3F6B]">Personne ne peut vous écrire directement sans que vous acceptiez sa demande de contact.</p>
                  <div className="mt-6 rounded-xl border border-[#E2D7BE] bg-[#F3EFE6] p-5">
                    <div className="flex items-center gap-3">
                      <Monogram letter="C" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#1A1535]">Membre C <span className="font-normal text-[#4A3F6B]">(profil fictif)</span></p>
                        <p className="mt-1 text-xs text-[#4A3F6B]">Souhaite échanger au sujet de la méditation</p>
                      </div>
                    </div>
                    {!requestAccepted ? (
                      <div className="mt-5 border-t border-[#E2D7BE] pt-5">
                        <p className="text-sm text-[#4A3F6B]">Une demande de discussion arrive. Vous êtes libre de l’accepter ou de ne pas y répondre.</p>
                        <button type="button" onClick={() => setRequestAccepted(true)} className="mt-4 rounded-lg bg-[#1A1535] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2B254D]">Simuler l’acceptation</button>
                      </div>
                    ) : (
                      <div className="mt-5 border-t border-[#E2D7BE] pt-5">
                        <p role="status" className="mb-4 text-xs font-semibold text-[#1A1535]">Demande acceptée dans la démonstration, sans création de vraie conversation.</p>
                        <div className="rounded-lg border border-[#E2D7BE] bg-white p-4">
                          <p className="text-sm leading-relaxed text-[#4A3F6B]"><strong>Membre C :</strong> « Bonjour, j’aimerais échanger sur nos façons de méditer, si vous en avez envie. »</p>
                          {dmMessages.map((message) => <p key={message.id} className="mt-3 break-words border-l-2 border-[#B9A77E] pl-3 text-sm leading-relaxed text-[#1A1535]"><strong>Vous (local) :</strong> {message.text}</p>)}
                        </div>
                        <form onSubmit={addDm} className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <label htmlFor="arche-dm-draft" className="sr-only">Écrire une réponse de démonstration</label>
                          <input id="arche-dm-draft" maxLength={240} value={dmDraft} onChange={(e) => setDmDraft(e.target.value)} placeholder="Réponse de démonstration..." className="min-h-11 flex-1 rounded-lg border border-[#B9A77E] bg-white px-3 py-3 text-sm outline-none focus:border-[#1A1535]" />
                          <button disabled={!dmDraft.trim()} type="submit" className="rounded-lg bg-[#1A1535] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">Afficher localement</button>
                        </form>
                        <button type="button" className="mt-4 text-xs font-semibold text-[#4A3F6B] underline underline-offset-4" onClick={() => { setRequestAccepted(false); setDmMessages([]); setDmDraft('') }}>Réinitialiser l’exemple de conversation</button>
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-[#4A3F6B]">En version réelle : bouton de blocage, signalement, limitation des sollicitations et outils de modération dès le lancement.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function ArchePage({ onBack, onNavigate }) {
  return (
    <div data-arche-prototype="v1" className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
      <header className="border-b border-[#E2D7BE] bg-[#FAFAF7]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <a href="/arche" className="flex items-center gap-3 text-[#1A1535]">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-10 w-10 object-contain" />
            <span className="font-georgia text-xl font-semibold tracking-[0.075em]">L’ARCHE</span>
          </a>
          <nav aria-label="Navigation de L'Arche" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs font-semibold md:text-sm">
            <a href="#vision" className="hover:underline">La vision</a>
            <a href="#compte" className="hover:underline">Le compte</a>
            <a href="#explorer" className="hover:underline">Explorer</a>
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
              <a href="#explorer" className="inline-flex min-h-12 items-center justify-center bg-[#1A1535] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#2B254D]">Explorer la maquette →</a>
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

        <Demonstration />

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
