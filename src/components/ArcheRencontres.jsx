import { useState } from 'react'

// Rencontres — maquette locale de L’Arche.
// Profils, invitations et conversations sont fictifs et restent dans la mémoire de l’onglet :
// aucun compte, aucun âge vérifié, aucune donnée transmise. Les vraies règles (18 ans et plus,
// visibilité, blocage, limites d’invitations, modération) devront être appliquées côté serveur.

const INTENTIONS = [
  { id: 'amitie', label: 'Amitié', hint: 'Des liens simples et sincères.' },
  { id: 'echanges', label: 'Échanges et découvertes', hint: 'Parler, apprendre, partager ses expériences.' },
  { id: 'binome', label: 'Binôme de pratique', hint: 'Méditer, tenir un carnet de rêves, s’exercer ensemble.' },
  { id: 'coeur', label: 'Affinités de cœur', hint: 'Une connexion du cœur, sans étiquette ni pression.' },
  { id: 'amour', label: 'Relation amoureuse', hint: 'Option explicite, réservée aux adultes.', adultOnly: true },
]

const PROFILES = [
  { id: 'lune', name: 'Lune Sereine', age: '35–44 ans', region: 'Bretagne', mood: 'Le calme du matin me fait du bien', intentions: ['amitie', 'binome'], interests: ['Méditation', 'Marche en forêt', 'Carnet de rêves'], bio: 'Je médite depuis quelques années, souvent seule. J’aimerais trouver quelqu’un avec qui partager un petit rendez-vous régulier, même à distance.', seeks: 'Une présence régulière, quelqu’un qui aime les silences autant que les mots.', icebreakers: ['Quelle pratique vous apaise le plus en ce moment ?', 'Plutôt méditation du matin ou du soir ?'], motif: 'moon', tone: '#EEEAF6', photo: true },
  { id: 'sentier', name: 'Sentier Vert', age: '28 ans', region: 'Occitanie', mood: 'Toujours une question en poche', intentions: ['echanges', 'amitie'], interests: ['Rêves lucides', 'Philosophie', 'Randonnée'], bio: 'Curieux de tout, sceptique parfois. J’aime les discussions où l’on peut douter sans être jugé.', seeks: 'Des échanges francs et bienveillants, entre croyants, non-croyants et chercheurs.', icebreakers: ['Un rêve qui vous a marqué ?', 'Qu’est-ce qui vous a fait changer d’avis récemment ?'], motif: 'leaf', tone: '#EAF3E8', photo: false },
  { id: 'phare', name: 'Petit Phare', age: '55–64 ans', region: 'Hauts-de-France', mood: 'Une lumière pour ceux qui passent', intentions: ['echanges', 'coeur'], interests: ['Deuil et mémoire', 'Écriture', 'Jardinage'], bio: 'Depuis un deuil, j’écris beaucoup. J’aimerais échanger avec des personnes qui comprennent ce chemin, sans conseils tout faits.', seeks: 'Des personnes qui savent écouter, et parfois rire aussi.', icebreakers: ['Qu’est-ce qui vous aide dans les jours plus lourds ?', 'Vous écrivez, vous aussi ?'], motif: 'star', tone: '#FFF1CC', photo: false },
  { id: 'sauge', name: 'Brin de Sauge', age: '45–54 ans', region: '', mood: 'Entre deux tisanes', intentions: ['amour', 'coeur', 'amitie'], interests: ['Plantes', 'Tarot en amateur', 'Musique'], bio: 'Je crois aux rencontres simples. Je prends le temps, j’aime les longues conversations avant tout le reste.', seeks: 'Une belle rencontre qui commence par une vraie conversation.', icebreakers: ['Votre tisane préférée ?', 'Une musique qui vous ressemble ?'], motif: 'sprig', tone: '#F3E7D9', photo: true },
  { id: 'maree', name: 'Marée Douce', age: '25–34 ans', region: 'Nouvelle-Aquitaine', mood: 'Je respire au rythme des vagues', intentions: ['binome', 'echanges'], interests: ['Yoga', 'Respiration', 'Astrologie'], bio: 'Je cherche un binôme pour tenir une petite routine : respiration le matin, un message le soir pour se dire comment ça s’est passé.', seeks: 'Un binôme fiable et doux, sans compétition.', icebreakers: ['Votre routine idéale tiendrait en combien de minutes ?', 'Mer ou montagne ?'], motif: 'wave', tone: '#E9F4F5', photo: false },
  { id: 'ambre', name: 'Ciel d’Ambre', age: '65 ans et plus', region: 'Auvergne-Rhône-Alpes', mood: 'Jeune retraitée, vieille âme', intentions: ['amitie', 'echanges'], interests: ['Prière', 'Lecture', 'Chant'], bio: 'Croyante, ouverte aux autres chemins. J’aime écouter les histoires de chacun et partager un bon livre.', seeks: 'Des amitiés au long cours, des lectures à partager.', icebreakers: ['Un livre qui vous accompagne ?', 'Un lieu où vous vous sentez en paix ?'], motif: 'sun', tone: '#F8E9EB', photo: false },
  { id: 'bois', name: 'Bois Flotté', age: '35–44 ans', region: 'Grand Est', mood: 'J’apprends à ralentir', intentions: ['amour', 'amitie'], interests: ['Méditation', 'Photographie', 'Cuisine'], bio: 'Père de deux enfants, je prends enfin du temps pour moi. Ouvert à une belle rencontre, sans précipitation.', seeks: 'De l’amitié d’abord, et pourquoi pas plus si le cœur y est.', icebreakers: ['Votre plat réconfortant ?', 'Qu’est-ce qui vous aide à ralentir ?'], motif: 'tree', tone: '#E7EEF8', photo: true },
]

