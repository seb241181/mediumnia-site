import { readFile, writeFile } from 'node:fs/promises'

// Isolation tardive de /arche, une fois tous les anciens patchs appliqués.
// Ne pas modifier App.jsx directement : il sert d'ancre aux patchs historiques.
const appPath = new URL('../src/App.jsx', import.meta.url)
let app = await readFile(appPath, 'utf8')

function replaceOnce(before, after, label) {
  if (app.includes(after)) return
  if (!app.includes(before)) throw new Error('Arche isolation patch drift: ' + label)
  app = app.replace(before, after)
}

if (app.includes("import ArchePage from './components/ArchePage'")) {
  app = app.replace("import ArchePage from './components/ArchePage'\n", '')
}
if (app.includes("import ArchePage from './components/ArchePage'")) throw new Error('Arche eager import persists')

const lazyAnchor = "const ChronosphereMaxPage = lazy(() => import('./components/ChronosphereMaxPage'))"
if (!app.includes("const ArchePage = lazy(() => import('./components/ArchePage'))")) {
  if (!app.includes(lazyAnchor)) throw new Error('Arche lazy anchor drift')
  app = app.replace(lazyAnchor, lazyAnchor+"\nconst ArchePage = lazy(() => import('./components/ArchePage'))")
}
replaceOnce(
  "  if (view === 'arche')        return <ArchePage onBack={backHome} onNavigate={legalNav} />",
  "  if (view === 'arche')        return <DeferredRoute><ArchePage onBack={backHome} onNavigate={legalNav} /></DeferredRoute>",
  'isolate route via Suspense fallback',
)

replaceOnce(
  "robots.setAttribute('content', isPrivate ? 'noindex,follow' : 'index,follow,max-image-preview:large')",
  "robots.setAttribute('content', meta.robots || (isPrivate ? 'noindex,follow' : 'index,follow,max-image-preview:large'))",
  'honor route robots noindex,nofollow',
)
await writeFile(appPath, app)
console.log('Arche: lazy-loaded isolated route, route robots respected')
