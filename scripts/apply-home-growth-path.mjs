import { readFile, writeFile } from 'node:fs/promises'

// Accueil « chemin » et quiz des canaux de perception.
// Dernier patch du prebuild : les ancres visent le code APRÈS les patchs
// historiques (imports en lazy(), routes dans <DeferredRoute>, ROUTE_META,
// liste d'événements de mesure complétée). Ne jamais modifier src/App.jsx
// directement : ses lignes d'origine servent d'ancres aux patchs historiques.

const appPath = new URL('../src/App.jsx', import.meta.url)
const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)

function insertAfter(source, needle, addition, label) {
  if (source.includes(addition.trim())) return source
  const index = source.indexOf(needle)
  if (index < 0) throw new Error(`Home growth path patch drift: ${label}`)
  return source.slice(0, index + needle.length) + addition + source.slice(index + needle.length)
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Home growth path patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = insertAfter(
  app,
  "import PractitionersBand from './components/PractitionersBand'",
  "\nimport { ManifestoBand, QuizInvite, PathLadder, ArcheSection } from './components/HomeGrowthPath'",
  'home sections import',
)

app = insertAfter(
  app,
  "const ChronosphereMaxPage = lazy(() => import('./components/ChronosphereMaxPage'))",
  "\nconst QuizSensibilitePage = lazy(() => import('./components/QuizSensibilitePage'))",
  'quiz page import',
)

app = replaceRequired(
  app,
  `const HOME_RAIL = [
  { id: 'formation', label: 'Formation' },
  { id: 'consulter', label: 'Consulter' },
  { id: 'avis', label: 'Avis' },
  { id: 'decouvrir', label: 'Tirages' },
  { id: 'boutique', label: 'Boutique' },
  { id: 'praticiens', label: 'Praticiens' },
]`,
  `const HOME_RAIL = [
  { id: 'formation', label: 'Formation' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'approche', label: 'Approche' },
  { id: 'chemin', label: 'Chemin' },
  { id: 'consulter', label: 'Consulter' },
  { id: 'avis', label: 'Avis' },
  { id: 'arche', label: 'L’Arche' },
  { id: 'decouvrir', label: 'Tirages' },
  { id: 'boutique', label: 'Boutique' },
  { id: 'praticiens', label: 'Praticiens' },
]`,
  'home rail',
)

app = replaceRequired(
  app,
  "onOpenRdv, onOpenConferences, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('home_view', 'home') }, [])",
  "onOpenRdv, onOpenConferences, onOpenQuiz, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('home_view', 'home') }, [])",
  'home signature',
)

app = replaceRequired(
  app,
  '          onOpenReseauDir={onOpenReseauDir}\n        />',
  '          onOpenReseauDir={onOpenReseauDir}\n          onOpenQuiz={onOpenQuiz}\n        />',
  'hero quiz door',
)

// La Formation reste visible dès le premier défilement ; le quiz, l'approche
// et le chemin suivent, avant les consultations.
app = replaceRequired(
  app,
  '          <FeaturedAccompagnement onOpen={onOpenFormation} />\n        </section>\n',
  `          <FeaturedAccompagnement onOpen={onOpenFormation} />
        </section>

        {/* ── Quiz des canaux : porte d'entrée gratuite ── */}
        <QuizInvite onOpenQuiz={onOpenQuiz} />

        {/* ── La médiumnité consciente : ce que défend MediumIA ── */}
        <ManifestoBand />

        {/* ── Le chemin, du gratuit à la Formation ── */}
        <PathLadder onOpenQuiz={onOpenQuiz} onOpenFormation={onOpenFormation} onOpenReseauForm={onOpenReseauForm} />
`,
  'home growth sections',
)

app = replaceRequired(
  app,
  "        <VideoInterview id=\"interview\" onOpenRdv={onOpenRdv ? () => onOpenRdv('sebastien-seguin') : undefined} />\n",
  `        <VideoInterview id="interview" onOpenRdv={onOpenRdv ? () => onOpenRdv('sebastien-seguin') : undefined} />

        {/* ── L'Arche : le Codex et la Kénose ── */}
        <ArcheSection />
`,
  'arche section',
)

app = replaceRequired(
  app,
  "    : p === '/defi-intuition' ? 'defi-intuition'",
  "    : p === '/defi-intuition' ? 'defi-intuition'\n    : p === '/quiz-sensibilite' ? 'quiz-sensibilite'",
  'quiz route',
)

app = insertAfter(
  app,
  "  const openFormation  = () => nav('/formation',        'formation')",
  "\n  const openQuiz       = () => nav('/quiz-sensibilite', 'quiz-sensibilite')",
  'quiz navigation',
)

app = insertAfter(
  app,
  "  if (view === 'defi-intuition') return <><DefiIntuitionPage onBack={backHome} onNavigate={legalNav} />{guardian}</>",
  "\n  if (view === 'quiz-sensibilite') return <DeferredRoute><QuizSensibilitePage onBack={backHome} onNavigate={legalNav} onOpenFormation={openFormation} />{guardian}</DeferredRoute>",
  'quiz render',
)

app = replaceRequired(
  app,
  'onOpenRdv={openRdvPublic} onOpenConferences={openConferences} onNavigate={legalNav} />{guardian}</>',
  'onOpenRdv={openRdvPublic} onOpenConferences={openConferences} onOpenQuiz={openQuiz} onNavigate={legalNav} />{guardian}</>',
  'home quiz prop',
)

app = insertAfter(
  app,
  'const ROUTE_META = {\n',
  `  'quiz-sensibilite': {
    title: 'Quel est votre canal de perception ? Quiz gratuit | MediumIA',
    description: 'ClairSensation, Clairvision, Clairaudience ou Clairconnaissance : découvrez en 2 minutes le canal de perception qui s’ouvre le plus naturellement chez vous.',
  },
`,
  'quiz route meta',
)

await writeFile(appPath, app)

let analytics = await readFile(analyticsPath, 'utf8')

analytics = insertAfter(
  analytics,
  "  'formation_email_optin_completed',",
  "\n  'quiz_view',\n  'quiz_started',\n  'quiz_completed',\n  'quiz_shared',\n  'quiz_email_optin_completed',",
  'quiz events',
)

analytics = replaceRequired(
  analytics,
  'const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|formation|conferences)(:(oracle|chronosphere|reseau|formation|notify))?$/',
  'const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|formation|conferences|quiz)(:(oracle|chronosphere|reseau|formation|notify|quiz|codex))?$/',
  'quiz sources',
)

await writeFile(analyticsPath, analytics)

console.log('MediumIA home growth path: quiz route, home sections and quiz metrics applied')
