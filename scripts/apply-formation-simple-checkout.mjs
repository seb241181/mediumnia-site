import { readFile, writeFile } from 'node:fs/promises'

// Page Formation simplifiée (mobile d'abord) : la Découverte à 29 € en premier,
// un bouton toujours visible, les consentements contrôlés au moment de
// poursuivre, les 3 exercices offerts hors de l'accordéon de l'assistant, les
// mensualités et le paiement complet en section secondaire.
// Dernier patch du prebuild : les ancres visent la page APRÈS les patchs
// historiques (formation-proof, funnel, email-lead, discovery-offer).
// Aucune règle commerciale ni aucun montant serveur n'est modifié.

const pagePath = new URL('../src/components/FormationPage.jsx', import.meta.url)
const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)
const SENTINEL = 'data-formation-ux="simple-checkout-v1"'

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Formation simple checkout patch drift: ${label}`)
  return source.slice(0, first) + after + source.slice(first + before.length)
}

// Remplace [début, fin) : le début est unique, la fin est la première occurrence après lui.
function replaceBetween(source, start, end, replacement, label) {
  const from = source.indexOf(start)
  if (from < 0 || source.indexOf(start, from + start.length) >= 0) throw new Error(`Formation simple checkout patch drift: ${label} (début)`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`Formation simple checkout patch drift: ${label} (fin)`)
  return source.slice(0, from) + replacement + source.slice(to)
}

let page = await readFile(pagePath, 'utf8')

if (!page.includes(SENTINEL)) {
  // ── Imports et état devenus inutiles (montants mensuels hors du premier écran) ──
  page = replaceOnce(page, "import { money, parcoursFaqAnswer, useParcoursOffer } from '../lib/parcoursOffer.js'", "import { parcoursFaqAnswer, useParcoursOffer } from '../lib/parcoursOffer.js'", 'parcours import')
  page = replaceOnce(page, "export default function FormationPage({ onBack, onNavigate }) {\n  const offer = useParcoursOffer()\n", "export default function FormationPage({ onBack, onNavigate }) {\n", 'page offer')

  // ── Constantes : contenu de la Découverte (inchangé), sommaire réordonné ──
  page = replaceBetween(page, 'const HERO_APPORTS = [', 'const FORMATION_SECTIONS = [', `// Contenu exact de la Découverte (inchangé, désormais visible sans clic).
const DISCOVERY_ITEMS = ['Introduction complète', 'Module 1 — L’Intention comme Porte', 'Exercices du Module 1', 'Carnet de pratique intégré', 'Assistant MediumIA facultatif pendant 30 jours', 'PDF Découverte personnel']

`, 'hero apports')
  page = replaceBetween(page, 'const FORMATION_SECTIONS = [', '// Téléphone, tablette et petits écrans', `const FORMATION_SECTIONS = [
  { id: 'offre', label: 'Formules' },
  { id: 'formation-complete', label: 'Formation complète' },
  { id: 'rencontres', label: 'Visios 2027' },
  { id: 'formation-exercices-gratuits', label: 'Exercices offerts' },
  { id: 'programme', label: 'Programme' },
  { id: 'formation-apercu-reel', label: 'Aperçu' },
  { id: 'formateur', label: 'À propos' },
  { id: 'faq', label: 'FAQ' },
]

