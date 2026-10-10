import { useState } from 'react'

// Maquette uniquement : aucune connexion, publication ou notification réelle.
const CIRCLES = [
  { id: 'decouverte', title: 'Les Découvertes', description: 'Pour commencer, poser des questions et rencontrer les autres.' },
  { id: 'intuition', title: 'Intuition & ressentis', description: 'Partager des impressions et des expériences personnelles.' },
  { id: 'reves', title: 'Rêves & symboles', description: 'Explorer des interprétations, sans certitudes imposées.' },
  { id: 'questions', title: 'Les Grandes Questions', description: 'Un dialogue entre curieux, croyants et sceptiques.' },
]
const EXAMPLE_POSTS = [
  { id: 'p1', author: 'Plume d’Or', circle: 'Les Découvertes', text: 'Peut-on s’intéresser à la spiritualité sans avoir de croyance particulière ? Je suis curieuse de connaître vos avis.' },
  { id: 'p2', author: 'Chemin Libre', circle: 'Intuition & ressentis', text: 'Comment différenciez-vous une intuition d’une émotion ? J’aimerais mieux comprendre.' },
]
const EXAMPLE_CHAT = [
  { id: 'c1', author: 'Lueur', text: 'Bonsoir à tous ! Vous aimeriez discuter de quel sujet ?' },
  { id: 'c2', author: 'Nuage Bleu', text: 'Des rêves ! Je viens de découvrir le Cercle qui en parle.' },
]
const MENU = [
  { id: 'feed', title: 'Le Fil' },
  { id: 'live', title: 'Grand Salon' },
  { id: 'circles', title: 'Les Cercles' },
  { id: 'messages', title: 'Rencontres' },
  { id: 'profile', title: 'Mon profil' },
]
const primary = 'min-h-11 rounded-lg bg-[#1A1535] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'min-h-11 rounded-lg border border-[#E2D7BE] bg-white px-4 py-3 text-sm font-semibold text-[#1A1535] hover:bg-[#F3EFE6]'
const field = 'min-h-11 w-full rounded-lg border border-[#D9D1C0] bg-[#FAFAF7] px-3 py-3 text-sm text-[#1A1535] outline-none focus:border-[#C9A84C]'
function Initial({ name, big=false }) {
  return <span aria-hidden="true" className={'flex shrink-0 items-center justify-center rounded-xl border border-[#C9A84C] bg-[#F3EFE6] font-georgia text-[#1A1535] '+(big?'h-16 w-16 text-2xl':'h-10 w-10 text-lg')}>{name?.charAt(0).toUpperCase()||'A'}</span>
}
function Heading({ label, title, description }) {
  return <div className="mb-6"><p className="mb-2 text-[11px] font-bold uppercase tracking-[.19em] text-[#9B640B]">{label}</p><h2 className="font-georgia text-3xl text-[#1A1535]">{title}</h2><p className="mt-2 text-sm leading-6 text-[#4A3F6B]">{description}</p></div>
}
export function ArcheLoginPreview({ onEnter, onBack }) {
  const [mode,setMode]=useState('existing')
  const [pseudo,setPseudo]=useState('Étoile du Nord')
  const [ack,setAck]=useState(false)
  return <div className="min-h-screen bg-[#FAFAF7]">
    <header className="border-b border-[#E2D7BE] px-5 py-4 md:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><p className="font-georgia text-xl text-[#1A1535]">L’ARCHE</p><button type="button" onClick={onBack} className={secondary}>← Revenir à la découverte</button></div></header>
    <section id="connexion" className="px-5 py-20 md:px-8">
    <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
      <div>
        <p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-[#9B640B]">Après la découverte, la communauté</p>
        <h2 className="font-georgia text-4xl leading-tight text-[#1A1535] md:text-5xl">Entrez dans L’Arche.<br/><em>Faites comme chez vous.</em></h2>
        <p className="mt-6 max-w-xl text-base leading-8 text-[#4A3F6B]">Une page de connexion, puis une application complète : votre fil de publications, les Cercles, le Grand Salon façon messagerie et vos contacts.</p>
        <div className="mt-6 space-y-3 text-sm leading-6 text-[#4A3F6B]"><p>• Un compte MediumIA gratuit, pour tout l’écosystème.</p><p>• Une fiche L’Arche séparée et visible uniquement par les membres.</p><p>• Pas de démarchage, ni d’obligation de publier.</p></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#E2D7BE] bg-white shadow-[0_18px_45px_rgba(26,21,53,.08)]">
        <div className="bg-[#1A1535] p-7 text-center text-white"><p className="text-xs font-semibold uppercase tracking-[.24em] text-[#C9A84C]">L’ARCHE · ACCÈS MEMBRES</p><h3 className="mt-3 font-georgia text-3xl">Bienvenue chez vous.</h3><p className="mt-2 text-sm text-[#E2D7BE]">Aperçu de la future connexion</p></div>
        <form onSubmit={event=>{event.preventDefault();if(pseudo.trim()&&ack)onEnter(pseudo.trim())}} className="space-y-5 p-6 sm:p-7">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Type de compte envisagé"><button type="button" className={mode==='existing'?primary:secondary} aria-pressed={mode==='existing'} onClick={()=>setMode('existing')}>J’ai un compte</button><button type="button" className={mode==='new'?primary:secondary} aria-pressed={mode==='new'} onClick={()=>setMode('new')}>Créer un compte</button></div>
          <p className="text-sm leading-6 text-[#4A3F6B]">{mode==='existing'?'Le compte MediumIA existant donnera accès à L’Arche après adhésion.':'Un nouveau compte MediumIA sera gratuit, puis l’adhésion à L’Arche restera facultative.'}</p>
          <label className="block text-sm font-semibold">Votre pseudonyme de démonstration<input autoComplete="off" maxLength={32} required value={pseudo} onChange={event=>setPseudo(event.target.value)} className={'mt-2 '+field} placeholder="Pseudonyme fictif"/></label>
          <label className="flex items-start gap-3 text-xs leading-5 text-[#4A3F6B]"><input required type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)} className="mt-1 h-4 w-4 accent-[#1A1535]"/><span>Je comprends que cet accès est une simulation locale : aucun compte n’est créé, aucun message n’est envoyé.</span></label>
          <button type="submit" disabled={!ack||!pseudo.trim()} className={primary+' w-full'}>Entrer dans l’application de démo →</button>
          <p className="text-center text-xs leading-5 text-[#4A3F6B]">Ne saisissez aucun vrai mot de passe ici. L’authentification sécurisée sera développée et testée séparément.</p>
        </form>
      </div>
    </div>
    </section>
  </div>
}
export function ArcheAppPreview({ nickname, onExit }) {
  const [view,setView]=useState('feed')
  const [posts,setPosts]=useState(EXAMPLE_POSTS)
  const [draft,setDraft]=useState('')
  const [likes,setLikes]=useState([])
  const [replyId,setReplyId]=useState('')
  const [replyDraft,setReplyDraft]=useState('')
  const [replies,setReplies]=useState({})
  const [chat,setChat]=useState(EXAMPLE_CHAT)
  const [chatDraft,setChatDraft]=useState('')
  const [circle,setCircle]=useState('decouverte')
  const [joined,setJoined]=useState(['decouverte'])
  const [contact,setContact]=useState('request')
  const [dm,setDm]=useState([])
  const [dmDraft,setDmDraft]=useState('')
  const [allowToc,setAllowToc]=useState(false)
  const [toc,setToc]=useState(false)
  const [lastToc,setLastToc]=useState(0)
  const [presence,setPresence]=useState('invisible')
  const [notice,setNotice]=useState('')
  const open=id=>{setView(id);setNotice('')}
  const submitPost=event=>{event.preventDefault();if(!draft.trim())return;setPosts(x=>[{id:'local-'+Date.now(),author:nickname,circle:'Le Fil',text:draft.trim()},...x]);setDraft('');setNotice('Votre publication est visible seulement dans cette démonstration.')}
  const submitChat=event=>{event.preventDefault();if(!chatDraft.trim())return;setChat(x=>[...x.slice(-12),{id:'local-'+Date.now(),author:nickname,text:chatDraft.trim()}]);setChatDraft('')}
  const submitDm=event=>{event.preventDefault();if(contact!=='accepted'||!dmDraft.trim())return;setDm(x=>[...x,{id:'dm-'+Date.now(),text:dmDraft.trim()}]);setDmDraft('')}
  function poke(){
    if(!allowToc||contact!=='accepted'||Date.now()-lastToc<10000)return
    setLastToc(Date.now());setToc(true)
    let vibration=false
    try{if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function')vibration=navigator.vibrate([90,45,90])}catch{vibration=false}
    setNotice(vibration?'Toc toc simulé : demande de vibration acceptée par le navigateur.':'Toc toc simulé : animation visible, mais vibration non disponible sur ce navigateur.')
  }
  return <div data-arche-app-preview="local-only" className="min-h-screen bg-[#FAFAF7] text-[#1A1535]">
    <style>{'@keyframes arche-poke{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}.arche-poke{animation:arche-poke .6s ease-in-out}@media(prefers-reduced-motion:reduce){.arche-poke{animation:none}}'}</style>
    <div role="status" className="bg-[#C9A84C] px-4 py-2 text-center text-[11px] font-semibold text-[#1A1535]">APPLICATION DE DÉMONSTRATION — aucun vrai membre, aucune donnée enregistrée ou envoyée</div>
    <header className="sticky top-0 z-10 border-b border-[#E2D7BE] bg-[#FAFAF7]"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1A1535] font-georgia text-xl text-[#C9A84C]">A</span><div><h1 className="font-georgia text-xl">L’ARCHE</h1><p className="text-[10px] uppercase tracking-widest text-[#4A3F6B]">La communauté</p></div></div><button type="button" onClick={onExit} className={secondary}>← Retour à la découverte</button></div></header>
    <div className="mx-auto grid max-w-7xl gap-5 px-3 pb-20 pt-6 sm:px-5 lg:grid-cols-[210px_minmax(0,1fr)_220px]">
      <aside className="hidden self-start lg:sticky lg:top-24 lg:block"><div className="space-y-1 rounded-xl border border-[#E2D7BE] bg-white p-3">{MENU.map(item=><button key={item.id} type="button" aria-current={view===item.id?'page':undefined} onClick={()=>open(item.id)} className={'min-h-11 w-full rounded-lg px-4 py-3 text-left text-sm '+(view===item.id?'bg-[#1A1535] font-semibold text-white':'text-[#4A3F6B] hover:bg-[#F3EFE6]')}>{item.title}</button>)}</div><div className="mt-4 rounded-xl bg-[#1A1535] p-5 text-xs leading-6 text-[#FAFAF7]"><p className="font-georgia text-lg">Un espace libre.</p><p className="mt-2 text-[#E2D7BE]">Aucune hiérarchie de l’éveil, pas de pression pour publier et aucun démarchage.</p></div></aside>
      <main className="min-w-0">
        <nav className="mb-5 grid grid-cols-5 gap-1 rounded-xl border border-[#E2D7BE] bg-white p-1 lg:hidden" aria-label="Menu de l’application">{MENU.map(item=><button type="button" key={item.id} aria-current={view===item.id?'page':undefined} onClick={()=>open(item.id)} className={'min-h-14 rounded-lg px-1 text-center text-[10px] leading-tight '+(view===item.id?'bg-[#1A1535] text-white':'text-[#4A3F6B]')}>{item.id==='messages'?'Messages':item.id==='profile'?'Profil':item.id==='live'?'Salon':item.id==='circles'?'Cercles':'Fil'}</button>)}</nav>
        {notice&&<p role="status" className="mb-4 rounded-lg border border-[#C9A84C] bg-[#F3EFE6] p-3 text-xs">{notice}</p>}
        {view==='feed'&&<><Heading label="La communauté" title="Le Fil" description="Partagez à votre rythme. Les publications et réactions suivantes sont entièrement fictives."/><form onSubmit={submitPost} className="mb-5 rounded-xl border border-[#E2D7BE] bg-white p-5"><div className="mb-3 flex items-center gap-3"><Initial name={nickname}/><strong className="text-sm">{nickname}</strong><span className="ml-auto text-xs text-[#4A3F6B]">Membres seulement</span></div><label className="sr-only" htmlFor="arche-post-draft">Écrire une publication de démo</label><textarea id="arche-post-draft" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={420} rows={3} placeholder="Qu’aimeriez-vous partager ?" className={field}/><div className="mt-3 text-right"><button type="submit" disabled={!draft.trim()} className={primary}>Publier dans la démo</button></div></form><div className="space-y-4">{posts.map(p=><article key={p.id} className="rounded-xl border border-[#E2D7BE] bg-white p-5"><div className="flex items-center gap-3"><Initial name={p.author}/><div className="flex-1"><strong className="text-sm">{p.author}</strong><p className="text-xs text-[#4A3F6B]">{p.circle} · Exemple fictif</p></div><button type="button" onClick={()=>setNotice('Signalement fictif : la modération réelle sera activée seulement après tests.')} className="text-xs text-[#4A3F6B] underline">Signaler</button></div><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{p.text}</p><div className="mt-4 flex gap-5 border-t border-[#E2D7BE] pt-4"><button type="button" className="min-h-11 text-xs font-semibold" aria-pressed={likes.includes(p.id)} onClick={()=>setLikes(v=>v.includes(p.id)?v.filter(x=>x!==p.id):[...v,p.id])}>{likes.includes(p.id)?'Merci envoyé':'Merci'}</button><button type="button" className="min-h-11 text-xs font-semibold" onClick={()=>setReplyId(replyId===p.id?'':p.id)}>Répondre</button></div>{(replies[p.id]||[]).map((text,i)=><p key={i} className="mt-2 rounded-lg bg-[#F3EFE6] p-3 text-xs"><strong>{nickname} :</strong> {text}</p>)}{replyId===p.id&&<form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();if(!replyDraft.trim())return;setReplies(x=>({...x,[p.id]:[...(x[p.id]||[]),replyDraft.trim()]}));setReplyDraft('');setReplyId('')}}><label className="sr-only" htmlFor={'arche-reply-'+p.id}>Réponse fictive</label><input id={'arche-reply-'+p.id} maxLength={240} value={replyDraft} onChange={e=>setReplyDraft(e.target.value)} className={field} placeholder="Votre réponse..."/><button type="submit" disabled={!replyDraft.trim()} className={primary}>Répondre</button></form>}</article>)}</div></>}
        {view==='live'&&<><Heading label="Un moment ensemble" title="Le Grand Salon" description="Un chat commun pour discuter spontanément. Aucun message n’est envoyé à de véritables membres."/><div className="overflow-hidden rounded-xl border border-[#E2D7BE] bg-white"><div className="flex justify-between bg-[#F3EFE6] p-4"><strong>Salon commun</strong><span className="text-xs text-[#4A3F6B]">Simulation locale</span></div><div aria-live="polite" className="max-h-[430px] min-h-[300px] space-y-4 overflow-y-auto p-4">{chat.map(m=><div key={m.id} className="flex items-start gap-3"><Initial name={m.author}/><div className="min-w-0 flex-1 rounded-lg bg-[#FAFAF7] p-3"><strong className="text-xs">{m.author}</strong><p className="mt-2 break-words text-sm leading-6">{m.text}</p></div></div>)}</div><form onSubmit={submitChat} className="flex gap-2 border-t border-[#E2D7BE] p-4"><label htmlFor="arche-chat-draft" className="sr-only">Message de salon fictif</label><input id="arche-chat-draft" maxLength={240} value={chatDraft} onChange={e=>setChatDraft(e.target.value)} className={field} placeholder="Écrire dans le salon..."/><button type="submit" disabled={!chatDraft.trim()} className={primary}>Envoyer</button></form></div><p className="mt-3 text-xs text-[#4A3F6B]">Le salon réel sera modéré et ouvert progressivement, après les tests et ton GO.</p></>}
        {view==='circles'&&<><Heading label="Vos centres d’intérêt" title="Les Cercles" description="Découvrez les thèmes qui vous attirent, sans obligation d’y participer."/><div className="grid gap-3 sm:grid-cols-2">{CIRCLES.map(c=><button type="button" key={c.id} onClick={()=>setCircle(c.id)} aria-pressed={circle===c.id} className={'rounded-xl border p-5 text-left '+(circle===c.id?'border-[#C9A84C] bg-[#F3EFE6]':'border-[#E2D7BE] bg-white')}><p className="font-georgia text-xl">{c.title}</p><p className="mt-3 text-xs leading-6 text-[#4A3F6B]">{c.description}</p></button>)}</div><div className="mt-5 rounded-xl border border-[#E2D7BE] bg-white p-5"><p className="text-xs text-[#9B640B]">Cercle sélectionné</p><h3 className="mt-2 font-georgia text-2xl">{CIRCLES.find(c=>c.id===circle)?.title}</h3><p className="mt-3 text-sm leading-6 text-[#4A3F6B]">Les membres pourront proposer d’autres Cercles à valider par l’équipe.</p><button type="button" className={primary+' mt-4'} onClick={()=>setJoined(x=>x.includes(circle)?x.filter(v=>v!==circle):[...x,circle])}>{joined.includes(circle)?'Quitter ce Cercle (démo)':'Rejoindre ce Cercle (démo)'}</button></div></>}
        {view==='messages'&&<><Heading label="Les échanges à deux" title="Mes Rencontres" description="Les messages privés commenceront uniquement après acceptation d’une invitation. Ils resteront fermés pendant le premier pilote."/><div className="overflow-hidden rounded-xl border border-[#E2D7BE] bg-white"><div className="flex items-center gap-3 bg-[#F3EFE6] p-4"><Initial name="Étoile du Nord"/><div><strong>Étoile du Nord</strong><p className="text-xs text-[#4A3F6B]">Personne fictive · Intérêt pour les rêves</p></div></div><div className="p-5">{contact==='request'&&<><p className="text-sm leading-6">Cette personne souhaite discuter avec vous. Acceptez, ignorez ou bloquez, sans avoir à vous justifier.</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>setContact('accepted')} className={primary}>Accepter</button><button onClick={()=>setContact('ignored')} className={secondary}>Ignorer</button><button onClick={()=>setContact('blocked')} className={secondary}>Bloquer</button></div></>}{contact==='accepted'&&<><div className="min-h-24 rounded-lg bg-[#FAFAF7] p-4"><p className="text-sm"><strong>Étoile du Nord :</strong> Bonjour ! J’aimerais échanger au sujet des rêves, si vous en avez envie.</p>{dm.map(m=><p key={m.id} className="mt-3 text-sm"><strong>{nickname} :</strong> {m.text}</p>)}</div><form onSubmit={submitDm} className="mt-3 flex gap-2"><label className="sr-only" htmlFor="arche-dm-sample">Message privé fictif</label><input id="arche-dm-sample" maxLength={240} value={dmDraft} onChange={e=>setDmDraft(e.target.value)} className={field} placeholder="Votre réponse..."/><button type="submit" disabled={!dmDraft.trim()} className={primary}>Envoyer</button></form><div className="mt-6 rounded-lg border border-[#C9A84C] bg-[#FAFAF7] p-5"><h3 className="font-georgia text-xl">Toc toc !</h3><p className="mt-2 text-xs leading-6 text-[#4A3F6B]">Notre clin d’œil aux messageries de jeunesse, avec un effet original et discret.</p><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={allowToc} onChange={e=>{setAllowToc(e.target.checked);setToc(false)}} className="accent-[#1A1535]"/> Autoriser les petits signaux de mes contacts</label>{toc&&<div key={lastToc} role="status" className="arche-poke mt-4 rounded-lg border border-[#C9A84C] bg-white p-4 text-center font-georgia">Toc toc ! Une pensée pour toi.</div>}<div className="mt-4"><button type="button" disabled={!allowToc} className={primary} onClick={poke}>Essayer le Toc toc</button></div><p className="mt-3 text-xs leading-6 text-[#4A3F6B]">Une courte vibration est tentée seulement après votre clic et si l’appareil le permet. Les ordinateurs et certains navigateurs iPhone ne vibrent pas. Limite de démonstration : un essai toutes les 10 secondes ; limite réelle à définir plus strictement.</p></div><button type="button" className="mt-4 text-xs underline" onClick={()=>{setContact('blocked');setDm([]);setToc(false)}}>Bloquer le contact (démo)</button></>}{(contact==='ignored'||contact==='blocked')&&<><p className="text-sm">{contact==='blocked'?'Contact bloqué, conversation masquée.':'Invitation ignorée : aucune conversation ouverte.'}</p><button type="button" className={secondary+' mt-4'} onClick={()=>{setContact('request');setToc(false);setDm([])}}>Recommencer</button></>}</div></div></>}
        {view==='profile'&&<><Heading label="Votre place parmi nous" title="Mon profil" description="Seuls les membres de L’Arche pourront consulter votre fiche. Aucun nom réel ou donnée de compte MediumIA n’est exposé."/><div className="rounded-xl border border-[#E2D7BE] bg-white p-6"><div className="flex items-center gap-4"><Initial name={nickname} big/><div><h3 className="font-georgia text-2xl">{nickname}</h3><p className="text-xs text-[#4A3F6B]">Profil fictif · Photo facultative plus tard</p></div></div><label className="mt-6 block text-sm font-semibold">Mon statut de présence<select className={field+' mt-2'} value={presence} onChange={e=>setPresence(e.target.value)}><option value="disponible">Disponible</option><option value="absent">Absent</option><option value="occupe">Occupé</option><option value="invisible">Invisible (par défaut)</option></select></label><p className="mt-4 rounded-lg bg-[#F3EFE6] p-4 text-xs leading-6">Statut simulé : <strong>{presence}</strong>. Le mode invisible ne publiera ni connexion ni dernière activité.</p><p className="mt-4 text-xs leading-6 text-[#4A3F6B]">La fiche finale permettra un avatar ou une photo facultative contrôlée, des centres d’intérêt et une présentation libre.</p></div></>}
      </main>
      <aside className="hidden self-start space-y-4 lg:sticky lg:top-24 lg:block"><div className="rounded-xl border border-[#E2D7BE] bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#9B640B]">Une question pour se rencontrer</p><p className="mt-3 font-georgia text-lg leading-7">Qu’est-ce qui a éveillé votre curiosité pour la spiritualité ?</p><button onClick={()=>open('feed')} type="button" className="mt-4 text-xs underline">Partager ma réflexion</button></div><div className="rounded-xl border border-[#E2D7BE] bg-white p-5"><strong className="text-sm">Se sentir à sa place</strong><p className="mt-3 text-xs leading-6 text-[#4A3F6B]">Aucune hiérarchie de l’éveil. Signalement, blocage, modération humaine assistée par IA à concevoir avant l’ouverture.</p></div></aside>
    </div>
  </div>
}
