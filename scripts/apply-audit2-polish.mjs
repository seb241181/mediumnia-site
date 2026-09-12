import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronoPath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const legalPath = new URL('../src/components/LegalPages.jsx', import.meta.url)
const guardianPath = new URL('../src/components/SiteGuardian.jsx', import.meta.url)
const indexPath = new URL('../index.html', import.meta.url)
const transactionalEmailPath = new URL('../lib/transactionalEmail.js', import.meta.url)
const oracleEmailSequencePath = new URL('../lib/oracleEmailSequence.js', import.meta.url)
const formationEmailLeadPath = new URL('../lib/formationEmailLead.js', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA audit2 polish drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')
const hasCosmicLibraryHero = app.includes("import CosmicLibraryHero from './components/CosmicLibraryHero'")

if (!hasCosmicLibraryHero) {
  app = replaceRequired(
    app,
    `          <p className="font-bodoni text-deep text-2xl md:text-4xl leading-relaxed max-w-3xl mx-auto -mt-4 md:-mt-8 mb-7">\n            Comprendre. Apprendre. Rencontrer.<br/>\n            <span className="text-gold">Exercer autrement.</span>\n          </p>`,
    `          <h1 className="font-bodoni text-deep text-2xl md:text-4xl leading-relaxed max-w-3xl mx-auto -mt-4 md:-mt-8 mb-7">\n            Comprendre. Apprendre. Rencontrer.<br/>\n            <span className="text-gold">Exercer autrement.</span>\n          </h1>`,
    'homepage H1',
  )

  app = replaceRequired(
    app,
    `            <button onClick={onOpenFormation} className="font-georgia px-9 py-4 rounded-lg bg-gold text-deep font-bold text-base">Découvrir l'accompagnement →</button>`,
    `            <button onClick={onOpenFormation} className="font-georgia px-9 py-4 rounded-lg bg-gold text-deep font-bold text-base">Découvrir la Formation MediumIA →</button>`,
    'homepage primary CTA clarity',
  )
}

app = replaceRequired(
  app,
  `          <button onClick={onOpenFormation} className="hover:text-gold transition-colors">Se former</button>`,
  `          <a href="/formation" onClick={(event) => { event.preventDefault(); onOpenFormation() }} className="hover:text-gold transition-colors">Se former</a>`,
  'formation nav link',
)

app = replaceRequired(
  app,
  `          <button onClick={onOpenConferences} className="hover:text-gold transition-colors">Conférences</button>`,
  `          <a href="/conferences" onClick={(event) => { event.preventDefault(); onOpenConferences() }} className="hover:text-gold transition-colors">Conférences</a>`,
  'conference nav link',
)

app = replaceRequired(
  app,
  `          <button onClick={onOpenReseauDir} className="hover:text-gold transition-colors">Trouver un praticien</button>`,
  `          <a href="/reseau" onClick={(event) => { event.preventDefault(); onOpenReseauDir() }} className="hover:text-gold transition-colors">Trouver un praticien</a>`,
  'network nav link',
)

if (!hasCosmicLibraryHero) {
  app = replaceRequired(
    app,
    `            src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png"\n            alt="MediumIA — Le monde spirituel, relié autrement"\n            className="w-80 md:w-[32rem] mx-auto mb-5"`,
    `            src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png"\n            alt="MediumIA — Le monde spirituel, relié autrement"\n            fetchPriority="high"\n            decoding="async"\n            className="w-80 md:w-[32rem] mx-auto mb-5"`,
    'homepage hero image priority',
  )
}

app = replaceRequired(
  app,
  `            src="/images/brand/MEDIUMIA_logo_maitre_2026-08-16.png"\n            alt="MediumIA, accompagnement à la médiumnité consciente"\n            className="aspect-[4/3] w-full object-cover object-center"`,
  `            src="/images/brand/MEDIUMIA_logo_maitre_2026-08-16.png"\n            alt="MediumIA, accompagnement à la médiumnité consciente"\n            loading="lazy"\n            decoding="async"\n            fetchPriority="low"\n            className="aspect-[4/3] w-full object-cover object-center"`,
  'below-fold master logo lazy loading',
)

await writeFile(appPath, app)

let chrono = await readFile(chronoPath, 'utf8')
if (!chrono.includes('Voir un exemple complet avant de remplir')) {
  chrono = replaceRequired(
    chrono,
    `          {/* Form — always visible */}`,
    `          <div className="mb-5 rounded-2xl border border-gold/25 bg-white/55 px-5 py-4 text-center md:flex md:items-center md:justify-between md:gap-6 md:text-left">\n            <div>\n              <p className="font-georgia text-sm font-semibold text-deep">Vous voulez voir le résultat avant de remplir ?</p>\n              <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">L’exemple public est fictif, mais il montre la structure réelle d’une lecture Chronosphère.</p>\n            </div>\n            <a href="/chronosphere/exemple" className="mt-3 inline-flex shrink-0 rounded-lg border border-gold/45 px-4 py-2.5 font-georgia text-xs font-bold text-deep transition-colors hover:bg-gold/10 md:mt-0">Voir un exemple complet avant de remplir →</a>\n          </div>\n\n          {/* Form — always visible */}`,
    'Chronosphere example before form',
  )
}
await writeFile(chronoPath, chrono)

let legal = await readFile(legalPath, 'utf8')
if (!legal.includes('Données collectées — Chronosphère')) {
  legal = replaceRequired(
    legal,
    `      <Section title="Données collectées — Essai MediumIA">`,
    `      <Section title="Données collectées — Chronosphère">\n        <p>\n          Pour générer une Chronosphère personnalisée, le formulaire demande notamment votre nom, votre date de naissance,\n          votre heure exacte de naissance, votre lieu de naissance, une adresse e-mail de livraison, le thème choisi et trois nombres distincts.\n          Ces informations sont utilisées pour calculer et générer la lecture demandée puis vous la transmettre.\n        </p>\n        <p>\n          Les données de paiement sont traitées par PayPal : MediumIA n’a pas accès à vos données bancaires.\n          Côté MediumIA, les jetons de paiement et l’adresse e-mail sont conservés sous forme d’empreintes techniques lorsque cela est nécessaire au suivi du tirage,\n          et le résultat de la lecture peut être conservé dans Supabase afin d’assurer la livraison, les reprises de pack et l’idempotence du service.\n        </p>\n        <p>\n          Les informations nécessaires à la génération de la lecture sont traitées par les services techniques de MediumIA, notamment les fonctions serveur et les fournisseurs d’intelligence artificielle utilisés pour produire le contenu.\n          Elles ne sont pas utilisées pour une prospection commerciale sans consentement distinct.\n        </p>\n      </Section>\n\n      <Section title="Données collectées — Essai MediumIA">`,
    'Chronosphere privacy section',
  )
}
await writeFile(legalPath, legal)

let guardian = await readFile(guardianPath, 'utf8')
if (!guardian.includes('function LinkedGuardianMessage')) {
  guardian = replaceRequired(
    guardian,
    `\nexport default function SiteGuardian() {`,
    `\nfunction LinkedGuardianMessage({ content }) {\n  const parts = String(content || '').split(/(https:\\/\\/mediumia\\.fr(?:\\/[^\\s]*)?)/g)\n  return parts.map((part, index) => {\n    if (!part.startsWith('https://mediumia.fr')) return <span key={index}>{part}</span>\n    const match = part.match(/^(.*?)([.,;:!?)]*)$/)\n    const url = match?.[1] || part\n    const suffix = match?.[2] || ''\n    return (\n      <span key={index}>\n        <a href={url} className="font-semibold underline decoration-gold/50 underline-offset-2 break-all">{url.replace('https://', '')}</a>\n        {suffix}\n      </span>\n    )\n  })\n}\n\nexport default function SiteGuardian() {`,
    'Guardian link renderer helper',
  )
}
guardian = replaceRequired(
  guardian,
  `                  {msg.content}`,
  `                  {msg.role === 'assistant' ? <LinkedGuardianMessage content={msg.content} /> : msg.content}`,
  'Guardian clickable assistant links',
)
await writeFile(guardianPath, guardian)

let index = await readFile(indexPath, 'utf8')
const heroImage = hasCosmicLibraryHero
  ? '/images/brand/MEDIUMIA_logo_officiel_transparent_2026-09-12.png'
  : '/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png'
if (!index.includes(`${heroImage}" fetchpriority="high"`)) {
  index = replaceRequired(
    index,
    `    <!-- Bodoni Moda — pont typographique avec le logo -->`,
    `    <link rel="preload" as="image" href="${heroImage}" fetchpriority="high" />\n\n    <!-- Bodoni Moda — pont typographique avec le logo -->`,
    'hero image preload',
  )
}
if (hasCosmicLibraryHero && !index.includes('/images/home/mediumia-cosmic-library-hero.webp"')) {
  index = replaceRequired(
    index,
    `    <!-- Bodoni Moda — pont typographique avec le logo -->`,
    `    <link rel="preload" as="image" href="/images/home/mediumia-cosmic-library-hero.webp" type="image/webp" media="(min-width: 761px)" fetchpriority="high" />\n    <link rel="preload" as="image" href="/images/home/mediumia-cosmic-library-hero-mobile.webp" type="image/webp" media="(max-width: 760px)" fetchpriority="high" />\n\n    <!-- Bodoni Moda — pont typographique avec le logo -->`,
    'cosmic library scene preloads',
  )
}
await writeFile(indexPath, index)

let transactionalEmail = await readFile(transactionalEmailPath, 'utf8')
transactionalEmail = replaceRequired(
  transactionalEmail,
  `export async function sendEmail({ to, subject, html, text, idempotencyKey, scheduledAt }) {\n  const apiKey = process.env.RESEND_API_KEY\n  const from = process.env.RESEND_FROM_EMAIL`,
  `export async function sendEmail({ to, subject, html, text, idempotencyKey, scheduledAt, from: fromOverride }) {\n  const apiKey = process.env.RESEND_API_KEY\n  const from = String(fromOverride || process.env.RESEND_FROM_EMAIL || '').trim()`,
  'transactional email sender override',
)
await writeFile(transactionalEmailPath, transactionalEmail)

let oracleEmailSequence = await readFile(oracleEmailSequencePath, 'utf8')
oracleEmailSequence = replaceRequired(
  oracleEmailSequence,
  `const SOURCE = 'oracle_free_result'\nconst PROOF_TTL_MS = 2 * 60 * 60 * 1000`,
  `const SOURCE = 'oracle_free_result'\nconst SEQUENCE_FROM = (process.env.RESEND_SEQUENCE_FROM_EMAIL || 'Sébastien — MediumIA <sebastien@mail.mediumia.fr>').trim()\nconst PROOF_TTL_MS = 2 * 60 * 60 * 1000`,
  'Oracle sequence sender',
)
oracleEmailSequence = replaceRequired(
  oracleEmailSequence,
  `  const exercise1Html = \`\n      <p style="line-height:1.75;margin:0 0 18px;">On commence par le premier geste de toute pratique consciente : poser une direction claire.</p>\n      <h2 style="font-size:19px;margin:24px 0 10px;">Votre exercice — L’Intention quotidienne</h2>`,
  `  const exercise1Html = \`\n      <h2 style="font-size:19px;margin:24px 0 10px;">Votre exercice — L’Intention quotidienne</h2>`,
  'exercise 1 duplicate HTML intro',
)
oracleEmailSequence = replaceRequired(
  oracleEmailSequence,
  `  const exercise1Text = \`On commence par le premier geste de toute pratique consciente : poser une direction claire.\\n\\nVOTRE EXERCICE — L’INTENTION QUOTIDIENNE`,
  `  const exercise1Text = \`VOTRE EXERCICE — L’INTENTION QUOTIDIENNE`,
  'exercise 1 duplicate text intro',
)
oracleEmailSequence = replaceRequired(
  oracleEmailSequence,
  `      const result = await sendEmail({\n        to: normalizedEmail,`,
  `      const result = await sendEmail({\n        from: SEQUENCE_FROM,\n        to: normalizedEmail,`,
  'Oracle sequence explicit sender',
)
await writeFile(oracleEmailSequencePath, oracleEmailSequence)

let formationEmailLead = await readFile(formationEmailLeadPath, 'utf8')
formationEmailLead = replaceRequired(
  formationEmailLead,
  `export const FORMATION_EMAIL_CONSENT_VERSION = 'formation-3-exercises-v1-2026-09-07'\n\nconst EMAIL_RE`,
  `export const FORMATION_EMAIL_CONSENT_VERSION = 'formation-3-exercises-v1-2026-09-07'\n\nconst SEQUENCE_FROM = (process.env.RESEND_SEQUENCE_FROM_EMAIL || 'Sébastien — MediumIA <sebastien@mail.mediumia.fr>').trim()\nconst EMAIL_RE`,
  'Formation sequence sender',
)
formationEmailLead = replaceRequired(
  formationEmailLead,
  `        const result = await sendEmail({\n          to: normalizedEmail,`,
  `        const result = await sendEmail({\n          from: SEQUENCE_FROM,\n          to: normalizedEmail,`,
  'Formation sequence explicit sender',
)
await writeFile(formationEmailLeadPath, formationEmailLead)

console.log('MediumIA audit #2 polish: CRO, privacy, assistant links, image loading and sequence sender updated')
