import { useState } from 'react'

// Prototype privé : toutes les données ci-dessous sont fictives et locales.
const PEOPLE = [
  { id: 'aurore', name: 'Aurore', status: 'online', note: 'Disponible ce soir' },
  { id: 'nuage', name: 'Nuage Bleu', status: 'online', note: 'Je relis mes rêves' },
  { id: 'plume', name: 'Plume d’Or', status: 'away', note: 'Revient plus tard' },
  { id: 'chemin', name: 'Chemin Libre', status: 'busy', note: 'Je préfère lire' },
]
const CIRCLES = [
  { id: 'decouverte', title: 'Les Découvertes', description: 'Questions simples, premiers pas et accueil.' },
  { id: 'intuition', title: 'Intuition', description: 'Ressentis, impressions et discernement.' },
  { id: 'reves', title: 'Rêves', description: 'Symboles, nuits marquantes et récits.' },
  { id: 'questions', title: 'Grandes Questions', description: 'Croire, douter, nuancer et dialoguer.' },
]
const POST_THEMES = {
  clear: { label: 'Clair', style: { background: '#FFFFFF', color: '#1A1535', borderColor: '#ECEAF2' }, accent: '#ECEAF2' },
  doux: { label: 'Doux', style: { background: 'linear-gradient(135deg, #FFFFFF 0%, #FFF8E8 100%)', color: '#1A1535', borderColor: '#F0DFC1' }, accent: '#C9A84C' },
  nuit: { label: 'Nuit', style: { background: 'radial-gradient(circle at top right, rgba(201,168,76,.34), transparent 32%), #1A1535', color: '#FFFFFF', borderColor: '#1A1535' }, accent: '#C9A84C' },
  brume: { label: 'Brume', style: { background: 'linear-gradient(135deg, #FFFFFF 0%, #EEEAF6 100%)', color: '#1A1535', borderColor: '#DDD7EA' }, accent: '#4A3F6B' },
}
const AVATAR_PALETTE = ['#EEEAF6', '#FFF1CC', '#E7EEF8', '#F8E9EB', '#EAF3E8', '#F3E7D9', '#E9F4F5', '#F2EAF1']
const REACTIONS = [
  { id: 'merci', label: 'Merci', icon: '✦' },
  { id: 'compris', label: 'Je te comprends', icon: '⌒⌒' },
  { id: 'aussi', label: 'Moi aussi', icon: '⟡' },
]
const MENU = [
  { id: 'feed', label: 'Fil', badge: 0 },
  { id: 'salon', label: 'Salon', badge: 0 },
  { id: 'cercles', label: 'Cercles', badge: 0 },
  { id: 'messages', label: 'Messages', badge: 0 },
  { id: 'profile', label: 'Moi', badge: 0 },
]
const INITIAL_POSTS = [
  { id: 'p1', author: 'Plume d’Or', circle: 'Les Découvertes', time: 'il y a 12 min', text: 'Avez-vous déjà senti que votre intuition disait oui alors que votre tête disait non ?', theme: 'brume', format: 'question', repliesOpen: true },
  { id: 'p2', author: 'Aurore', circle: 'Grand Salon', time: 'il y a 28 min', text: 'Petite présence ce soir. Je lis vos partages tranquillement.', theme: 'doux', format: 'normal' },
  { id: 'p3', author: 'Nuage Bleu', circle: 'Rêves', time: 'il y a 1 h', text: 'J’ai noté trois rêves cette semaine. Celui de lundi revient encore dans ma tête.', theme: 'nuit', format: 'normal' },
  { id: 'p4', author: 'Chemin Libre', circle: 'Les Découvertes', time: 'hier', text: 'Sujet sensible : je parle d’un moment de solitude et de deuil. J’aimerais seulement être lu avec douceur, sans conseil immédiat.', theme: 'clear', format: 'sensitive', topic: 'Deuil', replyPolicy: 'contacts' },
]
const primary = 'min-h-11 rounded-full bg-[#1A1535] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'min-h-11 rounded-full border border-[#ECEAF2] bg-white px-4 py-2 text-sm font-semibold text-[#1A1535] transition hover:bg-[#FAFAF7]'
const field = 'min-h-11 w-full rounded-2xl border border-[#ECEAF2] bg-white px-4 py-3 text-sm text-[#1A1535] outline-none transition focus:border-[#4A3F6B]'
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
  const bg = AVATAR_PALETTE[colorIndex(name)]
  return <span className={'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[#1A1535] '+(large ? 'h-14 w-14 text-xl' : 'h-11 w-11 text-sm')+(lueur ? ' ring-4 ring-[#C9A84C]/35 shadow-[0_0_26px_rgba(201,168,76,.45)]' : '')} style={{ background: bg }}>
    {name?.charAt(0)?.toUpperCase() || 'A'}<PresenceDot status={status}/>
  </span>
}
function getPerson(name) {
  return PEOPLE.find((person) => person.name === name) || { name, status: 'invisible', note: '' }
}
function themeForPost(post) {
  if (post.format === 'question' || post.format === 'sensitive') return POST_THEMES.clear
  return POST_THEMES[post.theme] || POST_THEMES.clear
}
// L’écran de connexion appartient à ArchePage.jsx et est chargé à la demande.
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
  return <form onSubmit={submit} className="rounded-2xl border border-[#ECEAF2] bg-white p-4 shadow-sm">
    <div className="flex gap-3"><Avatar name={nickname} status="invisible"/><div className="min-w-0 flex-1"><label className="sr-only" htmlFor="arche-post-draft">Écrire une publication fictive</label><textarea id="arche-post-draft" value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={420} className="w-full resize-none rounded-xl border border-[#ECEAF2] bg-[#FAFAF7] px-4 py-3 text-sm leading-6 outline-none focus:border-[#4A3F6B]" placeholder="Partager quelque chose…"/></div></div>
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
  const night = post.format === 'normal' && post.theme === 'nuit'
  return <article className={'overflow-visible rounded-2xl border bg-white shadow-[0_6px_24px_rgba(26,21,53,.035)] '+(isQuestion ? 'border-l-4 border-l-[#C9A84C]' : 'border-[#ECEAF2]')} style={theme.style}>
    <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3"><Avatar name={post.author} status={isClose ? person.status : 'invisible'}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm" style={{ color: theme.style.color }}>{post.author}</strong>{isQuestion && <span className="rounded-lg border-l-2 border-[#C9A84C] bg-[#FFF8E8] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Question</span>}{isSensitive && <span className="rounded-lg bg-[#EEEAF6] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Sujet sensible</span>}</div><p className="mt-1 text-xs" style={{ color: night ? '#E2D7BE' : '#4A3F6B' }}>{post.circle} · {post.time}</p></div>
        <div className="relative"><button type="button" onClick={() => setMenuOpen(v => !v)} aria-expanded={menuOpen} aria-label={'Options de la publication de '+post.author} className="min-h-11 min-w-11 rounded-lg text-xl" style={{ color: theme.style.color }}>···</button>
          {menuOpen && <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-[#ECEAF2] bg-white p-1 text-[#1A1535] shadow-lg">
            {['Masquer','Signaler',...(post.author !== nickname ? ['Bloquer'] : [])].map(action => <button type="button" key={action} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-[#FAFAF7]" onClick={() => { onModerate(action, post); setMenuOpen(false) }}>{action}</button>)}
          </div>}
        </div>
      </div>
      {isSensitive && !showSensitive ? <section className="mt-4 rounded-xl border border-[#ECEAF2] bg-white p-4 text-[#1A1535]"><p className="text-sm font-semibold">Sujet sensible : {post.topic || 'Sujet délicat'}</p><p className="mt-2 text-xs text-[#4A3F6B]">Ce partage est replié jusqu’à votre choix.</p><p className="mt-2 text-xs text-[#4A3F6B]">{policy === 'contacts' ? 'Réponses réservées aux proches' : policy === 'closed' ? 'Réponses fermées' : 'Réponses ouvertes'}</p><button type="button" onClick={() => setShowSensitive(true)} className={primary+' mt-3'}>Lire avec attention</button></section> : <p className={'mt-4 whitespace-pre-wrap break-words leading-7 '+(post.text.length < 130 && post.theme !== 'clear' && post.format === 'normal' ? 'text-xl font-semibold sm:text-2xl' : 'text-sm')} style={{ color: theme.style.color }}>{post.text}</p>}
      {canRead && <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-[#ECEAF2]/60 pt-3">{REACTIONS.map(reaction => <button key={reaction.id} type="button" aria-pressed={localReactions.includes(reaction.id)} onClick={() => onReact(post.id, reaction.id)} className={'reaction-button min-h-11 rounded-lg px-2 text-xs font-semibold transition '+(localReactions.includes(reaction.id) ? 'bg-[#FFF8E8] text-[#1A1535]' : night ? 'text-white hover:bg-white/10' : 'text-[#4A3F6B] hover:bg-[#FAFAF7]')}><span aria-hidden="true" className="mr-1">{reaction.icon}</span>{reaction.id === 'compris' ? 'Je comprends' : reaction.label}</button>)}
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
  return <div className="mx-auto max-w-[640px] space-y-3">
    <PostComposer nickname={nickname} onCreate={createPost}/>
    {lastHidden && <button type="button" className="min-h-11 w-full text-sm text-[#4A3F6B] underline" onClick={() => { setHidden(v => v.filter(id => id !== lastHidden)); setLastHidden(null) }}>Annuler le masquage de la dernière publication</button>}
    {shown.length === 0 && <p className="rounded-lg bg-white p-5 text-sm">Aucune publication visible dans cette démo.</p>}
    {shown.map(post => <PostCard key={post.id} post={post} nickname={nickname} reactions={reactions} replies={replies} onReact={react} onReply={reply} onModerate={moderate} isClose={PEOPLE.some(p => p.name === post.author && !blocked.includes(p.name))}/>)}
  </div>
}

function SalonView({ nickname }) {
  const [messages, setMessages] = useState([{ author:'Aurore',text:'Bienvenue dans ce salon de démonstration.' },{ author:'Nuage Bleu',text:'Je suis là aussi, je profite du calme.' }])
  const [draft, setDraft] = useState('')
  return <section className="mx-auto max-w-[720px] overflow-hidden rounded-2xl border border-[#ECEAF2] bg-white">
    <header className="border-b border-[#ECEAF2] px-4 py-3"><h2 className="text-base font-semibold">Grand Salon</h2><p className="text-xs text-[#4A3F6B]">Messages fictifs · aucun membre réel en ligne</p></header>
    <div aria-live="polite" className="max-h-[60vh] min-h-[340px] space-y-3 overflow-y-auto p-4">{messages.map((message,index) => <div key={index} className="flex gap-3"><Avatar name={message.author}/><p className="max-w-[80%] rounded-xl bg-[#FAFAF7] px-4 py-3 text-sm leading-6"><strong>{message.author}</strong><span className="block">{message.text}</span></p></div>)}</div>
    <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setMessages(current => [...current,{ author:nickname,text:draft.trim() }]); setDraft('') }} className="flex gap-2 border-t border-[#ECEAF2] p-3"><label className="sr-only" htmlFor="arche-salon-draft">Écrire dans le Salon fictif</label><input id="arche-salon-draft" maxLength={240} value={draft} onChange={event => setDraft(event.target.value)} className={field} placeholder="Écrire au Salon…"/><button disabled={!draft.trim()} className={primary}>Envoyer</button></form>
  </section>
}

function CirclesView() {
  const [selected,setSelected]=useState(null)
  const [joined,setJoined]=useState(['decouverte'])
  return <div className="mx-auto max-w-[720px]"><h2 className="mb-4 font-georgia text-2xl">Les Cercles</h2><div className="grid gap-3 sm:grid-cols-2">{CIRCLES.map(circle => <article key={circle.id} className="rounded-2xl border border-[#ECEAF2] bg-white p-5"><h3 className="text-base font-semibold">{circle.title}</h3><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">{circle.description}</p><button type="button" className={secondary+' mt-4'} onClick={()=>setSelected(circle.id)}>Explorer</button></article>)}</div>
    {selected && <div className="mt-4 rounded-2xl border border-[#ECEAF2] bg-white p-5"><h3 className="font-semibold">{CIRCLES.find(c=>c.id===selected)?.title}</h3><p className="mt-2 text-sm text-[#4A3F6B]">Espace de démonstration, sans véritables membres.</p><button type="button" className={primary+' mt-4'} onClick={()=>setJoined(list=>list.includes(selected)?list.filter(id=>id!==selected):[...list,selected])}>{joined.includes(selected)?'Quitter ce Cercle':'Rejoindre ce Cercle'}</button></div>}
  </div>
}
function MessagesView({ blocked, setBlocked, incomingLueur, onNotice }) {
  const [selected, setSelected] = useState('aurore')
  const [mobileThread, setMobileThread] = useState(false)
  const [request, setRequest] = useState('pending')
  const [messages, setMessages] = useState([{ who: 'them', text: 'Bonsoir ! Je voudrais parler des rêves, si vous en avez envie.' }])
  const [draft, setDraft] = useState('')
  const [sentLueur, setSentLueur] = useState(false)
  const [receivedLueur, setReceivedLueur] = useState(false)
  const [lastSent, setLastSent] = useState(0)
  const person = PEOPLE.find(p => p.id === selected) || PEOPLE[0]
  const contactBlocked = blocked.includes(person.name) || (request === 'blocked' && selected === 'aurore')
  // Consentement reçu de l'autre personne : valeur de scénario fictif, jamais modifiable par l'expéditeur.
  const recipientAcceptsLueur = selected === 'aurore'
  const canChat = request === 'accepted' && selected === 'aurore' && !contactBlocked
  function blockContact() {
    setBlocked(v => [...new Set([...v, person.name])])
    if (selected === 'aurore') setRequest('blocked')
    setSentLueur(false); setReceivedLueur(false); setMobileThread(false)
    onNotice('Contact fictif bloqué. Historique masqué, aucun signalement réel transmis.')
  }
  function sendLueur() {
    if (!canChat || !recipientAcceptsLueur || Date.now()-lastSent < 10000) return
    setLastSent(Date.now()); setSentLueur(true)
    onNotice('Lueur envoyée dans la simulation uniquement. Aucun appareil distant contacté.')
  }
  function simulateReceivedLueur() {
    if (!canChat || !incomingLueur) return
    setReceivedLueur(true)
    try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(70) } catch { /* vibration facultative */ }
    onNotice('Lueur reçue dans la simulation avec votre autorisation.')
  }
  return <div className="mx-auto grid max-w-[900px] gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
    <aside className={(mobileThread ? 'hidden ' : '')+'rounded-2xl border border-[#ECEAF2] bg-white p-3 md:block'}>
      <h2 className="px-3 py-2 text-base font-semibold">Mes rencontres</h2>
      {PEOPLE.filter(p => !blocked.includes(p.name)).slice(0,3).map(p => <button type="button" key={p.id} onClick={() => { setSelected(p.id); setMobileThread(true); setSentLueur(false); setReceivedLueur(false) }} className={'flex min-h-16 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[#FAFAF7] '+(p.id === selected ? 'bg-[#FAFAF7]' : '')}><Avatar name={p.name} status={p.status}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{p.name}</strong><span className="block truncate text-xs text-[#4A3F6B]">{p.note}</span></span></button>)}
      <p className="mt-3 border-t border-[#ECEAF2] p-3 text-xs text-[#4A3F6B]">Profils et conversations fictifs. Messages privés non ouverts pendant le pilote.</p>
    </aside>
    <section className={(mobileThread ? 'flex ' : 'hidden ')+'min-h-[480px] flex-col overflow-hidden rounded-2xl border border-[#ECEAF2] bg-white md:flex'}>
      <header className="flex items-center gap-2 border-b border-[#ECEAF2] p-3"><button type="button" onClick={() => setMobileThread(false)} aria-label="Revenir aux rencontres" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl md:hidden">←</button><Avatar name={person.name} status={person.status} lueur={receivedLueur}/><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{person.name}</h2><p className="text-xs text-[#4A3F6B]">Conversation de démonstration</p></div></header>
      <div className="min-h-[310px] flex-1 space-y-3 overflow-y-auto p-4">
        {contactBlocked ? <p className="text-sm">Contact bloqué. Historique masqué dans la démonstration.</p> : selected !== 'aurore' ? <p className="text-sm text-[#4A3F6B]">Aucune conversation ouverte. Une invitation acceptée sera nécessaire.</p> : request === 'pending' ? <div className="rounded-xl bg-[#FAFAF7] p-4"><p className="text-sm leading-6">Aurore souhaite entrer en contact avec vous. Vous pouvez accepter, ignorer ou bloquer sans justification.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primary} onClick={() => setRequest('accepted')}>Accepter</button><button type="button" className={secondary} onClick={() => setRequest('ignored')}>Ignorer</button><button type="button" className={secondary} onClick={blockContact}>Bloquer</button></div></div> : request === 'ignored' ? <div><p className="text-sm">Invitation ignorée. Aucune conversation privée ouverte.</p><button type="button" className={secondary+' mt-3'} onClick={() => setRequest('pending')}>Réinitialiser l’exemple</button></div> : <>
          {messages.map((m,index) => <div key={index} className={'flex '+(m.who === 'me' ? 'justify-end' : 'justify-start')}><p className={'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 '+(m.who === 'me' ? 'bg-[#EEEAF6]' : 'bg-[#FAFAF7]')}>{m.text}</p></div>)}
          {sentLueur && <p role="status" className="mx-auto w-fit rounded-xl bg-[#FFF8E8] px-4 py-2 text-xs">✧ Vous avez envoyé une Lueur à Aurore (démo)</p>}
          {receivedLueur && <p role="status" className="mx-auto w-fit rounded-xl bg-[#FFF8E8] px-4 py-2 text-xs">✧ Aurore vous envoie une Lueur (démo)</p>}
          <div className="flex flex-wrap gap-2 pt-4"><button type="button" disabled={!recipientAcceptsLueur} onClick={sendLueur} className={secondary}>Envoyer une Lueur</button><button type="button" disabled={!incomingLueur} onClick={simulateReceivedLueur} className={secondary}>Simuler une Lueur reçue</button><button type="button" onClick={blockContact} className={secondary}>Bloquer</button></div>
          <p className="text-xs leading-5 text-[#4A3F6B]">Aurore autorise les Lueurs dans ce scénario. Pour recevoir les vôtres, choisissez dans Moi → Confidentialité. La vibration peut ne pas fonctionner sur iPhone.</p>
        </>}
      </div>
      {canChat && <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setMessages(v => [...v,{ who:'me',text:draft.trim() }]); setDraft('') }} className="flex gap-2 border-t border-[#ECEAF2] p-3"><label className="sr-only" htmlFor="arche-dm-draft">Écrire un message fictif</label><input id="arche-dm-draft" className={field} maxLength={240} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Votre message…"/><button type="submit" disabled={!draft.trim()} className={primary}>Envoyer</button></form>}
    </section>
  </div>
}

function ProfileView({ nickname, presence, setPresence, mood, setMood, incomingLueur, setIncomingLueur, blocked, setBlocked, onExit }) {
  const [privacyOpen, setPrivacyOpen] = useState(true)
  return <section className="mx-auto max-w-[660px] rounded-2xl border border-[#ECEAF2] bg-white p-5"><div className="flex items-center gap-4"><Avatar name={nickname} status={presence} large/><div><h2 className="font-georgia text-2xl">{nickname}</h2><p className="text-sm text-[#4A3F6B]">Invisible par défaut · Profil réservé aux membres</p></div></div>
    <label className="mt-5 block text-sm font-semibold">Phrase d’humeur (visible par vos proches seulement)<input maxLength={60} value={mood} onChange={event => setMood(event.target.value)} className={field+' mt-2'} placeholder="Votre humeur…"/></label>
    <label className="mt-4 block text-sm font-semibold">Statut de présence (vos proches seulement)<select value={presence} onChange={event => setPresence(event.target.value)} className={field+' mt-2'}><option value="invisible">Invisible (par défaut)</option><option value="online">Disponible</option><option value="away">Absent</option><option value="busy">Occupé</option></select></label>
    <button type="button" aria-expanded={privacyOpen} onClick={() => setPrivacyOpen(v => !v)} className={secondary+' mt-5 w-full text-left'}>Confidentialité {privacyOpen ? '−' : '+'}</button>
    {privacyOpen && <div className="mt-3 rounded-xl bg-[#FAFAF7] p-4 text-sm"><label className="flex items-start gap-3"><input type="checkbox" checked={incomingLueur} onChange={event => setIncomingLueur(event.target.checked)} className="mt-1 h-4 w-4 accent-[#1A1535]"/><span>J’autorise mes proches à m’envoyer des Lueurs (désactivé par défaut).</span></label><p className="mt-2 text-xs leading-6 text-[#4A3F6B]">C’est la personne qui reçoit qui choisit. Jamais de lecture automatique des messages privés.</p><p className="mt-4 text-xs font-semibold">Contacts bloqués dans la démonstration</p>{blocked.length === 0 ? <p className="mt-1 text-xs">Aucun.</p> : blocked.map(name => <div key={name} className="mt-2 flex items-center justify-between gap-2"><span>{name}</span><button className={secondary} type="button" onClick={() => setBlocked(v => v.filter(item => item !== name))}>Débloquer</button></div>)}</div>}
    <button onClick={onExit} type="button" className={secondary+' mt-5'}>Quitter la démo</button>
  </section>
}

function RightRail({ blocked }) {
  return <aside className="hidden space-y-4 xl:block"><section className="rounded-2xl border border-[#ECEAF2] bg-white p-4"><h2 className="text-sm font-semibold">Mes proches <span className="font-normal text-[#4A3F6B]">· exemples fictifs</span></h2><div className="mt-3 space-y-3">{PEOPLE.filter(p=>!blocked.includes(p.name)).map(person=><div key={person.id} className="flex items-center gap-3"><Avatar name={person.name} status={person.status}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.name}</p><p className="truncate text-xs text-[#4A3F6B]">{person.note}</p></div></div>)}</div></section><section className="rounded-2xl border border-[#ECEAF2] bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[.14em]">Question du soir</p><p className="mt-3 text-sm leading-6">Qu’est-ce qui vous a donné envie d’explorer la spiritualité ?</p></section></aside>
}

export function ArcheAppPreview({ nickname, onExit }) {
  const [view, setView] = useState('feed')
  const [blocked, setBlocked] = useState([])
  const [presence, setPresence] = useState('invisible')
  const [mood, setMood] = useState('Je découvre doucement')
  const [incomingLueur, setIncomingLueur] = useState(false)
  const [notice, setNotice] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [search, setSearch] = useState('')
  const matching = PEOPLE.filter(p => !blocked.includes(p.name) && p.name.toLowerCase().includes(search.toLowerCase()))
  return <div data-arche-app-preview="local-only" style={{ fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }} className="min-h-screen bg-white text-[#1A1535]">
    <style>{'@keyframes soft-pop{0%{transform:scale(.92)}100%{transform:scale(1)}}.reaction-button[aria-pressed="true"]{animation:soft-pop .24s ease-out}@keyframes arche-lueur-glow{0%{box-shadow:0 0 0 rgba(201,168,76,0)}100%{box-shadow:0 0 26px rgba(201,168,76,.45)}}.arche-lueur{animation:arche-lueur-glow .45s ease-out}@media(prefers-reduced-motion:reduce){.reaction-button[aria-pressed="true"],.arche-lueur{animation:none}}'}</style>
    <header className="sticky top-0 z-30 border-b border-[#ECEAF2] bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-3 sm:px-5"><div className="flex shrink-0 items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1A1535] font-georgia text-lg text-white">A</span><strong className="font-georgia text-xl">L’ARCHE</strong><span className="rounded-md bg-[#C9A84C] px-2 py-1 text-[10px] font-semibold text-[#1A1535]">Démo</span></div>
      <label htmlFor="arche-member-search" className="sr-only">Rechercher un proche fictif</label><input id="arche-member-search" className="hidden min-h-11 min-w-0 flex-1 rounded-xl border border-[#ECEAF2] bg-[#FAFAF7] px-4 text-sm md:block" placeholder="Rechercher un proche…" value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" aria-label="Notifications fictives" aria-expanded={showNotifications} onClick={()=>setShowNotifications(v=>!v)} className="ml-auto min-h-11 min-w-11 rounded-xl border border-[#ECEAF2]">♧</button>
      <button type="button" onClick={()=>setView('profile')} aria-label="Ouvrir mon profil" className="flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-[#FAFAF7]"><Avatar name={nickname}/><span className="hidden text-sm lg:inline">{nickname}</span></button>
    </div>{showNotifications&&<p className="border-t border-[#ECEAF2] bg-[#FAFAF7] p-3 text-center text-xs">Aucune notification réelle, aucune statistique inventée.</p>}</header>
    {notice&&<div role="status" className="mx-auto mt-3 max-w-[720px] rounded-xl border border-[#ECEAF2] bg-[#FFF8E8] p-3 text-sm">{notice}<button type="button" onClick={()=>setNotice('')} className="ml-3 font-semibold underline">Fermer</button></div>}
    {search.trim()&&<div className="mx-auto max-w-[720px] border-b border-[#ECEAF2] p-3 text-sm"><p className="text-xs text-[#4A3F6B]">Recherche locale parmi les proches fictifs</p>{matching.length===0?'Aucun résultat.':matching.map(p=><p key={p.id} className="mt-2">{p.name}</p>)}</div>}
    <div className="mx-auto grid max-w-7xl gap-4 px-3 pb-28 pt-4 sm:px-5 lg:grid-cols-[205px_minmax(0,700px)] xl:grid-cols-[205px_minmax(0,700px)_250px]">
      <aside className="hidden lg:block"><nav className="sticky top-20 space-y-1">{MENU.map(item=><button key={item.id} type="button" aria-current={view===item.id?'page':undefined} onClick={()=>setView(item.id)} className={'flex min-h-12 w-full items-center rounded-xl px-4 text-left text-sm '+(view===item.id?'bg-[#EEEAF6] font-semibold text-[#1A1535]':'text-[#4A3F6B] hover:bg-[#FAFAF7]')}>{item.label}</button>)}<button type="button" onClick={onExit} className="min-h-11 w-full px-4 text-left text-sm text-[#4A3F6B]">Quitter la démo</button></nav></aside>
      <main className="min-w-0">
        {view==='feed'&&<FeedView nickname={nickname} blocked={blocked} setBlocked={setBlocked} onNotice={setNotice}/>}
        {view==='salon'&&<SalonView nickname={nickname}/>}
        {view==='cercles'&&<CirclesView/>}
        {view==='messages'&&<MessagesView blocked={blocked} setBlocked={setBlocked} incomingLueur={incomingLueur} onNotice={setNotice}/>}
        {view==='profile'&&<ProfileView nickname={nickname} presence={presence} setPresence={setPresence} mood={mood} setMood={setMood} incomingLueur={incomingLueur} setIncomingLueur={setIncomingLueur} blocked={blocked} setBlocked={setBlocked} onExit={onExit}/>}
      </main><RightRail blocked={blocked}/>
    </div>
    <nav aria-label="Navigation principale L’Arche" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ECEAF2] bg-white px-1 pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"><div className="grid grid-cols-5 gap-1">{MENU.map((item,index)=><button key={item.id} type="button" onClick={()=>setView(item.id)} aria-label={item.label} aria-current={view===item.id?'page':undefined} className={'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-t-2 px-1 text-[10px] font-semibold '+(view===item.id?'border-[#1A1535] text-[#1A1535]':'border-transparent text-[#4A3F6B]')}><span aria-hidden="true" className="text-lg leading-none">{['⌂','◉','◎','✉','◯'][index]}</span>{item.label}</button>)}</div></nav>
  </div>
}
