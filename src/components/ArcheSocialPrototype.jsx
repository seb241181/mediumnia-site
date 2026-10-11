import { createContext, useContext, useEffect, useRef, useState } from 'react'
import './ArcheSocialPrototype.css'
import ArcheBrand from './ArcheLogoPreview'

// Prototype privé : toutes les données ci-dessous sont fictives et locales.
const IdentityContext = createContext(null)
const AVATAR_MODELS = [{ id: 'lunettes', label: 'Illustré à lunettes' }, { id: 'portrait', label: 'Portrait illustré' }, { id: 'etoile', label: 'Emoji étoile' }, { id: 'lune', label: 'Emoji lune' }, { id: 'sourire', label: 'Emoji sourire' }]
const BUBBLE_COLORS = { ciel: 'Ciel', rose: 'Rose', lavande: 'Lavande', menthe: 'Menthe', peche: 'Pêche', nuit: 'Nuit' }
const PEOPLE = [
  { id: 'aurore', name: 'Aurore', status: 'online', note: 'Disponible ce soir' },
  { id: 'nuage', name: 'Nuage Bleu', status: 'online', note: 'Je relis mes rêves' },
  { id: 'plume', name: 'Plume d’Or', status: 'away', note: 'Revient plus tard' },
  { id: 'chemin', name: 'Chemin Libre', status: 'busy', note: 'Je préfère lire' },
]
const CIRCLES = [
  { id: 'decouverte', title: 'Les Découvertes', icon: 'chat', tint: 'ciel', invitation: 'Un premier pas, ensemble', description: 'Questions simples, premiers pas et accueil.' },
  { id: 'intuition', title: 'Intuition', icon: 'user', tint: 'menthe', invitation: 'Écouter ce qui résonne', description: 'Ressentis, impressions et discernement.' },
  { id: 'reves', title: 'Rêves', icon: 'bell', tint: 'lavande', invitation: 'Les histoires de nos nuits', description: 'Symboles, nuits marquantes et récits.' },
  { id: 'questions', title: 'Grandes Questions', icon: 'circles', tint: 'rose', invitation: 'Faire une place au doute', description: 'Croire, douter, nuancer et dialoguer.' },
]
const POST_THEMES = {
  clear: { label: 'Clair', style: { background: '#FFFFFF', color: '#1A1535', borderColor: '#ECEAF2' }, accent: '#ECEAF2' },
  doux: { label: 'Doux', style: { background: 'linear-gradient(135deg, #FFFFFF 0%, #FBE1EC 100%)', color: '#1A1535', borderColor: '#EAC8DA' }, accent: '#C9A84C' },
  nuit: { label: 'Nuit', style: { background: 'radial-gradient(circle at top right, rgba(201,168,76,.34), transparent 32%), #1A1535', color: '#FFFFFF', borderColor: '#1A1535' }, accent: '#C9A84C' },
  brume: { label: 'Brume', style: { background: 'linear-gradient(135deg, #FFFFFF 0%, #E4ECFC 100%)', color: '#1A1535', borderColor: '#DDD7EA' }, accent: '#4A3F6B' },
}
const AVATAR_PALETTE = ['#EEEAF6', '#FFF1CC', '#E7EEF8', '#F8E9EB', '#EAF3E8', '#F3E7D9', '#E9F4F5', '#F2EAF1']
const REACTIONS = [
  { id: 'merci', label: 'Merci', icon: '✦' },
  { id: 'compris', label: 'Je te comprends', icon: '⌒⌒' },
  { id: 'aussi', label: 'Moi aussi', icon: '⟡' },
]
const MENU = [
  { id: 'feed', label: 'Fil', icon: 'home' },
  { id: 'salon', label: 'Salon', icon: 'chat' },
  { id: 'cercles', label: 'Cercles', icon: 'circles' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
  { id: 'profile', label: 'Moi', icon: 'user' },
]
const INITIAL_POSTS = [
  { id: 'p1', author: 'Plume d’Or', circle: 'Les Découvertes', time: 'il y a 12 min', text: 'Avez-vous déjà senti que votre intuition disait oui alors que votre tête disait non ?', theme: 'brume', format: 'question', repliesOpen: true },
  { id: 'p2', author: 'Aurore', circle: 'Grand Salon', time: 'il y a 28 min', text: 'Petite présence ce soir. Je lis vos partages tranquillement.', theme: 'doux', format: 'normal' },
  { id: 'p3', author: 'Nuage Bleu', circle: 'Rêves', time: 'il y a 1 h', text: 'J’ai noté trois rêves cette semaine. Celui de lundi revient encore dans ma tête.', theme: 'nuit', format: 'normal' },
  { id: 'p4', author: 'Chemin Libre', circle: 'Les Découvertes', time: 'hier', text: 'Sujet sensible : je parle d’un moment de solitude et de deuil. J’aimerais seulement être lu avec douceur, sans conseil immédiat.', theme: 'clear', format: 'sensitive', topic: 'Deuil', replyPolicy: 'contacts' },
]
const primary = 'min-h-11 rounded-full bg-[#17233F] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2F486C] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'min-h-11 rounded-full border border-[#ECEAF2] bg-white px-4 py-2 text-sm font-semibold text-[#1A1535] transition hover:bg-[#FAFAF7]'
const field = 'min-h-11 w-full rounded-2xl border border-[#ECEAF2] bg-white px-4 py-3 text-sm text-[#1A1535] placeholder:text-[#4A3F6B] outline-none transition focus:border-[#4A3F6B]'
function AppIcon({ name, size = 20 }) {
  const paths = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 1 1 16.1-4Z"/>,
    circles: <><circle cx="8" cy="8" r="3"/><path d="M2 19v-2a6 6 0 0 1 12 0v2H2ZM16 5a3 3 0 0 1 0 6M16 14a5 5 0 0 1 5 5"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.chat}</svg>
}

function colorIndex(name) {
  return Array.from(name || 'A').reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_PALETTE.length
}

function PresenceDot({ status }) {
  if (!status || status === 'invisible') return null
  const label = status === 'online' ? 'Disponible' : status === 'away' ? 'Absent' : 'Occupé'
  return <span aria-label={label} title={label} className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-white">
    {status === 'online' && <span className="h-[11px] w-[11px] rounded-full bg-[#377946]"/>}
    {status === 'away' && <span className="h-[11px] w-[11px] rounded-full border border-[#675C47]" style={{ background: 'linear-gradient(90deg,#675C47 50%,#fff 50%)' }}/>}
    {status === 'busy' && <span className="flex h-[11px] w-[11px] items-center justify-center rounded-full bg-[#4A3F6B]"><span className="h-[2px] w-[7px] rounded-full bg-white"/></span>}
  </span>
}
function Avatar({ name, status = 'invisible', lueur = false, large = false }) {
  const identity = useContext(IdentityContext)
  return <span className={(large ? 'arche-avatar-large' : 'arche-avatar-shared')+(lueur ? ' arche-lueur ring-4 ring-[#C9A84C]/35 rounded-full' : '')}><MessageAvatar name={name} status={status} lueur={lueur} self={name === identity?.nickname} model={identity?.avatarModel}/></span>
}
function getPerson(name) {
  return PEOPLE.find((person) => person.name === name) || { name, status: 'invisible', note: '' }
}
function themeForPost(post) {
  if (post.format === 'question' || post.format === 'sensitive') return POST_THEMES.clear
  return POST_THEMES[post.theme] || POST_THEMES.clear
}
// L’écran de connexion appartient à ArchePage.jsx et est chargé à la demande.
function FeedAvatar({ name, status = 'invisible' }) {
  const identity = useContext(IdentityContext)
  if (name === identity?.nickname) return <Avatar name={name} status={status}/>
  const initials = { 'Aurore': 'Au', 'Nuage Bleu': 'NB', 'Plume d’Or': 'P', 'Chemin Libre': 'CL' }[name] || name.slice(0, 2)
  return <span role="img" aria-label={'Avatar de '+name} data-person={getPerson(name).id} className="arche-feed-avatar"><span aria-hidden="true">{initials}</span><PresenceDot status={status}/></span>
}
function PostComposer({ nickname, onCreate }) {
  const [draft, setDraft] = useState('')
  const [theme, setTheme] = useState('clear')
  const [format, setFormat] = useState('normal')
  const [topic, setTopic] = useState('Deuil')
  const [replyPolicy, setReplyPolicy] = useState('everyone')
  const [more, setMore] = useState(false)
  const effectiveTheme = draft.length > 160 || format !== 'normal' ? 'clear' : theme
  function submit(event) {
    event.preventDefault()
    if (!draft.trim()) return
    onCreate({ text: draft.trim(), theme: effectiveTheme, format, topic: format === 'sensitive' ? topic : null, replyPolicy })
    setDraft(''); setTheme('clear'); setFormat('normal'); setReplyPolicy('everyone'); setMore(false)
  }
  return <form onSubmit={submit} className="arche-composer rounded-2xl border border-[#ECEAF2] bg-white p-4 shadow-sm">
    <p className="arche-section-kicker">Et vous, aujourd’hui ?</p><div className="flex gap-3"><Avatar name={nickname} status="invisible"/><div className="min-w-0 flex-1"><label className="sr-only" htmlFor="arche-post-draft">Écrire une publication fictive</label><textarea id="arche-post-draft" value={draft} onChange={event => setDraft(event.target.value)} rows={1} maxLength={420} className="w-full resize-none rounded-xl border border-[#ECEAF2] bg-[#FAFAF7] px-4 py-3 text-sm leading-6 placeholder:text-[#4A3F6B] outline-none focus:border-[#4A3F6B]" placeholder="Partager quelque chose…"/></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#ECEAF2] pt-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ambiances de publication">
        {Object.entries(POST_THEMES).map(([id, data]) => <button key={id} type="button" disabled={draft.length > 160 || format !== 'normal'} onClick={() => setTheme(id)} aria-label={'Ambiance '+data.label} title={data.label} aria-pressed={effectiveTheme === id} className={'flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 disabled:opacity-35 '+(effectiveTheme === id ? 'border-[#1A1535]' : 'border-[#ECEAF2]')}><span aria-hidden="true" className="h-7 w-7 rounded-full border border-[#DDD7EA]" style={{ background: data.label === 'Nuit' ? '#1A1535' : data.label === 'Doux' ? '#FFF8E8' : data.label === 'Brume' ? '#EEEAF6' : '#FFFFFF' }}/></button>)}
      </div>
      <button type="button" aria-expanded={more} aria-label="Choisir un format supplémentaire" onClick={() => setMore(v => !v)} className={secondary}>+ <span className="hidden sm:inline">Format</span></button>
      <button disabled={!draft.trim()} className={primary+' ml-auto'}>Publier</button>
    </div>
    {more && <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-pressed={format === 'question'} onClick={() => setFormat(format === 'question' ? 'normal' : 'question')} className={format === 'question' ? primary : secondary}>Question</button><button type="button" aria-pressed={format === 'sensitive'} onClick={() => setFormat(format === 'sensitive' ? 'normal' : 'sensitive')} className={format === 'sensitive' ? primary : secondary}>Sujet sensible</button></div>}
    {format === 'sensitive' && <label className="mt-3 block text-xs font-semibold">Sujet indiqué aux lecteurs<select className={field+' mt-2'} value={topic} onChange={event => setTopic(event.target.value)}><option>Deuil</option><option>Émotion difficile</option><option>Autre sujet sensible</option></select></label>}
    {(more || format === 'sensitive') && <label className="mt-3 block text-xs font-semibold">Qui peut répondre ?<select className={field+' mt-2'} value={replyPolicy} onChange={event => setReplyPolicy(event.target.value)}><option value="everyone">Tous les membres</option><option value="contacts">Mes proches uniquement</option><option value="closed">Personne — réponses fermées</option></select></label>}
    {draft.length > 160 && <p className="mt-2 text-xs text-[#4A3F6B]">Texte long : l’ambiance revient automatiquement à Clair.</p>}
  </form>
}
function PostCard({ post, nickname, reactions, onReact, replies, onReply, onModerate, isClose }) {
  const person = getPerson(post.author)
  const [showSensitive, setShowSensitive] = useState(false)
  const [showReplies, setShowReplies] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const theme = themeForPost(post)
  const isQuestion = post.format === 'question'
  const isSensitive = post.format === 'sensitive'
  const canRead = !isSensitive || showSensitive
  const policy = post.replyPolicy || 'everyone'
  const canReply = policy !== 'closed' && (policy !== 'contacts' || isClose || post.author === nickname)
  const existingReplies = replies[post.id] || []
  const localReactions = reactions[post.id] || []
  const night = theme === POST_THEMES.nuit
  return <article data-ambiance={theme.label} data-format={post.format} className={'arche-post overflow-visible rounded-2xl border bg-white shadow-[0_6px_24px_rgba(26,21,53,.035)] '+(isQuestion ? 'border-l-4 border-l-[#C9A84C]' : 'border-[#ECEAF2]')} style={theme.style}>
    <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3"><FeedAvatar name={post.author} status={isClose ? person.status : 'invisible'}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm" style={{ color: theme.style.color }}>{post.author}</strong>{isQuestion && <span className="rounded-lg border-l-2 border-[#C9A84C] bg-[#FFF8E8] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Question</span>}{isSensitive && <span className="rounded-lg bg-[#EEEAF6] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Sujet sensible</span>}</div><p className="mt-1 text-xs" style={{ color: night ? '#E2D7BE' : '#4A3F6B' }}>{post.circle} · {post.time}</p></div>
        <div className="relative"><button type="button" onClick={() => setMenuOpen(v => !v)} aria-expanded={menuOpen} aria-label={'Options de la publication de '+post.author} className="min-h-11 min-w-11 rounded-lg text-xl" style={{ color: theme.style.color }}>···</button>
          {menuOpen && <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-[#ECEAF2] bg-white p-1 text-[#1A1535] shadow-lg">
            {['Masquer','Signaler',...(post.author !== nickname ? ['Bloquer'] : [])].map(action => <button type="button" key={action} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-[#FAFAF7]" onClick={() => { onModerate(action, post); setMenuOpen(false) }}>{action}</button>)}
          </div>}
        </div>
      </div>
      {isSensitive && !showSensitive ? <section className="mt-4 rounded-xl border border-[#ECEAF2] bg-white p-4 text-[#1A1535]"><p className="text-sm font-semibold">Sujet sensible : {post.topic || 'Sujet délicat'}</p><p className="mt-2 text-xs text-[#4A3F6B]">Ce partage est replié jusqu’à votre choix.</p><p className="mt-2 text-xs text-[#4A3F6B]">{policy === 'contacts' ? 'Réponses réservées aux proches' : policy === 'closed' ? 'Réponses fermées' : 'Réponses ouvertes'}</p><button type="button" onClick={() => setShowSensitive(true)} className={primary+' mt-3'}>Lire avec attention</button></section> : <p className={'mt-4 whitespace-pre-wrap break-words leading-7 '+(post.text.length < 130 && post.theme !== 'clear' && post.format === 'normal' ? 'text-xl font-semibold sm:text-2xl' : 'text-sm')} style={{ color: theme.style.color }}>{post.text}</p>}
      {canRead && <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-[#ECEAF2]/60 pt-3">{REACTIONS.map(reaction => <button key={reaction.id} type="button" aria-pressed={localReactions.includes(reaction.id)} onClick={() => onReact(post.id, reaction.id)} className={'reaction-button min-h-11 rounded-lg px-2 text-xs font-semibold transition '+(localReactions.includes(reaction.id) ? 'bg-[#FFF8E8] text-[#1A1535]' : night ? 'text-white hover:bg-white/10' : 'text-[#4A3F6B] hover:bg-[#FAFAF7]')}><span aria-hidden="true" className="mr-1">{reaction.icon}</span>{reaction.label}</button>)}
        {canReply ? <button type="button" className={'ml-auto min-h-11 px-2 text-xs font-semibold '+(night ? 'text-white' : 'text-[#1A1535]')} aria-expanded={showReplies} onClick={() => setShowReplies(v => !v)}>{showReplies ? 'Fermer' : 'Répondre'}{existingReplies.length > 0 ? ' · '+existingReplies.length+' (démo)' : ''}</button> : <span className={'ml-auto text-xs '+(night ? 'text-[#E2D7BE]' : 'text-[#4A3F6B]')}>{policy === 'closed' ? 'Réponses fermées' : 'Proches seulement'}</span>}</div>}
      {canRead && canReply && showReplies && <div className="mt-3 space-y-2 rounded-xl bg-white/95 p-3 text-[#1A1535]">{existingReplies.map((reply, index) => <p key={index} className="rounded-lg bg-[#FAFAF7] px-3 py-2 text-sm"><strong>{nickname}</strong> · {reply}</p>)}<form onSubmit={event => { event.preventDefault(); if (!replyDraft.trim()) return; onReply(post.id, replyDraft.trim()); setReplyDraft('') }} className="flex gap-2"><label className="sr-only" htmlFor={'reply-'+post.id}>Répondre à {post.author}</label><input id={'reply-'+post.id} value={replyDraft} onChange={event => setReplyDraft(event.target.value)} maxLength={200} placeholder="Votre réponse…" className={field}/><button disabled={!replyDraft.trim()} className={secondary}>Envoyer</button></form></div>}
    </div>
  </article>
}

function FeedView({ nickname, blocked, setBlocked, onNotice }) {
  const [posts, setPosts] = useState(INITIAL_POSTS)
  const [reactions, setReactions] = useState({})
  const [replies, setReplies] = useState({})
  const [hidden, setHidden] = useState([])
  const [lastHidden, setLastHidden] = useState(null)
  const createPost = ({ text, theme, format, topic, replyPolicy }) => setPosts(current => [{ id: 'local-'+Date.now(), author: nickname, circle: format === 'question' ? 'Les Découvertes' : 'Le Fil', time: 'à l’instant', text, theme, format, topic, replyPolicy }, ...current])
  const react = (postId, reactionId) => setReactions(current => ({ ...current, [postId]: current[postId]?.includes(reactionId) ? current[postId].filter(id => id !== reactionId) : [...(current[postId] || []), reactionId] }))
  const reply = (postId, text) => setReplies(current => ({ ...current, [postId]: [...(current[postId] || []), text] }))
  const moderate = (action, post) => {
    if (action === 'Masquer') { setHidden(v => [...v, post.id]); setLastHidden(post.id); onNotice('Publication masquée dans cette démonstration.') }
    if (action === 'Signaler') onNotice('Signalement simulé : aucun signalement réel envoyé.')
    if (action === 'Bloquer') { setBlocked(v => [...new Set([...v, post.author])]); onNotice('Contact fictif bloqué. Ses publications ne sont plus visibles.') }
  }
  const shown = posts.filter(post => !hidden.includes(post.id) && !blocked.includes(post.author))
  return <div className="arche-feed mx-auto max-w-[640px] space-y-3"><header className="arche-feed-title"><div><p className="arche-section-kicker">L’Arche · entre nous</p><h2>Le fil des liens<span aria-hidden="true">.</span></h2></div><p>Partages fictifs<br/>Un espace pour se retrouver</p></header>
    <PostComposer nickname={nickname} onCreate={createPost}/>
    {lastHidden && <button type="button" className="min-h-11 w-full text-sm text-[#4A3F6B] underline" onClick={() => { setHidden(v => v.filter(id => id !== lastHidden)); setLastHidden(null) }}>Annuler le masquage de la dernière publication</button>}
    {shown.length === 0 && <p className="rounded-lg bg-white p-5 text-sm">Aucune publication visible pour le moment.</p>}
    {shown.map(post => <PostCard key={post.id} post={post} nickname={nickname} reactions={reactions} replies={replies} onReact={react} onReply={reply} onModerate={moderate} isClose={PEOPLE.some(p => p.name === post.author && !blocked.includes(p.name))}/>)}
  </div>
}

function SpaceHeading({ icon, eyebrow, title, description }) {
  return <header className="arche-space-heading"><span className="arche-message-symbol"><AppIcon name={icon}/></span><div><p className="arche-section-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div></header>
}
function SalonView({ nickname, blocked }) {
  const identity = useContext(IdentityContext)
  const [messages, setMessages] = useState([{ author:'Aurore',text:'Bienvenue dans le Grand Salon !' },{ author:'Nuage Bleu',text:'Je suis là aussi, je profite du calme.' }])
  const [draft, setDraft] = useState('')
  return <section data-bubble-palette={identity.bubblePalette} className="arche-salon arche-messages mx-auto max-w-[720px] overflow-hidden rounded-2xl border border-[#ECEAF2] bg-white">
    <SpaceHeading icon="chat" eyebrow="Une place pour chaque voix" title="Grand Salon" description="Échanges collectifs fictifs · aucun membre réel en ligne"/>
    <div className="arche-salon-welcome"><span aria-hidden="true">✧</span> Entrez, prenez le temps. Ici, on se répond avec douceur.</div>
    <div aria-live="polite" className="arche-salon-transcript space-y-4">{messages.filter(message => !blocked.includes(message.author)).map((message,index) => <div key={index} className={'arche-message-row flex '+(message.author === nickname ? 'justify-end' : 'justify-start')}>{message.author !== nickname && <Avatar name={message.author}/>}<div className="arche-bubble"><strong className="arche-salon-author">{message.author}</strong><p>{message.text}</p><span className="arche-message-time" aria-label="Heure fictive">20:{String(10 + index % 50).padStart(2,'0')}</span></div>{message.author === nickname && <Avatar name={nickname}/>}</div>)}</div>
    <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setMessages(current => [...current,{ author:nickname,text:draft.trim() }]); setDraft('') }} className="arche-salon-compose flex gap-2 p-3"><label className="sr-only" htmlFor="arche-salon-draft">Écrire dans le Salon fictif</label><input id="arche-salon-draft" maxLength={240} value={draft} onChange={event => setDraft(event.target.value)} className={field} placeholder="Un petit mot pour le Salon…"/><button disabled={!draft.trim()} className={primary}>Envoyer</button></form>
  </section>
}

function CirclesView() {
  const [selected,setSelected]=useState(null)
  const [joined,setJoined]=useState(['decouverte'])
  return <div className="arche-circles mx-auto max-w-[720px]"><SpaceHeading icon="circles" eyebrow="Se retrouver autour de ce qui nous lie" title="Les Cercles" description="Choisissez un espace qui vous ressemble. Exploration fictive."/><div className="grid gap-3 sm:grid-cols-2">{CIRCLES.map(circle => <article key={circle.id} data-tint={circle.tint} className="arche-circle-card rounded-2xl border border-[#ECEAF2] bg-white p-5"><div className="arche-circle-art"><span className="arche-circle-icon"><AppIcon name={circle.icon} size={30}/></span><span className="arche-circle-orbit" aria-hidden="true">✧</span></div><p className="arche-section-kicker">{circle.invitation}</p><h3 className="text-base font-semibold">{circle.title}</h3><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">{circle.description}</p><button type="button" className={secondary+' mt-4'} onClick={()=>setSelected(circle.id)}>Explorer</button></article>)}</div>
    {selected && <div className="mt-4 rounded-2xl border border-[#ECEAF2] bg-white p-5"><h3 className="font-semibold">{CIRCLES.find(c=>c.id===selected)?.title}</h3><p className="mt-2 text-sm text-[#4A3F6B]">Découvrez les échanges du Cercle.</p><button type="button" className={primary+' mt-4'} onClick={()=>setJoined(list=>list.includes(selected)?list.filter(id=>id!==selected):[...list,selected])}>{joined.includes(selected)?'Quitter ce Cercle':'Rejoindre ce Cercle'}</button></div>}
  </div>
}
function MessageAvatar({ name, status = 'invisible', lueur = false, self = false, model = 'lunettes' }) {
  const index = self ? (model === 'portrait' ? 1 : 0) : colorIndex(name) % 4
  const emoji = { etoile: '🌟', lune: '🌙', sourire: '😊' }[model]
  return <span role="img" aria-label={'Avatar de '+name} className={'arche-message-avatar '+(self ? 'arche-avatar-self ' : '')+'arche-avatar-'+index+(lueur ? ' arche-lueur' : '')}>
    {self && emoji ? <span aria-hidden="true" className="arche-avatar-emoji">{emoji}</span> : self && model !== 'portrait' ? <svg aria-hidden="true" viewBox="0 0 64 64"><path d="M5 64c1-19 12-26 27-26s26 7 27 26" fill="#395F97"/><ellipse cx="32" cy="27" rx="13" ry="16" fill="#EAC29F"/><path d="M19 23c-5-23 33-23 27 0l-4-7-7 2-10-4Z" fill="#3A3548"/><g fill="none" stroke="#394660" strokeWidth="2"><rect x="21" y="24" width="10" height="7" rx="3"/><rect x="33" y="24" width="10" height="7" rx="3"/><path d="M31 27h2M27 35q5 4 10 0"/></g><path d="m32 48 2 4 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1Z" fill="#F6DC99"/></svg> : <svg aria-hidden="true" viewBox="0 0 64 64"><path d="M6 64c0-20 12-27 26-27s26 7 26 27" fill={['#628DAA','#9B82BD','#6EAB96','#C884A1'][index]}/><path d="M16 31c-5-25 38-29 33 1l4 14H12Z" fill="#343451"/><ellipse cx="32" cy="27" rx="13" ry="16" fill={['#EDC5AC','#BD886D','#E3B493','#D6A082'][index]}/><path d="M18 22c0-20 28-20 28 0-8-1-14-5-18-10-1 5-5 8-10 10" fill="#343451"/><circle cx="27" cy="26" r="1.2" fill="#343451"/><circle cx="37" cy="26" r="1.2" fill="#343451"/><path d="M27 33q5 4 10 0" stroke="#875743" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}<PresenceDot status={status}/>
  </span>
}
function MessagesView({ bubblePalette, setBubblePalette, avatarModel, setAvatarModel, blocked, setBlocked, incomingLueur, onNotice, nickname, mood, setMood, setIncomingLueur }) {
  const [selected, setSelected] = useState('aurore')
  const [personalizeOpen, setPersonalizeOpen] = useState(false)
  const [lueurPulse, setLueurPulse] = useState(null)
  const [sendCooling, setSendCooling] = useState(false)
  const lueurGate = useRef({ sent: 0, received: 0 })
  const [mobileThread, setMobileThread] = useState(false)
  const [request, setRequest] = useState('pending')
  const [messages, setMessages] = useState([{ who: 'them', text: 'Bonsoir ! Je voudrais parler des rêves, si vous en avez envie.' }, { who: 'them', text: 'Aucune urgence, on peut prendre notre temps ✧' }])
  const [draft, setDraft] = useState('')
  const [sentLueur, setSentLueur] = useState(false)
  const [receivedLueur, setReceivedLueur] = useState(false)
  const [lastSent, setLastSent] = useState(0)
  useEffect(() => {
    if (!lastSent) return
    const timer = setTimeout(() => setSendCooling(false), Math.max(0, 10000 - (Date.now() - lastSent)))
    return () => clearTimeout(timer)
  }, [lastSent])
  useEffect(() => {
    if (!lueurPulse) return
    const timer = setTimeout(() => setLueurPulse(null), 650)
    return () => clearTimeout(timer)
  }, [lueurPulse])
  const person = PEOPLE.find(p => p.id === selected) || PEOPLE[0]
  const contactBlocked = blocked.includes(person.name) || (request === 'blocked' && selected === 'aurore')
  // Consentement reçu de l'autre personne : valeur de scénario fictif, jamais modifiable par l'expéditeur.
  const recipientAcceptsLueur = selected === 'aurore'
  const canChat = request === 'accepted' && selected === 'aurore' && !contactBlocked
  function blockContact(withReport = false) {
    const evidenceCount = withReport ? Math.min(messages.length, 5) : 0
    setBlocked(v => [...new Set([...v, person.name])])
    if (selected === 'aurore') setRequest('blocked')
    setSentLueur(false); setReceivedLueur(false); setLueurPulse(null); setMobileThread(false)
    setMessages([]); setDraft('')
    onNotice(withReport
      ? 'Blocage et signalement simulés (' + evidenceCount + ' dernier(s) message(s) concernés). Aucune preuve copiée ni aucun signalement transmis.'
      : 'Contact fictif bloqué. Historique masqué, aucun signalement réel transmis.')
  }
  function sendLueur() {
    if (!canChat || !recipientAcceptsLueur || Date.now() - lueurGate.current.sent < 10000) return
    const now = Date.now()
    lueurGate.current.sent = now
    setLastSent(now); setSendCooling(true); setSentLueur(true); setLueurPulse({ kind: 'sent', id: now })
    onNotice('Lueur envoyée dans la simulation uniquement. Aucun appareil distant contacté.')
  }
  function simulateReceivedLueur() {
    if (!canChat || !incomingLueur || Date.now() - lueurGate.current.received < 10000) return
    const now = Date.now()
    lueurGate.current.received = now
    setReceivedLueur(true); setLueurPulse({ kind: 'received', id: now })
    try { if (window.innerWidth <= 767 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(40) } catch { /* vibration facultative */ }
    onNotice('Lueur reçue dans la simulation avec votre autorisation.')
  }
  return <div data-bubble-palette={bubblePalette} className="arche-messages mx-auto grid max-w-[900px] gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
    <aside className={(mobileThread ? 'hidden ' : '')+'rounded-2xl border border-[#ECEAF2] bg-white p-3 md:block'}>
      <div className="arche-contact-heading"><span className="arche-message-symbol" aria-hidden="true"><AppIcon name="chat" size={24}/></span><div><p className="arche-message-eyebrow">Un petit signe, un vrai lien</p><h2>Mes rencontres</h2></div></div><p className="arche-message-demo">Contacts et statuts fictifs</p>
      {PEOPLE.filter(p => !blocked.includes(p.name)).map(p => <button type="button" key={p.id} onClick={() => { setSelected(p.id); setMobileThread(true); setSentLueur(false); setReceivedLueur(false); setLueurPulse(null) }} aria-pressed={p.id === selected} className={'arche-contact flex min-h-16 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[#FAFAF7] '+(p.id === selected ? 'arche-contact-selected bg-[#FAFAF7]' : '')}><MessageAvatar name={p.name} status={p.status}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{p.name}</strong><span className="arche-contact-mood block truncate text-xs text-[#4A3F6B]">{p.note}</span><span className="arche-contact-status">{p.status === 'online' ? 'Disponible' : p.status === 'away' ? 'Absent' : 'Occupé'}</span></span></button>)}
      <p className="mt-3 border-t border-[#ECEAF2] p-3 text-xs text-[#4A3F6B]">Messages privés prévus après le pilote fermé.</p>
    </aside>
    <section className={(mobileThread ? 'flex ' : 'hidden ')+'min-h-[480px] flex-col overflow-hidden rounded-2xl border border-[#ECEAF2] bg-white md:flex'}>
      <header className="flex items-center gap-2 border-b border-[#ECEAF2] p-3"><button type="button" onClick={() => setMobileThread(false)} aria-label="Revenir aux rencontres" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl md:hidden">←</button><MessageAvatar name={person.name} status={person.status} lueur={canChat && incomingLueur && lueurPulse?.kind === 'received'}/><div className="min-w-0 flex-1"><h2 className="arche-conversation-name text-sm font-semibold">{person.name}</h2><p className="text-xs text-[#4A3F6B]">{person.note} · privé</p></div>{canChat && <button type="button" aria-label="Envoyer une Lueur" disabled={!recipientAcceptsLueur || sendCooling} title={sendCooling ? 'Patientez 10 secondes entre deux Lueurs' : 'Envoyer une Lueur fictive'} onClick={sendLueur} className="arche-header-lueur"><span aria-hidden="true">✧</span><span>Lueur</span></button>}{!contactBlocked &&           <details className="arche-conversation-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }}><summary aria-label="Options de la conversation" title="Options de la conversation"><span aria-hidden="true">···</span></summary><div className="arche-conversation-menu-panel"><p className="arche-menu-title">Votre conversation</p><label className="arche-lueur-consent"><input type="checkbox" checked={incomingLueur} onChange={event => { setIncomingLueur(event.target.checked); setReceivedLueur(false); setLueurPulse(null) }}/><span>Autoriser les Lueurs de mes proches</span></label><div className="flex flex-wrap gap-2 pt-4"><button type="button" onClick={() => onNotice('Signalement de conversation simulé : aucun message réel transmis.')} className={secondary}>Signaler</button><button type="button" disabled={!incomingLueur || !canChat} onClick={simulateReceivedLueur} className={secondary}>Simuler une Lueur reçue</button><button type="button" onClick={() => blockContact()} className={secondary}>Bloquer</button><button type="button" onClick={() => blockContact(true)} className={secondary}>Bloquer et signaler</button></div>
          <p className="text-xs leading-5 text-[#4A3F6B]">Aurore autorise les Lueurs dans ce scénario. Pour recevoir les vôtres, choisissez dans Moi → Confidentialité. La vibration peut ne pas fonctionner sur iPhone. Une Lueur par sens toutes les 10 secondes.</p></div></details>}</header>
      <div className={'arche-conversation-body min-h-[310px] flex-1 space-y-3 overflow-y-auto p-4'+(canChat && lueurPulse && (lueurPulse.kind === 'sent' ? recipientAcceptsLueur : incomingLueur) ? ' arche-lueur-nudge' : '')}>
        {canChat && lueurPulse && (lueurPulse.kind === 'sent' ? recipientAcceptsLueur : incomingLueur) && <span key={lueurPulse.id+'-'+lueurPulse.kind} className="arche-lueur-flash" aria-hidden="true"/>}
        {contactBlocked ? <p className="text-sm">Contact bloqué. Historique masqué dans la démonstration.</p> : selected !== 'aurore' ? <p className="text-sm text-[#4A3F6B]">Une invitation acceptée sera nécessaire pour échanger.</p> : request === 'pending' ? <div className="arche-invitation rounded-xl bg-[#FAFAF7] p-4"><p className="arche-eyebrow">Un nouveau lien, si vous le souhaitez</p><p className="text-sm leading-6">Aurore souhaite entrer en contact avec vous. Vous pouvez accepter, ignorer ou bloquer sans justification.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primary} onClick={() => setRequest('accepted')}>Accepter</button><button type="button" className={secondary} onClick={() => setRequest('ignored')}>Ignorer</button><button type="button" className={secondary} onClick={() => blockContact()}>Bloquer</button></div></div> : request === 'ignored' ? <div><p className="text-sm">Invitation ignorée. Aucune conversation privée ouverte.</p><button type="button" className={secondary+' mt-3'} onClick={() => setRequest('pending')}>Réinitialiser l’exemple</button></div> : <>
          <p className="arche-transcript-label">Conversation et horaires fictifs · démonstration</p>{messages.map((m,index) => <div key={index} className={'arche-message-row flex '+(m.who === 'me' ? 'justify-end' : 'justify-start')}>{m.who === 'them' && <MessageAvatar name={person.name}/>}<p className={'arche-bubble max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 '+(m.who === 'me' ? 'bg-[#EEEAF6]' : 'bg-[#FAFAF7]')}>{m.text}<span className="arche-message-time" aria-label="Heure fictive">20:{String(14 + index % 46).padStart(2, '0')}</span></p>{m.who === 'me' && <MessageAvatar name={nickname} self model={avatarModel}/>}</div>)}
          {sentLueur && <p role="status" className="mx-auto w-fit rounded-xl bg-[#FFF8E8] px-4 py-2 text-xs">✧ Vous avez envoyé une Lueur à Aurore (démo)</p>}
          {receivedLueur && <p role="status" className="mx-auto w-fit rounded-xl bg-[#FFF8E8] px-4 py-2 text-xs">✧ Aurore vous envoie une Lueur (démo)</p>}

        </>}
      </div>
      {canChat && <div className="arche-palette-bar"><span>Votre couleur</span><div role="group" aria-label="Couleur de vos bulles">{Object.keys(BUBBLE_COLORS).map(color => <button key={color} type="button" aria-label={'Bulles '+color} title={BUBBLE_COLORS[color]} aria-pressed={bubblePalette === color} onClick={() => setBubblePalette(color)} className={'arche-palette-choice arche-palette-'+color}><span aria-hidden="true"/></button>)}</div><button type="button" className="arche-personalize-toggle" aria-expanded={personalizeOpen} onClick={() => setPersonalizeOpen(v => !v)}>Mon style</button></div>}
      {canChat && <div className="arche-self-presence"><MessageAvatar name={nickname} self model={avatarModel}/><span><strong>{nickname}</strong><span>{mood}</span></span></div>}
      {canChat && personalizeOpen && <section className="arche-personalization" aria-label="Personnaliser la messagerie"><p className="arche-menu-title">Votre petite signature</p><div role="group" aria-label="Choisir mon avatar">{AVATAR_MODELS.map(model => <button type="button" key={model.id} aria-label={model.label} aria-pressed={avatarModel === model.id} onClick={() => setAvatarModel(model.id)}><MessageAvatar name={nickname} self model={model.id}/></button>)}</div><button type="button" disabled className="arche-photo-placeholder">Photo de profil · bientôt</button><p>Aucun import de photo dans cette maquette.</p><label>Ma phrase d’humeur<input aria-label="Ma phrase d’humeur" maxLength={60} value={mood} onChange={event => setMood(event.target.value)} placeholder="Quelques mots, juste pour vos proches…"/></label><span className="arche-mood-count">{mood.length}/60 · visible par vos proches seulement</span><button type="button" className="arche-personalization-done" onClick={() => setPersonalizeOpen(false)}>Terminé</button></section>}
      {canChat && <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setMessages(v => [...v,{ who:'me',text:draft.trim() }]); setDraft('') }} className="flex gap-2 border-t border-[#ECEAF2] p-3"><label className="sr-only" htmlFor="arche-dm-draft">Écrire un message fictif</label><input id="arche-dm-draft" className={field} maxLength={240} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Un petit mot pour Aurore…"/><button type="submit" disabled={!draft.trim()} className={primary+' shrink-0 px-5'}>Envoyer</button></form>}
    </section>
  </div>
}

function ProfileView({ bubblePalette, setBubblePalette, avatarModel, setAvatarModel, nickname, presence, setPresence, mood, setMood, incomingLueur, setIncomingLueur, blocked, setBlocked, onExit }) {
  const [privacyOpen, setPrivacyOpen] = useState(true)
  return <section data-bubble-palette={bubblePalette} className="arche-profile arche-messages mx-auto max-w-[660px] rounded-2xl border border-[#ECEAF2] bg-white p-5"><div className="arche-profile-cover"><p className="arche-section-kicker">Votre petite signature</p><span aria-hidden="true">✧</span></div><div className="flex items-center gap-4"><Avatar name={nickname} status={presence} large/><div><h2 className="font-georgia text-2xl">{nickname}</h2><p className="arche-profile-mood">{mood || "Quelques mots pour vos proches…"}</p><p className="text-xs text-[#4A3F6B]">Profil réservé aux membres · présence privée</p></div></div><section className="arche-personalization" aria-label="Personnaliser mon profil"><div role="group" aria-label="Choisir mon avatar">{AVATAR_MODELS.map(model => <button type="button" key={model.id} aria-label={model.label} aria-pressed={avatarModel === model.id} onClick={() => setAvatarModel(model.id)}><MessageAvatar name={nickname} self model={model.id}/></button>)}</div><button type="button" disabled className="arche-photo-placeholder">Photo de profil · bientôt</button><p>Aucun import de photo dans cette maquette.</p><p className="arche-menu-title">La couleur de mes échanges</p><div role="group" aria-label="Couleur de vos bulles">{Object.entries(BUBBLE_COLORS).map(([color,label]) => <button key={color} type="button" aria-label={"Bulles "+color} title={label} aria-pressed={bubblePalette === color} onClick={() => setBubblePalette(color)} className={"arche-palette-choice arche-palette-"+color}><span aria-hidden="true"/></button>)}</div><div className="arche-message-row justify-end"><p className="arche-bubble">Un petit signe, un vrai lien.</p></div></section>
    <label className="mt-5 block text-sm font-semibold">Phrase d’humeur (visible par vos proches seulement)<input maxLength={60} value={mood} onChange={event => setMood(event.target.value)} className={field+' mt-2'} placeholder="Votre humeur…"/></label>
    <label className="mt-4 block text-sm font-semibold">Statut de présence (vos proches seulement)<select value={presence} onChange={event => setPresence(event.target.value)} className={field+' mt-2'}><option value="invisible">Invisible (par défaut)</option><option value="online">Disponible</option><option value="away">Absent</option><option value="busy">Occupé</option></select></label>
    <button type="button" aria-expanded={privacyOpen} onClick={() => setPrivacyOpen(v => !v)} className={secondary+' mt-5 w-full text-left'}>Confidentialité {privacyOpen ? '−' : '+'}</button>
    {privacyOpen && <div className="mt-3 rounded-xl bg-[#FAFAF7] p-4 text-sm"><label className="flex items-start gap-3"><input type="checkbox" checked={incomingLueur} onChange={event => setIncomingLueur(event.target.checked)} className="mt-1 h-4 w-4 accent-[#1A1535]"/><span>J’autorise mes proches à m’envoyer des Lueurs (désactivé par défaut).</span></label><p className="mt-2 text-xs leading-6 text-[#4A3F6B]">C’est la personne qui reçoit qui choisit. Jamais de lecture automatique des messages privés.</p><p className="mt-4 text-xs font-semibold">Contacts bloqués</p>{blocked.length === 0 ? <p className="mt-1 text-xs">Aucun.</p> : blocked.map(name => <div key={name} className="mt-2 flex items-center justify-between gap-2"><span>{name}</span><button className={secondary} type="button" onClick={() => setBlocked(v => v.filter(item => item !== name))}>Débloquer</button></div>)}</div>}
    <button onClick={onExit} type="button" className={secondary+' mt-5'}>Quitter la démo</button>
  </section>
}

function RightRail({ blocked, feed = false }) {
  return <aside className="hidden space-y-4 xl:block"><section className="rounded-2xl border border-[#ECEAF2] bg-white p-4"><h2 className="text-sm font-semibold">Mes proches</h2><div className="mt-3 space-y-3">{PEOPLE.filter(p=>!blocked.includes(p.name)).map(person=><div key={person.id} className="flex items-center gap-3">{feed ? <FeedAvatar name={person.name} status={person.status}/> : <Avatar name={person.name} status={person.status}/>}<div className="min-w-0"><p className="truncate text-sm font-semibold">{person.name}</p><p className="truncate text-xs text-[#4A3F6B]">{person.note}</p></div></div>)}</div></section><section className="rounded-2xl border border-[#ECEAF2] bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[.14em]">Question du soir</p><p className="mt-3 text-sm leading-6">Qu’est-ce qui vous a donné envie d’explorer la spiritualité ?</p></section></aside>
}

export function ArcheAppPreview({ nickname, onExit }) {
  const [bubblePalette, setBubblePalette] = useState('ciel')
  const [avatarModel, setAvatarModel] = useState('lunettes')
  const [view, setView] = useState('feed')
  const [blocked, setBlocked] = useState([])
  const [presence, setPresence] = useState('invisible')
  const [mood, setMood] = useState('Je découvre doucement')
  const [incomingLueur, setIncomingLueur] = useState(false)
  const [notice, setNotice] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [search, setSearch] = useState('')
  // Les confirmations de la maquette concernent la vue courante uniquement.
  // Les données en mémoire des onglets restent intactes.
  function navigateTo(nextView) { setNotice(''); setView(nextView) }
  const matching = PEOPLE.filter(p => !blocked.includes(p.name) && p.name.toLowerCase().includes(search.toLowerCase()))
  return <IdentityContext.Provider value={{ nickname, avatarModel, bubblePalette }}><div data-active-view={view} data-arche-app-preview="local-only" style={{ fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }} className="min-h-screen bg-white text-[#1A1535]">
    <style>{'@keyframes soft-pop{0%{transform:scale(.92)}100%{transform:scale(1)}}.reaction-button[aria-pressed="true"]{animation:soft-pop .24s ease-out}@keyframes arche-lueur-glow{0%{box-shadow:0 0 0 rgba(201,168,76,0)}100%{box-shadow:0 0 26px rgba(201,168,76,.45)}}.arche-lueur{animation:arche-lueur-glow .45s ease-out}@media(prefers-reduced-motion:reduce){.reaction-button[aria-pressed="true"],.arche-lueur{animation:none}}'}</style>
    <header className="sticky top-0 z-30 border-b border-[#ECEAF2] bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-3 sm:px-5"><ArcheBrand demo/>
      <label htmlFor="arche-member-search" className="sr-only">Rechercher un proche fictif</label><input id="arche-member-search" className="hidden min-h-11 min-w-0 flex-1 rounded-xl border border-[#ECEAF2] bg-[#FAFAF7] px-4 text-sm placeholder:text-[#4A3F6B] md:block" placeholder="Rechercher un proche…" value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" aria-label="Notifications fictives" aria-expanded={showNotifications} onClick={()=>setShowNotifications(v=>!v)} className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[#ECEAF2]"><AppIcon name="bell"/></button>
      <button type="button" onClick={()=>navigateTo('profile')} aria-label="Ouvrir mon profil" className="flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-[#FAFAF7]"><Avatar name={nickname}/><span className="hidden text-sm lg:inline">{nickname}</span></button>
    </div>{showNotifications&&<p className="border-t border-[#ECEAF2] bg-[#FAFAF7] p-3 text-center text-xs">Aucune notification réelle, aucune statistique inventée.</p>}</header>
    {notice&&<div role="status" className="mx-auto mt-3 max-w-[720px] rounded-xl border border-[#ECEAF2] bg-[#FFF8E8] p-3 text-sm">{notice}<button type="button" onClick={()=>setNotice('')} className="ml-3 font-semibold underline">Fermer</button></div>}
    {search.trim()&&<div className="mx-auto max-w-[720px] border-b border-[#ECEAF2] p-3 text-sm"><p className="text-xs text-[#4A3F6B]">Recherche locale parmi les proches fictifs</p>{matching.length===0?'Aucun résultat.':matching.map(p=><p key={p.id} className="mt-2">{p.name}</p>)}</div>}
    <div className="mx-auto grid max-w-7xl gap-4 px-3 pb-28 pt-4 sm:px-5 lg:grid-cols-[205px_minmax(0,700px)] xl:grid-cols-[205px_minmax(0,700px)_250px]">
      <aside className="hidden lg:block"><nav aria-label="Navigation latérale L’Arche" className="sticky top-20 space-y-1">{MENU.map(item=><button key={item.id} type="button" aria-current={view===item.id?'page':undefined} onClick={()=>navigateTo(item.id)} className={'flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-sm '+(view===item.id?'bg-[#EEEAF6] font-semibold text-[#1A1535]':'text-[#4A3F6B] hover:bg-[#FAFAF7]')}><AppIcon name={item.icon}/>{item.label}</button>)}<button type="button" onClick={onExit} className="min-h-11 w-full px-4 text-left text-sm text-[#4A3F6B]">Quitter la démo</button></nav></aside>
      <main className="min-w-0">
        <div hidden={view !== 'feed'}><FeedView nickname={nickname} blocked={blocked} setBlocked={setBlocked} onNotice={setNotice}/></div>
        <div hidden={view !== 'salon'}><SalonView nickname={nickname} blocked={blocked}/></div>
        <div hidden={view !== 'cercles'}><CirclesView/></div>
        <div hidden={view !== 'messages'}><MessagesView bubblePalette={bubblePalette} setBubblePalette={setBubblePalette} avatarModel={avatarModel} setAvatarModel={setAvatarModel} blocked={blocked} setBlocked={setBlocked} incomingLueur={incomingLueur} onNotice={setNotice} nickname={nickname} mood={mood} setMood={setMood} setIncomingLueur={setIncomingLueur}/></div>
        <div hidden={view !== 'profile'}><ProfileView bubblePalette={bubblePalette} setBubblePalette={setBubblePalette} avatarModel={avatarModel} setAvatarModel={setAvatarModel} nickname={nickname} presence={presence} setPresence={setPresence} mood={mood} setMood={setMood} incomingLueur={incomingLueur} setIncomingLueur={setIncomingLueur} blocked={blocked} setBlocked={setBlocked} onExit={onExit}/></div>
      </main><RightRail blocked={blocked} feed={view === 'feed'}/>
    </div>
    <nav aria-label="Navigation principale L’Arche" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ECEAF2] bg-white px-1 pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"><div className="grid grid-cols-5 gap-1">{MENU.map(item=><button key={item.id} type="button" onClick={()=>navigateTo(item.id)} aria-label={item.label} aria-current={view===item.id?'page':undefined} className={'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-t-2 px-1 text-[10px] font-semibold '+(view===item.id?'border-[#1A1535] text-[#1A1535]':'border-transparent text-[#4A3F6B]')}><AppIcon name={item.icon} size={20}/>{item.label}</button>)}</div></nav>
  </div></IdentityContext.Provider>
}
