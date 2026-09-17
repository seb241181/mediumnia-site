import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const patchPath = new URL('../scripts/apply-conference-pass-current-main.mjs', import.meta.url)

test('conference pass action is forwarded through the shared rdv-config function', async () => {
  const source = await readFile(patchPath, 'utf8')
  assert.match(source, /handleConferencePassPayPal\(req, res, req\.query\.conferencePassAction\)/)
  assert.doesNotMatch(source, /handleConferencePassPayPal\(req, res\)(?!,)/)
})
