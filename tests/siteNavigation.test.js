import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('main navigation: validated order, real links, Espace élèves only, Espace Pro out', async () => {
  const nav = await read('src/components/SiteNav.jsx')
  const labels = [...nav.matchAll(/\{ id: '[a-z]+', label: '([^']+)', href: '([^']+)' \}/g)].map((m) => [m[1], m[2]])
  assert.deepEqual(labels, [
    ['Se former', '/formation'],
    ['Consulter', '/#consulter'],
    ['Découvrir', '/#decouvrir'],
    ['Conférences', '/conferences'],
    ['Boutique', '/#boutique'],
    ['Trouver un praticien', '/reseau'],
  ])
  assert.match(nav, /href="https:\/\/espace\.mediumia\.fr"[\s\S]*Espace élèves/)
  assert.doesNotMatch(nav.replace(/^\s*\/\/.*$/gm, ''), /Espace Pro|onOpenPro/)
})

test('phones get a real menu, not a sidebar; keyboard can close it', async () => {
  const nav = await read('src/components/SiteNav.jsx')
  assert.match(nav, /aria-expanded=\{open\}/)
  assert.match(nav, /aria-controls="site-nav-menu"/)
  assert.match(nav, /id="site-nav-menu"/)
  assert.match(nav, /event\.key === 'Escape'/)
  assert.match(nav, /className="hidden min-\[1041px\]:flex/)
  assert.match(nav, /className="site-nav__toggle/)
  const css = await read('src/styles/site-nav.css')
  assert.match(css, /@media \(min-width: 1041px\) \{\n  \.cosmic-nav \.site-nav__toggle \{ display: none; \}/)
})

test('long pages get a discreet « Sur cette page » rail on wide screens only', async () => {
  const [rail, app] = await Promise.all([read('src/components/PageRail.jsx'), read('src/App.jsx')])
  assert.match(rail, /hidden min-\[1360px\]:block/)
  assert.match(rail, /getBoundingClientRect\(\)\.top <= line/)
  assert.match(rail, /window\.scrollY > window\.innerHeight \* 0\.75/)
  assert.match(app, /<PageRail items=\{HOME_RAIL\} \/>/)
})
