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
  { id: 'videos', label: 'Vidéos' },
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
  { id: 'videos', label: 'Vidéos' },
  { id: 'arche', label: 'L’Arche' },
  { id: 'decouvrir', label: 'Tirages' },
  { id: 'boutique', label: 'Boutique' },
  { id: 'praticiens', label: 'Praticiens' },
]`,
  'home rail',
)

app = replaceRequired(
  app,
  "onOpenRdv, onOpenQuestion, onOpenVideos, onOpenConferences, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('home_view', 'home') }, [])",
  "onOpenRdv, onOpenQuestion, onOpenVideos, onOpenConferences, onOpenQuiz, onNavigate }) {\n  useEffect(() => { trackMediumiaMetric('home_view', 'home') }, [])",
  'home signature',
)

app = replaceRequired(
  app,
  '          onOpenReseauDir={onOpenReseauDir}\n          onOpenRdv={onOpenRdv}\n        />',
  '          onOpenReseauDir={onOpenReseauDir}\n          onOpenRdv={onOpenRdv}\n          onOpenQuiz={onOpenQuiz}\n        />',
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
  "        <VideoInterview id=\"videos\" onOpenRdv={onOpenRdv ? () => onOpenRdv('sebastien-seguin', 'home-interview') : undefined} onOpenVideos={onOpenVideos} showResponsesPreview />\n",
  `        <VideoInterview id="videos" onOpenRdv={onOpenRdv ? () => onOpenRdv('sebastien-seguin', 'home-interview') : undefined} onOpenVideos={onOpenVideos} showResponsesPreview />

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
  'onOpenRdv={openRdvPublic} onOpenQuestion={openQuestion} onOpenVideos={openVideos} onOpenConferences={openConferences} onNavigate={legalNav} />{guardian}</>',
  'onOpenRdv={openRdvPublic} onOpenQuestion={openQuestion} onOpenVideos={openVideos} onOpenConferences={openConferences} onOpenQuiz={openQuiz} onNavigate={legalNav} />{guardian}</>',
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
  'const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|formation|conferences|question)(:(oracle|chronosphere|reseau|formation|notify|question|q1|q2))?$/',
  'const SOURCE_RE = /^(home|oracle|chronosphere|chronosphere-example|formation|conferences|question|quiz)(:(oracle|chronosphere|reseau|formation|notify|question|q1|q2|quiz|codex))?$/',
  'quiz sources',
)

await writeFile(analyticsPath, analytics)

// Pilotage : libellés, entonnoir du quiz et portes « Quiz » / « Codex » de
// l'accueil. Les ancres visent le tableau de bord après apply-funnel-measurement
// et apply-oracle-email-sequence-pilotage.
const dashboardPath = new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url)
const adminPath = new URL('../api/rdv-admin.js', import.meta.url)

let dashboard = await readFile(dashboardPath, 'utf8')

dashboard = insertAfter(
  dashboard,
  "  oracle_email_unsubscribed: 'Désinscriptions séquence 3 exercices',",
  "\n  quiz_view: 'Vues quiz des canaux',\n  quiz_started: 'Quiz commencés',\n  quiz_completed: 'Quiz terminés',\n  quiz_shared: 'Résultats de quiz partagés',\n  quiz_email_optin_completed: 'Séquences 3 exercices demandées (quiz)',",
  'pilotage quiz labels',
)

dashboard = insertAfter(
  dashboard,
  '    oracle_email_unsubscribed: round(2),',
  '\n    quiz_view: round(64),\n    quiz_started: round(51),\n    quiz_completed: round(43),\n    quiz_shared: round(9),\n    quiz_email_optin_completed: round(14),',
  'pilotage quiz preview totals',
)

dashboard = replaceRequired(
  dashboard,
  '    formation: round(24),\n  }\n  const oracle_next_steps = {',
  '    formation: round(24),\n    quiz: round(31),\n    codex: round(6),\n  }\n  const oracle_next_steps = {',
  'pilotage quiz preview doors',
)

