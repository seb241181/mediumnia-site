import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SESSION_ONLY_FLAG, createAuthStorage, isSessionOnly, setRememberMe } from '../src/lib/authStorage.js'
import { PASSWORD_MIN_LENGTH, accountButtonLabel, isPasswordRecoveryUrl, passwordErrorMessage, passwordProblem } from '../src/lib/accountView.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const store = () => {
  const data = new Map()
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
}
const KEY = 'sb-test-auth-token'

test('« Rester connecté » coché : session conservée sur l’appareil, comme avant', () => {
  const local = store(); const session = store()
  const storage = createAuthStorage(local, session)
  setRememberMe(true, local)
  storage.setItem(KEY, 'jeton')
  assert.equal(local.getItem(KEY), 'jeton')
  assert.equal(session.getItem(KEY), null)
  assert.equal(storage.getItem(KEY), 'jeton')
  storage.removeItem(KEY)
  assert.equal(storage.getItem(KEY), null)
})

test('décoché : session limitée à l’onglet, rien ne reste sur l’appareil', () => {
  const local = store(); const session = store()
  const storage = createAuthStorage(local, session)
  local.setItem(KEY, 'ancienne-session')
  setRememberMe(false, local)
  assert.equal(isSessionOnly(local), true)
  storage.setItem(KEY, 'jeton')
  assert.equal(session.getItem(KEY), 'jeton')
  assert.equal(local.getItem(KEY), null)
  // Nouvel onglet ou navigateur rouvert : plus de session.
  assert.equal(createAuthStorage(local, store()).getItem(KEY), null)
  // Recocher à la connexion suivante : retour au stockage durable.
  setRememberMe(true, local)
  assert.equal(local.getItem(SESSION_ONLY_FLAG), null)
  storage.setItem(KEY, 'jeton2')
  assert.equal(local.getItem(KEY), 'jeton2')
  assert.equal(session.getItem(KEY), null)
})

test('stockage indisponible (navigation privée) : jamais d’exception', () => {
  const broken = { getItem() { throw new Error('bloqué') }, setItem() { throw new Error('bloqué') }, removeItem() { throw new Error('bloqué') } }
  const storage = createAuthStorage(broken, broken)
  assert.equal(storage.getItem(KEY), null)
  assert.doesNotThrow(() => { storage.setItem(KEY, 'x'); storage.removeItem(KEY); setRememberMe(false, broken) })
})

test('mot de passe : règles et messages, sans révéler qui a un compte', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8)
  assert.match(passwordProblem('court'), /au moins 8/)
  assert.match(passwordProblem('assezlong1', 'different1'), /pas identiques/)
  assert.equal(passwordProblem('assezlong1', 'assezlong1'), null)
  assert.match(passwordErrorMessage(new Error('Invalid login credentials')), /Adresse e-mail ou mot de passe incorrect/)
  assert.match(passwordErrorMessage(new Error('Password should be at least 6 characters')), /pas assez sûr/)
  assert.match(passwordErrorMessage(new Error('New password should be different from the old password.')), /déjà le vôtre/)
  assert.match(passwordErrorMessage(new Error('Password update requires reauthentication')), /reconnectez-vous/)
  assert.match(passwordErrorMessage(new Error('Email not confirmed')), /code reçu par e-mail/)
  assert.equal(isPasswordRecoveryUrl('#access_token=abc&type=recovery'), true)
  assert.equal(isPasswordRecoveryUrl('#access_token=abc&type=magiclink'), false)
  assert.equal(isPasswordRecoveryUrl('', '?type=recovery'), true)
})

