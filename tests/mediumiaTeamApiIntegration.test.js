import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('team AI uses the existing RDV function and adds no Vercel Hobby function', async () => {
  const json=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'))
  assert.equal(json.functions['api/mediumia-team-demo.js'],undefined)
  assert.equal(json.functions['api/rdv-admin.js']?.maxDuration,60)
  const api=await readFile(new URL('../api/rdv-admin.js',import.meta.url),'utf8')
  const action=api.indexOf("req.query.action === 'mediumia-team-demo'")
  const auth=api.indexOf('const auth = await requireAuth(req)')
  assert.ok(action>0 && action<auth)
  assert.match(api,/import \{ handleMediumiaTeamDemo \} from '\.\.\/lib\/mediumiaTeamDemoApi\.js'/)
  const ui=await readFile(new URL('../src/components/rdv/MediumiaTeamDashboard.jsx',import.meta.url),'utf8')
  assert.equal((ui.match(/\/api\/rdv-admin\?action=mediumia-team-demo/g)||[]).length,2)
  assert.match(ui,/Faire travailler mon équipe IA/)
})
