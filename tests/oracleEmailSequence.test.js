import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  buildOracleEmailSequence,
  buildUnsubscribeUrl,
  createOracleEmailSequenceProof,
  verifyOracleEmailSequenceProof,
} from '../lib/oracleEmailSequence.js'
import { cancelScheduledEmail } from '../lib/transactionalEmail.js'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

function setTestEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    t.after(() => {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    })
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const emptyUrlEnv = {
  VERCEL_ENV: undefined,
  VERCEL_BRANCH_URL: undefined,
  VERCEL_URL: undefined,
  ORACLE_PUBLIC_URL: undefined,
}

test('email sequence consent ledger is service-role-only and stores no raw email column', () => {
  const migration = read('supabase/migrations/20260907050000_oracle_email_sequence_subscriptions.sql')
  assert.match(migration, /email_hash text not null/)
  assert.doesNotMatch(migration, /\n\s*email\s+text/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all .* from public, anon, authenticated/i)
  assert.match(migration, /grant select, insert, update, delete .* to service_role/i)
  assert.match(migration, /unsubscribe_token_hash text not null/)
  assert.match(migration, /resend_email_ids text\[\]/)
})

test('sequence uses exactly three scheduled emails with the Formation CTA only at the end', () => {
  const now = Date.parse('2026-09-07T06:00:00.000Z')
  const token = 'a'.repeat(43)
  const sequence = buildOracleEmailSequence({ unsubscribeToken: token, nowMs: now })
  assert.equal(sequence.length, 3)
  assert.equal(Date.parse(sequence[0].scheduledAt), now + 5 * 60 * 1000)
  assert.equal(Date.parse(sequence[1].scheduledAt), now + 2 * 24 * 60 * 60 * 1000)
  assert.equal(Date.parse(sequence[2].scheduledAt), now + 4 * 24 * 60 * 60 * 1000)
  assert.doesNotMatch(sequence[0].html, /mediumia\.fr\/formation/)
  assert.doesNotMatch(sequence[1].html, /mediumia\.fr\/formation/)
  assert.match(sequence[2].html, /https:\/\/mediumia\.fr\/formation/)
})

for (const { name, env, origin } of [
  {
    name: 'Preview uses the branch URL ahead of deployment and Production URLs',
    env: {
      VERCEL_ENV: 'preview',
      VERCEL_BRANCH_URL: 'mediumia-git-audit2.vercel.app',
      VERCEL_URL: 'mediumia-deployment.vercel.app',
      ORACLE_PUBLIC_URL: 'https://mediumia.fr',
    },
    origin: 'https://mediumia-git-audit2.vercel.app',
  },
  {
    name: 'Preview falls back to its deployment URL when the branch URL is absent',
    env: {
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'mediumia-deployment.vercel.app',
      ORACLE_PUBLIC_URL: 'https://mediumia.fr',
    },
    origin: 'https://mediumia-deployment.vercel.app',
  },
  {
    name: 'Production uses the configured public URL and ignores Vercel hosts',
    env: {
      VERCEL_ENV: 'production',
      VERCEL_BRANCH_URL: 'mediumia-git-main.vercel.app',
      VERCEL_URL: 'mediumia-production-deployment.vercel.app',
      ORACLE_PUBLIC_URL: '  https://mediumia.fr/  ',
    },
    origin: 'https://mediumia.fr',
  },
  {
    name: 'Production without configuration keeps mediumia.fr rather than VERCEL_URL',
    env: {
      VERCEL_ENV: 'production',
      VERCEL_URL: 'mediumia-production-deployment.vercel.app',
    },
    origin: 'https://mediumia.fr',
  },
  {
    name: 'Preview without Vercel hosts falls back to the configured public URL',
    env: { VERCEL_ENV: 'preview', ORACLE_PUBLIC_URL: 'https://oracle.example/' },
    origin: 'https://oracle.example',
  },
  {
    name: 'without URL configuration the public fallback remains mediumia.fr',
    env: {},
    origin: 'https://mediumia.fr',
  },
]) {
  test(`all three emails: ${name}`, t => {
    setTestEnv(t, { ...emptyUrlEnv, ...env })
    const token = 'b'.repeat(43)
    const expected = `${origin}/oracle#desinscription=${token}`
    const sequence = buildOracleEmailSequence({ unsubscribeToken: token })
    assert.equal(sequence.length, 3)

    for (const email of sequence) {
      const htmlLinks = [...email.html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
      assert.deepEqual(htmlLinks.filter(link => link.includes('#desinscription=')), [expected])
      assert.equal(email.text.match(/Se désinscrire : (\S+)/)?.[1], expected)
      assert.match(email.text, /uniquement trois e-mails/)
      for (const link of htmlLinks) {
        const url = new URL(link)
        assert.equal(url.pathname.includes(token), false)
        assert.equal(url.search, '')
      }
    }
  })
}

test('unsubscribe URL encodes reserved characters exclusively inside the fragment', t => {
  setTestEnv(t, emptyUrlEnv)
  const token = 'test /?&=#%+é'
  const url = new URL(buildUnsubscribeUrl(token))
  assert.equal(url.origin, 'https://mediumia.fr')
  assert.equal(url.pathname, '/oracle')
  assert.equal(url.search, '')
  assert.equal(url.hash, '#desinscription=test%20%2F%3F%26%3D%23%25%2B%C3%A9')
  assert.equal(decodeURIComponent(url.hash.slice('#desinscription='.length)), token)
})

test('sequence generation still rejects invalid unsubscribe tokens', () => {
  assert.throws(
    () => buildOracleEmailSequence({ unsubscribeToken: 'invalid /?&=# token' }),
    /Invalid unsubscribe token/,
  )
})

test('Oracle opt-in proof is email-bound and expires', () => {
  const previousSecret = process.env.ORACLE_RATE_LIMIT_SECRET
  process.env.ORACLE_RATE_LIMIT_SECRET = 'mediumia-test-only-secret'
  try {
    const now = Date.parse('2026-09-07T06:00:00.000Z')
    const proof = createOracleEmailSequenceProof('Personne@Example.com', now)
    assert.ok(proof)
    assert.equal(verifyOracleEmailSequenceProof('personne@example.com', proof, now + 60_000), true)
    assert.equal(verifyOracleEmailSequenceProof('autre@example.com', proof, now + 60_000), false)
    assert.equal(verifyOracleEmailSequenceProof('personne@example.com', proof, now + 2 * 60 * 60 * 1000 + 1), false)
  } finally {
    if (previousSecret === undefined) delete process.env.ORACLE_RATE_LIMIT_SECRET
    else process.env.ORACLE_RATE_LIMIT_SECRET = previousSecret
  }
})

test('active build patch reuses the existing Oracle endpoint without adding a Lambda', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  const packageJson = read('package.json')
  assert.match(patch, /mode=email-sequence/)
  assert.match(patch, /handleOracleEmailSequence/)
  assert.doesNotMatch(patch, /api\/oracle-email-sequence\.js/)
  assert.match(packageJson, /apply-oracle-email-sequence-v2\.mjs/)
})

