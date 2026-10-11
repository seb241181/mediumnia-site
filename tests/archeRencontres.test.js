import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rencontres = () => read('src/components/ArcheRencontres.jsx')
const app = () => read('src/components/ArcheSocialPrototype.jsx')

test('Rencontres : composant autonome monté comme une vue de L’Arche', () => {
  const source = app()
  assert.match(source, /import ArcheRencontres, \{ ProfileAvatar \} from '\.\/ArcheRencontres'/)
  assert.match(source, /\{ id: 'rencontres', label: 'Rencontres', icon: 'meet' \}/)
  assert.match(source, /<div hidden=\{view !== 'rencontres'\}><ArcheRencontres/)
  assert.match(source, /<div className="grid grid-cols-5 gap-1">/)
  assert.match(source, /MENU\.filter\(item => item\.id !== 'salon'\)/)
})

test('Rencontres : phrase d’accueil et cinq intentions, dont une option adulte explicite', () => {
  const source = rencontres()
  assert.match(source, /Les belles rencontres commencent parfois par une simple conversation\./)
  for (const label of ['Amitié', 'Échanges et découvertes', 'Binôme de pratique', 'Affinités de cœur', 'Relation amoureuse']) assert.ok(source.includes("label: '"+label+"'"), label)
  assert.match(source, /id: 'amour', label: 'Relation amoureuse', hint: 'Option explicite, réservée aux adultes\.', adultOnly: true/)
  // L’intention amoureuse n’est montrée qu’aux participants qui l’ont aussi choisie.
  assert.match(source, /const visibleIntentions = \(profile, mine\) => profile\.intentions\.filter\(id => id !== 'amour' \|\| mine\.includes\('amour'\)\)/)
})

test('Rencontres : participation désactivée par défaut, 18 ans et plus confirmé, profil masquable', () => {
  const source = rencontres()
  assert.match(source, /const \[joined, setJoined\] = useState\(false\)/)
  assert.match(source, /const \[adultConfirmed, setAdultConfirmed\] = useState\(false\)/)
  assert.match(source, /J’ai 18 ans ou plus et je choisis de participer aux Rencontres\./)
  assert.match(source, /disabled=\{!adultConfirmed \|\| mine\.length === 0 \|\| !profileName\.trim\(\) \|\| !simpleChoice\}/)
  assert.match(source, /Mon profil est visible des participants/)
  assert.match(source, /Quitter les Rencontres/)
  assert.match(source, /aucun âge n’est vérifié/)
})

test('Rencontres : aucun score, aucun classement, aucune promesse ni donnée de localisation précise', () => {
  const source = rencontres()
  assert.doesNotMatch(source, /compatib|âme sœur|matching|\bscore\s*[:=]|%\s*(d’)?affinit/i)
  assert.match(source, /a\.name\.localeCompare\(b\.name, 'fr'\)/)
  assert.match(source, /ordre alphabétique, aucun classement/)
  assert.doesNotMatch(source, /geolocation|latitude|longitude|adresse exacte|\d+\s?km\b/i)
  assert.doesNotMatch(source, /niveau spirituel|niveau d’éveil|vibration élevée/i)
})

test('Rencontres : données fictives locales, sans image distante ni appel réseau', () => {
  const source = rencontres()
  assert.doesNotMatch(source + read('src/data/archeRencontres.js'), /https?:\/\//)
  assert.doesNotMatch(source, /<img|fetch\(|supabase|localStorage/i)
  assert.match(source, /profils fictifs de démonstration/)
  assert.match(source, /Photo partagée seulement après une acceptation mutuelle\./)
})

test('Rencontres : la messagerie ne s’ouvre qu’après acceptation, sans message libre avant', () => {
  const source = rencontres()
  assert.match(source, /const isConnected = \(id\) => !isBlocked\(id\) && acceptedIds\.includes\(id\)/)
  assert.doesNotMatch(source, /rencontre-draft|function sendMessage|setThreads/)
  assert.match(source, /onOpenConversation\(profile\.id\)/)
  assert.match(source, /Ouvrir dans Messages/)
  assert.match(source, /Pas de message libre avant acceptation/)
  assert.doesNotMatch(source, /sendLueur|Envoyer une Lueur/)
})

test('Rencontres : accepter, ignorer, refuser, bloquer et signaler dès l’invitation', () => {
  const source = rencontres()
  for (const status of ['accepted', 'ignored', 'refused']) assert.ok(source.includes("answer(invitation, '"+status+"')"), status)
  assert.equal((source.match(/<ArcheInvitationActions /g) || []).length, 2)
  assert.match(source, /const \[reportBlock, setReportBlock\] = useState\(true\)/)
  assert.match(source, /Personne possiblement mineure/)
  // Un blocage retire la personne partout et clôt ses invitations en attente.
  assert.match(source, /\.filter\(profile => !isBlocked\(profile\.id\) && !hidden\.includes\(profile\.id\)\)/)
  assert.match(source, /item\.from === id && item\.status !== 'accepted' \? \{ \.\.\.item, status: 'refused' \}/)
  assert.match(source, /if \(!profile \|\| isBlocked\(profile\.id\)/)
  assert.match(source, /!visible \|\| outgoing\[profile\.id\]/)
})

test('Invitations : un seul composant commun, quatre réponses, aucun message libre', () => {
  const actions = read('src/components/ArcheInvitationActions.jsx')
  for (const label of ['>Accepter<', '>Ignorer<', '>Refuser<', '>Bloquer et signaler<']) assert.ok(actions.includes(label), label)
  assert.doesNotMatch(actions, /<input|<textarea|<select|contentEditable/i)
  assert.match(rencontres(), /import ArcheInvitationActions from '\.\/ArcheInvitationActions'/)
})

test('Refuser : aucun motif ni relance ; seule la personne qui a refusé peut revenir sur sa décision', () => {
  const source = rencontres()
  assert.match(source, /aucun motif, aucune relance possible/)
  assert.match(source, /Revenir sur ma décision/)
  // Revenir = rouvrir sa propre invitation reçue ; rien n’est envoyé à l’autre personne.
  assert.match(source, /onClick=\{\(\) => answer\(received, 'pending'\)\}>Revenir sur ma décision</)
  assert.match(source, /n’en est pas averti·e/)
  // Une invitation qui m’a été refusée reste fermée : pas de nouvelle sollicitation.
  assert.match(source, /const disabled = !connected && \(sent\?\.status === 'pending' \|\| sent\?\.status === 'closed'\)/)
  assert.match(source, /sent\?\.status === 'closed' \? <p className="text-sm text-\[#4A3F6B\]">Pas de suite pour le moment\. Une nouvelle invitation n’est pas possible\.<\/p>/)
})

test('Avatars : choisis par chaque personne, jamais déduits du pseudonyme', () => {
  const source = rencontres() + read('src/data/archeRencontres.js')
  assert.doesNotMatch(source, /motif: '|colorIndex|charCodeAt/)
  assert.equal((source.match(/avatar: \{ symbol: '/g) || []).length, 6)
  assert.equal((source.match(/avatar: null/g) || []).length, 1)
  assert.match(source, /style=\{\{ background: chosen \? chosen\.tone : '#F3F1F7' \}\}/)
  assert.match(source, /'Avatar choisi par '\+profile\.name/)
})