dashboard = insertAfter(
  dashboard,
  '  const formationPurchaseCompleted = Number(totals.formation_purchase_completed || 0)',
  `
  const quizHomeClicks = Number(homeDoors.quiz || 0)
  const quizViews = Number(totals.quiz_view || 0)
  const quizStarted = Number(totals.quiz_started || 0)
  const quizCompleted = Number(totals.quiz_completed || 0)
  const quizShared = Number(totals.quiz_shared || 0)
  const quizOptin = Number(totals.quiz_email_optin_completed || 0)
  const socialShares = oracleShared + quizShared
  const storyAttribution = data?.story_attribution || {}
  const oracleStory = storyAttribution['story-oracle'] || { visits: 0, events: {} }
  const quizStory = storyAttribution['story-quiz'] || { visits: 0, events: {} }
  const storyVisits = Number(oracleStory.visits || 0) + Number(quizStory.visits || 0)
  const storyFreeResults = Number(oracleStory.events?.oracle_free_draw_completed || 0) + Number(quizStory.events?.quiz_completed || 0)
  const storyPaymentStarts = Number(oracleStory.events?.question_payment_started || 0) + Number(oracleStory.events?.chronosphere_payment_opened || 0) + Number(oracleStory.events?.formation_payment_started || 0) + Number(quizStory.events?.question_payment_started || 0) + Number(quizStory.events?.chronosphere_payment_opened || 0) + Number(quizStory.events?.formation_payment_started || 0)
  const storyPurchases = Number(oracleStory.events?.question_purchase_completed || 0) + Number(oracleStory.events?.chronosphere_purchase_completed || 0) + Number(oracleStory.events?.formation_purchase_completed || 0) + Number(quizStory.events?.question_purchase_completed || 0) + Number(quizStory.events?.chronosphere_purchase_completed || 0) + Number(quizStory.events?.formation_purchase_completed || 0)`,
  'pilotage quiz values',
)

dashboard = replaceRequired(
  dashboard,
  "            {['oracle', 'chronosphere', 'reseau', 'formation'].map(key => {\n              const labels = { oracle: 'Oracle', chronosphere: 'Chronosphère', reseau: 'Réseau', formation: 'Formation' }",
  "            {['formation', 'quiz', 'oracle', 'chronosphere', 'reseau', 'codex'].map(key => {\n              const labels = { oracle: 'Oracle', chronosphere: 'Chronosphère', reseau: 'Réseau', formation: 'Formation', quiz: 'Quiz des canaux', codex: 'Codex (Amazon)' }",
  'pilotage home doors',
)

dashboard = replaceRequired(
  dashboard,
  `      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">`,
  `      </section>

      <section className="rounded-2xl border border-gold/25 bg-deep p-6 text-cream">
        <div className="mb-5">
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">PARTAGES SOCIAUX</p>
          <h3 className="mt-1 font-georgia text-xl font-medium">Est-ce que MediumIA circule ?</h3>
          <p className="mt-2 font-georgia text-xs leading-relaxed text-cream/70">Compteur agrégé des stories partagées depuis l’Oracle et le Quiz sur la période choisie.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard eyebrow="Total partagé" value={socialShares} note={'Sur les ' + days + ' derniers jours'} />
          <MetricCard eyebrow="Stories Oracle" value={oracleShared} note={pct(oracleShared, oracleDrawCompleted) + ' des tirages obtenus'} />
          <MetricCard eyebrow="Stories Quiz" value={quizShared} note={pct(quizShared, quizCompleted) + ' des résultats obtenus'} />
        </div>
        <div className="mt-5 grid gap-4 border-t border-gold/20 pt-5 sm:grid-cols-4">
          <MetricCard eyebrow="Visites ramenées" value={storyVisits} note={Number(oracleStory.visits || 0) + ' Oracle · ' + Number(quizStory.visits || 0) + ' Quiz'} />
          <MetricCard eyebrow="Résultats gratuits" value={storyFreeResults} note={pct(storyFreeResults, storyVisits) + ' des visites story'} />
          <MetricCard eyebrow="Paiements lancés" value={storyPaymentStarts} note={pct(storyPaymentStarts, storyVisits) + ' des visites story'} />
          <MetricCard eyebrow="Achats attribués" value={storyPurchases} note={pct(storyPurchases, storyVisits) + ' des visites story'} />
        </div>
      </section>

      <section className="rounded-2xl border border-gold/20 bg-white/65 p-6">
        <div className="mb-6">
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">QUIZ DES CANAUX</p>
          <h3 className="mt-1 font-georgia text-xl font-medium text-deep">Du quiz gratuit aux 3 exercices</h3>
          <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">La porte d’entrée gratuite : combien découvrent leur canal, le partagent, puis demandent les exercices.</p>
        </div>
        <div className="space-y-5">
          <FunnelRow label="Page quiz vue" value={quizViews} reference={quizViews} detail={quizHomeClicks ? \`dont \${quizHomeClicks.toLocaleString('fr-FR')} depuis l’accueil\` : undefined} />
          <FunnelRow label="Quiz commencé" value={quizStarted} reference={quizViews} detail={pct(quizStarted, quizViews)} />
          <FunnelRow label="Résultat obtenu" value={quizCompleted} reference={quizViews} detail={pct(quizCompleted, quizStarted)} />
          <FunnelRow label="Résultat partagé" value={quizShared} reference={quizViews} detail={pct(quizShared, quizCompleted)} />
          <FunnelRow label="Séquence 3 exercices demandée" value={quizOptin} reference={quizViews} detail={pct(quizOptin, quizCompleted)} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">`,
  'pilotage quiz funnel',
)