test('Resend helper supports scheduled sends and cancellation with a separate management key', () => {
  const helper = read('lib/transactionalEmail.js')
  assert.match(helper, /scheduledAt/)
  assert.match(helper, /payload\.scheduled_at/)
  assert.match(helper, /export async function cancelScheduledEmail/)
  assert.match(helper, /RESEND_MANAGEMENT_API_KEY \|\| process\.env\.RESEND_API_KEY/)
  assert.match(helper, /emails\/\$\{encodeURIComponent\(normalizedId\)\}\/cancel/)
})

for (const managementKey of ['test-management-key', undefined, '']) {
  test(`scheduled cancellation uses ${managementKey ? 'the management key' : `the sending key when management is ${managementKey === undefined ? 'absent' : 'empty'}`}`, async t => {
    setTestEnv(t, {
      RESEND_MANAGEMENT_API_KEY: managementKey,
      RESEND_API_KEY: 'test-sending-key',
    })
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, options })
      return { ok: true }
    })

    assert.deepEqual(await cancelScheduledEmail('scheduled-email-id'), { status: 'cancelled' })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://api.resend.com/emails/scheduled-email-id/cancel')
    assert.equal(requests[0].options.method, 'POST')
    assert.equal(requests[0].options.headers.Authorization, `Bearer ${managementKey || 'test-sending-key'}`)
  })
}

test('opt-in UI requires a positive action and promises only three emails', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  assert.match(patch, /const \[emailOptIn, setEmailOptIn\] = useState\(false\)/)
  assert.match(patch, /disabled=\{!emailOptIn \|\| sequenceLoading \|\| sequenceDone\}/)
  assert.match(patch, /3 e-mails seulement/)
  assert.match(patch, /ne vous inscrit pas automatiquement à une newsletter générale/)
  assert.match(patch, /consent: true/)
})

test('privacy copy documents separate consent and data minimisation', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  assert.match(patch, /Cette demande est distincte du tirage gratuit/)
  assert.match(patch, /case dédiée non pré-cochée/)
  assert.match(patch, /ne conserve pas cette adresse en clair dans Supabase/)
  assert.match(patch, /annulation des envois encore programmés/)
})

test('aggregate metrics cover opt-in and unsubscribe without visitor identifiers', () => {
  const patch = read('scripts/apply-oracle-email-sequence-v2.mjs')
  for (const event of [
    'oracle_email_optin_view',
    'oracle_email_optin_completed',
    'oracle_email_unsubscribed',
  ]) {
    assert.match(patch, new RegExp(event))
  }
  assert.doesNotMatch(patch, /visitor_id|session_id|user_id/)
})