const APPROACHES = [
  'Votre présentation m’a parlé.',
  'J’aimerais échanger sur nos pratiques.',
  'Un binôme de pratique me plairait.',
  'Nous avons des centres d’intérêt en commun.',
]

const INITIAL_INCOMING = [
  { id: 'inv-phare', from: 'phare', intention: 'echanges', approach: 'Votre présentation m’a parlé.', status: 'pending' },
  { id: 'inv-bois', from: 'bois', intention: 'amitie', approach: 'Nous avons des centres d’intérêt en commun.', status: 'pending' },
]

const REPORT_REASONS = ['Comportement insistant', 'Faux profil', 'Propos déplacés ou blessants', 'Démarchage ou vente', 'Personne possiblement mineure', 'Autre raison']

const primary = 'min-h-11 rounded-full bg-[#1A1535] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2B254D] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'min-h-11 rounded-full border border-[#ECEAF2] bg-white px-4 py-2 text-sm font-semibold text-[#1A1535] transition hover:bg-[#FAFAF7] disabled:cursor-not-allowed disabled:opacity-50'
const quiet = 'min-h-11 rounded-full px-3 py-2 text-sm font-semibold text-[#4A3F6B] underline-offset-4 hover:underline'
const field = 'min-h-11 w-full rounded-2xl border border-[#ECEAF2] bg-white px-4 py-3 text-sm text-[#1A1535] placeholder:text-[#4A3F6B] outline-none transition focus:border-[#4A3F6B]'
const chip = 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-[#1A1535]'
const INTENTION_TONE = { amitie: '#EAF3E8', echanges: '#E7EEF8', binome: '#EEEAF6', coeur: '#FFF1CC', amour: '#F8E9EB' }

const intentionLabel = (id) => INTENTIONS.find(item => item.id === id)?.label || id
// La relation amoureuse n’est montrée qu’aux personnes qui l’ont elles-mêmes choisie.
const visibleIntentions = (profile, mine) => profile.intentions.filter(id => id !== 'amour' || mine.includes('amour'))

function Motif({ name, size = 28 }) {
  const paths = {
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
    leaf: <path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Zm0 0 7-7"/>,
    star: <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7Z"/>,
    sprig: <path d="M12 21V9m0 4c-3 0-5-2-5-5 3 0 5 2 5 5Zm0-2c3 0 5-2 5-5-3 0-5 2-5 5Z"/>,
    wave: <path d="M3 10c3-3 6 3 9 0s6 3 9 0M3 16c3-3 6 3 9 0s6 3 9 0"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    tree: <path d="m12 3-5 7h3l-4 6h12l-4-6h3Zm0 13v5"/>,
    camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.star}</svg>
}

function ProfileAvatar({ profile, large = false }) {
  return <span className={'relative inline-flex shrink-0 items-center justify-center rounded-full text-[#1A1535] ring-4 ring-white '+(large ? 'h-24 w-24' : 'h-16 w-16')} style={{ background: profile.tone }}>
    <Motif name={profile.motif} size={large ? 40 : 28}/>
  </span>
}

function IntentionChips({ ids }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Intentions">
    {ids.map(id => <li key={id} className={chip} style={{ background: INTENTION_TONE[id] }}>{intentionLabel(id)}</li>)}
  </ul>
}

function InterestChips({ items }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Centres d’intérêt">
    {items.map(item => <li key={item} className={chip+' border border-[#ECEAF2] bg-white font-medium'}>{item}</li>)}
  </ul>
}

function IntentionPicker({ mine, onToggle, idPrefix }) {
  const regular = INTENTIONS.filter(item => !item.adultOnly)
  const adult = INTENTIONS.find(item => item.adultOnly)
  const box = (item) => <label key={item.id} htmlFor={idPrefix+item.id} className={'flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border p-3 transition '+(mine.includes(item.id) ? 'border-[#1A1535] bg-[#FAFAF7]' : 'border-[#ECEAF2] bg-white hover:bg-[#FAFAF7]')}>
    <input id={idPrefix+item.id} type="checkbox" checked={mine.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-1 h-4 w-4 shrink-0 accent-[#1A1535]"/>
    <span><span className="block text-sm font-semibold">{item.label}</span><span className="block text-xs leading-5 text-[#4A3F6B]">{item.hint}</span></span>
  </label>
  return <div className="space-y-4">
    <fieldset><legend className="text-sm font-semibold">Ce que je viens chercher <span className="font-normal text-[#4A3F6B]">(plusieurs choix possibles)</span></legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{regular.map(box)}</div></fieldset>
    <fieldset className="rounded-2xl border border-dashed border-[#DDD7EA] p-3"><legend className="px-1 text-sm font-semibold">Option adulte, à choisir explicitement</legend>{box(adult)}<p className="mt-2 text-xs leading-5 text-[#4A3F6B]">Visible uniquement des participants qui l’ont aussi choisie. Jamais affichée ailleurs dans L’Arche.</p></fieldset>
  </div>
}

function ReportPanel({ profile, reason, setReason, alsoBlock, setAlsoBlock, onSubmit, onCancel }) {
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="mt-4 rounded-2xl border border-[#ECEAF2] bg-[#FAFAF7] p-4 text-[#1A1535]" aria-label={'Signaler '+profile.name}>
    <fieldset><legend className="text-sm font-semibold">Pourquoi signalez-vous {profile.name} ?</legend>
      <div className="mt-3 grid gap-1">{REPORT_REASONS.map(item => <label key={item} className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm hover:bg-white"><input type="radio" name={'report-'+profile.id} value={item} checked={reason === item} onChange={() => setReason(item)} className="h-4 w-4 accent-[#1A1535]"/>{item}</label>)}</div>
    </fieldset>
    <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={alsoBlock} onChange={event => setAlsoBlock(event.target.checked)} className="h-4 w-4 accent-[#1A1535]"/>Bloquer aussi cette personne</label>
    <p className="mt-1 text-xs leading-5 text-[#4A3F6B]">Démonstration : aucun signalement n’est transmis. La personne n’est jamais informée de qui l’a signalée.</p>
    <div className="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={!reason} className={primary}>Envoyer le signalement</button><button type="button" onClick={onCancel} className={secondary}>Annuler</button></div>
  </form>
}

export default function ArcheRencontres({ nickname, blocked = [], setBlocked = () => {}, onNotice = () => {} }) {
  // Participation volontaire : désactivée tant que la personne ne l’a pas choisie.
  const [joined, setJoined] = useState(false)
  const [adultConfirmed, setAdultConfirmed] = useState(false)
  const [mine, setMine] = useState([])
  const [visible, setVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filter, setFilter] = useState('mine')
  const [openId, setOpenId] = useState(null)
  const [hidden, setHidden] = useState([])
  const [lastHidden, setLastHidden] = useState(null)
  const [incoming, setIncoming] = useState(INITIAL_INCOMING)
  const [outgoing, setOutgoing] = useState({})
  const [inviteFor, setInviteFor] = useState(null)
  const [inviteIntention, setInviteIntention] = useState('')
  const [inviteApproach, setInviteApproach] = useState(APPROACHES[0])
  const [reportFor, setReportFor] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportBlock, setReportBlock] = useState(true)
  const [threads, setThreads] = useState({})
  const [draft, setDraft] = useState('')
  const [showIgnored, setShowIgnored] = useState(false)

  const byId = Object.fromEntries(PROFILES.map(profile => [profile.id, profile]))
  const isBlocked = (id) => blocked.includes(byId[id]?.name)
  const incomingFrom = (id) => incoming.find(item => item.from === id)
  const isConnected = (id) => !isBlocked(id) && (outgoing[id]?.status === 'accepted' || incomingFrom(id)?.status === 'accepted')
  const commonIntentions = (profile) => visibleIntentions(profile, mine).filter(id => mine.includes(id))
  const pendingIncoming = incoming.filter(item => item.status === 'pending' && !isBlocked(item.from))
  const ignoredIncoming = incoming.filter(item => item.status === 'ignored' && !isBlocked(item.from))
  const connections = PROFILES.filter(profile => isConnected(profile.id))
  const sentPending = PROFILES.filter(profile => outgoing[profile.id]?.status === 'pending' && !isBlocked(profile.id))
  // Aucun classement : ordre alphabétique, filtré seulement par les intentions choisies.
  const shown = PROFILES
    .filter(profile => !isBlocked(profile.id) && !hidden.includes(profile.id))
    .filter(profile => {
      const ids = visibleIntentions(profile, mine)
      return filter === 'mine' ? ids.some(id => mine.includes(id)) : ids.includes(filter)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const filters = [{ id: 'mine', label: 'Mes intentions' }, ...INTENTIONS.filter(item => !item.adultOnly || mine.includes(item.id))]
  const openProfile = openId && !isBlocked(openId) ? byId[openId] : null

  function toggleMine(id) {
    setMine(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    if (filter === id) setFilter('mine')
  }
  function join() {
    if (!adultConfirmed || mine.length === 0) return
    setJoined(true)
    onNotice('Profil Rencontres créé dans la démonstration. Vous pouvez le masquer à tout moment.')
  }
  function leave() {
    setJoined(false); setSettingsOpen(false); setOpenId(null); setInviteFor(null); setVisible(true)
    onNotice('Vous avez quitté les Rencontres : votre profil Rencontres n’est plus visible.')
  }
  function openFiche(id, withInvite = false) {
    setOpenId(id); setReportFor(null); setDraft('')
    if (withInvite) startInvite(byId[id]); else setInviteFor(null)
  }
  function startInvite(profile) {
    setInviteFor(profile.id)
    setInviteIntention(commonIntentions(profile)[0] || '')
    setInviteApproach(APPROACHES[0])
  }
  function sendInvite() {
    const profile = byId[inviteFor]
    if (!profile || !inviteIntention || !visible || outgoing[profile.id]) return
    setOutgoing(current => ({ ...current, [profile.id]: { status: 'pending', intention: inviteIntention, approach: inviteApproach } }))
    setInviteFor(null)
    onNotice('Invitation envoyée à '+profile.name+' (simulation). Aucune relance possible : cette personne répond si elle le souhaite.')
  }
  function simulateAnswer(id, accepted) {
    setOutgoing(current => ({ ...current, [id]: { ...current[id], status: accepted ? 'accepted' : 'closed' } }))
    onNotice(accepted ? byId[id].name+' a accepté (simulation). La conversation est ouverte.' : 'Pas de suite pour le moment (simulation). Aucune raison n’est demandée, aucune relance n’est possible.')
  }
  function answer(invitation, status) {
    setIncoming(list => list.map(item => item.id === invitation.id ? { ...item, status } : item))
    const name = byId[invitation.from].name
    if (status === 'accepted') onNotice('Invitation de '+name+' acceptée. Vous pouvez maintenant échanger.')
    if (status === 'ignored') onNotice('Invitation ignorée. '+name+' n’est pas prévenu·e ; vous pourrez y revenir plus tard.')
    if (status === 'refused') onNotice('Invitation refusée. '+name+' voit seulement qu’elle n’a pas abouti et ne pourra pas vous réinviter.')
    if (status === 'pending') onNotice('Invitation de '+name+' de nouveau en attente.')
  }
  function openReport(id) { setReportFor(id); setReportReason(''); setReportBlock(true) }
  function blockProfile(id, message) {
    setBlocked(current => [...new Set([...current, byId[id].name])])
    setIncoming(list => list.map(item => item.from === id && item.status !== 'accepted' ? { ...item, status: 'refused' } : item))
    setOpenId(null); setInviteFor(null); setReportFor(null)
    onNotice(message)
  }
  function submitReport() {
    if (!reportReason) return
    if (reportBlock) blockProfile(reportFor, 'Signalement simulé et personne bloquée. Elle ne peut plus vous voir, vous inviter ni vous écrire. Rien n’a été transmis.')
    else { setReportFor(null); onNotice('Signalement simulé : rien n’a été transmis.') }
  }
  function hideProfile(id) {
    setHidden(current => [...current, id]); setLastHidden(id); setOpenId(null); setInviteFor(null)
    onNotice('Profil masqué : il ne vous sera plus proposé.')
  }
  function sendMessage(id) {
    if (!draft.trim() || !isConnected(id)) return
    setThreads(current => ({ ...current, [id]: [...(current[id] || []), draft.trim()] }))
    setDraft('')
  }

  if (!joined) return <section className="mx-auto max-w-[680px] space-y-4" aria-labelledby="rencontres-title">
    <header className="rounded-3xl border border-[#ECEAF2] bg-[#FAFAF7] p-6">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-[#4A3F6B]">Rencontres</p>
      <h2 id="rencontres-title" className="mt-3 font-georgia text-3xl leading-tight text-balance">Les belles rencontres commencent parfois par une simple conversation.</h2>
      <p className="mt-4 text-sm leading-7 text-[#4A3F6B]">Amitié, échanges, binôme de pratique ou affinités de cœur : ici, on se découvre par ce qu’on partage, pas par une photo.</p>
      <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
        <li className="rounded-2xl bg-white p-3">Aucun score, aucun classement.</li>
        <li className="rounded-2xl bg-white p-3">Photos partagées seulement après acceptation.</li>
        <li className="rounded-2xl bg-white p-3">On n’écrit qu’à qui a dit oui.</li>
      </ul>
    </header>
    <form onSubmit={(event) => { event.preventDefault(); join() }} className="rounded-3xl border border-[#ECEAF2] bg-white p-5">
      <h3 className="font-georgia text-xl">Créer mon profil Rencontres</h3>
      <p className="mt-2 text-sm leading-6 text-[#4A3F6B]">La participation est désactivée par défaut. Votre profil Rencontres est distinct de votre profil L’Arche, visible seulement des autres participants, et masquable à tout moment.</p>
      <div className="mt-5"><IntentionPicker mine={mine} onToggle={toggleMine} idPrefix="join-"/></div>
      <label className="mt-5 flex items-start gap-3 rounded-2xl bg-[#FAFAF7] p-3 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#1A1535]"/><span>J’ai 18 ans ou plus et je choisis de participer aux Rencontres.</span></label>
      <p className="mt-2 text-xs leading-5 text-[#4A3F6B]">Démonstration : aucun âge n’est vérifié et aucun profil réel n’est créé. Pseudonyme affiché : {nickname}.</p>
      <button type="submit" disabled={!adultConfirmed || mine.length === 0} className={primary+' mt-4 w-full sm:w-auto'}>Rejoindre les Rencontres</button>
    </form>
  </section>

  if (openProfile) {
    const profile = openProfile
    const ids = visibleIntentions(profile, mine)
    const sent = outgoing[profile.id]
    const received = incomingFrom(profile.id)
    const connected = isConnected(profile.id)
    const common = commonIntentions(profile)
    return <article className="mx-auto max-w-[680px] space-y-4" aria-labelledby="rencontre-fiche-title">
      <button type="button" onClick={() => { setOpenId(null); setInviteFor(null); setReportFor(null) }} className={secondary}>← Retour aux profils</button>
      <section className="rounded-3xl border border-[#ECEAF2] bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <ProfileAvatar profile={profile} large/>
          <div className="min-w-0 flex-1">
            <h2 id="rencontre-fiche-title" className="font-georgia text-3xl">{profile.name}</h2>
            <p className="mt-1 text-sm text-[#4A3F6B]">{profile.age} · {profile.region || 'Région non précisée'}</p>
            <p className="mt-3 font-georgia text-lg italic">« {profile.mood} »</p>
          </div>
        </div>
        <div className="mt-6 grid gap-6">
          <div><h3 className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-[#4A3F6B]">Ce que je cherche ici</h3><IntentionChips ids={ids}/><p className="mt-3 text-sm leading-7">{profile.seeks}</p></div>
          <div><h3 className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-[#4A3F6B]">Ma présentation</h3><p className="text-sm leading-7">{profile.bio}</p></div>
          <div><h3 className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-[#4A3F6B]">Ce qui me fait du bien</h3><InterestChips items={profile.interests}/></div>
          <div className="rounded-2xl bg-[#FAFAF7] p-4"><h3 className="text-xs font-bold uppercase tracking-[.14em] text-[#4A3F6B]">Pour briser la glace</h3><ul className="mt-2 space-y-1 text-sm leading-6">{profile.icebreakers.map(item => <li key={item}>— {item}</li>)}</ul></div>
          {profile.photo && <p className="flex items-center gap-3 rounded-2xl border border-[#ECEAF2] p-3 text-sm text-[#4A3F6B]"><Motif name="camera" size={22}/>{connected ? 'Photo partagée avec vous (aucune vraie photo dans la démonstration).' : 'Photo partagée seulement après une acceptation mutuelle.'}</p>}
        </div>
      </section>

      <section className="rounded-3xl border border-[#ECEAF2] bg-white p-5" aria-label="Faire connaissance">
        {connected ? <div>
          <h3 className="font-georgia text-xl">Votre conversation avec {profile.name}</h3>
          <p className="mt-1 text-xs text-[#4A3F6B]">Ouverte parce que vous avez tous les deux dit oui. Conversation fictive, rien n’est envoyé.</p>
          <div aria-live="polite" className="mt-4 space-y-2">{(threads[profile.id] || []).length === 0 ? <p className="rounded-2xl bg-[#FAFAF7] p-3 text-sm">Vous pouvez écrire le premier message. Une question de « Pour briser la glace » peut aider.</p> : threads[profile.id].map((text, index) => <p key={index} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[#EEEAF6] px-4 py-3 text-sm leading-6">{text}</p>)}</div>
          <form onSubmit={(event) => { event.preventDefault(); sendMessage(profile.id) }} className="mt-3 flex gap-2"><label className="sr-only" htmlFor="rencontre-draft">Écrire à {profile.name}</label><input id="rencontre-draft" value={draft} onChange={event => setDraft(event.target.value)} maxLength={240} className={field} placeholder="Votre message…"/><button type="submit" disabled={!draft.trim()} className={primary+' shrink-0'}>Envoyer</button></form>
        </div> : received?.status === 'pending' ? <div>
          <h3 className="font-georgia text-xl">{profile.name} aimerait faire connaissance</h3>
          <p className="mt-2 text-sm">Intention proposée : <strong>{intentionLabel(received.intention)}</strong> · « {received.approach} »</p>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primary} onClick={() => answer(received, 'accepted')}>Accepter</button><button type="button" className={secondary} onClick={() => answer(received, 'ignored')}>Ignorer</button><button type="button" className={secondary} onClick={() => answer(received, 'refused')}>Refuser</button><button type="button" className={secondary} onClick={() => openReport(profile.id)}>Bloquer et signaler</button></div>
        </div> : sent?.status === 'pending' ? <div>
          <h3 className="font-georgia text-xl">Invitation envoyée</h3>
          <p className="mt-2 text-sm text-[#4A3F6B]">{profile.name} répondra si elle ou il le souhaite. Pas de relance, pas de compte à rebours.</p>
          <div className="mt-4 rounded-2xl border border-dashed border-[#DDD7EA] p-3"><p className="text-xs font-semibold text-[#4A3F6B]">Pour la démonstration uniquement</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => simulateAnswer(profile.id, true)}>Simuler une acceptation</button><button type="button" className={secondary} onClick={() => simulateAnswer(profile.id, false)}>Simuler une absence de suite</button></div></div>
        </div> : sent?.status === 'closed' || received?.status === 'refused' ? <p className="text-sm text-[#4A3F6B]">Pas de suite pour le moment. Une nouvelle invitation n’est pas possible.</p>
        : inviteFor === profile.id ? <form onSubmit={(event) => { event.preventDefault(); sendInvite() }}>
          <h3 className="font-georgia text-xl">Demander à faire connaissance</h3>
          <p className="mt-2 text-sm leading-6 text-[#4A3F6B]">Pas de message libre avant acceptation : vous choisissez une intention commune et une phrase d’approche. {profile.name} pourra accepter, ignorer, refuser ou bloquer, sans se justifier.</p>
          {common.length === 0 ? <p className="mt-4 rounded-2xl bg-[#FAFAF7] p-3 text-sm">Vos intentions ne se croisent pas. Vous pouvez en ajouter dans « Mon profil Rencontres ».</p> : <>
            <fieldset className="mt-4"><legend className="text-sm font-semibold">Intention proposée</legend><div className="mt-2 flex flex-wrap gap-2">{common.map(id => <label key={id} className={'flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm '+(inviteIntention === id ? 'border-[#1A1535] bg-[#FAFAF7] font-semibold' : 'border-[#ECEAF2]')}><input type="radio" name="invite-intention" value={id} checked={inviteIntention === id} onChange={() => setInviteIntention(id)} className="h-4 w-4 accent-[#1A1535]"/>{intentionLabel(id)}</label>)}</div></fieldset>
            <label className="mt-4 block text-sm font-semibold" htmlFor="invite-approach">Phrase d’approche</label>
            <select id="invite-approach" value={inviteApproach} onChange={event => setInviteApproach(event.target.value)} className={field+' mt-2'}>{APPROACHES.map(item => <option key={item}>{item}</option>)}</select>
          </>}
          <div className="mt-4 flex flex-wrap gap-2"><button type="submit" disabled={!inviteIntention || !visible} className={primary}>Envoyer l’invitation</button><button type="button" className={secondary} onClick={() => setInviteFor(null)}>Annuler</button></div>
        </form>
        : <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={!visible} className={primary} onClick={() => startInvite(profile)}>Faire connaissance</button><p className="text-xs leading-5 text-[#4A3F6B]">{visible ? 'La messagerie s’ouvre seulement si la personne accepte.' : 'Rendez votre profil visible pour inviter quelqu’un.'}</p></div>}
        <p className="mt-4 border-t border-[#ECEAF2] pt-3 text-xs leading-5 text-[#4A3F6B]">Les Lueurs restent réservées aux proches qui les ont autorisées.</p>
      </section>

      <div className="flex flex-wrap gap-1">
        <button type="button" className={quiet} onClick={() => hideProfile(profile.id)}>Ne plus me proposer ce profil</button>
        <button type="button" className={quiet} onClick={() => blockProfile(profile.id, 'Personne bloquée. Elle ne peut plus vous voir, vous inviter ni vous écrire (simulation).')}>Bloquer</button>
        <button type="button" className={quiet} onClick={() => openReport(profile.id)}>Signaler</button>
      </div>
      {reportFor === profile.id && <ReportPanel profile={profile} reason={reportReason} setReason={setReportReason} alsoBlock={reportBlock} setAlsoBlock={setReportBlock} onSubmit={submitReport} onCancel={() => setReportFor(null)}/>}
    </article>
  }

  return <section className="mx-auto max-w-[760px] space-y-5" aria-labelledby="rencontres-title">
    <header className="rounded-3xl border border-[#ECEAF2] bg-[#FAFAF7] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#4A3F6B]">Rencontres · profils fictifs de démonstration</p><h2 id="rencontres-title" className="mt-2 font-georgia text-2xl leading-tight text-balance sm:text-3xl">Les belles rencontres commencent parfois par une simple conversation.</h2></div>
        <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)} className={secondary+' shrink-0'}>Mon profil Rencontres</button>
      </div>
      {settingsOpen && <div className="mt-5 space-y-4 rounded-2xl bg-white p-4">
        <IntentionPicker mine={mine} onToggle={toggleMine} idPrefix="edit-"/>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={visible} onChange={event => { setVisible(event.target.checked); onNotice(event.target.checked ? 'Votre profil Rencontres est de nouveau visible des participants.' : 'Votre profil Rencontres est masqué. Vos conversations ouvertes restent accessibles.') }} className="h-4 w-4 accent-[#1A1535]"/>Mon profil est visible des participants</label>
        <button type="button" onClick={leave} className={secondary}>Quitter les Rencontres</button>
      </div>}
    </header>

    {!visible && <p className="rounded-2xl border border-[#ECEAF2] bg-white p-4 text-sm leading-6">Votre profil est masqué : vous n’apparaissez plus et vous ne pouvez pas envoyer d’invitation. Pour découvrir les autres, rendez-le visible : la découverte est réciproque.</p>}

    {pendingIncoming.length > 0 && <section aria-labelledby="invitations-title" className="space-y-3">
      <h3 id="invitations-title" className="font-georgia text-xl">Invitations reçues</h3>
      {pendingIncoming.map(invitation => { const profile = byId[invitation.from]; return <article key={invitation.id} className="rounded-3xl border border-[#ECEAF2] bg-white p-4">
        <div className="flex items-center gap-4"><ProfileAvatar profile={profile}/><div className="min-w-0"><p className="text-sm"><strong>{profile.name}</strong> aimerait faire connaissance</p><p className="mt-1 text-xs leading-5 text-[#4A3F6B]">{intentionLabel(invitation.intention)} · « {invitation.approach} »</p></div></div>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => openFiche(profile.id)}>Voir son profil</button><button type="button" className={primary} onClick={() => answer(invitation, 'accepted')}>Accepter</button><button type="button" className={secondary} onClick={() => answer(invitation, 'ignored')}>Ignorer</button><button type="button" className={secondary} onClick={() => answer(invitation, 'refused')}>Refuser</button><button type="button" className={secondary} onClick={() => openReport(profile.id)}>Bloquer et signaler</button></div>
        {reportFor === profile.id && <ReportPanel profile={profile} reason={reportReason} setReason={setReportReason} alsoBlock={reportBlock} setAlsoBlock={setReportBlock} onSubmit={submitReport} onCancel={() => setReportFor(null)}/>}
      </article> })}
      <p className="text-xs leading-5 text-[#4A3F6B]">Aucune pression : répondre n’est jamais obligatoire, et personne ne voit si vous avez lu son invitation.</p>
    </section>}
    {ignoredIncoming.length > 0 && <div><button type="button" aria-expanded={showIgnored} onClick={() => setShowIgnored(value => !value)} className={quiet}>Invitations ignorées ({ignoredIncoming.length})</button>{showIgnored && <ul className="mt-2 space-y-2">{ignoredIncoming.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#ECEAF2] bg-white p-3 text-sm"><span>{byId[invitation.from].name}</span><button type="button" className={secondary} onClick={() => answer(invitation, 'pending')}>Revoir l’invitation</button></li>)}</ul>}</div>}

    {(connections.length > 0 || sentPending.length > 0) && <section aria-labelledby="liens-title" className="rounded-3xl border border-[#ECEAF2] bg-white p-4">
      <h3 id="liens-title" className="text-sm font-semibold">Vos liens en cours</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {connections.map(profile => <li key={profile.id}><button type="button" onClick={() => openFiche(profile.id)} className={secondary}>Écrire à {profile.name}</button></li>)}
        {sentPending.map(profile => <li key={profile.id}><button type="button" onClick={() => openFiche(profile.id)} className={secondary+' text-[#4A3F6B]'}>{profile.name} · invitation en attente</button></li>)}
      </ul>
    </section>}

    {visible && <section aria-labelledby="profils-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><h3 id="profils-title" className="font-georgia text-xl">Des personnes à découvrir</h3><p className="text-xs text-[#4A3F6B]">{shown.length} profil{shown.length > 1 ? 's' : ''} · ordre alphabétique, aucun classement</p></div>
      <div role="group" aria-label="Filtrer par intention" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={'min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition '+(filter === item.id ? 'border-[#1A1535] bg-[#1A1535] text-white' : 'border-[#ECEAF2] bg-white text-[#1A1535] hover:bg-[#FAFAF7]')}>{item.label}</button>)}</div>
      {lastHidden && <button type="button" className={quiet} onClick={() => { setHidden(current => current.filter(id => id !== lastHidden)); setLastHidden(null) }}>Annuler le masquage de {byId[lastHidden].name}</button>}
      {shown.length === 0 ? <p className="rounded-2xl bg-[#FAFAF7] p-5 text-sm">Personne pour cette intention dans la démonstration. Essayez un autre filtre.</p> : <div className="grid gap-4 sm:grid-cols-2">
        {shown.map(profile => {
          const sent = outgoing[profile.id]
          const received = incomingFrom(profile.id)
          const connected = isConnected(profile.id)
          const label = connected ? 'Écrire' : received?.status === 'pending' ? 'Voir son invitation' : sent?.status === 'pending' ? 'Invitation envoyée' : sent?.status === 'closed' || received?.status === 'refused' ? 'Pas de suite' : 'Faire connaissance'
          const disabled = !connected && (sent?.status === 'pending' || sent?.status === 'closed' || received?.status === 'refused')
          return <article key={profile.id} className="flex flex-col rounded-3xl border border-[#ECEAF2] bg-white p-5 shadow-[0_6px_24px_rgba(26,21,53,.04)]">
            <div className="flex items-start gap-4"><ProfileAvatar profile={profile}/><div className="min-w-0"><h4 className="font-georgia text-xl leading-tight">{profile.name}</h4><p className="mt-1 text-xs text-[#4A3F6B]">{profile.age} · {profile.region || 'Région non précisée'}</p><p className="mt-2 text-sm italic leading-6">« {profile.mood} »</p></div></div>
            <div className="mt-4"><IntentionChips ids={visibleIntentions(profile, mine)}/></div>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#4A3F6B]">{profile.bio}</p>
            <div className="mt-3"><InterestChips items={profile.interests}/></div>
            <div className="mt-auto flex flex-wrap gap-2 pt-5"><button type="button" className={secondary+' flex-1 whitespace-nowrap'} onClick={() => openFiche(profile.id)} aria-label={'Voir le profil de '+profile.name}>Voir le profil</button><button type="button" disabled={disabled} className={primary+' flex-1 whitespace-nowrap'} onClick={() => openFiche(profile.id, !connected && !received)} aria-label={label+' — '+profile.name}>{label}</button></div>
          </article>
        })}
      </div>}
    </section>}
  </section>
}
