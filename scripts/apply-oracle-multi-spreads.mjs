import { readFile, writeFile } from 'node:fs/promises'

const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Oracle multi-spreads patch drift: ${label}`)
  return source.replace(before, after)
}

let oracleTest = await readFile(oracleTestPath, 'utf8')

oracleTest = replaceRequired(
  oracleTest,
  `import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'`,
  `import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'
import {
  DEFAULT_ORACLE_SPREAD_ID,
  getOracleSpread,
  ORACLE_SPREADS,
} from '../data/oracleSpreads.js'`,
  'OracleTest spread imports',
)

oracleTest = replaceRequired(
  oracleTest,
  `  const [unsubscribeError, setUnsubscribeError] = useState(false)`,
  `  const [unsubscribeError, setUnsubscribeError] = useState(false)
  const [spreadId, setSpreadId] = useState(DEFAULT_ORACLE_SPREAD_ID)
  const spread = getOracleSpread(spreadId)`,
  'OracleTest spread state',
)

oracleTest = replaceRequired(
  oracleTest,
  `        body: JSON.stringify({ email: trimmedEmail, cardIds: ids }),`,
  `        body: JSON.stringify({ email: trimmedEmail, cardIds: ids, spreadId }),`,
  'OracleTest spread request',
)

oracleTest = replaceRequired(
  oracleTest,
  `                {['Ombre', 'Passage', 'Guérison'][idx]}`,
  `                {spread.positions[idx].label}`,
  'OracleTest dynamic position labels',
)

const formLine = `      <form onSubmit={handleSubmit} className="space-y-5">`
const spreadPicker = `${formLine}
        <div className="rounded-2xl border border-gold/25 bg-cream/60 p-4 md:p-5">
          <p className="font-georgia text-xs text-mist tracking-[0.15em] uppercase mb-3">Choisir la structure du tirage</p>
          <div className="grid gap-3 md:grid-cols-2">
            {ORACLE_SPREADS.map((option) => {
              const active = option.id === spreadId
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSpreadId(option.id)}
                  aria-pressed={active}
                  className={\`rounded-xl border-2 px-4 py-3 text-left transition-all \${active
                    ? 'border-gold bg-gold/10 shadow-sm'
                    : 'border-gold/20 bg-white/70 hover:border-gold/45'
                  }\`}
                >
                  <span className="block font-georgia text-sm font-semibold text-deep">{option.name}</span>
                  <span className="mt-1 block font-georgia text-xs leading-relaxed text-mist">{option.shortDescription}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {spread.positions.map((position, index) => (
              <div key={position.label} className="rounded-lg bg-white/60 px-3 py-2">
                <p className="font-georgia text-xs font-semibold text-gold">{index + 1}. {position.label}</p>
                <p className="mt-1 font-georgia text-[11px] leading-relaxed text-mist">{position.meaning}</p>
              </div>
            ))}
          </div>
        </div>`

oracleTest = replaceRequired(
  oracleTest,
  formLine,
  spreadPicker,
  'OracleTest spread picker',
)

oracleTest = replaceRequired(
  oracleTest,
  `        <div className="mt-10 border-t border-gold/20 pt-8">
          <div className="grid grid-cols-3 gap-4 mb-8">`,
  `        <div className="mt-10 border-t border-gold/20 pt-8">
          <div className="mb-6 text-center">
            <p className="font-georgia text-xs uppercase tracking-[0.16em] text-gold">Structure choisie</p>
            <p className="mt-1 font-georgia text-base text-deep">{spread.name}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-8">`,
  'OracleTest result spread heading',
)

oracleTest = replaceRequired(
  oracleTest,
  `                <p className="font-georgia text-xs text-mist">{card.name}</p>`,
  `                <p className="font-georgia text-[11px] uppercase tracking-wide text-gold mb-1">{spread.positions[idx].label}</p>
                <p className="font-georgia text-xs text-mist">{card.name}</p>`,
  'OracleTest result position labels',
)

await writeFile(oracleTestPath, oracleTest)

console.log('MediumIA Oracle multi-spreads: selector UI applied')