`, 'sections')
  page = replaceOnce(page, 'font-georgia text-xs font-bold text-gold">Rejoindre</a>', 'font-georgia text-xs font-bold text-gold">Commencer</a>', 'section bar cta')
  page = replaceOnce(page, "<PageRail items={FORMATION_SECTIONS} cta={{ label: 'Rejoindre la formation', target: 'offre' }} />", "<PageRail items={FORMATION_SECTIONS} cta={{ label: 'Commencer — 29 €', target: 'offre' }} />", 'page rail cta')

  // ── Exercices offerts : présentés comme une première expérience ──
  page = replaceOnce(page, 'mb-3">Expérimenter avant de décider</p>', 'mb-3">Une première expérience</p>', 'lead eyebrow')
  page = replaceOnce(page, 'leading-tight mb-3">Vous voulez d’abord essayer par vous-même ?</h2>', 'leading-tight mb-3">Trois exercices offerts, pour commencer à pratiquer</h2>', 'lead title')
  page = replaceOnce(page, 'Recevez gratuitement trois exercices réellement issus de MediumIA pour explorer l’intention, la perception et le discernement avant de décider si vous souhaitez rejoindre le parcours complet.',
    'Trois exercices issus de la méthode MediumIA, reçus par e-mail sur quelques jours, pour explorer l’intention, la perception et le discernement. Un premier contact avec la pratique : la formation, elle, va beaucoup plus loin.', 'lead text')

  // Mobile : les 3 exercices sur une ligne, section plus compacte.
  page = replaceOnce(page, 'id="formation-exercices-gratuits" className="px-6 py-16 bg-deep/[0.04]"', 'id="formation-exercices-gratuits" className="px-6 py-10 md:py-14 bg-deep/[0.04] scroll-mt-40"', 'lead section')
  page = replaceOnce(page, '<div className="grid sm:grid-cols-3 gap-3 mb-7">', '<div className="grid grid-cols-3 gap-2 md:gap-3 mb-6">', 'lead grid')
  page = replaceOnce(page, '<div key={num} className="rounded-xl border border-gold/20 bg-cream/60 p-4 text-center">', '<div key={num} className="rounded-xl border border-gold/20 bg-cream/60 px-2 py-3 md:p-4 text-center">', 'lead card')

  // ── Paiement : bouton visible tout de suite, consentements vérifiés au clic ──
  page = replaceOnce(page, `  const [success, setSuccess] = useState(false)
  const containerRef = useRef(null)
`, `  const [success, setSuccess] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [consentError, setConsentError] = useState(false)
  const termsRef = useRef(null)
  const immediateRef = useRef(null)
  const containerRef = useRef(null)
  const consentsGiven = termsAccepted && immediateAccessAccepted
  const showButtons = revealed && consentsGiven

  // Les cases restent obligatoires et non précochées : elles sont vérifiées
  // quand l'acheteur veut poursuivre, au lieu de cacher le bouton.
  function continueToPayment() {
    if (!consentsGiven) {
      setConsentError(true)
      // Case visible au centre (pas sous la barre fixe), puis focus clavier.
      const box = (termsAccepted ? immediateRef : termsRef).current
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      box?.focus({ preventScroll: true })
      return
    }
    setRevealed(true)
  }
