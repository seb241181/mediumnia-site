import { readFile, writeFile } from 'node:fs/promises'

// Partage en story du tirage Oracle offert. OracleTest.jsx est modifié par les
// patchs du prebuild : ce script passe après eux et vise le code APRÈS ces
// patchs (sélecteur de structure, interprétation, bloc 3 exercices). Ne jamais
// modifier src/components/OracleTest.jsx directement : ses lignes d'origine
// servent d'ancres aux patchs historiques. Le quiz, lui, n'est pas patché :
// son bouton de partage vit dans src/components/QuizSensibilitePage.jsx.

const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)
const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Share stories patch drift: ${label}`)
  return source.replace(before, after)
}

let oracleTest = await readFile(oracleTestPath, 'utf8')

oracleTest = replaceRequired(
  oracleTest,
  "  const [result, setResult]   = useState(null)",
  "  const [result, setResult]   = useState(null)\n  const [shareBusy, setShareBusy] = useState(false)\n  const [shareNote, setShareNote] = useState('')\n\n  async function shareOracleStory() {\n    if (!result?.cards?.length) return\n    setShareBusy(true)\n    setShareNote('')\n    try {\n      const { drawOracleImage } = await import('../lib/oracleShareImage.js')\n      const { canvasToFile, shareImageFile } = await import('../lib/shareImage.js')\n      const drawn = result.spread || spread\n      const canvas = await drawOracleImage(document.createElement('canvas'), { spreadName: drawn.name, cards: result.cards, positions: drawn.positions })\n      const file = await canvasToFile(canvas, 'mon-tirage-oracle-mediumia.png')\n      const outcome = await shareImageFile(file, 'J’ai fait mon tirage Oracle offert sur MediumIA ✦ mediumia.fr/oracle')\n      if (outcome === 'cancelled') return\n      trackMediumiaMetric('oracle_shared', 'oracle')\n      if (outcome === 'downloaded') setShareNote('Image enregistrée : ajoutez-la à votre story Instagram, TikTok ou Facebook.')\n    } catch {\n      setShareNote('L’image n’a pas pu être créée sur cet appareil.')\n    } finally {\n      setShareBusy(false)\n    }\n  }",
  'OracleTest share state',
)

oracleTest = replaceRequired(
  oracleTest,
  '          <p className="font-georgia text-base md:text-lg text-deep italic leading-relaxed whitespace-pre-line">{result.interpretation}</p>\n',
  `          <p className="font-georgia text-base md:text-lg text-deep italic leading-relaxed whitespace-pre-line">{result.interpretation}</p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button type="button" onClick={shareOracleStory} disabled={shareBusy} className="w-full rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto">
              {shareBusy ? 'Création de l’image…' : 'Partager mon tirage en story ✦'}
            </button>
            <p className="font-georgia text-[11px] text-mist">Seuls vos cartes et l’Oracle sont partagés, jamais votre interprétation personnelle.</p>
            {shareNote && <p role="status" className="text-center font-georgia text-xs text-mist">{shareNote}</p>}
          </div>
`,
  'OracleTest share button',
)

// Fige la structure utilisée pour le tirage : le sélecteur reste actif après
// le tirage, donc l'image doit refléter la structure du résultat, pas celle
// sélectionnée au moment du partage.
oracleTest = replaceRequired(
  oracleTest,
  "      setResult({ cards: drawnCards, interpretation, emailSequenceProof })",
  "      setResult({ cards: drawnCards, interpretation, emailSequenceProof, spread })",
  'OracleTest result spread capture',
)

await writeFile(oracleTestPath, oracleTest)

let analytics = await readFile(analyticsPath, 'utf8')

analytics = replaceRequired(
  analytics,
  "  'quiz_email_optin_completed',",
  "  'quiz_email_optin_completed',\n  'oracle_shared',",
  'share analytics events',
)

await writeFile(analyticsPath, analytics)

console.log('MediumIA share stories: Oracle draw story-share button and oracle_shared metric applied')
