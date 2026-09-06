import fs from 'node:fs'
import path from 'node:path'

const filePath = path.join(process.cwd(), 'src/components/FormationPage.jsx')
let source = fs.readFileSync(filePath, 'utf8')

const previewMarker = 'id="formation-apercu-reel"'

if (!source.includes(previewMarker)) {
  const approachAnchor = `        <section className="px-6 py-16 max-w-4xl mx-auto">\n          <div className="text-center mb-12"><p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">L'approche</p><h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">Ce qui rend MediumIA différente</h2></div>`

  if (!source.includes(approachAnchor)) {
    throw new Error('Formation proof sprint: approach anchor not found')
  }

  const previewSection = `        <section id="formation-apercu-reel" className="px-6 py-16 md:py-20">\n          <div className="max-w-4xl mx-auto">\n            <div className="text-center max-w-2xl mx-auto mb-10">\n              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Aperçu réel · Module 1</p>\n              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-4">L'Intention comme Porte</h2>\n              <p className="font-georgia text-mist text-base leading-relaxed">Avant d'investir dans le parcours complet, découvrez un vrai extrait de la pédagogie MediumIA.</p>\n            </div>\n\n            <article className="rounded-3xl border-2 border-gold/30 bg-white/70 p-7 md:p-10 shadow-[0_12px_34px_rgba(26,21,53,.06)]">\n              <div className="flex flex-wrap items-center gap-3 mb-7">\n                <span className="rounded-full bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Niveau 1 · Les Fondations</span>\n                <span className="font-georgia text-xs text-mist">Extrait du contenu réellement remis aux élèves</span>\n              </div>\n\n              <blockquote className="border-l-4 border-gold pl-5 md:pl-6 py-1 mb-7">\n                <p className="font-bodoni text-2xl md:text-3xl italic leading-relaxed text-deep">« Avant de recevoir, il faut avoir décidé d'être disponible. »</p>\n              </blockquote>\n\n              <p className="font-georgia text-base md:text-lg leading-relaxed text-deep/80">\n                On commence toujours par la porte. Pas par la technique, pas par les exercices spectaculaires, pas par les protocoles compliqués. La porte. Ce qui ouvre tout le reste. Et la porte de la médiumnité, c'est l'intention.\n              </p>\n\n              <div className="mt-8 grid gap-4 md:grid-cols-2">\n                <div className="rounded-2xl border border-gold/25 bg-cream p-5">\n                  <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold mb-2">Ce que le module installe</p>\n                  <p className="font-georgia text-sm leading-relaxed text-deep">Comprendre que l'intention n'est pas un simple souhait : elle donne une direction consciente à la pratique et à la qualité de l'information recherchée.</p>\n                </div>\n                <div className="rounded-2xl border border-gold/25 bg-cream p-5">\n                  <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold mb-2">Mise en pratique</p>\n                  <p className="font-georgia text-sm leading-relaxed text-deep">Vous formulez votre propre intention d'ouverture de canal avec vos mots, puis vous l'installez progressivement comme une signature de pratique.</p>\n                </div>\n              </div>\n\n              <div className="mt-8 flex flex-col items-center text-center">\n                <p className="font-georgia text-xs leading-relaxed text-mist max-w-xl mb-5">Cet aperçu est volontairement partiel : le parcours complet contient les explications, exercices, questions de réflexion et la progression des 25 modules.</p>\n                <button onClick={() => document.getElementById('essai-assistant')?.scrollIntoView({ behavior: 'smooth' })} className="font-georgia px-7 py-3.5 rounded-lg border-2 border-gold/50 text-deep font-bold hover:border-gold transition-colors">\n                  Tester ensuite MediumIA →\n                </button>\n              </div>\n            </article>\n          </div>\n        </section>\n\n`

  source = source.replace(approachAnchor, previewSection + approachAnchor)
}

source = source.replace(
  '<section className="px-6 py-16 bg-deep/3">',
  '<section id="essai-assistant" className="px-6 py-16 bg-deep/3">',
)

fs.writeFileSync(filePath, source)
console.log('MediumIA formation proof sprint: real Module 1 preview applied')
