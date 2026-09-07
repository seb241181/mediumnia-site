import { readFile, writeFile } from 'node:fs/promises'

const oracleApiPath = new URL('../api/oracle-interpret.js', import.meta.url)
const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)
const formationPath = new URL('../src/components/FormationPage.jsx', import.meta.url)
const legalPagesPath = new URL('../src/components/LegalPages.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Formation email-lead patch drift: ${label}`)
  return source.replace(before, after)
}

let oracleApi = await readFile(oracleApiPath, 'utf8')
oracleApi = replaceRequired(
  oracleApi,
  `import { createOracleEmailSequenceProof, handleOracleEmailSequence } from '../lib/oracleEmailSequence.js'`,
  `import { createOracleEmailSequenceProof, handleOracleEmailSequence } from '../lib/oracleEmailSequence.js'\nimport { handleFormationEmailLead } from '../lib/formationEmailLead.js'`,
  'Formation email lead import',
)
oracleApi = replaceRequired(
  oracleApi,
  `  if (req.query?.mode === 'email-sequence') {\n    return handleOracleEmailSequence(req, res)\n  }\n\n  if (req.method !== 'POST') {`,
  `  if (req.query?.mode === 'email-sequence') {\n    return handleOracleEmailSequence(req, res)\n  }\n  if (req.query?.mode === 'formation-email-sequence') {\n    return handleFormationEmailLead(req, res)\n  }\n\n  if (req.method !== 'POST') {`,
  'reuse Oracle Lambda for Formation email lead',
)
await writeFile(oracleApiPath, oracleApi)

let analytics = await readFile(analyticsPath, 'utf8')
analytics = replaceRequired(
  analytics,
  `  'oracle_email_unsubscribed',\n])`,
  `  'oracle_email_unsubscribed',\n  'formation_email_optin_view',\n  'formation_email_optin_completed',\n])`,
  'Formation email lead metrics',
)
await writeFile(analyticsPath, analytics)

