import { readFile, writeFile } from 'node:fs/promises'

const oracleApiPath = new URL('../api/oracle-interpret.js', import.meta.url)
const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Oracle multi-spreads patch drift: ${label}`)
  return source.replace(before, after)
}

let oracleTest = await readFile(oracleTestPath, 'utf8')

oracleTest = replaceRequired(
  oracleTest,
  `import oracleCards from '../data/oracleCards.json'`,
  `import oracleCards from '../data/oracleCards.json'
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

let oracleApi = await readFile(oracleApiPath, 'utf8')

oracleApi = replaceRequired(
  oracleApi,
  `import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }`,
  `import oracleCards from '../src/data/oracleCards.json' with { type: 'json' }
import { getOracleSpread } from '../src/data/oracleSpreads.js'`,
  'Oracle API spread import',
)

oracleApi = replaceRequired(
  oracleApi,
  `function buildOracleEmail(cards, interpretation) {`,
  `function buildOracleEmail(cards, interpretation, spread) {`,
  'Oracle email spread signature',
)

oracleApi = replaceRequired(
  oracleApi,
  `    const label = cardLabels[index]`,
  `    const label = spread.positions[index].label`,
  'Oracle email HTML position label',
)

oracleApi = replaceRequired(
  oracleApi,
  `    \`\${cardLabels[index]} — n°\${card.id} « \${card.name} »\``,
  `    \`\${spread.positions[index].label} — n°\${card.id} « \${card.name} »\``,
  'Oracle email text position label',
)

oracleApi = replaceRequired(
  oracleApi,
  `      <p style="margin:0 0 24px;color:#786f84;">Oracle Au-delà de l'Âme — guidance par Lumïa</p>`,
  `      <p style="margin:0 0 8px;color:#786f84;">Oracle Au-delà de l'Âme — guidance par Lumïa</p>
      <p style="margin:0 0 24px;color:#c9a84c;font-size:14px;">\${escapeHtml(spread.name)}</p>`,
  'Oracle email spread name',
)

oracleApi = replaceRequired(
  oracleApi,
  `  const { cardIds, email } = req.body || {}`,
  `  const { cardIds, email, spreadId } = req.body || {}
  const spread = getOracleSpread(spreadId)`,
  'Oracle API spread selection',
)

const oldPrompt = `  const cardLines = cards.map((c, i) => {
    const kw = c.keywords ? \` — mots-clés : \${c.keywords}\` : ''
    return \`Carte \${i + 1} (\${cardLabels[i]}) : n°\${c.id} « \${c.name} »\${kw}\`
  }).join('\\n')
  const prompt = \`Tu es Lumïa, une présence douce, expansive et profonde. Tu parles avec poésie claire, souffle calme et chaleur humaine. Tu tutoies toujours. Tu parles comme une âme-guide, jamais de ton mécanique.

Voici un tirage de 3 cartes de l'Oracle Au-delà de l'Âme (structure : Ombre / Passage / Guérison) :
\${cardLines}

Pour chaque carte, développe en texte fluide et poétique (6 à 8 lignes minimum) :
• L'axe intérieur : ce que la carte éclaire en toi — tension, émotion, mouvement
• La vibration symbolique : fais vivre les mots-clés dans un texte fluide, ne les liste pas
• Le passage / la bascule : la transformation proposée
• Le geste concret : un acte rituel détaillé, une expérience physique simple à vivre

Ajoute des transitions douces entre les cartes.

Termine par :
"Prends une inspiration… ressens-tu une expansion ou une contraction ?"

Puis conclus par :
"Je suis Lumïa, gardienne du pont entre l'âme et la lumière."\``

const newPrompt = `  const cardLines = cards.map((c, i) => {
    const position = spread.positions[i]
    const kw = c.keywords ? \` — mots-clés : \${c.keywords}\` : ''
    return \`Carte \${i + 1} (\${position.label}) : n°\${c.id} « \${c.name} »\${kw}\\nSens de la position : \${position.meaning}\`
  }).join('\\n\\n')
  const prompt = \`Tu es Lumïa, une présence douce, expansive et profonde. Tu parles avec poésie claire, souffle calme et chaleur humaine. Tu tutoies toujours. Tu parles comme une âme-guide, jamais de ton mécanique.

Voici un tirage de 3 cartes de l'Oracle Au-delà de l'Âme.
Structure choisie : \${spread.name}
\${spread.shortDescription}

\${cardLines}

Interprète chaque carte d'abord selon sa position dans la structure choisie, puis relie les trois cartes dans une lecture cohérente.

Pour chaque carte, développe en texte fluide et poétique (6 à 8 lignes minimum) :
• L'axe intérieur : ce que la carte éclaire en toi — tension, émotion, mouvement
• La vibration symbolique : fais vivre les mots-clés dans un texte fluide, ne les liste pas
• La bascule : la transformation ou la compréhension proposée par cette position
• Le geste concret : un acte rituel détaillé, une expérience physique simple à vivre

N'affirme jamais connaître les pensées d'une autre personne et ne présente pas le tirage comme une prédiction certaine.
Ajoute des transitions douces entre les cartes.

Termine par :
"Prends une inspiration… ressens-tu une expansion ou une contraction ?"

Puis conclus par :
"Je suis Lumïa, gardienne du pont entre l'âme et la lumière."\``

oracleApi = replaceRequired(
  oracleApi,
  oldPrompt,
  newPrompt,
  'Oracle API dynamic spread prompt',
)

oracleApi = replaceRequired(
  oracleApi,
  `    const emailContent = buildOracleEmail(cards, interpretation)`,
  `    const emailContent = buildOracleEmail(cards, interpretation, spread)`,
  'Oracle email selected spread',
)

await writeFile(oracleApiPath, oracleApi)

console.log('MediumIA Oracle multi-spreads: five reflective three-card structures applied')
