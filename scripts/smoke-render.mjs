// Opens every public route of the built site (dist/) in a real browser and fails
// on any uncaught JS error or empty render. Run after `npm run build`:
//   npm run smoke
// Needs Playwright + Chromium, e.g. `npx playwright install chromium` once, or set
// PLAYWRIGHT_MODULE / CHROMIUM_PATH to an existing install.
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const dist = join(root, 'dist')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { reseauPractitioners } = await import(pathToFileURL(join(root, 'src/data/reseauPractitioners.js')).href)

const routes = [
  '/', '/formation', '/oracle', '/chronosphere', '/chronosphere/exemple', '/chronosphere-max',
  '/conferences', '/reseau', '/reseau/rejoindre', '/pro', '/mentions', '/confidentialite', '/cgv-oracle', '/cgv-chronosphere', '/retractation', '/avis', '/avis/moderation', '/cartes-cadeaux',
  ...reseauPractitioners.map((practitioner) => `/reseau/${practitioner.id}`),
]

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  let file = join(dist, url)
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch {
    if (!extname(url)) file = join(dist, 'index.html')
  }
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const failures = []
for (const route of routes) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Errors caught by AppErrorBoundary are no longer "uncaught": read them from the console.
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().startsWith('[MediumIA] render error')) errors.push(message.text().slice(0, 200))
  })
  // Only the built site is under test: third-party hosts are cut off.
  await page.route('**/*', (r) => (new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort()))
  try {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(500)
    const { rendered, crashed } = await page.evaluate(() => ({
      rendered: document.getElementById('root')?.innerHTML.length || 0,
      crashed: Boolean(document.querySelector('[data-app-crash]')),
    }))
    if (!rendered) errors.push('empty render')
    if (crashed && !errors.length) errors.push('error boundary fallback shown')
  } catch (error) {
    errors.push(error.message.split('\n')[0])
  }
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${route}${errors.length ? ` — ${errors.join(' | ')}` : ''}`)
  if (errors.length) failures.push(route)
  await page.close()
}
await browser.close()
server.close()

if (failures.length) {
  console.error(`\n${failures.length} page(s) en échec : ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`\n${routes.length} pages OK`)