test('le mot de passe n’est jamais stocké ni envoyé à notre serveur', () => {
  const sources = ['src/components/account/AccountPage.jsx', 'src/components/account/PasswordForms.jsx', 'src/lib/authStorage.js', 'src/lib/accountProfile.js'].map(read).join('\n')
  assert.equal(/(localStorage|sessionStorage)\.setItem\([^)]*assword/.test(sources), false)
  assert.equal(/fetch\([^)]*\)[\s\S]{0,200}password/i.test(read('src/components/account/PasswordForms.jsx')), false)
  assert.equal(/password/i.test(read('lib/accountApiHandler.js')), false)
  const auth = read('src/lib/useAuth.js')
  assert.match(auth, /supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.match(auth, /supabase\.auth\.resetPasswordForEmail\(/)
  assert.match(auth, /supabase\.auth\.signInWithPassword\(/)
})

test('connexion : mot de passe, code e-mail toujours proposé, oubli sans énumération', () => {
  const page = read('src/components/account/AccountPage.jsx')
  assert.match(page, /\['password', 'Mot de passe'\], \['code', 'Code par e-mail'\]/)
  assert.match(page, /Rester connecté sur cet appareil/)
  assert.match(page, /setRememberMe\(remember\)\n {4}const \{ error: signInError \} = await signIn\(address, password\)/)
  assert.match(page, /Mot de passe oublié \?/)
  assert.match(page, /Si un espace MediumIA correspond à <strong className="break-all">\{resetSentTo\}/)
  assert.match(page, /event === 'PASSWORD_RECOVERY'/)
  // Pas de création de compte par mot de passe ici : un seul chemin de création, par code.
  assert.equal(/signUp\(/.test(page), false)
  // Définir un mot de passe = mise à jour du compte connecté, donc aucun doublon.
  assert.match(read('src/components/account/ProfileForm.jsx'), /<PasswordSection setPassword=\{setPassword\} \/>/)
})

test('bouton « Mon espace » : prénom si connecté, déconnexion disponible', () => {
  assert.equal(accountButtonLabel({}), 'Mon espace')
  assert.equal(accountButtonLabel({ user: { id: 'u' }, firstName: 'Alice', fullName: 'Alicia Martin' }), 'Alice')
  assert.equal(accountButtonLabel({ user: { id: 'u' }, fullName: 'Alicia Martin' }), 'Alicia')
  assert.equal(accountButtonLabel({ user: { id: 'u' } }), 'Mon espace')
  const account = read('src/components/GlobalAccount.jsx')
  assert.match(account, /window\.location\.assign\('\/mon-espace'\)/)
  assert.match(account, /onClick=\{handleSignOut\}/)
  // Effacer le profil Chronosphère ne supprime plus les coordonnées de l'espace.
  assert.equal(/from\('mediumia_profiles'\)\.delete\(\)/.test(account), false)
})

test('en-tête : bouton « Mon espace » permanent, prénom, profil et déconnexion', () => {
  const nav = read('src/components/SiteNav.jsx')
  assert.match(nav, /Espace élèves\n {10}<\/a>\n {10}<SiteNavAccount \/>/)
  const account = read('src/components/SiteNavAccount.jsx')
  assert.match(account, /href="\/mon-espace" data-site-nav-account/)
  assert.match(account, /accountButtonLabel\(\{ user, firstName \}\)/)
  assert.match(account, /href="\/mon-espace#profil"/)
  assert.match(account, /await signOut\(\)/)
  // Visible à toutes les largeurs : aucune classe qui le masque.
  assert.equal(/hidden|min-\[/.test(account.match(/const button = '([^']*)'/)[1]), false)
  const css = read('src/styles/site-nav.css')
  assert.match(css, /body:has\(\[data-site-nav-account\]\) \.global-account-launcher \{ display: none; \}/)
  assert.match(read('src/components/GlobalAccount.jsx'), /addEventListener\('mediumia:open-account'/)
  assert.match(read('src/components/account/AccountPage.jsx'), /window\.location\.hash === '#profil' \? 'profil' : 'rdv'/)
})

test('textes : les deux modes de connexion sont annoncés', () => {
  const sources = [read('lib/rdvContactMode.js'), read('src/components/account/AccountInvite.jsx'), read('src/components/account/AccountPage.jsx')].join('\n')
  assert.equal(/sans mot de passe|aucun mot de passe à retenir/i.test(sources), false)
  assert.match(read('lib/rdvContactMode.js'), /votre mot de passe ou avec un code reçu par e-mail/)
})
