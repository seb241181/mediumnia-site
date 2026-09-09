import { readFile, writeFile } from 'node:fs/promises'

const formationPath = new URL('../src/components/FormationPage.jsx', import.meta.url)
const catalogPath = new URL('../lib/mediumiaPublicCatalog.js', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA discovery patch drift: ${label}`)
  return source.replace(before, after)
}

let formation = await readFile(formationPath, 'utf8')

formation = replaceRequired(
  formation,
  'function FormationCheckout() {',
  "function FormationCheckout({ product = 'full' }) {\n  const isDiscovery = product === 'discovery'",
  'checkout product scope',
)

formation = replaceRequired(
  formation,
  "    fetch('/api/rdv-config?paypalAction=config', { cache: 'no-store' })",
  "    fetch(`/api/rdv-config?paypalAction=config&product=${encodeURIComponent(product)}`, { cache: 'no-store' })",
  'product config request',
)

formation = replaceRequired(
  formation,
  "    return () => { cancelled = true }\n  }, [])\n\n  useEffect(() => {\n    if (!config || !termsAccepted || !immediateAccessAccepted || success) return",
  "    return () => { cancelled = true }\n  }, [product])\n\n  useEffect(() => {\n    if (!config || !termsAccepted || !immediateAccessAccepted || success) return",
  'product config dependency',
)

formation = replaceRequired(
  formation,
  "              body: JSON.stringify({ termsAccepted: true, immediateAccessAccepted: true }),",
  "              body: JSON.stringify({ product, termsAccepted: true, immediateAccessAccepted: true }),",
  'create product',
)

formation = replaceRequired(
  formation,
  "            if (!res.ok || !data.id) throw new Error(data.error || 'paypal_create_order_failed')",
  "            if (!res.ok || !data.id || data.product !== product) throw new Error(data.error || 'paypal_create_order_failed')",
  'create product response',
)

formation = replaceRequired(
  formation,
  '              body: JSON.stringify({ orderId: data.orderID }),',
  '              body: JSON.stringify({ product, orderId: data.orderID }),',
  'capture product',
)

formation = replaceRequired(
  formation,
  "            if (!res.ok || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')",
  "            if (!res.ok || result.product !== product || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')",
  'capture product response',
)

formation = replaceRequired(
  formation,
  '  }, [config, termsAccepted, immediateAccessAccepted, success])',
  '  }, [config, termsAccepted, immediateAccessAccepted, success, product])',
  'checkout product dependency',
)

formation = replaceRequired(
  formation,
  '<p className="font-georgia text-deep font-bold text-lg mb-2">Votre accès MediumIA est activé.</p>',
  '<p className="font-georgia text-deep font-bold text-lg mb-2">{isDiscovery ? \'Votre accès Découverte est activé.\' : \'Votre accès MediumIA est activé.\'}</p>',
  'product success copy',
)

formation = replaceRequired(
  formation,
  '<div className="border-2 border-gold/40 rounded-2xl p-8 md:p-10 bg-white/70 text-left mb-6">\n              <p className="font-georgia text-xs text-mist tracking-widest uppercase mb-6 text-center">Le parcours complet comprend</p>',
  '<div className="relative border-2 border-gold/55 rounded-2xl p-8 md:p-10 bg-white/80 text-left mb-10 shadow-[0_20px_60px_rgba(26,21,53,0.08)]">\n              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-deep px-4 py-1.5 font-georgia text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Offre principale</span>\n              <p className="font-georgia text-xs text-mist tracking-widest uppercase mb-6 text-center">Le parcours complet comprend</p>',
  'primary full offer',
)

const discoveryCard = `

            <div className="rounded-2xl border border-deep/15 bg-deep/[0.035] p-7 md:p-8 text-left">
              <div className="text-center mb-6">
                <p className="font-georgia text-[11px] text-gold tracking-[0.2em] uppercase mb-2">Pour commencer en douceur</p>
                <h3 className="font-georgia text-2xl md:text-3xl font-medium text-deep">Découverte MediumIA</h3>
                <p className="font-georgia text-4xl text-deep font-medium mt-3">29 €</p>
              </div>
              <ul className="font-georgia text-sm md:text-base text-deep/85 space-y-2.5 max-w-lg mx-auto mb-6">
                {['Introduction complète','Module 1 — L’Intention comme Porte','Exercices du Module 1','Carnet de pratique intégré','MediumIA pendant 30 jours','PDF Découverte personnel'].map((item, i) => (
                  <li key={i} className="flex gap-3 items-start"><span className="text-gold shrink-0 mt-0.5">✓</span><span>{item}</span></li>
                ))}
              </ul>
              <p className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-center font-georgia text-sm font-semibold leading-relaxed text-deep mb-6">
                Vos 29 € sont déduits si vous poursuivez ensuite avec la Formation complète.
              </p>
              <p className="font-georgia text-xs text-mist text-center mb-5">Accès limité au contenu Découverte · Paiement sécurisé via PayPal</p>
              <FormationCheckout product="discovery" />
            </div>`

formation = replaceRequired(
  formation,
  `                <FormationCheckout />
              </div>
            </div>
          </div>`,
  `                <FormationCheckout />
              </div>
            </div>${discoveryCard}
          </div>`,
  'discovery offer card',
)

await writeFile(formationPath, formation)

let catalog = await readFile(catalogPath, 'utf8')
catalog = replaceRequired(
  catalog,
  `- Parcours de 25 modules, 84 exercices guidés et carnet de pratique.
- 12 mois d'accès à l'application MediumIA ; les contenus téléchargés restent acquis.`,
  `- Parcours de 25 modules, 84 exercices guidés et carnet de pratique.
- PDF complet de 269 pages ; il s'agit d'un contenu numérique, pas d'un livre physique.
- 12 mois d'accès à l'application MediumIA ; les contenus téléchargés restent acquis.`,
  'full PDF wording',
)

catalog = replaceRequired(
  catalog,
  `- Page publique : https://mediumia.fr/formation

SÉQUENCE GRATUITE — 3 EXERCICES MEDIUMIA`,
  `- Page publique : https://mediumia.fr/formation

OFFRE DÉCOUVERTE MEDIUMIA
- Introduction complète, Module 1, exercices associés et carnet de pratique.
- Coach MediumIA limité à l'Introduction et au Module 1 pendant 30 jours.
- PDF Découverte personnel fourni par un lien privé ; aucun lien Google Drive public n'est exposé.
- Prix public : 29 € TTC.
- Les 29 € sont déduits si l'élève poursuit ensuite avec la Formation complète ; cette éligibilité repose sur la preuve serveur du paiement.

SÉQUENCE GRATUITE — 3 EXERCICES MEDIUMIA`,
  'public discovery catalog',
)
await writeFile(catalogPath, catalog)

console.log('MediumIA discovery offer: 29 EUR checkout and public card applied')
