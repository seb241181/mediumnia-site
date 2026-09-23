import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)

// These helpers run on every render, including the first visit when no reading
// exists yet. They are plain JS inside the page module, so we extract and run them.
async function loadReadingHelpers() {
  const source = await readFile(pagePath, 'utf8')
  const names = ['paragraphs', 'stripInlineLabel', 'extractLabeledText', 'extractLeverCards', 'extractPathCards']
  const bodies = names.map((name) => {
    const start = source.indexOf(`function ${name}(`)
    assert.notEqual(start, -1, `${name} not found in ChronospherePage.jsx`)
    let depth = 0
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      if (source[i] === '}') depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`Unterminated function ${name}`)
  })
  return new Function(`${bodies.join('\n')}\nreturn { ${names.join(', ')} }`)()
}

test('reading helpers do not crash before any reading exists (blank-page regression)', async () => {
  const { extractPathCards, extractLeverCards } = await loadReadingHelpers()
  for (const empty of [undefined, null, '']) {
    assert.deepEqual(extractPathCards(empty), [])
    assert.deepEqual(extractLeverCards(empty), [])
  }
})

test('reading helpers still parse a real reading', async () => {
  const { extractPathCards, extractLeverCards } = await loadReadingHelpers()
  const paths = extractPathCards('Si vous maintenez la dynamique actuelle : rien ne bouge.\n\nSi vous modifiez l’élément clé : une porte s’ouvre.')
  assert.equal(paths.length, 2)
  assert.match(paths[0].text, /rien ne bouge/)
  assert.match(paths[1].text, /une porte s’ouvre/)

  const levers = extractLeverCards('À faire maintenant : écrire.\nÀ préparer : un appel.\nÀ ne pas forcer : la réponse.')
  assert.deepEqual(levers.map((item) => item.text), ['écrire.', 'un appel.', 'la réponse.'])
})