`, 'checkout state')
  page = replaceOnce(page, '    if (!config || !termsAccepted || !immediateAccessAccepted || success) return\n', '    if (!config || !showButtons || success) return\n', 'checkout gate')
  page = replaceOnce(page, '  }, [config, termsAccepted, immediateAccessAccepted, success, product])', '  }, [config, showButtons, success, product])', 'checkout deps')
  const ON_ERROR = "          onError: (err) => setStatus(/price_changed|discovery_credit_unavailable|session_expired/.test(String(err?.message || '')) ? 'Le montant à régler a changé depuis l’affichage de la page (vérification de votre Découverte). Rechargez la page avant de payer : rien n’a été débité.' : 'Le paiement n’a pas pu aboutir. Vous pouvez réessayer sans être débité deux fois.'),\n"
  page = replaceOnce(page, "          onCancel: () => setStatus('Paiement annulé. Aucun accès n’a été activé.'),\n" + ON_ERROR,
    "          onCancel: () => {\n            trackMediumiaMetric('formation_payment_cancelled', 'formation')\n            setStatus('Paiement annulé. Aucun accès n’a été activé.')\n          },\n"
    + "          onError: (err) => {\n            trackMediumiaMetric('formation_payment_failed', 'formation')\n" + ON_ERROR.replace('          onError: (err) => setStatus(', '            setStatus(').replace(".'),\n", ".')\n") + "          },\n", 'checkout metrics')
  page = replaceOnce(page, '<input type="checkbox" checked={termsAccepted}', '<input ref={termsRef} type="checkbox" checked={termsAccepted}', 'terms ref')
  page = replaceOnce(page, '<input type="checkbox" checked={immediateAccessAccepted}', '<input ref={immediateRef} type="checkbox" checked={immediateAccessAccepted}', 'immediate ref')
  page = replaceOnce(page, `          <div ref={containerRef} className={termsAccepted && immediateAccessAccepted ? 'min-h-[48px]' : 'hidden'} />
          {(!termsAccepted || !immediateAccessAccepted) && (
            <p className="font-georgia text-xs text-mist text-center italic">Cochez les deux cases ci-dessus pour afficher les boutons de paiement : carte bancaire (sans compte PayPal) ou PayPal, en une ou plusieurs fois.</p>
          )}`, `          {!showButtons && (
            <button type="button" onClick={continueToPayment} className="w-full font-georgia px-7 py-4 rounded-lg bg-deep text-gold font-bold text-base">
              {isDiscovery ? 'Commencer ma découverte — 29 €' : 'Continuer vers le paiement'}
            </button>
          )}
          {consentError && !consentsGiven && <p role="alert" className="font-georgia text-sm text-red-700 text-center mt-3">Pour continuer, cochez les deux cases ci-dessus.</p>}
          {showButtons && <p className="font-georgia text-sm text-deep text-center mb-3">Choisissez votre moyen de paiement :</p>}
          <div ref={containerRef} className={showButtons ? 'min-h-[48px]' : 'hidden'} />
          <p className="font-georgia text-xs text-mist text-center mt-3">Paiement sécurisé par PayPal. Quand PayPal le propose, vous pouvez aussi payer par carte bancaire.</p>`, 'checkout button')

  // ── Premier écran : la Découverte, en quelques secondes ──
  page = replaceBetween(page, '        {/* ── Premier écran : quoi, pour qui, ce que ça apporte, prix, comment rejoindre ── */}', '        <section id="offre"', `        {/* ── Premier écran : ce qu'on apprend, ce que l'on reçoit pour 29 €, comment commencer ── */}
        <section id="formation-top" data-formation-positioning="human-first-v1" className="px-6 pt-6 pb-8 md:pt-12 md:pb-16">
          <div className="max-w-6xl mx-auto grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Formation MediumIA · en ligne</p>
              <h1 className="font-georgia font-medium text-4xl md:text-6xl leading-[1.08] mb-5">Développer sa médiumnité, pas à pas</h1>
              <p className="font-georgia text-lg md:text-xl text-deep/85 leading-relaxed">J’ai conçu et écrit cette méthode à partir de plus de douze ans de pratique, pour vous aider à comprendre ce que vous percevez, dans la clarté et à votre rythme.</p>
            </div>
            <aside className="rounded-2xl border-2 border-gold/55 bg-white/90 p-5 md:p-8 shadow-[0_18px_50px_rgba(26,21,53,0.08)]" aria-label="La Découverte en bref">
              <p className="font-georgia text-xs uppercase tracking-[0.18em] text-gold mb-2">Formation complète</p>
              <p className="font-georgia text-deep leading-none mb-3"><span className="text-5xl font-medium">597 €</span> <span className="text-base text-mist">TTC</span></p>
              <p className="font-georgia text-sm text-mist leading-relaxed mb-4">25 modules, 84 exercices guidés et accès immédiat à la méthode complète.</p>
              <div className="flex flex-col gap-3">
                <button type="button" onClick={() => goTo('formation-complete')} className="font-georgia px-5 py-3 rounded-lg bg-deep text-gold font-bold">Voir la formation complète →</button>
                <button type="button" onClick={() => goTo('formation-decouverte')} className="font-georgia px-4 py-2 rounded-lg border border-gold/50 text-deep font-medium">Ou commencer par 29 €</button>
              </div>
            </aside>
          </div>
        </section>

        {/* ── Ce qui rend la méthode particulière : trois repères, sans promesse de résultat ── */}
        <section className="px-6 pb-10" aria-labelledby="formation-methode">
          <div className="max-w-5xl mx-auto">
            <h2 id="formation-methode" className="font-georgia font-medium text-2xl md:text-3xl text-center mb-6">Ce qui rend cette méthode particulière</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {[POINTS[0], POINTS[1], POINTS[3]].map((p) => (
                <div key={p.titre} className="rounded-xl border border-gold/25 bg-white/60 p-5">
                  <p className="font-georgia text-deep font-medium mb-2"><span className="text-gold mr-2" aria-hidden="true">✦</span>{p.titre}</p>
                  <p className="font-georgia text-sm text-mist leading-relaxed">{p.texte}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

`, 'hero')

  // ── Offre : la Découverte d'abord ; mensualités et 597 € en section secondaire ──
  page = replaceOnce(page, '        <FormationExerciseLead />\n', '', 'lead out of assistant accordion')
  page = replaceBetween(page, '        <section id="offre"', '        <section className="bg-deep/[0.04] px-6 py-12">', `        <section id="offre" ${SENTINEL} className="px-6 py-12 scroll-mt-40">
          <div className="max-w-5xl mx-auto">
            <div className="mb-7 text-center">
              <p className="font-georgia text-gold tracking-[0.2em] uppercase text-xs mb-2">Trois façons de commencer</p>
              <h2 className="font-georgia text-3xl md:text-4xl font-medium text-deep mb-3">Choisissez votre formule MediumIA</h2>
              <p className="font-georgia text-sm md:text-base text-mist max-w-2xl mx-auto">La formation complète comprend 25 modules et 84 exercices. Accédez-y directement ou commencez par la Découverte, sans obligation de poursuivre.</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
              <div id="formation-complete" className="scroll-mt-40 rounded-2xl border-2 border-gold/60 bg-white/90 p-6 md:p-8 shadow-[0_16px_46px_rgba(26,21,53,0.09)]">
                <p className="font-georgia text-xs font-bold tracking-[0.2em] uppercase text-gold mb-2">La formation intégrale</p>
                <h3 className="font-georgia text-2xl md:text-3xl font-medium text-deep mb-2">Formation complète · 597 € TTC</h3>
                <p className="font-georgia text-sm text-mist leading-relaxed mb-5">Débloquez directement les 25 modules, les 84 exercices guidés, votre carnet de pratique et les contenus PDF téléchargeables.</p>
                <ul className="font-georgia text-sm text-deep space-y-2 mb-6">
                  {['25 modules en 4 niveaux', '84 exercices guidés', 'Application MediumIA et assistant facultatif', "12 mois d’accès à l’application ; PDF personnels conservés", 'Cinq rencontres en visio 2027 selon les conditions annoncées'].map((item) => (
                    <li key={item} className="flex gap-3 items-start"><span className="text-gold shrink-0" aria-hidden="true">✓</span><span>{item}</span></li>
                  ))}
                </ul>
                <FormationCreditNotice />
                <FormationCheckout />
              </div>
              <div id="formation-decouverte" className="scroll-mt-40 rounded-2xl border-2 border-gold/35 bg-white/85 p-6 md:p-8 shadow-[0_16px_46px_rgba(26,21,53,0.07)]">
                <p className="font-georgia text-xs font-bold tracking-[0.2em] uppercase text-gold mb-2">Sans obligation de poursuivre</p>
                <h3 className="font-georgia text-2xl md:text-3xl font-medium text-deep mb-2">Découverte · 29 € TTC</h3>
                <p className="font-georgia text-sm text-mist mb-5">Essayez l'introduction et le Module 1 complet avant de décider. Les 29 € sont déduits du prix total de 597 € si vous poursuivez.</p>
                <ul className="font-georgia text-sm text-deep space-y-2 mb-6">
                  {DISCOVERY_ITEMS.map((item) => (
                    <li key={item} className="flex gap-3 items-start"><span className="text-gold shrink-0" aria-hidden="true">✓</span><span>{item}</span></li>
                  ))}
                </ul>
                <FormationCheckout product="discovery" />
              </div>
            </div>
            <div id="formation-progressive" className="scroll-mt-40">
              <ParcoursOffer />
            </div>
          </div>
        </section>

        <FormationExerciseLead />

`, 'offer')

  // ── Visios 2027 : visibles immédiatement avant les trois exercices offerts ──
  // Le script déplace la section après l'offre ; elle reste hors de l'accordéon.
  const rencontresMarker = '        <section id="rencontres"'
  const rencontresStart = page.indexOf(rencontresMarker)
  if (rencontresStart < 0 || page.indexOf(rencontresMarker, rencontresStart + 1) >= 0) {
    throw new Error('Formation simple checkout patch drift: section rencontres')
  }
  const rencontresClosing = '\n        </section>\n'
  const rencontresEnd = page.indexOf(rencontresClosing, rencontresStart)
  if (rencontresEnd < 0) throw new Error('Formation simple checkout patch drift: fin rencontres')
  const rencontresMarkup = page.slice(rencontresStart, rencontresEnd + rencontresClosing.length)
  page = replaceOnce(page, rencontresMarkup, '', 'remove old rencontres position')
  page = replaceOnce(page, '        <FormationExerciseLead />\n', `${rencontresMarkup}\n        <FormationExerciseLead />\n`, 'visios directly before free exercises')

  // ── Accordéon de l'assistant : l'outil seul ──
  page = replaceOnce(page, 'Ouvrir uniquement si vous souhaitez essayer l’outil complémentaire ou recevoir les exercices offerts.', 'Ouvrir pour essayer l’outil complémentaire : 5 messages offerts, sans inscription.', 'assistant summary')
  page = replaceOnce(page, 'Si vous le souhaitez, vous pouvez aussi essayer l’assistant ou recevoir 3 exercices par e-mail.', 'Si vous le souhaitez, vous pouvez aussi essayer l’assistant.', 'assistant intro')

  // ── Fin de page : un seul appel, sans tableau de chiffres ──
  page = replaceBetween(page, '        <section className="px-6 py-14 text-center border-t border-gold/20">
          <h2 className="font-georgia text-2xl text-deep mb-2">Choisissez votre formation</h2>
          <p className="font-georgia text-sm text-mist mb-6">597 € TTC pour les 25 modules, ou Découverte à 29 € pour commencer sans engagement.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => goTo('formation-complete')} className="font-georgia px-7 py-4 rounded-lg bg-deep text-gold font-bold">Accéder à la formation complète — 597 €</button>
            <button type="button" onClick={() => goTo('formation-decouverte')} className="font-georgia px-7 py-4 rounded-lg border-2 border-gold/40 text-deep font-bold">Découverte — 29 €</button>
          </div>
          <div className="mt-8"><button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">← Retour à MediumIA</button></div>
        </section>
`, 'final cta')

  await writeFile(pagePath, page)
}

// Mesure (compteurs journaliers, aucune donnée personnelle) : annulation et
// échec du paiement, pour distinguer un abandon d'un incident.
let analytics = await readFile(analyticsPath, 'utf8')
if (!analytics.includes("'formation_payment_failed'")) {
  analytics = replaceOnce(analytics, "  'formation_purchase_completed',\n", "  'formation_purchase_completed',\n  'formation_payment_cancelled',\n  'formation_payment_failed',\n", 'analytics events')
  await writeFile(analyticsPath, analytics)
}

console.log('MediumIA Formation: simple Discovery checkout applied')
