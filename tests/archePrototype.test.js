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
  assert.match(page, /setScreen\('login'\)/)
  assert.match(page, /screen === 'login'/)
  assert.match(page, /ArcheLoginPreview onBack=/)
  assert.match(page, /screen === 'app'/)
  assert.match(page, /ArcheAppPreview nickname=\{appNickname\}/)
  assert.match(app, /Je comprends qu’aucun compte, message ou profil réel/)
})

test('base blanche, crème subtil et or uniquement en accent lisible', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /bg-white/)
  assert.match(app, /#FFFFFF/)
  assert.match(app, /#FAFAF7/)
  assert.match(app, /#ECEAF2/)
  assert.match(app, /#1A1535/)
  assert.match(app, /#C9A84C/)
  assert.doesNotMatch(app, /text-\[#C9A84C\]/)
  assert.doesNotMatch(app, /color:\s*'#C9A84C'/)
  assert.doesNotMatch(app, /text-gold/i)
})

test('quatre ambiances de publication et textes longs repassent en clair', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /const POST_THEMES = \{[\s\S]*clear:[\s\S]*doux:[\s\S]*nuit:[\s\S]*brume:/)
  assert.match(app, /label: 'Clair'/)
  assert.match(app, /label: 'Doux'/)
  assert.match(app, /label: 'Nuit'/)
  assert.match(app, /label: 'Brume'/)
  assert.match(app, /draft\.length > 160 \|\| format !== 'normal' \? 'clear' : theme/)
  assert.match(app, /Les ambiances colorées sont réservées aux textes courts/)
})

test('Question est un format et Sujet sensible est une protection repliée', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /format === 'question'/)
  assert.match(app, /border-l-4 border-l-\[#C9A84C\]/)
  assert.match(app, /format === 'sensitive'/)
  assert.match(app, /const \[showSensitive, setShowSensitive\] = useState\(false\)/)
  assert.match(app, /Lire avec attention/)
  assert.match(app, /Réponses limitées aux proches/)
  assert.match(app, /if \(post\.format === 'question' \|\| post\.format === 'sensitive'\) return POST_THEMES\.clear/)
})

test('avatars colorés, présence lisible par forme, invisible par défaut et Lueur séparée', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /const AVATAR_PALETTE = \[/)
  assert.match(app, /function PresenceDot/)
  assert.match(app, /if \(status === 'invisible'\) return null/)
  assert.match(app, /status === 'online' \? '●'/)
  assert.match(app, /status === 'away' \? '◐' : '⊖'/)
  assert.match(app, /lueur \? ' ring-4 ring-\[#C9A84C\]\/35/)
  assert.match(app, /Phrase d’humeur/)
  assert.match(app, /Visible par les proches uniquement/)
})

test('réactions douces sans compteur public et animations réduites si demandé', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /const REACTIONS = \[/)
  assert.match(app, /Merci/)
  assert.match(app, /Je te comprends/)
  assert.match(app, /Moi aussi/)
  assert.match(app, /reaction-button/)
  assert.match(app, /prefers-reduced-motion:reduce/)
  assert.doesNotMatch(app, /likes?Count|reactionCount|compteur public/i)
})

test('maquette locale sans Supabase, réseau, stockage navigateur ni fausses données réelles', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /data-arche-app-preview="local-only"/)
  assert.match(app, /Prototype privé : toutes les données ci-dessous sont fictives et locales/)
  assert.doesNotMatch(app, /supabase|\.insert\(|\.upsert\(|supabase\.from\(|\bfetch\s*\(|axios|signInWithPassword|signUp\(|localStorage|sessionStorage/)
})

test('barre mobile en bas et zones de toucher minimales', () => {
  const app = read('src/components/ArcheSocialPrototype.jsx')
  assert.match(app, /fixed inset-x-0 bottom-0/)
  assert.match(app, /pb-\[env\(safe-area-inset-bottom\)\]/)
  assert.match(app, /min-h-14/)
  assert.match(app, /min-h-11/)
})
