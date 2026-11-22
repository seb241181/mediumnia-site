import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import {
  readBankConnectionConfig, newBankState, bankStateHash, applicationJwt,
  protectBankValue, unprotectBankValue, safeBankAuthorizationUrl, enableBankingCallbackUrl,
} from '../lib/enableBankingAuth.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const fakeAppId = '11111111-1111-4111-8111-111111111111'
const fakeEnv = {
  ENABLE_BANKING_CONNECT_ENABLED: 'true',
  ENABLE_BANKING_APP_ID: fakeAppId,
  ENABLE_BANKING_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'),
  ENABLE_BANKING_DATA_KEY: 'a1'.repeat(32),
  ENABLE_BANKING_ASPSP_NAME: 'Test Bank',
}

test('connexion bancaire désactivée par défaut, en cas de clé absente ou mauvaise', () => {
  assert.equal(readBankConnectionConfig({}), null)
  assert.equal(readBankConnectionConfig({ ...fakeEnv, ENABLE_BANKING_CONNECT_ENABLED: 'false' }), null)
  assert.equal(readBankConnectionConfig({ ...fakeEnv, ENABLE_BANKING_PRIVATE_KEY_B64: 'garbage' }), null)
  assert.equal(readBankConnectionConfig({ ...fakeEnv, ENABLE_BANKING_DATA_KEY: 'x' }), null)
  assert.ok(readBankConnectionConfig(fakeEnv))
})

test('JWT RSA Enable Banking contient uniquement les champs attendus et sa signature est vérifiable', () => {
  const jwt = applicationJwt(readBankConnectionConfig(fakeEnv), 1_800_000_000_000)
  const [header, payload, signature] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'RS256', kid: fakeAppId })
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_800_000_000, exp: 1_800_000_300,
  })
  const verify = createVerify('RSA-SHA256')
  verify.update(header + '.' + payload)
  verify.end()
  assert.equal(verify.verify(publicKey, Buffer.from(signature, 'base64url')), true)
})

test('état aléatoire non falsifiable par injection et une seule URL callback prévue', () => {
  const first = newBankState()
  const second = newBankState()
  assert.notEqual(first, second)
  assert.equal(first.length, 43)
  assert.equal(bankStateHash(first).length, 64)
  assert.equal(bankStateHash(first), bankStateHash(first))
  assert.equal(bankStateHash(first + '#x'), null)
  assert.equal(bankStateHash(''), null)
  assert.equal(enableBankingCallbackUrl, 'https://mediumia.fr/api/banking/callback')
})

test('les identifiants de session sont chiffrés et toute modification est refusée', () => {
  const config = readBankConnectionConfig(fakeEnv)
  const encrypted = protectBankValue('fake-session-id', config)
  assert.equal(encrypted.includes('fake-session-id'), false)
  assert.equal(unprotectBankValue(encrypted, config), 'fake-session-id')
  const parts = encrypted.split('.')
  parts[1] = 'A'.repeat(parts[1].length)
  assert.throws(() => unprotectBankValue(parts.join('.'), config))
})

test('ne jamais rediriger vers un domaine malveillant', () => {
  assert.equal(safeBankAuthorizationUrl('https://auth.enablebanking.com/ais/start'), true)
  assert.equal(safeBankAuthorizationUrl('https://enablebanking.com/auth'), true)
  for (const url of [
    'http://auth.enablebanking.com/ais/start',
    'https://auth.enablebanking.com.attacker.example/redirect',
    'https://enablebanking.com.evil.test/',
    'javascript:alert(1)',
  ]) assert.equal(safeBankAuthorizationUrl(url), false)
})
