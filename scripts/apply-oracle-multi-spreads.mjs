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
          <p className="font-georgia text-xs text-mist tracking-[0.15em] uppercase mb-4">Choisir la structure du tirage</p>

          <div className="grid gap-3 md:grid-cols-2">
            {ORACLE_SPREADS.map((option) => {
              const active = option.id === spreadId
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSpreadId(option.id)}
                  aria-pressed={active}
                  className={\`rounded-xl border-2 px-4 py-4 text-left transition-all \${active
                    ? 'border-[#B87811] bg-[#C88616] shadow-sm'
                    : 'border-gold/20 bg-white/70 hover:border-gold/45'
                  }\`}
                >
                  <span className={\`block font-georgia text-sm md:text-base font-semibold \${active ? 'text-deep' : 'text-deep'}\`}>
                    {option.name}
                  </span>
                  <span className={\`mt-1 block font-georgia text-xs leading-relaxed \${active ? 'text-deep/80' : 'text-mist'}\`}>
                    {option.shortDescription}
                  </span>
                  {option.kind === 'free' && (
                    <span className={\`mt-2 inline-block rounded-full px-2 py-1 font-georgia text-[10px] uppercase tracking-[0.12em] \${active ? 'bg-white/35 text-deep' : 'bg-gold/10 text-gold'}\`}>
                      Fidèle au jeu physique
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {spread.kind === 'free' ? (
            <div className="mt-5 rounded-xl bg-white/75 px-4 py-4">
              <p className="font-georgia text-xs font-semibold text-gold">Lecture libre par Lumïa</p>
              <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">
                Posez vos trois cartes comme avec l'oracle imprimé. Lumïa respecte leur sens propre, puis observe leur résonance, leurs tensions et leur mouvement d'ensemble, sans leur imposer de rôle prédéfini.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {spread.positions.map((position, index) => (
                <div key={position.label} className="rounded-xl bg-white/75 px-4 py-3">
                  <p className="font-georgia text-xs font-semibold text-gold">{index + 1}. {position.label}</p>
                  <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">{position.meaning}</p>
                </div>
              ))}
            </div>
          )}
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

let oracleApi = await readFile(new URL('../api/oracle-interpret.js', import.meta.url), 'utf8')

oracleApi = replaceRequired(
  oracleApi,
  "import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }",
  "import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }\nimport { getOracleSpread } from '../src/data/oracleSpreads.js'",
  'Oracle API spread import',
)

oracleApi = replaceRequired(
  oracleApi,
  'function buildOracleEmail(cards, interpretation) {',
  'function buildOracleEmail(cards, interpretation, spread) {',
  'Oracle email spread signature',
)

oracleApi = replaceRequired(
  oracleApi,
  '    const label = cardLabels[index]',
  '    const label = spread.positions[index].label',
  'Oracle email HTML position label',
)

oracleApi = replaceRequired(
  oracleApi,
  "    \`${cardLabels[index]} — n°${card.id} « ${card.name} »\`",
  "    \`${spread.positions[index].label} — n°${card.id} « ${card.name} »\`",
  'Oracle email text position label',
)

oracleApi = replaceRequired(
  oracleApi,
  "      <p style=\"margin:0 0 24px;color:#786f84;\">Oracle Au-delà de l'Âme — guidance par Lumïa</p>",
  "      <p style=\"margin:0 0 8px;color:#786f84;\">Oracle Au-delà de l'Âme — guidance par Lumïa</p>\n      <p style=\"margin:0 0 24px;color:#c9a84c;font-size:14px;\">${escapeHtml(spread.name)}</p>",
  'Oracle email spread name',
)

oracleApi = replaceRequired(
  oracleApi,
  '  const { cardIds, email } = req.body || {}',
  '  const { cardIds, email, spreadId } = req.body || {}\n  const spread = getOracleSpread(spreadId)',
  'Oracle API spread selection',
)

const oldCardLines = [
  '  const cardLines = cards.map((c, i) => {',
  "    const kw = c.keywords ? \` — mots-clés : ${c.keywords}\` : ''",
  '    return \`Carte ${i + 1} (${cardLabels[i]}) : n°${c.id} « ${c.name} »${kw}\`',
  "  }).join('\\n')",
].join('\n')

const newCardLines = [
  "  const isFreeSpread = spread.kind === 'free'",
  '  const cardLines = cards.map((c, i) => {',
  "    const kw = c.keywords ? \` — mots-clés : ${c.keywords}\` : ''",
  '    if (isFreeSpread) return \`Carte ${i + 1} : n°${c.id} « ${c.name} »${kw}\`',
  '    const position = spread.positions[i]',
  '    return \`Carte ${i + 1} (${position.label}) : n°${c.id} « ${c.name} »${kw}\\nSens de la position : ${position.meaning}\`',
  "  }).join('\\n\\n')",
].join('\n')

oracleApi = replaceRequired(
  oracleApi,
  oldCardLines,
  newCardLines,
  'Oracle API dynamic position lines',
)

oracleApi = replaceRequired(
  oracleApi,
  "Voici un tirage de 3 cartes de l'Oracle Au-delà de l'Âme (structure : Ombre / Passage / Guérison) :\n${cardLines}",
  "Voici un tirage de 3 cartes de l'Oracle Au-delà de l'Âme.\nMode choisi : ${spread.name}\n${spread.shortDescription}\n\n${cardLines}\n\n${isFreeSpread ? \"Il s'agit d'un tirage libre fidèle au jeu physique. N'attribue aucun rôle prédéfini aux cartes. Commence par le sens propre de chacune, puis observe leur résonance, leurs tensions et leur mouvement d'ensemble.\" : \"Il s'agit d'un tirage guidé numérique proposé par Lumïa. Interprète chaque carte selon le sens précis de sa position, puis relie les trois cartes dans une lecture cohérente.\"}",
  'Oracle API spread prompt header',
)

oracleApi = replaceRequired(
  oracleApi,
  "• Le passage / la bascule : la transformation proposée",
  "• Le mouvement intérieur : ce que cette carte met en circulation et comment elle dialogue avec les autres",
  'Oracle API spread interpretation axis',
)

oracleApi = replaceRequired(
  oracleApi,
  "Ajoute des transitions douces entre les cartes.",
  "N'affirme jamais connaître les pensées d'une autre personne et ne présente pas le tirage comme une prédiction certaine.\nAjoute des transitions douces entre les cartes.",
  'Oracle API reflective guardrail',
)

oracleApi = replaceRequired(
  oracleApi,
  '    const emailContent = buildOracleEmail(cards, interpretation)',
  '    const emailContent = buildOracleEmail(cards, interpretation, spread)',
  'Oracle email selected spread',
)

await writeFile(new URL('../api/oracle-interpret.js', import.meta.url), oracleApi)

console.log('MediumIA Oracle: physical free draw plus optional Lumia guided spreads applied')
