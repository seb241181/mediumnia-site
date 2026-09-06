import { readFile, writeFile } from 'node:fs/promises'

const ecosystemPath = new URL('../src/components/EcosystemNextSteps.jsx', import.meta.url)
const oraclePath = new URL('../src/components/OraclePage.jsx', import.meta.url)
const testPath = new URL('../tests/ecosystemPathways.test.js', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Astra patch drift: ${label}`)
  return source.replace(before, after)
}

let ecosystem = await readFile(ecosystemPath, 'utf8')

ecosystem = replaceRequired(
  ecosystem,
  `  const openPath = (path) => {
    trackMediumiaMetric(context === 'home' ? 'home_door_click' : 'ecosystem_door_click', \`${'${context}:${path.key}'}\`)
    handlers[path.handler]()
  }`,
  `  const openPath = (path) => {
    trackMediumiaMetric(context === 'home' ? 'home_door_click' : 'ecosystem_door_click', \`${'${context}:${path.key}'}\`)

    // A door explicitly presented as free must land on the free experience itself,
    // not on the physical Oracle purchase section above it.
    if (path.key === 'oracle' && (context === 'home' || context === 'chronosphere')) {
      window.location.assign('/oracle#tirage-gratuit')
      return
    }

    handlers[path.handler]()
  }`,
  'free Oracle doorway',
)

await writeFile(ecosystemPath, ecosystem)

let oracle = await readFile(oraclePath, 'utf8')

oracle = replaceRequired(
  oracle,
  `import LegalFooter from './LegalFooter'`,
  `import { useEffect } from 'react'\nimport LegalFooter from './LegalFooter'`,
  'Oracle useEffect import',
)

oracle = replaceRequired(
  oracle,
  `export default function OraclePage({ onBack, onNavigate, onOpenChronosphere, onOpenFormation, onOpenReseau }) {
  return (`,
  `export default function OraclePage({ onBack, onNavigate, onOpenChronosphere, onOpenFormation, onOpenReseau }) {
  useEffect(() => {
    if (window.location.hash !== '#tirage-gratuit') return

    requestAnimationFrame(() => {
      document.getElementById('tirage-gratuit')?.scrollIntoView({ block: 'start' })
    })
  }, [])

  return (`,
  'Oracle free-draw hash scroll',
)

oracle = replaceRequired(
  oracle,
  `<section className="px-6 py-16 max-w-3xl mx-auto">`,
  `<section id="tirage-gratuit" className="scroll-mt-24 px-6 py-16 max-w-3xl mx-auto">`,
  'Oracle free-draw anchor',
)

await writeFile(oraclePath, oracle)

let tests = await readFile(testPath, 'utf8')
const freeEntryTest = `test('free discovery opens the offered draw directly', async () => {`
if (!tests.includes(freeEntryTest)) {
  tests += `\n\ntest('free discovery opens the offered draw directly', async () => {\n  const { component, oracle } = await readSources()\n  assert.match(component, /window\\.location\\.assign\\('\/oracle#tirage-gratuit'\\)/)\n  assert.match(oracle, /id="tirage-gratuit"/)\n  assert.match(oracle, /window\\.location\\.hash !== '#tirage-gratuit'/)\n  assert.match(oracle, /scrollIntoView\\(\\{ block: 'start' \\}\\)/)\n})\n`
  await writeFile(testPath, tests)
}

console.log('MediumIA Astra sprint: free entry aligned with the free Oracle draw')