await writeFile(dashboardPath, dashboard)

let admin = await readFile(adminPath, 'utf8')

admin = replaceRequired(
  admin,
  '  const home_doors = { oracle: 0, chronosphere: 0, reseau: 0, formation: 0 }',
  '  const home_doors = { oracle: 0, chronosphere: 0, reseau: 0, formation: 0, quiz: 0, codex: 0 }',
  'pilotage server home doors',
)

// Les Previews Vercel affichent les données de démonstration du serveur.
admin = replaceRequired(
  admin,
  '    conference_interest_click: round(11),\n  }\n  const home_doors = {',
  '    conference_interest_click: round(11),\n    quiz_view: round(64),\n    quiz_started: round(51),\n    quiz_completed: round(43),\n    quiz_shared: round(9),\n    quiz_email_optin_completed: round(14),\n  }\n  const home_doors = {',
  'pilotage server preview totals',
)

admin = replaceRequired(
  admin,
  '    formation: round(24),\n  }\n  const oracle_next_steps = {',
  '    formation: round(24),\n    quiz: round(31),\n    codex: round(6),\n  }\n  const oracle_next_steps = {',
  'pilotage server preview doors',
)


admin = insertAfter(
  admin,
  "  const oracle_next_steps = {\n    chronosphere: round(12),\n    reseau: round(7),\n    formation: round(9),\n  }",
  "\n  const story_attribution = {\n    'story-oracle': { visits: round(18), events: { oracle_free_draw_completed: round(11), chronosphere_payment_opened: round(3), chronosphere_purchase_completed: round(1), question_purchase_completed: round(1) } },\n    'story-quiz': { visits: round(13), events: { quiz_completed: round(8), formation_payment_started: round(2), formation_purchase_completed: round(1) } },\n  }",
  'pilotage preview story attribution',
)

admin = replaceRequired(
  admin,
  '  return { preview: true, days, totals, home_doors, oracle_next_steps, daily }',
  '  return { preview: true, days, totals, home_doors, oracle_next_steps, story_attribution, daily }',
  'pilotage preview story attribution return',
)

admin = insertAfter(
  admin,
  '  const oracle_next_steps = { chronosphere: 0, reseau: 0, formation: 0 }',
  "\n  const story_attribution = {\n    'story-oracle': { visits: 0, events: {} },\n    'story-quiz': { visits: 0, events: {} },\n  }",
  'pilotage live story attribution',
)

admin = replaceRequired(
  admin,
  "    if (row.event_name === 'ecosystem_door_click' && row.source?.startsWith('oracle:')) {\n      const target = row.source.slice(7)\n      if (target in oracle_next_steps) oracle_next_steps[target] += count\n    }\n    dailyMap.set",
  "    if (row.event_name === 'ecosystem_door_click' && row.source?.startsWith('oracle:')) {\n      const target = row.source.slice(7)\n      if (target in oracle_next_steps) oracle_next_steps[target] += count\n    }\n    if (row.event_name === 'story_visit' && row.source in story_attribution) {\n      story_attribution[row.source].visits += count\n    }\n    if (row.event_name === 'story_attributed' && row.source?.startsWith('story-')) {\n      const separator = row.source.indexOf(':')\n      const story = separator > 0 ? row.source.slice(0, separator) : ''\n      const event = separator > 0 ? row.source.slice(separator + 1) : ''\n      if (story in story_attribution && event) {\n        story_attribution[story].events[event] = (story_attribution[story].events[event] || 0) + count\n      }\n    }\n    dailyMap.set",
  'pilotage story attribution aggregation',
)

admin = replaceRequired(
  admin,
  '  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, daily })',
  '  return res.status(200).json({ preview: false, days, totals, home_doors, oracle_next_steps, story_attribution, daily })',
  'pilotage live story attribution return',
)