let formation = await readFile(formationPath, 'utf8')
const leadComponent = `
function FormationExerciseLead() {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const sectionRef = useRef(null)

  useEffect(() => {
    const node = sectionRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    let tracked = false
    const observer = new IntersectionObserver((entries) => {
      if (!tracked && entries.some(entry => entry.isIntersecting)) {
        tracked = true
        trackMediumiaMetric('formation_email_optin_view', 'formation')
        observer.disconnect()
      }
    }, { threshold: 0.35 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!consent || loading || done) return
    setLoading(true)
    setMessage('')
    setIsError(false)

    try {
      const res = await fetch('/api/oracle-interpret?mode=formation-email-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), consent: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setIsError(true)
        setMessage(body.message || 'Trop de demandes ont été effectuées. Merci de réessayer plus tard.')
        return
      }
      if (res.status === 409) {
        setMessage('Votre demande est déjà en cours. Vérifiez votre boîte e-mail dans quelques instants.')
        return
      }
      if (!res.ok) throw new Error(body.error || 'sequence_unavailable')

      setDone(true)
      if (body.status === 'already_subscribed') {
        setMessage('Cette adresse est déjà inscrite à la séquence des 3 exercices MediumIA.')
      } else {
        setMessage('C’est parti ✦ Le premier exercice arrivera dans quelques minutes, puis les deux suivants à J+2 et J+4.')
        trackMediumiaMetric('formation_email_optin_completed', 'formation')
      }
    } catch {
      setIsError(true)
      setMessage('La séquence n’a pas pu être programmée pour le moment. Vous pourrez réessayer sans acheter la Formation.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section ref={sectionRef} id="formation-exercices-gratuits" className="px-6 py-16 bg-deep/[0.04]">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border-2 border-gold/30 bg-white/70 p-6 md:p-8">
          <div className="text-center max-w-2xl mx-auto mb-7">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-3">Expérimenter avant de décider</p>
            <h2 className="font-georgia font-medium text-2xl md:text-3xl leading-tight mb-3">Vous voulez d’abord essayer par vous-même ?</h2>
            <p className="font-georgia text-mist text-sm md:text-base leading-relaxed">
              Recevez gratuitement trois exercices réellement issus de MediumIA pour explorer l’intention, la perception et le discernement avant de décider si vous souhaitez rejoindre le parcours complet.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mb-7">
            {[
              ['1', 'L’Intention quotidienne'],
              ['2', 'Le Souffle de vérité'],
              ['3', 'Feu Rouge / Feu Vert'],
            ].map(([num, title]) => (
              <div key={num} className="rounded-xl border border-gold/20 bg-cream/60 p-4 text-center">
                <span className="font-georgia text-gold text-xs tracking-widest">EXERCICE {num}</span>
                <p className="font-georgia text-deep text-sm font-medium mt-2">{title}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl mx-auto">
            <div>
              <label htmlFor="formation-exercise-email" className="font-georgia text-xs text-mist tracking-[0.15em] uppercase block mb-1.5">Votre e-mail</label>
              <input
                id="formation-exercise-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={done}
                placeholder="votre@email.com"
                className="w-full font-georgia text-sm text-deep bg-white border-2 border-gold/25 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/60 transition-colors disabled:opacity-60"
              />
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-gold/20 bg-cream/60 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={done}
                className="mt-1 h-4 w-4 accent-[#C9A84C]"
              />
              <span className="font-georgia text-sm text-deep leading-relaxed">
                Je souhaite recevoir gratuitement les 3 exercices MediumIA par e-mail et découvrir à la fin la Formation MediumIA. Je peux me désinscrire à tout moment.
              </span>
            </label>

            <p className="font-georgia text-xs text-mist leading-relaxed">
              3 e-mails seulement. Cette demande ne vous inscrit pas automatiquement à une newsletter générale. Consultez notre <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.
            </p>

            <button
              type="submit"
              disabled={!consent || loading || done}
              className="w-full rounded-lg bg-gold px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              {loading ? 'Programmation…' : done ? 'Mes 3 exercices sont programmés ✓' : 'Recevoir mes 3 exercices →'}
            </button>

            {message && <p className={\`font-georgia text-sm text-center \${isError ? 'text-red-600' : 'text-deep'}\`}>{message}</p>}
          </form>
        </div>
      </div>
    </section>
  )
}
`
formation = replaceRequired(
  formation,
  `\nfunction FormationCheckout() {`,
  `${leadComponent}\nfunction FormationCheckout() {`,
  'Formation exercise lead component',
)
formation = replaceRequired(
  formation,
  `            <TrialChat />\n          </div>\n        </section>\n\n        <section id="offre" className="px-6 py-16">`,
  `            <TrialChat />\n          </div>\n        </section>\n\n        <FormationExerciseLead />\n\n        <section id="offre" className="px-6 py-16">`,
  'Formation exercise lead placement before offer',
)
await writeFile(formationPath, formation)

let legalPages = await readFile(legalPagesPath, 'utf8')
legalPages = replaceRequired(
  legalPages,
  `          Après votre tirage Oracle gratuit, vous pouvez demander facultativement une séquence limitée à trois e-mails\n          contenant des exercices issus de la Formation MediumIA. Cette demande est distincte du tirage gratuit et ne conditionne jamais l’accès au résultat.`,
  `          Après votre tirage Oracle gratuit ou directement depuis la page Formation, vous pouvez demander facultativement une séquence limitée à trois e-mails\n          contenant des exercices issus de la Formation MediumIA. Sur la page Oracle, cette demande reste distincte du tirage gratuit et ne conditionne jamais l’accès au résultat.`,
  'privacy policy Formation source',
)
await writeFile(legalPagesPath, legalPages)

console.log('MediumIA Formation email lead: three-exercise opt-in added before the paid offer')
