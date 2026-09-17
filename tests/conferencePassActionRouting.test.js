import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const apiPath = new URL('../api/rdv-config.js', import.meta.url)

test('conference pass action is forwarded through the shared rdv-config function', async () => {
  const source = await readFile(apiPath, 'utf8')
  assert.match(source, /if \(req\.query\.conferencePassAction\) return handleConferencePassPayPal\(req, res, req\.query\.conferencePassAction\)/)
  assert.doesNotMatch(source, /if \(req\.query\.conferencePassAction\) return handleConferencePassPayPal\(req, res\)\s*$/m)
})
