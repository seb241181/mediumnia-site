import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('L’Arche a une route séparée des rendez-vous et du réseau professionnel', () => {
  const app = read('src/App.jsx')
  assert.match(app, /import ArchePage from '\.\/components\/ArchePage'/)
  assert.match(app, /p === '\/arche' \? 'arche'/)
  assert.match(app, /view === 'arche'[\s\S]*<ArchePage onBack=\{backHome\} onNavigate=\{legalNav\}/)
  assert.match(read('scripts/apply-lumia-assistant-console.mjs'), /view !== 'arche'/)
  assert.match(app, /p\.startsWith\('\/reseau'\) \? 'reseau-dir'/)
})

test('la maquette n’ouvre aucune inscription et n’envoie aucune donnée', () => {
  const page = read('src/components/ArchePage.jsx')
  assert.match(page, /data-arche-prototype="v1"/)
  assert.match(page, /Maquette interactive/)
  assert.match(page, /aucun message transmis ou enregistré en ligne/)
  assert.match(page, /Pas encore ouverte aux inscriptions/)
  assert.match(page, /Tous les contenus sont des exemples/)
  assert.match(page, /const DEMO_POSTS/)
  assert.match(page, /useState\(\[\]\)/)
  assert.doesNotMatch(page, /supabase|\.insert\(|\.upsert\(|\.from\(|\bfetch\s*\(|axios/)
})

test('la fiche, le salon et les messages privés sont explorables et identifiés comme fictifs', () => {
  const page = read('src/components/ArchePage.jsx')
  assert.match(page, /id: 'salon', text: 'Salon commun'/)
  assert.match(page, /id: 'profils', text: 'Mon profil'/)
  assert.match(page, /id: 'prive', text: 'Conversation privée'/)
  assert.match(page, /onClick=\{\(\) => \{ setTab\(item\.id\)/)
  assert.match(page, /onSubmit=\{addLocalPost\}/)
  assert.match(page, /onSubmit=\{addDm\}/)
  assert.match(page, /\!requestAccepted/)
  assert.match(page, /setRequestAccepted\(true\)/)
  assert.match(page, /profil fictif/)
  assert.match(page, /rien n’est enregistré, publié ou transmis/)
})

test('la charte garantit la liberté de douter et interdit le démarchage', () => {
  const page = read('src/components/ArchePage.jsx')
  assert.match(page, /Ni plateforme de voyance/)
  assert.match(page, /Ni concours de spiritualité/)
  assert.match(page, /Croire, ne pas croire, chercher ou douter/)
  assert.match(page, /Aucun démarchage en privé/)
  assert.match(page, /signalement/)
  assert.match(page, /Sébastien Seguin/)
})

test('la route reste noindex avant ouverture publique et a son titre de partage', () => {
  const meta = read('scripts/apply-route-seo-cro.mjs')
  const staticSeo = read('scripts/prerender-route-meta.mjs')
  assert.match(meta, /arche: \{\n    title: 'L’Arche — Communauté spirituelle gratuite/)
  assert.match(meta, /robots: 'noindex,nofollow'/)
  assert.match(read('scripts/apply-lumia-assistant-console.mjs'), /isPrivate = view === 'arche'/)
  assert.match(staticSeo, /arche: '\/arche'/)
})

test('L’Arche reprend la palette MediumIA et indique le compte commun requis', () => {
  const page = read('src/components/ArchePage.jsx')
  assert.match(page, /MEDIUMIA_symbol_header\.png/)
  assert.match(page, /Un seul compte MediumIA/)
  assert.match(page, /Aucun achat ni aucune formation/)
  assert.match(page, /votre profil sur L.Arche sera séparé/i)
  assert.match(page, /Le parcours est illustré uniquement/)
  assert.match(page, /aria-pressed=\{choice === 'existing'\}/)
  assert.match(page, /aria-pressed=\{choice === 'new'\}/)
  assert.match(page, /id="compte"/)
  assert.match(page, /#1A1535|text-deep/)
  assert.match(page, /#C9A84C|text-gold/)
  assert.match(page, /#FAFAF7|bg-cream/)
  assert.doesNotMatch(page, /#315e52|#284c3d|#34594e|#305a4c/i)
  assert.doesNotMatch(page, /signInWithPassword|signUp\(|\.auth\.|createUser|emailRedirectTo/)
})

test('Toc toc reste une simulation consentie, désactivable et sans notification réelle', () => {
  const page = read('src/components/ArchePage.jsx')
  assert.match(page, /const \[acceptsTocToc, setAcceptsTocToc\] = useState\(true\)/)
  assert.match(page, /const \[tocTocReceived, setTocTocReceived\] = useState\(false\)/)
  assert.match(page, /checked=\{acceptsTocToc\}/)
  assert.match(page, /setAcceptsTocToc\(event\.target\.checked\)/)
  assert.match(page, /disabled=\{!acceptsTocToc \|\| tocTocReceived\}/)
  assert.match(page, /onClick=\{\(\) => setTocTocReceived\(true\)\}/)
  assert.match(page, /Toc toc ! Une petite pensée pour toi\./)
  assert.match(page, /motion-reduce:animate-none/)
  assert.match(page, /Aucune notification ni vibration n’est envoyée ici/)
  assert.match(page, /En version réelle : uniquement entre contacts acceptés/)
  assert.doesNotMatch(page, /new Notification\(|navigator\.vibrate|Audio\(/)
})
