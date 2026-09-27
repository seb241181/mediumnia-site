import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Fenêtre minimale : localStorage + adresse courante.
function fakeWindow(pathname = '/') {
  const store = new Map()
  const replaced = []
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { pathname, origin: 'https://mediumia.fr', replace: (url) => replaced.push(url) },
  }
  return { store, replaced }
}

function fakeSupabase() {
  let listener
  return {
    emit: (event, session) => listener(event, session),
    auth: { onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } } } },
  }
}

const mod = await import('../src/lib/proOnboarding.js')

test('the confirmation link targets the pro space', () => {
  fakeWindow()
  assert.equal(mod.proConfirmationRedirectUrl(), 'https://mediumia.fr/agents')
})

test('a sign-in during the pro onboarding brings the person back to /agents, once', () => {
  const { store, replaced } = fakeWindow('/')
  const sb = fakeSupabase()
  mod.markProOnboarding()
  mod.installProOnboardingRedirect(sb)
  sb.emit('SIGNED_IN', { user: { id: 'u1' } })
  assert.deepEqual(replaced, ['/agents'])
  assert.equal(store.size, 0, 'the local marker is removed')
})

test('without a pending onboarding, or once expired, nothing moves', () => {
  const { replaced } = fakeWindow('/')
  const sb = fakeSupabase()
  mod.installProOnboardingRedirect(sb)
  sb.emit('SIGNED_IN', { user: { id: 'u1' } })
  mod.markProOnboarding(Date.now() - 4 * 24 * 60 * 60 * 1000)
  sb.emit('SIGNED_IN', { user: { id: 'u1' } })
  assert.deepEqual(replaced, [])
})

test('the marker holds no personal data', () => {
  const { store } = fakeWindow()
  mod.markProOnboarding(1000)
  assert.deepEqual([...store.values()], [String(1000 + 3 * 24 * 60 * 60 * 1000)])
})

test('pro parcours: invitation link opens the sign-up, sign-up returns to /agents, activation is automatic, /pro links to the space', () => {
  const access = read('src/components/FounderCopilotAccess.jsx')
  assert.match(read('lib/proWorkspace.js'), /\$\{appUrl\}\/agents\?invitation=1/)
  assert.match(access, /has\('invitation'\) \? 'signup' : 'signin'/)
  assert.match(access, /emailRedirectTo: proConfirmationRedirectUrl\(\)/)
  assert.match(access, /data\.invitation && data\.emailConfirmed && !autoClaimTried\.current[\s\S]*call\('claim', \{\}\)/)
  assert.match(read('src/main.jsx'), /installProOnboardingRedirect\(supabase\)/)
  assert.match(read('src/components/ProWaitlistPublic.jsx'), /href="\/agents"[\s\S]*mon espace pro/)
})
