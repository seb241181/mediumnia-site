import { readFile, writeFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronoPath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const legalPath = new URL('../src/components/LegalPages.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA audit2 polish drift: ${label}`)
  return source.replace(before, after)
}

let app = await readFile(appPath, 'utf8')

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

console.log('MediumIA audit #2 polish: homepage, navigation, Chronosphere and privacy updated')
