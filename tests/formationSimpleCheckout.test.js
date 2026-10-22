import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Page Formation après tous les patchs du prebuild (tests lancés après eux).
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = () => read('src/components/FormationPage.jsx')
const checkout = () => {
  const source = page()
  return source.slice(source.indexOf('function FormationCheckout('), source.indexOf('export default function FormationPage('))
}

test('Découverte : bouton « Commencer ma découverte — 29 € » visible sans attendre les cases', () => {
  const c = checkout()
  assert.match(c, /\{!showButtons && \(\n\s+<button type="button" onClick=\{continueToPayment\}/)
  assert.match(c, /isDiscovery \? 'Commencer ma découverte — 29 €' : 'Continuer vers le paiement'/)
  assert.doesNotMatch(c, /Cochez les deux cases ci-dessus pour afficher les boutons de paiement/)
})

test('consentements : explicites, non précochés, vérifiés au moment de poursuivre', () => {
  const c = checkout()
  assert.match(c, /const \[termsAccepted, setTermsAccepted\] = useState\(false\)/)
  assert.match(c, /const \[immediateAccessAccepted, setImmediateAccessAccepted\] = useState\(false\)/)
  assert.match(c, /conditions générales de vente de l’accompagnement MediumIA/)
  assert.match(c, /je perds mon droit de rétractation pour ces contenus numériques/)
  // Les boutons PayPal ne sont rendus qu'après le clic ET les deux cases cochées.
  assert.match(c, /const consentsGiven = termsAccepted && immediateAccessAccepted/)
  assert.match(c, /const showButtons = revealed && consentsGiven/)
  assert.match(c, /if \(!config \|\| !showButtons \|\| success\) return/)
  assert.match(c, /if \(!consentsGiven\) \{\n\s+setConsentError\(true\)/)
  assert.match(c, /role="alert"[^>]*>Pour continuer, cochez les deux cases ci-dessus\./)
  assert.match(c, /<div ref=\{containerRef\} className=\{showButtons \? 'min-h-\[48px\]' : 'hidden'\} \/>/)
})

test('carte bancaire : aucune promesse « sans compte PayPal » non vérifiée', () => {
  const source = page()
  assert.doesNotMatch(source, /sans compte PayPal|pas besoin de compte PayPal/)
  assert.match(source, /Quand PayPal le propose, vous pouvez aussi payer par carte bancaire/)
})

test('formation : découverte avant les prix, parcours progressif en premier et paiements visibles', () => {
  const source = page()
  const main = source.slice(source.indexOf('export default function FormationPage'))
  const offerStart = main.indexOf('<section id="offre"')
  const footerStart = main.lastIndexOf('<section className="px-6 py-14 text-center border-t border-gold/20">')
  const offre = main.slice(offerStart, footerStart)
  assert.ok(offerStart > main.indexOf('id="programme"'))
  assert.ok(offerStart > main.indexOf('id="formation-apercu-reel"'))
  assert.ok(offerStart > main.indexOf('id="formateur"'))
  assert.ok(offerStart > main.indexOf('id="faq"'))
  assert.ok(footerStart > offerStart)
  assert.ok(offre.indexOf('id="formation-progressive"') < offre.indexOf('id="formation-complete"'))
  assert.ok(offre.indexOf('id="formation-complete"') < offre.indexOf('id="formation-decouverte"'))
  assert.match(offre, /<ParcoursOffer \/>/)
  assert.match(offre, /offer \? \(/)
  assert.match(offre, /Parcours progressif momentanément fermé/)
  assert.match(offre, /<FormationCheckout \/>/)
  assert.match(offre, /<FormationCheckout product="discovery" \/>/)
  assert.doesNotMatch(offre, /<details/, 'Les choix de paiement restent visibles sans accordéon')
  assert.doesNotMatch(main.slice(0, main.indexOf('id="offre"')), /<span className="text-5xl font-medium">597 €/)
  assert.match(main, /Découvrir le programme →/)
  assert.match(main.slice(footerStart), /Accéder à la formation complète — 597 €/)
  assert.match(main.slice(footerStart), /Découverte — 29 €/)
})

test('pas d’avis présentés sur la page Formation (aucun avis de consultation réattribué)', () => {
  assert.doesNotMatch(page(), /ReviewsStrip|GoogleReviews|avis clients|★★★★★/i)
})

test('mesure : annulation et échec du paiement comptés séparément (compteurs anonymes)', () => {
  const c = checkout()
  assert.match(c, /trackMediumiaMetric\('formation_payment_cancelled', 'formation'\)/)
  assert.match(c, /trackMediumiaMetric\('formation_payment_failed', 'formation'\)/)
  const analytics = read('lib/mediumiaAnalytics.js')
  assert.match(analytics, /'formation_payment_cancelled',/)
  assert.match(analytics, /'formation_payment_failed',/)
})

test('le patch est rejouable et s’arrête net si une ancre change', () => {
  const patch = read('scripts/apply-formation-simple-checkout.mjs')
  assert.match(patch, /if \(!page\.includes\(SENTINEL\)\)/)
  assert.match(patch, /throw new Error\(`Formation simple checkout patch drift/)
  for (const script of ['predev', 'pretest', 'prebuild']) {
    assert.match(JSON.parse(read('package.json')).scripts[script], /apply-discovery-offer\.mjs && node scripts\/apply-formation-simple-checkout\.mjs/)
  }
})
