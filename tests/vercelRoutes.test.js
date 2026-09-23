import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Vercel only serves the app shell for paths listed in vercel.json rewrites
// (the local smoke server falls back for every path, so it cannot catch this).
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const smoke = fs.readFileSync(new URL('../scripts/smoke-render.mjs', import.meta.url), 'utf8')

function matches(source, path) {
  const pattern = '^' + source.replace(/:[A-Za-z]+/g, '[^/]+') + '$'
  return new RegExp(pattern).test(path)
}

test('every public route checked by the smoke test is routed by Vercel', () => {
  const list = smoke.slice(smoke.indexOf('const routes = ['), smoke.indexOf('...reseauPractitioners'))
  const routes = [...list.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((r) => r !== '/')
  assert.ok(routes.length > 15)
  const missing = routes.filter((route) => !vercel.rewrites.some((rule) => matches(rule.source, route)))
  assert.deepEqual(missing, [], `add a rewrite to /index.html for: ${missing.join(', ')}`)
})
