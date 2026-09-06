import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronospherePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const footerPath = new URL('../src/components/LegalFooter.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA route/CRO patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = replaceRequired(
  app,
  `import SiteGuardian from './components/SiteGuardian'`,
  `import SiteGuardian from './components/SiteGuardian'\nimport { reseauPractitioners } from './data/reseauPractitioners.js'`,
  'route SEO practitioner data import',
)

const routeSeoHelpers = `const ROUTE_META = {
  home: {
    title: 'MediumIA — Médiumnité, formation, consultations & réseau',
    description: 'MediumIA réunit formation à la médiumnité, consultations, Chronosphère, Oracle Au-delà de l’Âme et réseau de praticiens du spirituel et du bien-être.',
  },
  formation: {
    title: 'Formation à la médiumnité consciente — MediumIA',
    description: 'Découvrez l’accompagnement MediumIA : 25 modules, 84 exercices guidés, assistant personnel et 12 mois d’accès pour structurer votre pratique médiumnique.',
  },
  oracle: {
    title: 'Oracle Au-delà de l’Âme — Tirage offert | MediumIA',
    description: 'Découvrez l’Oracle Au-delà de l’Âme et réalisez un tirage test offert avec interprétation personnalisée par Lumïa.',
  },
  chronosphere: {
    title: 'Chronosphère 999 — Oracle des Lignes de Temps | MediumIA',
    description: 'Explorez une ligne de temps personnalisée à partir de votre thème, de trois fréquences de l’Oracle et d’un contexte astrologique calculé.',
  },
  'chronosphere-example': {
    title: 'Exemple de tirage Chronosphère 999 | MediumIA',
    description: 'Découvrez un exemple complet de lecture Chronosphère 999 avant de réaliser votre propre tirage.',
  },
  'reseau-dir': {
    title: 'Réseau MediumIA — Trouver un praticien',
    description: 'Découvrez les praticiens du Réseau MediumIA et trouvez un accompagnement selon votre besoin, votre pratique et votre localisation.',
  },
  'reseau-form': {
    title: 'Rejoindre le Réseau MediumIA — Praticiens',
    description: 'Présentez votre pratique et rejoignez le Réseau MediumIA, pensé pour relier praticiens et personnes en recherche d’accompagnement.',
  },
  conferences: {
    title: 'Conférences MediumIA — Rencontres et directs',
    description: 'Découvrez les futures conférences MediumIA : transmission, échanges en direct, questions du public et réservation depuis MediumIA.',
  },
}

function ensureHeadElement(selector, create) {
  let node = document.head.querySelector(selector)
  if (!node) {
    node = create()
    document.head.appendChild(node)
  }
  return node
}

function routeMeta(view) {
  if (view === 'reseau-profile') {
    const slug = window.location.pathname.split('/').filter(Boolean)[1] || ''
    const practitioner = reseauPractitioners.find((item) => item.id === slug)
    if (practitioner) {
      return {
        title: \`${practitioner.name} — ${practitioner.role} | Réseau MediumIA\`,
        description: \`Découvrez le profil de ${practitioner.name}, ${practitioner.role}${practitioner.city ? ` à ${practitioner.city}` : ''}, membre du Réseau MediumIA.\`,
      }
    }
  }
  return ROUTE_META[view] || ROUTE_META.home
}

function applyRouteMeta(view) {
  const meta = routeMeta(view)
  const canonicalUrl = \`https://mediumia.fr${window.location.pathname === '/' ? '/' : window.location.pathname.replace(/\/$/, '')}\`
  const isPrivate = view === 'rdv-dashboard' || view === 'rdv-cancellation'

  document.title = meta.title

  const description = ensureHeadElement('meta[name="description"]', () => {
    const node = document.createElement('meta')
    node.setAttribute('name', 'description')
    return node
  })
  description.setAttribute('content', meta.description)

  const robots = ensureHeadElement('meta[name="robots"]', () => {
    const node = document.createElement('meta')
    node.setAttribute('name', 'robots')
    return node
  })
  robots.setAttribute('content', isPrivate ? 'noindex,follow' : 'index,follow,max-image-preview:large')

  const canonical = ensureHeadElement('link[rel="canonical"]', () => {
    const node = document.createElement('link')
    node.setAttribute('rel', 'canonical')
    return node
  })
  canonical.setAttribute('href', canonicalUrl)

  for (const [property, content] of [
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:url', canonicalUrl],
  ]) {
    const node = ensureHeadElement(\`meta[property="${property}"]\`, () => {
      const element = document.createElement('meta')
      element.setAttribute('property', property)
      return element
    })
    node.setAttribute('content', content)
  }

  for (const [name, content] of [
    ['twitter:title', meta.title],
    ['twitter:description', meta.description],
  ]) {
    const node = ensureHeadElement(\`meta[name="${name}"]\`, () => {
      const element = document.createElement('meta')
      element.setAttribute('name', name)
      return element
    })
    node.setAttribute('content', content)
  }
}

`

