import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronospherePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const oraclePath = new URL('../src/components/OraclePage.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA ecosystem patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = replaceRequired(
  app,
  `import SiteGuardian from './components/SiteGuardian'`,
  `import SiteGuardian from './components/SiteGuardian'\nimport EcosystemNextSteps from './components/EcosystemNextSteps'`,
  'App ecosystem import',
)

app = replaceRequired(
  app,
  `        {/* ── Découvrir ── */}`,
  `        {/* ── Orientation légère ── */}
        <section className="mx-auto max-w-6xl px-6 pb-4">
          <EcosystemNextSteps
            context="home"
            onOpenOracle={onOpenOracle}
            onOpenChronosphere={onOpenChronosphere}
            onOpenReseau={onOpenReseauDir}
            onOpenFormation={onOpenFormation}
          />
        </section>

        {/* ── Découvrir ── */}`,
  'Home lightweight pathways',
)

app = replaceRequired(
  app,
  `  if (view === 'oracle')       return <><OraclePage onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
  `  if (view === 'oracle')       return <><OraclePage onBack={backHome} onNavigate={legalNav} onOpenChronosphere={openChronosphere} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</>`,
  'Oracle route callbacks',
)

app = replaceRequired(
  app,
  `  if (view === 'chronosphere') return <><ChronospherePage onBack={backHome} onNavigate={legalNav} />{guardian}</>`,
  `  if (view === 'chronosphere') return <><ChronospherePage onBack={backHome} onNavigate={legalNav} onOpenOracle={openOracle} onOpenFormation={openFormation} onOpenReseau={openReseauDir} />{guardian}</>`,
  'Chronosphere route callbacks',
)

await writeFile(appPath, app)

let chronosphere = await readFile(chronospherePath, 'utf8')
chronosphere = replaceRequired(
  chronosphere,
  `import LegalFooter from './LegalFooter'`,
  `import LegalFooter from './LegalFooter'\nimport EcosystemNextSteps from './EcosystemNextSteps'`,
  'Chronosphere ecosystem import',
)
chronosphere = replaceRequired(
  chronosphere,
  `export default function ChronospherePage({ onBack, onNavigate }) {`,
  `export default function ChronospherePage({ onBack, onNavigate, onOpenOracle, onOpenFormation, onOpenReseau }) {`,
  'Chronosphere ecosystem props',
)

const chronosphereAct = `              {/* Act */}
              <article className="rounded-2xl bg-deep p-6 text-cream">
                <p className="mb-2 font-georgia text-xs uppercase tracking-[0.16em] text-gold">
                  Acte de réalignement
                </p>
                <p className="font-georgia text-sm leading-relaxed text-cream/80">
                  <strong className="text-cream">Geste :</strong> {esc(result.cards[0].gesture)}
                </p>
                <p className="mt-3 font-bodoni text-lg italic leading-relaxed text-gold">
                  {esc(result.cards[0].decree)}
                </p>
              </article>`

const chronosphereActWithPathways = `${chronosphereAct}

              <EcosystemNextSteps
                context="chronosphere"
                onOpenOracle={onOpenOracle}
                onOpenReseau={onOpenReseau}
                onOpenFormation={onOpenFormation}
                className="mt-8"
              />`

chronosphere = replaceRequired(
  chronosphere,
  chronosphereAct,
  chronosphereActWithPathways,
  'Chronosphere post-result pathways',
)
await writeFile(chronospherePath, chronosphere)

let oracle = await readFile(oraclePath, 'utf8')
oracle = replaceRequired(
  oracle,
  `import LegalFooter from './LegalFooter'\nimport OracleTest from './OracleTest'`,
  `import LegalFooter from './LegalFooter'\nimport OracleTest from './OracleTest'\nimport EcosystemNextSteps from './EcosystemNextSteps'`,
  'Oracle ecosystem import',
)
oracle = replaceRequired(
  oracle,
  `export default function OraclePage({ onBack, onNavigate }) {`,
  `export default function OraclePage({ onBack, onNavigate, onOpenChronosphere, onOpenFormation, onOpenReseau }) {`,
  'Oracle ecosystem props',
)

oracle = replaceRequired(
  oracle,
  `      </main>`,
  `        <section className="mx-auto max-w-5xl px-6 pb-16 pt-2">
          <EcosystemNextSteps
            context="oracle"
            onOpenChronosphere={onOpenChronosphere}
            onOpenReseau={onOpenReseau}
            onOpenFormation={onOpenFormation}
          />
        </section>

      </main>`,
  'Oracle next-step pathways',
)
await writeFile(oraclePath, oracle)

console.log('MediumIA ecosystem: contextual pathways applied')
