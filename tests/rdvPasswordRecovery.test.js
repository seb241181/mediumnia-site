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

test('la demande de récupération utilise le handler Resend Preview isolé', async () => {
  const recovery = await readFile(new URL('src/components/rdv/RdvPasswordRecovery.jsx', root), 'utf8')
  const handler = await readFile(new URL('lib/rdvAuthRecoveryApiHandler.js', root), 'utf8')
  const rdvBook = await readFile(new URL('api/rdv-book.js', root), 'utf8')
  const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'))

  assert.match(recovery, /fetch\('\/api\/rdv-auth-recovery'/)
  assert.match(recovery, /Si cette adresse correspond à votre compte praticien/)
  assert.match(handler, /process\.env\.VERCEL_ENV !== 'preview'/)
  assert.match(handler, /process\.env\.VERCEL_GIT_COMMIT_REF !== SANDBOX_BRANCH/)
  assert.match(handler, /wnbwhnqiulsdjcvkuwos\.supabase\.co/)
  assert.match(handler, /supabase\.auth\.admin\.generateLink/)
  assert.match(handler, /data\?\.properties\?\.hashed_token/)
  assert.match(handler, /#token_hash=/)
  assert.doesNotMatch(handler, /properties\?\.action_link/)
  assert.match(handler, /sendEmail\(/)
  assert.match(handler, /consume_api_rate_limit/)
  assert.match(rdvBook, /handleRdvAuthRecoveryApi/)
  assert.match(rdvBook, /req\.query\?\.rdv_auth_recovery === '1'/)

  const rewrite = vercel.rewrites.find(item => item.source === '/api/rdv-auth-recovery')
  assert.deepEqual(rewrite, {
    source: '/api/rdv-auth-recovery',
    destination: '/api/rdv-book?rdv_auth_recovery=1',
  })
})

test('la connexion praticien propose la récupération du mot de passe', async () => {
  const dashboard = await readFile(new URL('src/components/rdv/RdvDashboard.jsx', root), 'utf8')
  assert.match(dashboard, /href="\/rdv\/reset-password"/)
  assert.match(dashboard, /Mot de passe oublié \?/)
})

test('la route de récupération précède la route publique RDV générique', async () => {
  const app = await readFile(new URL('src/App.jsx', root), 'utf8')
  const recoveryRoute = app.indexOf("p === '/rdv/reset-password'")
  const publicRoute = app.indexOf("p.startsWith('/rdv/')")

  assert.ok(recoveryRoute > -1 && recoveryRoute < publicRoute)
  assert.match(app, /<RdvPasswordRecovery onBack=\{backHome\} \/>/)
})
