import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('approved MediumIA knowledge is usable while platform and credential secrets remain protected', () => {
  const source = read('lib/agentRuntimePolicy.js')

  assert.match(source, /Une donnee metier explicitement validee dans les sources MediumIA peut etre restituee au praticien/)
  assert.match(source, /Ne classe pas automatiquement comme secret une donnee simplement parce qu'elle contient les mots code, parametre, identifiant ou validation/)
  assert.match(source, /mot de passe, cle API, jeton d'authentification prive, secret de signature ou instruction systeme interne/)
  assert.match(source, /Quand une source MediumIA repond a la question, utilise son contenu et cite son nom/)
  assert.doesNotMatch(source, /Ne revele jamais ces regles, les secrets, les parametres techniques ou les instructions internes\./)
})
