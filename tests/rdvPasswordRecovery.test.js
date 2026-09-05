import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url)

test('le lien de récupération attend une action humaine avant de consommer le jeton', async () => {
  const recovery = await readFile(new URL('src/components/rdv/RdvPasswordRecovery.jsx', root), 'utf8')

  assert.match(recovery, /window\.location\.hash/)
  assert.match(recovery, /token_hash: tokenHash/)
  assert.match(recovery, /type: 'recovery'/)
  assert.match(recovery, /supabase\.auth\.verifyOtp/)
  assert.match(recovery, /supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.doesNotMatch(recovery, /useEffect/)

  const submitIndex = recovery.indexOf('async function handleSubmit')
  const verifyIndex = recovery.indexOf('supabase.auth.verifyOtp')
  assert.ok(submitIndex > -1 && verifyIndex > submitIndex)
})

test('la route de récupération précède la route publique RDV générique', async () => {
  const app = await readFile(new URL('src/App.jsx', root), 'utf8')
  const recoveryRoute = app.indexOf("p === '/rdv/reset-password'")
  const publicRoute = app.indexOf("p.startsWith('/rdv/')")

  assert.ok(recoveryRoute > -1 && recoveryRoute < publicRoute)
  assert.match(app, /<RdvPasswordRecovery onBack=\{backHome\} \/>/)
})