app = replaceRequired(
  app,
  `function pathToView(p) {`,
  `${routeSeoHelpers}function pathToView(p) {`,
  'route SEO helpers',
)

app = replaceRequired(
  app,
  `  useEffect(() => {\n    const onPop = () => setView(pathToView(window.location.pathname))\n    window.addEventListener('popstate', onPop)\n    return () => window.removeEventListener('popstate', onPop)\n  }, [])`,
  `  useEffect(() => {\n    const onPop = () => setView(pathToView(window.location.pathname))\n    window.addEventListener('popstate', onPop)\n    return () => window.removeEventListener('popstate', onPop)\n  }, [])\n\n  useEffect(() => {\n    applyRouteMeta(view)\n  }, [view])`,
  'route SEO effect',
)

await writeFile(appPath, app)

let chronosphere = await readFile(chronospherePath, 'utf8')

chronosphere = replaceRequired(
  chronosphere,
  `              Ces informations servent aux calculs astrologiques du tirage : ciel natal, Ascendant, Milieu du Ciel, maisons et fenêtres temporelles.`,
  `              Ces informations servent aux calculs astrologiques du tirage : ciel natal, Ascendant, Milieu du Ciel, maisons et fenêtres temporelles. L’heure de naissance est nécessaire pour conserver des calculs cohérents : aucune heure approximative n’est inventée.`,
  'Chronosphere birth-data explanation',
)

chronosphere = replaceRequired(
  chronosphere,
  `                  Heure exacte`,
  `                  Heure exacte de naissance`,
  'Chronosphere birth-time label',
)

chronosphere = replaceRequired(
  chronosphere,
  `                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"\n                />\n              </div>\n              <div className="md:col-span-2">`,
  `                  className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/60 disabled:opacity-60"\n                />\n                <p className="mt-1.5 font-georgia text-xs leading-relaxed text-mist">\n                  Indispensable pour calculer l’Ascendant, le Milieu du Ciel et les maisons. Si vous ne la connaissez pas, vérifiez votre acte de naissance avant de lancer le tirage.\n                </p>\n              </div>\n              <div className="md:col-span-2">`,
  'Chronosphere exact-time helper',
)

chronosphere = replaceRequired(
  chronosphere,
  `            {/* Numbers */}\n            <div className="mb-7 grid grid-cols-3 gap-3 md:gap-5">`,
  `            {/* Numbers */}\n            <div className="mb-4 rounded-xl border border-gold/25 bg-gold/[.06] px-4 py-3.5">\n              <p className="font-georgia text-sm leading-relaxed text-deep/80">\n                Choisissez spontanément <strong className="text-deep">trois nombres différents entre 1 et 58</strong>. Le premier porte l’axe principal du tirage ; les deux suivants servent de résonances. Il n’y a pas de bon ou de mauvais choix.\n              </p>\n            </div>\n            <div className="mb-7 grid grid-cols-3 gap-3 md:gap-5">`,
  'Chronosphere number-choice explanation',
)

chronosphere = replaceRequired(
  chronosphere,
  `                    <span className={\`mt-1 block font-georgia text-xs \${selectedProduct === 'pack3' ? 'text-cream/70' : 'text-mist'}\`}>3 tirages</span>`,
  `                    <span className={\`mt-1 block font-georgia text-xs \${selectedProduct === 'pack3' ? 'text-cream/70' : 'text-mist'}\`}>3 tirages · les suivants quand vous voulez</span>`,
  'Chronosphere pack card value',
)

chronosphere = replaceRequired(
  chronosphere,
  `                      ? 'Votre achat comprend 3 tirages Chronosphère, utilisables maintenant ou plus tard.'`,
  `                      ? 'Votre achat comprend 3 tirages Chronosphère. Après chaque lecture, l’e-mail contient votre lien personnel pour reprendre les tirages restants quand vous le souhaitez.'`,
  'Chronosphere pack resume value before payment',
)

chronosphere = replaceRequired(
  chronosphere,
  `                        : 'Un paiement unique pour 3 tirages complets avec envoi de chaque compte rendu par e-mail.'}`,
  `                        : 'Un paiement unique pour 3 tirages complets. Après chaque lecture, l’e-mail contient votre lien personnel pour reprendre les tirages restants.'}`,
  'Chronosphere pack resume value payment',
)

await writeFile(chronospherePath, chronosphere)

let footer = await readFile(footerPath, 'utf8')

footer = replaceRequired(
  footer,
  `      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-georgia text-[11px] text-mist/60">`,
  `      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 font-georgia text-xs text-mist/60 sm:gap-x-3 sm:text-[11px]">`,
  'mobile footer spacing',
)

footer = footer.replaceAll(
  `className="hover:text-gold transition-colors"`,
  `className="inline-flex min-h-11 items-center rounded-lg px-2 hover:text-gold transition-colors"`,
)

await writeFile(footerPath, footer)

console.log('MediumIA route/CRO sprint: per-route SEO, Chronosphere clarity and mobile footer applied')
