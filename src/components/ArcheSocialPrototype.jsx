import { useMemo, useState } from 'react'

// Prototype privé : toutes les données ci-dessous sont fictives et locales.
const PEOPLE = [
  { id: 'lueur', name: 'Lueur', status: 'online', note: 'Disponible ce soir', unread: 1 },
  { id: 'nuage', name: 'Nuage Bleu', status: 'online', note: 'Je relis mes rêves', unread: 0 },
  { id: 'plume', name: 'Plume d’Or', status: 'away', note: 'Revient plus tard', unread: 2 },
  { id: 'chemin', name: 'Chemin Libre', status: 'busy', note: 'Je préfère lire', unread: 0 },
]
const CIRCLES = [
  { id: 'decouverte', title: 'Les Découvertes', unread: 4, description: 'Questions simples, premiers pas et accueil.' },
  { id: 'intuition', title: 'Intuition', unread: 1, description: 'Ressentis, impressions et discernement.' },
  { id: 'reves', title: 'Rêves', unread: 0, description: 'Symboles, nuits marquantes et récits.' },
  { id: 'questions', title: 'Grandes Questions', unread: 2, description: 'Croire, douter, nuancer et dialoguer.' },
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
  { id: 'salon', label: 'Salon', badge: 5 },
  { id: 'cercles', label: 'Cercles', badge: 7 },
  { id: 'messages', label: 'Messages', badge: 2 },
  { id: 'profile', label: 'Moi', badge: 0 },
]
const INITIAL_POSTS = [
  { id: 'p1', author: 'Plume d’Or', circle: 'Les Découvertes', time: 'il y a 12 min', text: 'Avez-vous déjà senti que votre intuition disait oui alors que votre tête disait non ?', theme: 'brume', format: 'question', repliesOpen: true },
  { id: 'p2', author: 'Lueur', circle: 'Grand Salon', time: 'il y a 28 min', text: 'Petite présence ce soir. Je lis vos partages tranquillement.', theme: 'doux', format: 'normal' },
  { id: 'p3', author: 'Nuage Bleu', circle: 'Rêves', time: 'il y a 1 h', text: 'J’ai noté trois rêves cette semaine. Celui de lundi revient encore dans ma tête.', theme: 'nuit', format: 'normal' },
  { id: 'p4', author: 'Chemin Libre', circle: 'Les Découvertes', time: 'hier', text: 'Sujet sensible : je parle d’un moment de solitude et de deuil. J’aimerais seulement être lu avec douceur, sans conseil immédiat.', theme: 'clear', format: 'sensitive' },
]
const primary = 'min-h-11 rounded-full bg-[#1A1535] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'min-h-11 rounded-full border border-[#ECEAF2] bg-white px-4 py-2 text-sm font-semibold text-[#1A1535] transition hover:bg-[#FAFAF7]'
const field = 'min-h-11 w-full rounded-2xl border border-[#ECEAF2] bg-white px-4 py-3 text-sm text-[#1A1535] outline-none transition focus:border-[#4A3F6B]'
function colorIndex(name) {
  return Array.from(name || 'A').reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_PALETTE.length
}
function PresenceDot({ status }) {
  if (status === 'invisible') return null
  const label = status === 'online' ? 'en ligne' : status === 'away' ? 'absent' : 'occupé'
  const shape = status === 'online' ? '●' : status === 'away' ? '◐' : '⊖'
  const color = status === 'online' ? '#5E8F63' : status === 'away' ? '#9B640B' : '#4A3F6B'
  return <span aria-label={label} title={label} className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white text-[13px] font-bold" style={{ color }}>{shape}</span>
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
function ArcheLoginPreview({ onEnter, onBack }) {
  const [mode, setMode] = useState('existing')
  const [pseudo, setPseudo] = useState('Étoile du Nord')
  const [ack, setAck] = useState(false)
  return <div className="min-h-screen bg-white text-[#1A1535]">
    <header className="border-b border-[#ECEAF2] bg-white px-5 py-4 md:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between"><p className="font-georgia text-xl tracking-[.05em]">L’ARCHE</p><button type="button" onClick={onBack} className={secondary}>← Découverte</button></div></header>
    <section id="connexion" className="px-5 py-20 md:px-8"><div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_420px]">
      <div><p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-[#4A3F6B]">Accès membres · démonstration</p><h2 className="max-w-xl font-georgia text-4xl leading-tight md:text-5xl">Entrez dans L’Arche.</h2><p className="mt-6 max-w-xl text-base leading-8 text-[#4A3F6B]">Un espace clair, blanc, social : Fil vivant, Grand Salon, Cercles, proches, présence et Lueur. Tout reste simulé localement.</p></div>
      <form onSubmit={(event) => { event.preventDefault(); if (pseudo.trim() && ack) onEnter(pseudo.trim()) }} className="rounded-3xl border border-[#ECEAF2] bg-white p-6 shadow-[0_22px_70px_rgba(26,21,53,.08)]">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Type d’accès"><button type="button" className={mode === 'existing' ? primary : secondary} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>J’ai un compte</button><button type="button" className={mode === 'new' ? primary : secondary} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Créer un compte</button></div>
        <p className="mt-5 text-sm leading-6 text-[#4A3F6B]">{mode === 'existing' ? 'Dans la vraie version, votre compte MediumIA ouvrira l’adhésion gratuite à L’Arche.' : 'La création du compte restera gratuite, puis l’adhésion à L’Arche sera distincte.'}</p>
        <label className="mt-5 block text-sm font-semibold">Pseudonyme fictif<input required maxLength={32} autoComplete="off" value={pseudo} onChange={(event) => setPseudo(event.target.value)} className={'mt-2 '+field}/></label>
        <label className="mt-5 flex items-start gap-3 text-xs leading-5 text-[#4A3F6B]"><input required checked={ack} onChange={(event) => setAck(event.target.checked)} type="checkbox" className="mt-1 h-4 w-4 accent-[#1A1535]"/><span>Je comprends qu’aucun compte, message ou profil réel n’est créé par cette démonstration.</span></label>
        <button disabled={!ack || !pseudo.trim()} className={primary+' mt-6 w-full'}>Entrer dans l’application →</button>
      </form>
    </div></section>
  </div>
}
function PostComposer({ nickname, onCreate }) {
  const [draft, setDraft] = useState('')
  const [theme, setTheme] = useState('clear')
  const [format, setFormat] = useState('normal')
  const effectiveTheme = draft.length > 160 || format !== 'normal' ? 'clear' : theme
  return <form onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; onCreate({ text: draft.trim(), theme: effectiveTheme, format }); setDraft(''); setTheme('clear'); setFormat('normal') }} className="rounded-3xl border border-[#ECEAF2] bg-white p-4 shadow-[0_12px_36px_rgba(26,21,53,.05)]">
    <div className="flex gap-3"><Avatar name={nickname} status="invisible"/><div className="min-w-0 flex-1"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={420} className="w-full resize-none rounded-2xl border border-[#ECEAF2] bg-[#FAFAF7] px-4 py-3 text-sm leading-6 outline-none focus:border-[#4A3F6B]" placeholder="Partager quelque chose…"/></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#ECEAF2] pt-3">
      {Object.entries(POST_THEMES).map(([id, data]) => <button key={id} type="button" disabled={draft.length > 160 || format !== 'normal'} onClick={() => setTheme(id)} aria-pressed={effectiveTheme === id} className={'min-h-11 rounded-full border px-3 text-xs font-semibold '+(effectiveTheme === id ? 'border-[#1A1535] bg-[#1A1535] text-white' : 'border-[#ECEAF2] bg-white text-[#4A3F6B] disabled:opacity-35')}>{data.label}</button>)}
      <span className="mx-1 hidden h-6 w-px bg-[#ECEAF2] sm:block"/>
      <button type="button" onClick={() => setFormat(format === 'question' ? 'normal' : 'question')} className={'min-h-11 rounded-full border px-3 text-xs font-semibold '+(format === 'question' ? 'border-[#C9A84C] bg-[#FFF8E8] text-[#1A1535]' : 'border-[#ECEAF2] bg-white text-[#4A3F6B]')}>Question</button>
      <button type="button" onClick={() => setFormat(format === 'sensitive' ? 'normal' : 'sensitive')} className={'min-h-11 rounded-full border px-3 text-xs font-semibold '+(format === 'sensitive' ? 'border-[#4A3F6B] bg-[#EEEAF6] text-[#1A1535]' : 'border-[#ECEAF2] bg-white text-[#4A3F6B]')}>Sujet sensible</button>
      <button disabled={!draft.trim()} className={primary+' ml-auto'}>Publier</button>
    </div>
    {draft.length > 160 && <p className="mt-2 text-xs text-[#4A3F6B]">Les ambiances colorées sont réservées aux textes courts. Ce post repassera en Clair.</p>}
  </form>
}
function PostCard({ post, nickname, reactions, onReact, replies, onReply }) {
  const person = getPerson(post.author)
  const [showSensitive, setShowSensitive] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const theme = themeForPost(post)
  const isQuestion = post.format === 'question'
  const isSensitive = post.format === 'sensitive'
  const textVisible = !isSensitive || showSensitive
  const localReactions = reactions[post.id] || []
  return <article className={'overflow-hidden rounded-3xl border bg-white shadow-[0_10px_30px_rgba(26,21,53,.04)] '+(isQuestion ? 'border-l-4 border-l-[#C9A84C]' : 'border-[#ECEAF2]')} style={theme.style}>
    <div className="p-5">
      <div className="flex items-start gap-3"><Avatar name={post.author} status={person.status}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-sm" style={{ color: theme.style.color }}>{post.author}</strong>{isQuestion && <span className="rounded-full bg-[#FFF8E8] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Question</span>}{isSensitive && <span className="rounded-full bg-[#EEEAF6] px-2 py-1 text-[11px] font-semibold text-[#1A1535]">Sujet sensible</span>}</div><p className="mt-1 text-xs" style={{ color: post.theme === 'nuit' && !isQuestion && !isSensitive ? '#E2D7BE' : '#4A3F6B' }}>{post.circle} · {post.time}</p></div><button type="button" className="min-h-11 min-w-11 rounded-full text-sm" aria-label="Menu de publication">…</button></div>
      {isSensitive && !showSensitive ? <div className="mt-4 rounded-2xl border border-[#ECEAF2] bg-white/80 p-4"><p className="text-sm leading-6 text-[#4A3F6B]">Ce partage est replié par respect du rythme de lecture.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowSensitive(true)} className={primary}>Lire avec attention</button><button type="button" className={secondary}>Réponses limitées aux proches</button></div></div> : <p className={'mt-4 whitespace-pre-wrap break-words leading-7 '+(post.text.length < 130 && post.theme !== 'clear' && post.format === 'normal' ? 'text-[1.35rem] font-semibold md:text-[1.65rem]' : 'text-sm')} style={{ color: theme.style.color }}>{post.text}</p>}
      {textVisible && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#ECEAF2]/80 pt-4">{REACTIONS.map((reaction) => <button key={reaction.id} type="button" aria-pressed={localReactions.includes(reaction.id)} onClick={() => onReact(post.id, reaction.id)} className={'reaction-button min-h-11 rounded-full border px-3 text-xs font-semibold transition '+(localReactions.includes(reaction.id) ? 'border-[#C9A84C] bg-[#FFF8E8] text-[#1A1535]' : 'border-[#ECEAF2] bg-white text-[#4A3F6B] hover:bg-[#FAFAF7]')}><span aria-hidden="true" className="mr-1">{reaction.icon}</span>{reaction.label}</button>)}<button type="button" className={isQuestion ? primary : secondary} onClick={() => document.getElementById('reply-'+post.id)?.focus()}>Répondre</button></div>}
      {textVisible && <div className="mt-3 space-y-2">{(replies[post.id] || []).map((reply, index) => <p key={index} className="rounded-2xl bg-[#FAFAF7] px-4 py-3 text-sm leading-6 text-[#1A1535]"><strong>{nickname}</strong> · {reply}</p>)}<form onSubmit={(event) => { event.preventDefault(); if (!replyDraft.trim()) return; onReply(post.id, replyDraft.trim()); setReplyDraft('') }} className="flex gap-2"><label className="sr-only" htmlFor={'reply-'+post.id}>Réponse sobre</label><input id={'reply-'+post.id} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} maxLength={200} placeholder="Réponse sobre…" className={field}/><button disabled={!replyDraft.trim()} className={secondary}>Envoyer</button></form></div>}
    </div>
  </article>
}
function FeedView({ nickname }) {
  const [posts, setPosts] = useState(INITIAL_POSTS)
  const [reactions, setReactions] = useState({})
  const [replies, setReplies] = useState({})
  const createPost = ({ text, theme, format }) => setPosts((current) => [{ id: 'local-'+Date.now(), author: nickname, circle: format === 'question' ? 'Les Découvertes' : 'Le Fil', time: 'à l’instant', text, theme, format }, ...current])
  const react = (postId, reactionId) => setReactions((current) => ({ ...current, [postId]: current[postId]?.includes(reactionId) ? current[postId].filter((id) => id !== reactionId) : [...(current[postId] || []), reactionId] }))
  const reply = (postId, text) => setReplies((current) => ({ ...current, [postId]: [...(current[postId] || []), text] }))
  return <div className="space-y-5"><PostComposer nickname={nickname} onCreate={createPost}/>{posts.map((post) => <PostCard key={post.id} post={post} nickname={nickname} reactions={reactions} replies={replies} onReact={react} onReply={reply}/>)}</div>
}
function SalonView({ nickname }) {
  const [messages, setMessages] = useState([{ author: 'Lueur', text: 'Bienvenue dans le Grand Salon.' }, { author: 'Nuage Bleu', text: 'Je suis là aussi, je lis doucement.' }])
  const [draft, setDraft] = useState('')
  return <section className="rounded-3xl border border-[#ECEAF2] bg-white shadow-[0_12px_36px_rgba(26,21,53,.05)]"><header className="flex items-center justify-between border-b border-[#ECEAF2] p-4"><div><h2 className="font-georgia text-xl">Grand Salon</h2><p className="text-xs text-[#4A3F6B]">5 présents · Lueur écrit…</p></div><button className={secondary}>Présences</button></header><div className="min-h-[420px] space-y-4 p-4">{messages.map((message, index) => <div key={index} className="flex gap-3"><Avatar name={message.author} status={getPerson(message.author).status}/><p className="max-w-[75%] rounded-3xl bg-[#FAFAF7] px-4 py-3 text-sm leading-6"><strong>{message.author}</strong><br/>{message.text}</p></div>)}</div><form onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; setMessages((current) => [...current, { author: nickname, text: draft.trim() }]); setDraft('') }} className="flex gap-2 border-t border-[#ECEAF2] p-4"><input value={draft} onChange={(event) => setDraft(event.target.value)} className={field} placeholder="Écrire au Salon…"/><button disabled={!draft.trim()} className={primary}>Envoyer</button></form></section>
}
function CirclesView() {
  return <div className="grid gap-3 md:grid-cols-2">{CIRCLES.map((circle) => <article key={circle.id} className="rounded-3xl border border-[#ECEAF2] bg-white p-5 shadow-[0_10px_30px_rgba(26,21,53,.04)]"><div className="flex items-center justify-between"><h2 className="font-georgia text-xl text-[#1A1535]">{circle.title}</h2>{circle.unread > 0 && <span className="rounded-full bg-[#C9A84C] px-2 py-1 text-xs font-bold text-[#1A1535]">{circle.unread}</span>}</div><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">{circle.description}</p><button className={secondary+' mt-5'}>Explorer</button></article>)}</div>
}
function MessagesView() {
  const [accepted, setAccepted] = useState(false)
  const [allowLueur, setAllowLueur] = useState(false)
  const [lueur, setLueur] = useState(false)
  return <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><aside className="rounded-3xl border border-[#ECEAF2] bg-white p-3">{PEOPLE.slice(0,3).map((person) => <button key={person.id} className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-[#FAFAF7]"><Avatar name={person.name} status={person.status} lueur={person.id === 'lueur' && lueur}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{person.name}</strong><span className="block truncate text-xs text-[#4A3F6B]">{person.note}</span></span>{person.unread > 0 && <span className="rounded-full bg-[#1A1535] px-2 py-1 text-[11px] font-bold text-white">{person.unread}</span>}</button>)}</aside><section className="rounded-3xl border border-[#ECEAF2] bg-white shadow-[0_12px_36px_rgba(26,21,53,.05)]"><header className="flex items-center justify-between border-b border-[#ECEAF2] p-4"><div className="flex items-center gap-3"><Avatar name="Lueur" status="online" lueur={lueur}/><div><h2 className="font-semibold">Lueur</h2><p className="text-xs text-[#4A3F6B]">Visible par les proches uniquement</p></div></div>{accepted && <button disabled={!allowLueur} onClick={() => setLueur(true)} className={secondary}>Envoyer une Lueur</button>}</header><div className="min-h-[340px] space-y-3 p-5">{!accepted ? <div className="rounded-3xl bg-[#FAFAF7] p-5"><p className="text-sm leading-6">Lueur souhaite entrer dans vos proches. Vous pouvez accepter, ignorer ou bloquer.</p><button onClick={() => setAccepted(true)} className={primary+' mt-4'}>Accepter</button></div> : <><p className="max-w-[70%] rounded-3xl bg-[#FAFAF7] px-4 py-3 text-sm">Bonsoir, je voulais juste échanger tranquillement.</p><p className="ml-auto max-w-[70%] rounded-3xl bg-[#EEEAF6] px-4 py-3 text-sm">Avec plaisir.</p>{lueur && <p className="mx-auto w-fit rounded-full bg-[#FFF8E8] px-4 py-2 text-sm font-semibold text-[#1A1535]">✧ Lueur pense à toi</p>}</>}</div><footer className="border-t border-[#ECEAF2] p-4"><label className="flex items-center gap-2 text-xs text-[#4A3F6B]"><input type="checkbox" checked={allowLueur} onChange={(event) => { setAllowLueur(event.target.checked); if (!event.target.checked) setLueur(false) }} className="accent-[#1A1535]"/> Autoriser les Lueurs de mes proches</label></footer></section></div>
}
function ProfileView({ nickname }) {
  return <section className="rounded-3xl border border-[#ECEAF2] bg-white p-6 shadow-[0_12px_36px_rgba(26,21,53,.05)]"><div className="flex items-center gap-4"><Avatar name={nickname} status="invisible" large/><div><h2 className="font-georgia text-2xl">{nickname}</h2><p className="text-sm text-[#4A3F6B]">Invisible par défaut · Profil réservé aux membres</p><p className="mt-1 text-sm text-[#4A3F6B]">Phrase d’humeur : « Je découvre doucement »</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><button className={secondary}>Statut</button><button className={secondary}>Confidentialité</button><button className={secondary}>Quitter la démo</button></div></section>
}
function RightRail() {
  return <aside className="hidden space-y-4 xl:block"><section className="rounded-3xl border border-[#ECEAF2] bg-white p-4"><h2 className="text-sm font-bold">Mes proches</h2><div className="mt-3 space-y-2">{PEOPLE.map((person) => <div key={person.id} className="flex items-center gap-3"><Avatar name={person.name} status={person.status}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.name}</p><p className="truncate text-xs text-[#4A3F6B]">{person.note}</p></div></div>)}</div></section><section className="rounded-3xl border border-[#ECEAF2] bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#4A3F6B]">Question du soir</p><p className="mt-3 text-sm leading-6 text-[#1A1535]">Qu’est-ce qui vous a donné envie d’explorer la spiritualité ?</p></section></aside>
}
export function ArcheAppPreview({ nickname, onExit }) {
  const [view, setView] = useState('feed')
  const current = useMemo(() => MENU.find((item) => item.id === view) || MENU[0], [view])
  return <div data-arche-app-preview="local-only" className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
    <style>{'@keyframes soft-pop{0%{transform:scale(.92);opacity:.55}100%{transform:scale(1);opacity:1}}.reaction-button[aria-pressed="true"]{animation:soft-pop .24s ease-out}@media(prefers-reduced-motion:reduce){.reaction-button[aria-pressed="true"]{animation:none}}'}</style>
    <header className="sticky top-0 z-30 border-b border-[#ECEAF2] bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#1A1535] font-georgia text-lg text-white">A</span><strong className="font-georgia text-xl tracking-[.04em]">L’ARCHE</strong><span className="rounded-full bg-[#C9A84C] px-2 py-1 text-[11px] font-bold text-[#1A1535]">Démo</span></div><input aria-label="Rechercher un membre ou un Cercle" className="hidden min-h-11 flex-1 rounded-full border border-[#ECEAF2] bg-[#FAFAF7] px-4 text-sm outline-none focus:border-[#4A3F6B] md:block" placeholder="Rechercher un membre ou un Cercle"/><button className={secondary}>🔔 3</button><button onClick={onExit} className={secondary}>Quitter</button></div></header>
    <div className="mx-auto grid max-w-7xl gap-4 px-3 pb-24 pt-4 md:px-5 lg:grid-cols-[220px_minmax(0,680px)_260px] xl:grid-cols-[220px_minmax(0,680px)_280px]">
      <aside className="hidden lg:block"><nav className="sticky top-20 rounded-3xl border border-[#ECEAF2] bg-white p-2">{MENU.map((item) => <button key={item.id} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={'flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-sm '+(view === item.id ? 'bg-[#1A1535] font-semibold text-white' : 'text-[#4A3F6B] hover:bg-[#FAFAF7]')}><span>{item.label}</span>{item.badge > 0 && <span className={view === item.id ? 'rounded-full bg-white px-2 py-1 text-[11px] text-[#1A1535]' : 'rounded-full bg-[#ECEAF2] px-2 py-1 text-[11px] text-[#1A1535]'}>{item.badge}</span>}</button>)}</nav></aside>
      <main className="min-w-0"><div className="mb-3 flex items-center justify-between rounded-3xl border border-[#ECEAF2] bg-white p-3 lg:hidden"><h1 className="font-semibold">{current.label}</h1><span className="text-xs text-[#4A3F6B]">{nickname}</span></div>{view === 'feed' && <FeedView nickname={nickname}/>} {view === 'salon' && <SalonView nickname={nickname}/>} {view === 'cercles' && <CirclesView/>} {view === 'messages' && <MessagesView/>} {view === 'profile' && <ProfileView nickname={nickname}/>}</main>
      <RightRail/>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ECEAF2] bg-white px-2 pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"> <div className="grid grid-cols-5 gap-1">{MENU.map((item) => <button key={item.id} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={'relative min-h-14 rounded-2xl text-[11px] font-semibold '+(view === item.id ? 'bg-[#1A1535] text-white' : 'text-[#4A3F6B]')}>{item.label}{item.badge > 0 && <span className="absolute right-2 top-1 rounded-full bg-[#C9A84C] px-1.5 py-0.5 text-[10px] text-[#1A1535]">{item.badge}</span>}</button>)}</div></nav>
  </div>
}
