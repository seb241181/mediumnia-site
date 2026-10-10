import { useMemo, useState } from 'react'

// Prototype privé : toutes les données ci-dessous sont fictives et locales.
const PEOPLE = [
  { id: 'lueur', name: 'Lueur', status: 'online', note: 'Disponible', unread: 1 },
  { id: 'nuage', name: 'Nuage Bleu', status: 'online', note: 'Dans le Salon', unread: 0 },
  { id: 'plume', name: 'Plume d’Or', status: 'away', note: 'Revient plus tard', unread: 2 },
  { id: 'chemin', name: 'Chemin Libre', status: 'busy', note: 'Préférer lire', unread: 0 },
]
const CIRCLES = [
  { id: 'decouverte', title: 'Les Découvertes', unread: 4, members: '18', description: 'Commencer sans jargon, avec questions simples.' },
  { id: 'intuition', title: 'Intuition', unread: 2, members: '12', description: 'Ressentis, impressions et expériences.' },
  { id: 'reves', title: 'Rêves', unread: 0, members: '9', description: 'Symboles, rêves marquants, questions.' },
  { id: 'questions', title: 'Grandes Questions', unread: 1, members: '15', description: 'Croire, douter, débattre calmement.' },
]
const START_POSTS = [
  { id: 'post-1', author: 'Plume d’Or', circle: 'Les Découvertes', time: 'il y a 2 h', text: 'Peut-on s’intéresser à la spiritualité sans adhérer à une croyance particulière ? J’aimerais lire vos façons de voir.', replies: 3 },
  { id: 'post-2', author: 'Chemin Libre', circle: 'Intuition', time: 'il y a 5 h', text: 'Comment différenciez-vous une intuition d’une émotion ? Je découvre le sujet et je trouve la frontière parfois fine.', replies: 1 },
  { id: 'post-3', author: 'Nuage Bleu', circle: 'Rêves', time: 'hier', text: 'Je garde un carnet de rêves depuis une semaine. C’est fou comme certains détails reviennent quand on relit calmement.', replies: 2 },
]
const LIVE_MESSAGES = [
  { id: 'm1', author: 'Lueur', text: 'Bonsoir, la Veillée commence doucement. Quel sujet vous appelle ce soir ?', time: '20:04' },
  { id: 'm2', author: 'Nuage Bleu', text: 'Les rêves, clairement. J’ai l’impression qu’ils deviennent plus précis.', time: '20:06' },
  { id: 'm3', author: 'Plume d’Or', text: 'Je lis tranquillement pour l’instant, mais je suis là.', time: '20:07' },
]
const MENU = [
  { id: 'feed', label: 'Fil', badge: 0 },
  { id: 'live', label: 'Salon', badge: 5 },
  { id: 'circles', label: 'Cercles', badge: 3 },
  { id: 'messages', label: 'Messages', badge: 2 },
  { id: 'profile', label: 'Moi', badge: 0 },
]
const primary = 'min-h-11 rounded-full bg-[#1A1535] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40'
const softButton = 'min-h-10 rounded-full bg-[#F3EFE6] px-4 py-2 text-xs font-semibold text-[#1A1535] transition hover:bg-[#E8E0CF]'
const inputClass = 'min-h-11 w-full rounded-2xl border border-[#E2D7BE] bg-[#FAFAF7] px-4 py-3 text-sm text-[#1A1535] outline-none transition focus:border-[#C9A84C]'