await writeFile(adminPath, admin)

// Séquence des 3 exercices demandée depuis le quiz : le consentement est
// enregistré avec sa vraie source (quiz_page) et sa propre version, les
// e-mails nomment le quiz, et la politique de confidentialité cite ce point
// d'entrée. Ancres : lib/formationEmailLead.js et LegalPages.jsx après
// apply-formation-email-lead.
const leadPath = new URL('../lib/formationEmailLead.js', import.meta.url)
const legalPath = new URL('../src/components/LegalPages.jsx', import.meta.url)

let lead = await readFile(leadPath, 'utf8')

lead = insertAfter(
  lead,
  "export const FORMATION_EMAIL_CONSENT_VERSION = 'formation-3-exercises-v1-2026-09-07'",
  `
export const QUIZ_EMAIL_SOURCE = 'quiz_page'
export const QUIZ_EMAIL_CONSENT_VERSION = 'quiz-3-exercises-v1-2026-10-06'

// Seule l'origine « quiz » change la source ; toute autre valeur reste Formation.
export function formationLeadConsent(origin) {
  return origin === 'quiz'
    ? { source: QUIZ_EMAIL_SOURCE, consentVersion: QUIZ_EMAIL_CONSENT_VERSION, context: 'depuis le quiz MediumIA' }
    : { source: FORMATION_EMAIL_SOURCE, consentVersion: FORMATION_EMAIL_CONSENT_VERSION, context: 'depuis la page Formation MediumIA' }
}`,
  'lead quiz consent',
)

lead = replaceRequired(
  lead,
  `function formationContextCopy(value) {
  return String(value || '')
    .replaceAll('après votre tirage Oracle', 'depuis la page Formation MediumIA')
    .replaceAll('après votre tirage Oracle.', 'depuis la page Formation MediumIA.')
}

export function buildFormationEmailSequence({ unsubscribeToken, nowMs = Date.now() }) {
  return buildOracleEmailSequence({ unsubscribeToken, nowMs }).map((item) => ({
    ...item,
    html: formationContextCopy(item.html),
    text: formationContextCopy(item.text),
  }))
}`,
  `function formationContextCopy(value, context = 'depuis la page Formation MediumIA') {
  return String(value || '')
    .replaceAll('après votre tirage Oracle', context)
}

export function buildFormationEmailSequence({ unsubscribeToken, nowMs = Date.now(), origin }) {
  const { context } = formationLeadConsent(origin)
  return buildOracleEmailSequence({ unsubscribeToken, nowMs }).map((item) => ({
    ...item,
    html: formationContextCopy(item.html, context),
    text: formationContextCopy(item.text, context),
  }))
}`,
  'lead email context',
)

lead = replaceRequired(
  lead,
  `async function reserveSubscription(supabase, emailHash, tokenHash, now = new Date()) {
  const payload = {
    email_hash: emailHash,
    status: 'pending',
    source: FORMATION_EMAIL_SOURCE,
    consent_version: FORMATION_EMAIL_CONSENT_VERSION,`,
  `async function reserveSubscription(supabase, emailHash, tokenHash, now = new Date(), consent = formationLeadConsent()) {
  const payload = {
    email_hash: emailHash,
    status: 'pending',
    source: consent.source,
    consent_version: consent.consentVersion,`,
  'lead reservation consent',
)

lead = replaceRequired(
  lead,
  '    const reservation = await reserveSubscription(supabase, emailHash, tokenHash)',
  '    const reservation = await reserveSubscription(supabase, emailHash, tokenHash, new Date(), formationLeadConsent(req.body?.origin))',
  'lead reservation call',
)

lead = replaceRequired(
  lead,
  '      const sequence = buildFormationEmailSequence({ unsubscribeToken })',
  '      const sequence = buildFormationEmailSequence({ unsubscribeToken, origin: req.body?.origin })',
  'lead sequence origin',
)

await writeFile(leadPath, lead)

let legal = await readFile(legalPath, 'utf8')

legal = replaceRequired(
  legal,
  'Après votre tirage Oracle gratuit ou directement depuis la page Formation, vous pouvez demander',
  'Après votre tirage Oracle gratuit, à la fin du quiz des canaux de perception ou directement depuis la page Formation, vous pouvez demander',
  'privacy quiz entry point',
)

await writeFile(legalPath, legal)

console.log('MediumIA home growth path: quiz route, home sections, quiz metrics, pilotage and quiz consent applied')
