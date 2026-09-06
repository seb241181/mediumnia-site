import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const directoryPath = new URL('../src/components/ReseauDirectory.jsx', import.meta.url)
const stephaniePortraitPayloadPath = new URL('../public/images/reseau/stephanie-madhyama-small.b64', import.meta.url)
const stephaniePortraitPath = new URL('../public/images/reseau/stephanie-madhyama.jpg', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA reseau profiles patch drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

app = replaceRequired(
  app,
  `const ReseauDirectory = lazy(() => import('./components/ReseauDirectory'))`,
  `const ReseauDirectory = lazy(() => import('./components/ReseauDirectory'))\nconst PractitionerProfile = lazy(() => import('./components/PractitionerProfile'))`,
  'lazy practitioner profile route',
)

app = replaceRequired(
  app,
  `    : p.startsWith('/reseau/rejoindre') ? 'reseau-form'\n    : p.startsWith('/reseau') ? 'reseau-dir'`,
  `    : p.startsWith('/reseau/rejoindre') ? 'reseau-form'\n    : p.startsWith('/reseau/') ? 'reseau-profile'\n    : p.startsWith('/reseau') ? 'reseau-dir'`,
  'practitioner profile path',
)

app = replaceRequired(
  app,
  `  const openReseauDir   = () => nav('/reseau',           'reseau-dir')\n  const openReseauForm  = () => nav('/reseau/rejoindre', 'reseau-form')`,
  `  const openReseauDir   = () => nav('/reseau',           'reseau-dir')\n  const openReseauProfile = (id) => nav(\`/reseau/\${id}\`, 'reseau-profile')\n  const openReseauForm  = () => nav('/reseau/rejoindre', 'reseau-form')`,
  'practitioner profile navigator',
)

app = replaceRequired(
  app,
  `  if (view === 'reseau-dir')   return <DeferredRoute><ReseauDirectory onBack={backHome} onNavigate={legalNav} />{guardian}</DeferredRoute>`,
  `  if (view === 'reseau-profile') return <DeferredRoute><PractitionerProfile practitionerId={window.location.pathname.split('/').filter(Boolean)[1] || ''} onBack={openReseauDir} onNavigate={legalNav} />{guardian}</DeferredRoute>\n  if (view === 'reseau-dir')   return <DeferredRoute><ReseauDirectory onBack={backHome} onNavigate={legalNav} onOpenProfile={openReseauProfile} />{guardian}</DeferredRoute>`,
  'practitioner profile render route',
)

await writeFile(appPath, app)

let directory = await readFile(directoryPath, 'utf8')

directory = replaceRequired(
  directory,
  `export default function ReseauDirectory({ onBack, onNavigate }) {`,
  `export default function ReseauDirectory({ onBack, onNavigate, onOpenProfile }) {`,
  'directory profile navigation prop',
)

directory = replaceRequired(
  directory,
  `                      <a\n                        href={practitioner.bookingUrl}\n                        target="_blank"\n                        rel="noopener noreferrer"\n                        className="mt-auto inline-flex justify-center items-center rounded-xl bg-deep text-gold font-georgia font-bold px-6 py-3.5 hover:bg-deep/90 transition-colors"\n                      >\n                        {practitioner.externalLabel || 'Voir ses disponibilités'} →\n                      </a>`,
  `                      <div className="mt-auto flex flex-col gap-3 sm:flex-row">\n                        <button\n                          type="button"\n                          onClick={() => onOpenProfile(practitioner.id)}\n                          className="inline-flex flex-1 items-center justify-center rounded-xl bg-deep px-6 py-3.5 font-georgia font-bold text-gold transition-colors hover:bg-deep/90"\n                        >\n                          Découvrir son profil →\n                        </button>\n                        <a\n                          href={practitioner.bookingUrl}\n                          target="_blank"\n                          rel="noopener noreferrer"\n                          className="inline-flex items-center justify-center rounded-xl border border-gold/35 px-5 py-3.5 font-georgia text-sm font-semibold text-deep transition-colors hover:bg-gold/10"\n                        >\n                          {practitioner.externalLabel || 'Disponibilités'} ↗\n                        </a>\n                      </div>`,
  'directory practitioner actions',
)

await writeFile(directoryPath, directory)

const stephaniePortraitBase64 = (await readFile(stephaniePortraitPayloadPath, 'utf8')).trim()
const stephaniePortrait = Buffer.from(stephaniePortraitBase64, 'base64')
const isJpeg = stephaniePortrait.length >= 5000
  && stephaniePortrait[0] === 0xff
  && stephaniePortrait[1] === 0xd8
  && stephaniePortrait[2] === 0xff

if (!isJpeg) throw new Error('MediumIA reseau profiles: invalid Stephanie portrait payload')
await writeFile(stephaniePortraitPath, stephaniePortrait)

console.log('MediumIA reseau: individual practitioner pages applied')
