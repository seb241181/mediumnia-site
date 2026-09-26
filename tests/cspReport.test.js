import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { summarizeCspReports, handleCspReport } from '../lib/cspReport.js'

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

test('a Report-Only CSP is sent on every page, allowing what the site really loads', () => {
  const all = vercel.headers.find((h) => h.source === '/(.*)').headers
  const csp = all.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value || ''
  assert.ok(!all.some((h) => h.key === 'Content-Security-Policy'), 'observation seulement, rien n’est bloqué')
  for (const needed of ["default-src 'self'", 'https://*.paypal.com', 'https://fonts.gstatic.com', 'https://*.supabase.co', "object-src 'none'", 'report-uri /api/rdv-config?cspReport=1']) {
    assert.ok(csp.includes(needed), needed)
  }
})

test('reports keep only directive, blocked host and page path', () => {
  const legacy = { 'csp-report': { 'document-uri': 'https://mediumia.fr/formation?token=secret', 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?k=1' } }
  assert.deepEqual(summarizeCspReports(JSON.stringify(legacy)), [{ directive: 'script-src-elem', blocked: 'evil.example', page: '/formation' }])
  const modern = [{ type: 'csp-violation', body: { documentURL: 'https://mediumia.fr/', effectiveDirective: 'img-src', blockedURL: 'inline' } }, { type: 'deprecation', body: {} }]
  assert.deepEqual(summarizeCspReports(modern), [{ directive: 'img-src', blocked: 'inline', page: '/' }])
  assert.deepEqual(summarizeCspReports('not json'), [])
  assert.deepEqual(summarizeCspReports('x'.repeat(20000)), [])
})

test('the endpoint answers 204 to POST and never logs query strings', async () => {
  const logs = []; const warn = console.warn; console.warn = (...a) => logs.push(a.join(' '))
  let status = 0
  const res = { status(c) { status = c; return this }, end() { return this }, json() { return this } }
  await handleCspReport({ method: 'POST', body: { 'csp-report': { 'document-uri': 'https://mediumia.fr/a?email=x@y.z', 'effective-directive': 'connect-src', 'blocked-uri': 'https://x.test/p?t=1' } } }, res)
  console.warn = warn
  assert.equal(status, 204)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0], /email|t=1|\?/)
  await handleCspReport({ method: 'GET' }, res)
  assert.equal(status, 405)
})