function initials(name) {
  return (name || 'A').split(' ').map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase()
}
function Presence({ status = 'offline', small = false }) {
  const label = { online: 'Disponible', away: 'Absent', busy: 'Occupé', offline: 'Invisible' }[status] || 'Invisible'
  const shape = status === 'online' ? 'bg-[#C9A84C]' : status === 'away' ? 'bg-[#C9A84C]/60' : status === 'busy' ? 'bg-[#1A1535]' : 'border border-[#C9A84C] bg-[#FAFAF7]'
  return <span title={label} aria-label={label} className={(small ? 'h-2.5 w-2.5' : 'h-3 w-3') + ' inline-flex rounded-full ' + shape} />
}
function Avatar({ name, status, size = 'md' }) {
  const sizeClass = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-9 w-9 text-xs' : 'h-11 w-11 text-sm'
  return <span className="relative inline-flex shrink-0"><span className={sizeClass + ' flex items-center justify-center rounded-full bg-[#1A1535] font-semibold text-[#C9A84C]'}>{initials(name)}</span>{status && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#FAFAF7] p-0.5"><Presence status={status} small /></span>}</span>
}
function Badge({ children }) {
  return <span className="ml-auto rounded-full bg-[#C9A84C] px-2 py-0.5 text-[10px] font-bold text-[#1A1535]">{children}</span>
}

export function ArcheLoginPreview({ onEnter, onBack }) {
  const [mode, setMode] = useState('existing')
  const [pseudo, setPseudo] = useState('Étoile du Nord')
  const [ack, setAck] = useState(false)
  return <div className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
    <header className="border-b border-[#E2D7BE] bg-white/80 px-5 py-4 backdrop-blur md:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><p className="font-georgia text-xl tracking-[.08em]">L’ARCHE</p><button type="button" onClick={onBack} className={softButton}>← Découverte</button></div></header>
    <main id="connexion" className="px-5 py-14 md:px-8 md:py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_420px]">
        <section>
          <p className="mb-4 text-xs font-bold uppercase tracking-[.22em] text-[#9B640B]">Accès membres · simulation</p>
          <h1 className="font-georgia text-4xl leading-tight md:text-6xl">Entrez dans L’Arche.</h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-[#4A3F6B]">Après la page de découverte, les membres arrivent dans une vraie application sociale : fil, salon, cercles, proches et messages.</p>
          <div className="mt-8 flex flex-wrap gap-3 text-xs font-semibold text-[#4A3F6B]"><span className="rounded-full bg-white px-4 py-2 shadow-sm">Compte MediumIA gratuit</span><span className="rounded-full bg-white px-4 py-2 shadow-sm">Profil L’Arche séparé</span><span className="rounded-full bg-white px-4 py-2 shadow-sm">Démo locale</span></div>
        </section>
        <form onSubmit={(event) => { event.preventDefault(); if (pseudo.trim() && ack) onEnter(pseudo.trim()) }} className="rounded-[2rem] border border-[#E2D7BE] bg-white p-6 shadow-[0_24px_70px_rgba(26,21,53,.09)]">
          <div className="mb-6 text-center"><span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1A1535] font-georgia text-2xl text-[#C9A84C]">A</span><h2 className="mt-4 font-georgia text-3xl">Connexion</h2><p className="mt-2 text-xs text-[#4A3F6B]">Aucun vrai identifiant demandé ici.</p></div>
          <div className="mb-5 grid grid-cols-2 gap-2" role="group" aria-label="Parcours d’accès simulé"><button type="button" onClick={() => setMode('existing')} aria-pressed={mode === 'existing'} className={mode === 'existing' ? primary : softButton}>J’ai un compte</button><button type="button" onClick={() => setMode('new')} aria-pressed={mode === 'new'} className={mode === 'new' ? primary : softButton}>Créer</button></div>
          <p className="mb-5 rounded-2xl bg-[#F3EFE6] p-4 text-sm leading-6 text-[#4A3F6B]">{mode === 'existing' ? 'Dans la version réelle, connexion avec le compte MediumIA existant puis adhésion à L’Arche.' : 'Dans la version réelle, création gratuite d’un compte MediumIA puis choix du profil communautaire.'}</p>
          <label className="block text-sm font-semibold">Pseudonyme de démonstration<input autoComplete="off" maxLength={32} required value={pseudo} onChange={(event) => setPseudo(event.target.value)} className={inputClass + ' mt-2'} placeholder="Pseudonyme fictif" /></label>
          <label className="mt-4 flex items-start gap-3 text-xs leading-5 text-[#4A3F6B]"><input required type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-1 h-4 w-4 accent-[#1A1535]" /><span>Je comprends que cette démo ne crée aucun compte et n’envoie aucun message.</span></label>
          <button type="submit" disabled={!ack || !pseudo.trim()} className={primary + ' mt-6 w-full'}>Entrer dans l’application →</button>
        </form>
      </div>
    </main>
  </div>
}

function TopBar({ nickname, onExit, notifications = 3 }) {
  return <header className="sticky top-0 z-30 border-b border-[#E2D7BE] bg-white/95 backdrop-blur">
    <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#1A1535] font-georgia text-xl text-[#C9A84C]">A</span><span className="hidden font-georgia text-xl tracking-[.08em] text-[#1A1535] sm:inline">L’ARCHE</span><span className="rounded-full border border-[#C9A84C] px-2 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#9B640B]">Démo</span></div>
      <label className="relative mx-auto hidden max-w-xl flex-1 md:block"><span className="sr-only">Rechercher un membre ou un Cercle</span><input className="h-11 w-full rounded-full border border-[#E2D7BE] bg-[#FAFAF7] px-5 text-sm outline-none focus:border-[#C9A84C]" placeholder="Rechercher un membre ou un Cercle" /></label>
      <button type="button" className="relative min-h-11 rounded-full bg-[#F3EFE6] px-4 text-sm font-semibold">🔔{notifications > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[#C9A84C] px-1.5 text-[10px]">{notifications}</span>}</button>
      <button type="button" onClick={onExit} className="hidden min-h-11 rounded-full bg-[#F3EFE6] px-4 text-xs font-semibold text-[#1A1535] hover:bg-[#E8E0CF] sm:inline-flex sm:items-center">Quitter la démo</button>
      <div className="flex items-center gap-2 rounded-full bg-[#F3EFE6] px-2 py-1"><Avatar name={nickname} status="offline" size="sm" /><span className="hidden max-w-[120px] truncate text-xs font-semibold sm:inline">{nickname}</span></div>
    </div>
  </header>
}
function Sidebar({ view, setView }) {
  return <aside className="hidden w-[244px] shrink-0 lg:block"><div className="sticky top-20 space-y-5">
    <nav className="rounded-3xl border border-[#E2D7BE] bg-white p-3 shadow-sm" aria-label="Navigation L’Arche">
      {MENU.map((item) => <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={(view === item.id ? 'bg-[#1A1535] text-white' : 'text-[#4A3F6B] hover:bg-[#F3EFE6]') + ' mb-1 flex min-h-11 w-full items-center rounded-2xl px-4 text-left text-sm font-semibold'}><span>{item.label}</span>{item.badge > 0 && <Badge>{item.badge}</Badge>}</button>)}
    </nav>
    <section className="rounded-3xl border border-[#E2D7BE] bg-white p-5 shadow-sm"><p className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[#9B640B]">Mes Cercles</p>{CIRCLES.slice(0, 3).map((circle) => <button key={circle.id} type="button" onClick={() => setView('circles')} className="mb-2 flex w-full items-center rounded-2xl px-3 py-2 text-left text-sm hover:bg-[#F3EFE6]"><span className="truncate">{circle.title}</span>{circle.unread > 0 && <Badge>{circle.unread}</Badge>}</button>)}<button type="button" onClick={() => setView('circles')} className="mt-1 text-xs font-semibold text-[#9B640B]">+ Explorer</button></section>
  </div></aside>
}
function RightRail({ setView }) {
  return <aside className="hidden w-[264px] shrink-0 xl:block"><div className="sticky top-20 space-y-4">
    <section className="rounded-3xl border border-[#E2D7BE] bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#9B640B]">Mes proches</p><button type="button" onClick={() => setView('messages')} className="text-xs font-semibold text-[#1A1535]">Voir</button></div>{PEOPLE.map((person) => <button key={person.id} type="button" onClick={() => setView('messages')} className="mb-3 flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-[#F3EFE6]"><Avatar name={person.name} status={person.status} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.name}</span><span className="block truncate text-xs text-[#4A3F6B]">{person.note}</span></span>{person.unread > 0 && <Badge>{person.unread}</Badge>}</button>)}</section>
    <section className="rounded-3xl border border-[#E2D7BE] bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#9B640B]">Grand Salon</p><div className="mt-3 flex -space-x-2">{PEOPLE.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} status={p.status} size="sm" />)}</div><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">5 présents · Veillée douce</p><button type="button" onClick={() => setView('live')} className={softButton + ' mt-3 w-full'}>Rejoindre</button></section>
    <section className="rounded-3xl bg-[#1A1535] p-5 text-[#FAFAF7]"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#C9A84C]">Question du soir</p><p className="mt-3 font-georgia text-lg leading-7">Qu’est-ce qui a éveillé votre curiosité spirituelle ?</p></section>
  </div></aside>
}
function MobileTabs({ view, setView }) {
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E2D7BE] bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden" aria-label="Navigation mobile L’Arche"><div className="grid grid-cols-5">{MENU.map((item) => <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={(view === item.id ? 'text-[#1A1535]' : 'text-[#4A3F6B]') + ' relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold'}><span className={(view === item.id ? 'bg-[#1A1535]' : 'bg-[#E8E0CF]') + ' h-1.5 w-1.5 rounded-full'} />{item.label}{item.badge > 0 && <span className="absolute right-4 top-1 rounded-full bg-[#C9A84C] px-1.5 text-[10px] text-[#1A1535]">{item.badge}</span>}</button>)}</div></nav>
}
function PeopleStrip({ setView }) {
  return <div className="mb-4 overflow-x-auto rounded-3xl border border-[#E2D7BE] bg-white p-3 shadow-sm lg:hidden"><div className="flex min-w-max gap-4">{PEOPLE.map((person) => <button key={person.id} type="button" onClick={() => setView('messages')} className="flex w-16 flex-col items-center gap-2 text-center text-[11px]"><Avatar name={person.name} status={person.status} /><span className="line-clamp-1">{person.name}</span></button>)}</div></div>
}

function Composer({ nickname, draft, setDraft, onSubmit }) {
  return <form onSubmit={onSubmit} className="rounded-3xl border border-[#E2D7BE] bg-white p-4 shadow-sm"><div className="flex gap-3"><Avatar name={nickname} status="offline" /><div className="min-w-0 flex-1"><label htmlFor="arche-feed-composer" className="sr-only">Partager quelque chose</label><textarea id="arche-feed-composer" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={420} placeholder="Partager quelque chose…" className="w-full resize-none rounded-2xl border border-[#E2D7BE] bg-[#FAFAF7] px-4 py-3 text-sm outline-none focus:border-[#C9A84C]" /><div className="mt-3 flex items-center justify-between"><select aria-label="Choisir un Cercle" className="rounded-full border border-[#E2D7BE] bg-white px-3 py-2 text-xs"><option>Le Fil de L’Arche</option><option>Les Découvertes</option><option>Intuition</option></select><button type="submit" disabled={!draft.trim()} className={primary}>Publier</button></div></div></div></form>
}
function PostCard({ post, liked, onLike, onReply, replyOpen, replyDraft, setReplyDraft, addReply, replies, setNotice }) {
  return <article className="rounded-3xl border border-[#E2D7BE] bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><Avatar name={post.author} status={post.author === 'Plume d’Or' ? 'away' : 'online'} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2"><strong className="text-sm">{post.author}</strong><span className="text-xs text-[#4A3F6B]">· {post.circle}</span><span className="text-xs text-[#4A3F6B]">· {post.time || 'à l’instant'}</span></div><p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-[#1A1535]">{post.text}</p></div><button type="button" onClick={() => setNotice('Menu de modération fictif : Masquer, Signaler, Bloquer.')} className="min-h-10 rounded-full px-3 text-xl leading-none text-[#4A3F6B] hover:bg-[#F3EFE6]" aria-label="Menu de publication">…</button></div><div className="mt-4 flex flex-wrap gap-2 border-t border-[#E2D7BE] pt-3"><button type="button" onClick={onLike} aria-pressed={liked} className={softButton}>{liked ? 'Merci envoyé' : 'Merci'}</button><button type="button" className={softButton}>Je te comprends</button><button type="button" onClick={onReply} className={softButton}>Répondre · {post.replies + replies.length}</button></div>{(post.replies > 0 || replies.length > 0) && <button type="button" onClick={onReply} className="mt-3 text-xs font-semibold text-[#9B640B]">Voir les {post.replies + replies.length} réponses</button>}{replyOpen && <form onSubmit={addReply} className="mt-3 flex gap-2"><label className="sr-only" htmlFor={'reply-' + post.id}>Réponse</label><input id={'reply-' + post.id} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} maxLength={240} placeholder="Votre réponse…" className={inputClass} /><button type="submit" disabled={!replyDraft.trim()} className={primary}>OK</button></form>}{replies.map((reply, index) => <p key={index} className="mt-3 rounded-2xl bg-[#F3EFE6] px-4 py-3 text-sm"><strong>Vous :</strong> {reply}</p>)}</article>
}

function FeedView({ nickname, posts, setPosts, notice, setNotice }) {
  const [draft, setDraft] = useState('')
  const [liked, setLiked] = useState([])
  const [replyOpen, setReplyOpen] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [replies, setReplies] = useState({})
  function publish(event) { event.preventDefault(); const text = draft.trim(); if (!text) return; setPosts((items) => [{ id: 'local-' + Date.now(), author: nickname, circle: 'Le Fil', time: 'à l’instant', text, replies: 0 }, ...items]); setDraft(''); setNotice('Publication ajoutée à la démo locale.') }
  function addReply(event, postId) { event.preventDefault(); const text = replyDraft.trim(); if (!text) return; setReplies((old) => ({ ...old, [postId]: [...(old[postId] || []), text] })); setReplyDraft('') }
  return <section className="mx-auto max-w-[680px] space-y-4"><PeopleStrip setView={() => {}} />{notice && <p role="status" className="rounded-2xl border border-[#C9A84C] bg-[#F3EFE6] p-3 text-xs text-[#1A1535]">{notice}</p>}<Composer nickname={nickname} draft={draft} setDraft={setDraft} onSubmit={publish} />{posts.map((post) => <PostCard key={post.id} post={post} liked={liked.includes(post.id)} onLike={() => setLiked((items) => items.includes(post.id) ? items.filter((id) => id !== post.id) : [...items, post.id])} onReply={() => setReplyOpen(replyOpen === post.id ? '' : post.id)} replyOpen={replyOpen === post.id} replyDraft={replyDraft} setReplyDraft={setReplyDraft} addReply={(event) => addReply(event, post.id)} replies={replies[post.id] || []} setNotice={setNotice} />)}</section>
}
function LiveView({ nickname, chat, setChat }) {
  const [draft, setDraft] = useState('')
  function send(event) { event.preventDefault(); const text = draft.trim(); if (!text) return; setChat((items) => [...items.slice(-14), { id: 'live-' + Date.now(), author: nickname, text, time: 'maintenant' }]); setDraft('') }
  return <section className="mx-auto max-w-[760px] overflow-hidden rounded-3xl border border-[#E2D7BE] bg-white shadow-sm"><header className="flex items-center justify-between border-b border-[#E2D7BE] bg-[#F3EFE6] p-4"><div><h2 className="font-georgia text-2xl">Le Grand Salon</h2><p className="text-xs text-[#4A3F6B]">5 présents · Lueur écrit…</p></div><div className="flex -space-x-2">{PEOPLE.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} status={p.status} size="sm" />)}</div></header><div className="max-h-[62vh] min-h-[420px] space-y-4 overflow-y-auto p-4" aria-live="polite">{chat.map((message) => <div key={message.id} className="flex gap-3"><Avatar name={message.author} status="online" size="sm" /><div className="min-w-0 flex-1 rounded-3xl bg-[#FAFAF7] px-4 py-3"><div className="flex items-center gap-2"><strong className="text-xs">{message.author}</strong><span className="text-[11px] text-[#4A3F6B]">{message.time}</span></div><p className="mt-1 break-words text-sm leading-6">{message.text}</p></div></div>)}</div><form onSubmit={send} className="flex gap-2 border-t border-[#E2D7BE] p-4"><label htmlFor="arche-live-message" className="sr-only">Message du Salon</label><input id="arche-live-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={240} className={inputClass} placeholder="Écrire au Grand Salon…" /><button type="submit" disabled={!draft.trim()} className={primary}>Envoyer</button></form></section>
}
function CirclesView() {
  return <section className="mx-auto max-w-[900px]"><div className="mb-4 grid gap-3 sm:grid-cols-2">{CIRCLES.map((circle) => <article key={circle.id} className="rounded-3xl border border-[#E2D7BE] bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#9B640B]">{circle.members} membres</p><h2 className="mt-2 font-georgia text-2xl">{circle.title}</h2></div>{circle.unread > 0 && <Badge>{circle.unread}</Badge>}</div><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">{circle.description}</p><button type="button" className={softButton + ' mt-4'}>Ouvrir le Cercle</button></article>)}</div><div className="rounded-3xl border border-dashed border-[#C9A84C] bg-[#F3EFE6] p-5"><p className="font-georgia text-xl">Proposer un Cercle</p><p className="mt-2 text-sm text-[#4A3F6B]">Dans la version réelle, une proposition sera relue avant d’être ouverte.</p></div></section>
}
function MessagesView({ nickname, setNotice }) {
  const [selected, setSelected] = useState('lueur')
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState('')
  const [thread, setThread] = useState([{ id: 't1', from: 'Lueur', text: 'Bonsoir, j’ai vu votre réponse dans le Fil. On peut échanger sur les rêves ?' }])
  const [allowGlow, setAllowGlow] = useState(false)
  const [glow, setGlow] = useState(false)
  const [lastGlow, setLastGlow] = useState(0)
  const person = PEOPLE.find((p) => p.id === selected) || PEOPLE[0]
  function send(event) { event.preventDefault(); const text = message.trim(); if (!text || !accepted) return; setThread((items) => [...items, { id: 'local-' + Date.now(), from: nickname, text }]); setMessage('') }
  function sendGlow() { if (!allowGlow || !accepted || Date.now() - lastGlow < 10000) return; setGlow(true); setLastGlow(Date.now()); let vibration = false; try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') vibration = navigator.vibrate([80, 45, 80]) } catch { vibration = false } setNotice(vibration ? 'Lueur envoyée : vibration demandée au navigateur.' : 'Lueur envoyée : animation visible, vibration non disponible ici.') }
  return <section className="mx-auto grid max-w-[980px] overflow-hidden rounded-3xl border border-[#E2D7BE] bg-white shadow-sm md:grid-cols-[280px_minmax(0,1fr)]"><aside className="border-b border-[#E2D7BE] bg-[#FAFAF7] p-3 md:border-b-0 md:border-r"><p className="px-3 py-2 text-xs font-bold uppercase tracking-[.14em] text-[#9B640B]">Demandes</p><button type="button" onClick={() => setSelected('lueur')} className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm"><Avatar name="Lueur" status="online" /><span className="min-w-0 flex-1"><strong className="block text-sm">Lueur</strong><span className="block truncate text-xs text-[#4A3F6B]">Demande de contact</span></span><Badge>1</Badge></button><p className="px-3 py-2 text-xs font-bold uppercase tracking-[.14em] text-[#9B640B]">Conversations</p>{PEOPLE.slice(1).map((p) => <button key={p.id} type="button" onClick={() => setSelected(p.id)} className="mb-1 flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-white"><Avatar name={p.name} status={p.status} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{p.name}</strong><span className="block truncate text-xs text-[#4A3F6B]">Aucun message réel</span></span>{p.unread > 0 && <Badge>{p.unread}</Badge>}</button>)}</aside><div className="flex min-h-[560px] flex-col"><header className="flex items-center justify-between border-b border-[#E2D7BE] p-4"><div className="flex items-center gap-3"><Avatar name={person.name} status={person.status} /><div><h2 className="font-semibold">{person.name}</h2><p className="text-xs text-[#4A3F6B]">{person.note}</p></div></div>{accepted && <button type="button" onClick={sendGlow} disabled={!allowGlow} className={softButton}>Lueur ✧</button>}</header>{!accepted ? <div className="m-auto max-w-sm p-6 text-center"><p className="font-georgia text-2xl">Nouvelle demande</p><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">La conversation privée commence seulement si vous acceptez cette invitation.</p><div className="mt-6 flex justify-center gap-2"><button type="button" onClick={() => setAccepted(true)} className={primary}>Accepter</button><button type="button" onClick={() => setNotice('Demande ignorée dans la démo.')} className={softButton}>Ignorer</button></div></div> : <><div className="flex-1 space-y-3 overflow-y-auto bg-[#FAFAF7] p-4">{thread.map((item) => <p key={item.id} className={(item.from === nickname ? 'ml-auto bg-[#1A1535] text-white' : 'mr-auto bg-white text-[#1A1535]') + ' max-w-[78%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm'}><strong className="block text-[11px] opacity-70">{item.from}</strong>{item.text}</p>)}{glow && <p key={lastGlow} role="status" className="arche-glow mx-auto rounded-full border border-[#C9A84C] bg-white px-5 py-3 text-center font-georgia text-[#9B640B]">✧ Lueur pense à toi</p>}</div><div className="border-t border-[#E2D7BE] bg-white p-4"><label className="mb-3 flex items-center gap-2 text-xs text-[#4A3F6B]"><input type="checkbox" checked={allowGlow} onChange={(event) => { setAllowGlow(event.target.checked); setGlow(false) }} className="accent-[#1A1535]" /> Autoriser les Lueurs de mes proches</label><form onSubmit={send} className="flex gap-2"><label className="sr-only" htmlFor="arche-private-message">Message privé fictif</label><input id="arche-private-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={240} className={inputClass} placeholder="Votre message…" /><button type="submit" disabled={!message.trim()} className={primary}>Envoyer</button></form></div></>}</div></section>
}
function ProfileView({ nickname, onExit }) {
  const [presence, setPresence] = useState('offline')
  return <section className="mx-auto max-w-[760px] rounded-3xl border border-[#E2D7BE] bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center gap-5"><Avatar name={nickname} status={presence} size="lg" /><div><h2 className="font-georgia text-3xl">{nickname}</h2><p className="text-sm text-[#4A3F6B]">Fiche visible uniquement par les membres de L’Arche.</p></div></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Présence<select value={presence} onChange={(event) => setPresence(event.target.value)} className={inputClass + ' mt-2'}><option value="offline">Invisible par défaut</option><option value="online">Disponible</option><option value="away">Absent</option><option value="busy">Occupé</option></select></label><div className="rounded-3xl bg-[#F3EFE6] p-5 text-sm leading-6 text-[#4A3F6B]"><strong className="text-[#1A1535]">Confidentialité</strong><br />Pas de dernière activité publique, pas de liste de proches visible par les autres.</div></div><div className="mt-6 flex flex-wrap gap-3"><button type="button" className={softButton}>Gérer mes blocages</button><button type="button" className={softButton}>Aide et sécurité</button><button type="button" onClick={onExit} className={primary}>Quitter la démo</button></div></section>
}

export function ArcheAppPreview({ nickname, onExit }) {
  const [view, setView] = useState('feed')
  const [posts, setPosts] = useState(START_POSTS)
  const [chat, setChat] = useState(LIVE_MESSAGES)
  const [notice, setNotice] = useState('')
  const content = useMemo(() => {
    if (view === 'live') return <LiveView nickname={nickname} chat={chat} setChat={setChat} />
    if (view === 'circles') return <CirclesView />
    if (view === 'messages') return <MessagesView nickname={nickname} setNotice={setNotice} />
    if (view === 'profile') return <ProfileView nickname={nickname} onExit={onExit} />
    return <FeedView nickname={nickname} posts={posts} setPosts={setPosts} notice={notice} setNotice={setNotice} />
  }, [view, nickname, posts, chat, notice, onExit])
  return <div data-arche-app-preview="social-shell" className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
    <style>{'@keyframes arche-glow{0%,100%{box-shadow:0 0 0 rgba(201,168,76,0);transform:scale(1)}50%{box-shadow:0 0 28px rgba(201,168,76,.65);transform:scale(1.02)}}.arche-glow{animation:arche-glow .85s ease-in-out}@media(prefers-reduced-motion:reduce){.arche-glow{animation:none}}'}</style>
    <TopBar nickname={nickname} onExit={onExit} />
    <div className="mx-auto flex max-w-[1400px] gap-5 px-3 pb-24 pt-5 sm:px-5 lg:pb-8"><Sidebar view={view} setView={setView} /><main className="min-w-0 flex-1"><PeopleStrip setView={setView} />{notice && view !== 'feed' && <p role="status" className="mx-auto mb-4 max-w-[760px] rounded-2xl border border-[#C9A84C] bg-[#F3EFE6] p-3 text-xs text-[#1A1535]">{notice}</p>}{content}</main><RightRail setView={setView} /></div>
    <MobileTabs view={view} setView={setView} />
  </div>
}
