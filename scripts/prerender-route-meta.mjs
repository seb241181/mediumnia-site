// Social networks and messaging apps do not run JavaScript: without this step
// every shared link (a practitioner profile, /formation…) previews as the home
// page. After `vite build`, write dist/<route>/index.html copies of the app
// shell whose <head> already carries that route's title, description, canonical
// URL and image. The app itself is unchanged and keeps updating the head at runtime.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const dist = path.join(root, 'dist')
const SITE = 'https://mediumia.fr'
const DEFAULT_IMAGE = `${SITE}/og-image.jpg`

// ROUTE_META is generated into src/App.jsx by scripts/apply-route-seo-cro.mjs
// during prebuild; it is a plain object literal.
export function readRouteMeta(appSource) {
  const match = appSource.match(/const ROUTE_META = (\{[\s\S]*?\n\})\n/)
  if (!match) throw new Error('ROUTE_META not found in src/App.jsx (prebuild must run first)')
  return new Function(`return (${match[1]})`)()
}

const ROUTE_PATHS = {
  formation: '/formation',
  oracle: '/oracle',
  chronosphere: '/chronosphere',
  'chronosphere-example': '/chronosphere/exemple',
  'chronosphere-max': '/chronosphere-max',
  pro: '/pro',
  'reseau-dir': '/reseau',
  'reseau-form': '/reseau/rejoindre',
  conferences: '/conferences',
  avis: '/avis',
}

// Routes with their own share visual (default: the site image).
const ROUTE_IMAGES = {
  conferences: '/images/conference/conference-23-octobre-partage.jpg',
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const absolute = (url) => (/^https?:\/\//.test(url) ? url : `${SITE}${url.startsWith('/') ? '' : '/'}${url}`)

export function withMeta(html, { title, description, url, image = DEFAULT_IMAGE }) {
  const setMeta = (source, attr, key, content) => {
    const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\s*/?>`)
    const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`
    return re.test(source) ? source.replace(re, tag) : source.replace('</head>', `    ${tag}\n  </head>`)
  }
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeText(title)}</title>`)
  out = setMeta(out, 'name', 'description', description)
  out = setMeta(out, 'property', 'og:title', title)
  out = setMeta(out, 'property', 'og:description', description)
  out = setMeta(out, 'property', 'og:url', url)
  out = setMeta(out, 'property', 'og:image', image)
  out = setMeta(out, 'name', 'twitter:title', title)
  out = setMeta(out, 'name', 'twitter:description', description)
  out = setMeta(out, 'name', 'twitter:image', image)
  const canonical = `<link rel="canonical" href="${escapeAttr(url)}" />`
  out = /<link rel="canonical"[^>]*>/.test(out)
    ? out.replace(/<link rel="canonical"[^>]*>/, canonical)
    : out.replace('</head>', `    ${canonical}\n  </head>`)
  return out
}

export function buildPages(shell, routeMeta, practitioners) {
  const pages = [{ file: 'index.html', meta: { ...routeMeta.home, url: `${SITE}/` } }]
  for (const [view, routePath] of Object.entries(ROUTE_PATHS)) {
    if (!routeMeta[view]) continue
    const image = ROUTE_IMAGES[view] ? absolute(ROUTE_IMAGES[view]) : DEFAULT_IMAGE
    pages.push({ file: `${routePath.slice(1)}/index.html`, meta: { ...routeMeta[view], url: SITE + routePath, image } })
  }
  for (const p of practitioners) {
    pages.push({
      file: `reseau/${p.id}/index.html`,
      meta: {
        title: `${p.name} — ${p.role} | Réseau MediumIA`,
        description: `Découvrez le profil de ${p.name}, ${p.role}${p.city ? ` à ${p.city}` : ''}, membre du Réseau MediumIA.`,
        url: `${SITE}/reseau/${p.id}`,
        image: p.portrait ? absolute(p.portrait) : DEFAULT_IMAGE,
      },
    })
  }
  return pages.map(({ file, meta }) => ({ file, html: withMeta(shell, meta) }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
  const routeMeta = readRouteMeta(fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8'))
  const { reseauPractitioners } = await import(pathToFileURL(path.join(root, 'src/data/reseauPractitioners.js')).href)
  const pages = buildPages(shell, routeMeta, reseauPractitioners)
  for (const { file, html } of pages) {
    const target = path.join(dist, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, html)
  }
  console.log(`MediumIA: ${pages.length} pages with their own share preview`)
}
