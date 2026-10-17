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

// Le code source App.jsx est laissé intact : la route est assemblée après Lumia.
const pathAnchor = "    : p.startsWith('/oracle') ? 'oracle'"
const archePath = "    : p === '/arche' ? 'arche'"
if (!app.includes(archePath)) {
  if (!app.includes(pathAnchor)) throw new Error('Arche isolation patch drift: pathToView oracle anchor')
  app = app.replace(pathAnchor, pathAnchor + '\n' + archePath)
}
const renderAnchor = "  if (view === 'oracle')       return "
const archeRender = "  if (view === 'arche')        return <DeferredRoute><ArchePage onBack={backHome} onNavigate={legalNav} /></DeferredRoute>"
if (!app.includes(archeRender)) {
  const where = app.indexOf(renderAnchor)
  if (where < 0) throw new Error('Arche isolation patch drift: render anchor')
  app = app.slice(0, where) + archeRender + '\n' + app.slice(where)
}
const guardianLine = app.split('\n').find(line => line.startsWith('  const showGuardian ='))
if (!guardianLine) throw new Error('Arche isolation patch drift: guardian line')
if (!guardianLine.includes("view !== 'arche'")) {
  app = app.replace(guardianLine, guardianLine + " && view !== 'arche'")
}
const privateLine = app.split('\n').find(line => line.startsWith('  const isPrivate ='))
if (!privateLine) throw new Error('Arche isolation patch drift: private meta line')
if (!privateLine.includes("view === 'arche'")) {
  app = app.replace(privateLine, privateLine.replace('= ', "= view === 'arche' || "))
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
  "robots.setAttribute('content', isPrivate ? 'noindex,follow' : 'index,follow,max-image-preview:large')",
  "robots.setAttribute('content', meta.robots || (isPrivate ? 'noindex,follow' : 'index,follow,max-image-preview:large'))",
  'honor route robots noindex,nofollow',
)
await writeFile(appPath, app)

// GlobalAccount est monté dans main.jsx, hors de App et de ses gardes visuels.
// Masquer à la source son bouton flottant et toute fenêtre déjà ouverte sur /arche.
const globalAccountPath = new URL('../src/components/GlobalAccount.jsx', import.meta.url)
let globalAccount = await readFile(globalAccountPath, 'utf8')
const hideBefore = "  const hideLauncher = pathname.startsWith('/rdv/')"
const hideAfter = "  const hideLauncher = pathname.startsWith('/rdv/') || pathname === '/arche'"
if (!globalAccount.includes(hideAfter)) {
  if (!globalAccount.includes(hideBefore)) throw new Error('Arche GlobalAccount patch drift: launcher guard')
  globalAccount = globalAccount.replace(hideBefore, hideAfter)
}
const modalBefore = "      {open && ("
const modalAfter = "      {open && !hideLauncher && ("
if (!globalAccount.includes(modalAfter)) {
  if (!globalAccount.includes(modalBefore)) throw new Error('Arche GlobalAccount patch drift: modal guard')
  globalAccount = globalAccount.replace(modalBefore, modalAfter)
}
await writeFile(globalAccountPath, globalAccount)
console.log('Arche: lazy route, correct robots, GlobalAccount launcher/modal hidden on /arche')
