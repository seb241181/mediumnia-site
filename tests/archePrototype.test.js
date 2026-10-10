import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('route arche conservée séparément et noindex avant ouverture', () => {
  const app = read('src/App.jsx')
  assert.match(app, /import ArchePage from '\.\/components\/ArchePage'/)
  assert.match(app, /p === '\/arche' \? 'arche'/)
  assert.match(app, /view === 'arche'[\s\S]*<ArchePage onBack=\{backHome\} onNavigate=\{legalNav\}/)
  assert.match(read('scripts/apply-lumia-assistant-console.mjs'), /view !== 'arche'/)
  const meta = read('scripts/apply-route-seo-cro.mjs')
  assert.match(meta, /arche: \{\n    title: 'L’Arche — Communauté spirituelle gratuite/)
  assert.match(meta, /robots: 'noindex,nofollow'/)
})

test('parcours séparé : découverte puis connexion puis application sociale', () => {
  const page = read('src/components/ArchePage.jsx')
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(page, /data-arche-prototype="v2"/)
  assert.match(page, /screen === 'login'/)
  assert.match(page, /ArcheLoginPreview onBack=/)
  assert.match(page, /screen === 'app'/)
  assert.match(page, /ArcheAppPreview nickname=\{appNickname\}/)
  assert.match(app, /export function ArcheLoginPreview\(\{ onEnter, onBack \}\)/)
  assert.match(app, /Aucun vrai identifiant demandé ici/)
  assert.match(app, /Je comprends que cette démo ne crée aucun compte et n’envoie aucun message/)
  assert.match(app, /onEnter\(pseudo\.trim\(\)\)/)
})

test('coque application réseau social : barre haute, trois colonnes desktop, onglets mobile', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /data-arche-app-preview="social-shell"/)
  assert.match(app, /function TopBar/)
  assert.match(app, /function Sidebar/)
  assert.match(app, /function RightRail/)
  assert.match(app, /function MobileTabs/)
  assert.match(app, /grid-cols-5/)
  assert.match(app, /Mes proches/)
  assert.match(app, /Question du soir/)
  assert.match(app, /Rechercher un membre ou un Cercle/)
  assert.match(app, /Démo/)
})

test('le fil ressemble à un fil social vivant', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /START_POSTS/)
  assert.match(app, /Partager quelque chose/)
  assert.match(app, /Merci/)
  assert.match(app, /Je te comprends/)
  assert.match(app, /Voir les \{post\.replies \+ replies\.length\} réponses/)
  assert.match(app, /Menu de modération fictif : Masquer, Signaler, Bloquer/)
  assert.doesNotMatch(app, /Exemple fictif sur chaque publication/)
})

test('le salon direct, les cercles et les messages existent comme espaces distincts', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /function LiveView/)
  assert.match(app, /Le Grand Salon/)
  assert.match(app, /Lueur écrit/)
  assert.match(app, /function CirclesView/)
  assert.match(app, /Proposer un Cercle/)
  assert.match(app, /function MessagesView/)
  assert.match(app, /Demande de contact/)
  assert.match(app, /Conversations/)
})

test('présence, proches et Lueur restent opt-in et limités', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /const PEOPLE = \[/)
  assert.match(app, /function Presence/)
  assert.match(app, /Disponible/)
  assert.match(app, /Invisible par défaut/)
  assert.match(app, /const \[allowGlow, setAllowGlow\] = useState\(false\)/)
  assert.match(app, /!allowGlow \|\| !accepted \|\| Date\.now\(\) - lastGlow < 10000/)
  assert.match(app, /navigator\.vibrate\(\[80, 45, 80\]\)/)
  assert.match(app, /@media\(prefers-reduced-motion:reduce\)/)
  assert.match(app, /Autoriser les Lueurs de mes proches/)
  assert.doesNotMatch(app, /new Notification\(|new Audio\(/)
})

test('maquette locale sans écriture Supabase, réseau ou stockage navigateur', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /Prototype privé : toutes les données ci-dessous sont fictives et locales/)
  assert.doesNotMatch(app, /supabase|\.insert\(|\.upsert\(|\.from\(|\bfetch\s*\(|axios|signInWithPassword|signUp\(|localStorage|sessionStorage/)
})

test('charte visuelle MediumIA et protections restent visibles', () => {
  const page = read('src/components/ArchePage.jsx')
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(page, /MEDIUMIA_symbol_header\.png/)
  assert.match(page, /Un seul compte MediumIA/)
  assert.match(page, /Aucun achat ni aucune formation/)
  assert.match(page, /Aucun démarchage en privé/)
  assert.match(app, /#1A1535/)
  assert.match(app, /#C9A84C/)
  assert.match(app, /#FAFAF7/)
  assert.match(app, /Fiche visible uniquement par les membres/)
})
