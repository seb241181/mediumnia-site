import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const guardianPath = path.join(root, 'src/components/SiteGuardian.jsx')
const indexPath = path.join(root, 'index.html')
const publicDir = path.join(root, 'public')

function writeIfChanged(filePath, content) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  if (current !== content) fs.writeFileSync(filePath, content)
}

// 1) Gardien mobile : empreinte tactile et halo visuel plus discrets sans le supprimer.
let guardian = fs.readFileSync(guardianPath, 'utf8')
guardian = guardian.replace(
  'className="guardian-fab fixed bottom-5 right-5 z-[60] w-[84px] h-[84px] md:w-[100px] md:h-[100px] rounded-full flex items-center justify-center transition-all overflow-hidden"',
  'className="guardian-fab fixed bottom-4 right-4 z-[60] w-[64px] h-[64px] md:w-[100px] md:h-[100px] rounded-full flex items-center justify-center transition-all overflow-hidden"',
)

if (!guardian.includes('@keyframes guardian-breathe-mobile')) {
  const anchor = `        @keyframes guardian-appear {`
  const mobileKeyframes = `        @keyframes guardian-breathe-mobile {\n          0%, 100% {\n            box-shadow: 0 0 10px 3px rgba(201,168,76,0.25), 0 0 22px 6px rgba(90,60,140,0.1);\n            transform: scale(1);\n          }\n          50% {\n            box-shadow: 0 0 16px 5px rgba(201,168,76,0.34), 0 0 28px 8px rgba(90,60,140,0.14);\n            transform: scale(1.018);\n          }\n        }\n`
  guardian = guardian.replace(anchor, mobileKeyframes + anchor)
}

if (!guardian.includes('@media (max-width: 639px)')) {
  const anchor = `        @media (prefers-reduced-motion: reduce) {`
  const mobileMedia = `        @media (max-width: 639px) {\n          .guardian-fab {\n            animation: guardian-appear 500ms ease-out both, guardian-breathe-mobile 4s ease-in-out 500ms infinite;\n          }\n        }\n`
  guardian = guardian.replace(anchor, mobileMedia + anchor)
}
writeIfChanged(guardianPath, guardian)

// 2) SEO global : MediumIA doit décrire l'écosystème, pas seulement la formation.
let html = fs.readFileSync(indexPath, 'utf8')
html = html
  .replace(
    '<meta name="description" content="Mediumia — Accompagnement à la Médiumnité Consciente par Sébastien Seguin. 25 modules, application mobile, coach IA personnel." />',
    '<meta name="description" content="MediumIA réunit formation à la médiumnité, consultations, Chronosphère, Oracle Au-delà de l’Âme et réseau de praticiens du spirituel et du bien-être." />',
  )
  .replace(
    '<title>Mediumia — Accompagnement à la Médiumnité Consciente</title>',
    '<title>MediumIA — Médiumnité, formation, consultations & réseau</title>',
  )
  .replace(
    '<meta property="og:title" content="Mediumia — Formation à la Médiumnité Consciente" />',
    '<meta property="og:title" content="MediumIA — Le monde spirituel, relié autrement" />',
  )
  .replace(
    '<meta property="og:description" content="25 modules pour apprendre la médiumnité consciente, du premier ressenti à la pratique structurée. Avec un compagnon numérique disponible jour et nuit." />',
    '<meta property="og:description" content="Formation, consultations, Chronosphère, Oracle et réseau de praticiens : découvrez l’écosystème MediumIA créé par Sébastien Seguin." />',
  )
  .replace(
    '<meta property="og:image" content="https://www.mediumia.fr/og-image.jpg" />',
    '<meta property="og:image" content="https://mediumia.fr/og-image.jpg" />',
  )
  .replace(
    '<meta property="og:url" content="https://www.mediumia.fr" />',
    '<meta property="og:url" content="https://mediumia.fr/" />',
  )
  .replace(
    '<meta property="og:site_name" content="Mediumia" />',
    '<meta property="og:site_name" content="MediumIA" />',
  )
  .replace(
    '<meta name="twitter:title" content="Mediumia — Formation à la Médiumnité Consciente" />',
    '<meta name="twitter:title" content="MediumIA — Le monde spirituel, relié autrement" />',
  )
  .replace(
    '<meta name="twitter:description" content="25 modules pour apprendre la médiumnité consciente, avec un compagnon numérique disponible jour et nuit." />',
    '<meta name="twitter:description" content="Formation, consultations, Chronosphère, Oracle et réseau de praticiens au sein d’un même écosystème." />',
  )
  .replace(
    '<meta name="twitter:image" content="https://www.mediumia.fr/og-image.jpg" />',
    '<meta name="twitter:image" content="https://mediumia.fr/og-image.jpg" />',
  )

if (!html.includes('<!-- MediumIA SEO baseline -->')) {
  const seoBaseline = `\n    <!-- MediumIA SEO baseline -->\n    <meta name="robots" content="index,follow,max-image-preview:large" />\n    <link rel="canonical" href="https://mediumia.fr/" />\n    <script type="application/ld+json">\n      {\n        "@context": "https://schema.org",\n        "@type": "WebSite",\n        "name": "MediumIA",\n        "url": "https://mediumia.fr/",\n        "description": "Écosystème dédié à la médiumnité, au spirituel et au bien-être.",\n        "publisher": {\n          "@type": "Organization",\n          "name": "MediumIA",\n          "url": "https://mediumia.fr/",\n          "founder": {\n            "@type": "Person",\n            "name": "Sébastien Seguin"\n          }\n        }\n      }\n    </script>\n`
  html = html.replace('    <!-- Bodoni Moda — pont typographique avec le logo -->', seoBaseline + '\n    <!-- Bodoni Moda — pont typographique avec le logo -->')
}
writeIfChanged(indexPath, html)

// 3) Découverte par les moteurs : fichiers simples, publics et volontairement sans zones privées.
fs.mkdirSync(publicDir, { recursive: true })
writeIfChanged(path.join(publicDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /rdv/annuler\nSitemap: https://mediumia.fr/sitemap.xml\n`)

const urls = [
  '/',
  '/formation',
  '/oracle',
  '/chronosphere',
  '/chronosphere/exemple',
  '/reseau',
  '/reseau/rejoindre',
  '/reseau/amandine-pouwels',
  '/reseau/lydie-lesaffre',
  '/reseau/willy-ryckebusch',
  '/reseau/gilda',
  '/conferences',
  '/pro',
]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>https://mediumia.fr${url}</loc></url>`).join('\n')}\n</urlset>\n`
writeIfChanged(path.join(publicDir, 'sitemap.xml'), sitemap)

console.log('MediumIA mobile/SEO sprint: guardian footprint and crawl baseline applied')
