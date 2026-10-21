import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('practitioner tabs show the full name and unique slug', async () => {
  const source = await readFile(new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url), 'utf8')
  assert.match(source, /<span className="block">\{p\.name\}<\/span>/)
  assert.match(source, /<span className="block font-mono text-\[10px\] opacity-70">\{p\.slug\}<\/span>/)
  assert.doesNotMatch(source, /p\.name\.split\(' '\)\[0\]/)
})
