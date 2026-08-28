import { useState } from 'react'
import LegalFooter from './LegalFooter'
import TrialChat from './TrialChat'

const NIVEAUX = [
  { num: '01', titre: 'Les Fondations', modules: 'Modules 1 à 6', texte: "Poser l'intention juste. Recevoir avant d'interpréter. Découvrir votre canal dominant. Comprendre ce qu'est vraiment un oracle. Développer le discernement vibratoire. Entrer en contact avec vos guides." },
  { num: '02', titre: 'La Technique du Canal', modules: 'Modules 7 à 13', texte: "Le contact avec les défunts. La consécration d'un oracle. L'art de la canalisation consciente. L'ouverture et la fermeture du canal. Les trois sources d'information intérieure. Le canal intérieur. Les codes vibratoires." },
  { num: '03', titre: 'Maîtrise et Autonomie', modules: 'Modules 14 à 20', texte: "La gestion des émotions du médium. La lecture des signes et synchronicités. La conscience du canal. L'approfondissement de la relation avec vos guides. L'art de filtrer les informations. Le contact avancé avec les défunts. La médiumnité mature." },
  { num: '04', titre: "L'Art du Médium Maître", modules: 'Modules 21 à 25', texte: "La canalisation créative. La réception instantanée. La canalisation en séance. La lecture médiumnique structurée. Et le module final : accompagner les vivants." },
]

const INCLUS = [
  { icon: '◇', titre: '25 modules PDF · 269 pages', texte: "25 modules complets répartis en 4 niveaux, plus une introduction et un lexique. Écrits dans un langage clair, profond et accessible. Chaque module contient des explications, des exercices pratiques, des questions de réflexion et une citation centrale." },
  { icon: '◌', titre: '84 exercices guidés', texte: "Chaque exercice est accompagné d'étapes claires et d'une question de carnet. Du plus simple au plus avancé, ils construisent progressivement votre pratique." },
  { icon: '✦', titre: 'MediumIA, votre assistant personnel', texte: "Formé spécifiquement sur le contenu des 25 modules, MediumIA répond à vos questions, vous aide à relire vos ressentis avec discernement et vous accompagne module après module. Il ne canalise pas à votre place — il vous aide à découvrir votre propre canal." },
  { icon: '◈', titre: 'Carnet de pratique intégré', texte: "Intégré dans l'application, il vous permet de noter vos ressentis, vos perceptions, vos questions après chaque exercice. Avec le temps, il devient votre outil de discernement le plus précieux." },
  { icon: '◉', titre: "12 mois d'accès", texte: "Votre code personnel vous donne accès à l'application et à MediumIA pendant 12 mois. Les modules téléchargés, eux, restent à vous pour toujours." },
]

const POINTS = [
  { titre: 'Pas de mystère inutile', texte: "Tout est expliqué clairement. Pas de jargon obscur, pas de rituels imposés. Vous comprenez ce que vous faites et pourquoi." },
  { titre: 'Le cœur au centre', texte: "Ce parcours place le cœur comme véritable centre de la pratique médiumnique. Le cœur est votre émetteur-récepteur. Le cerveau n'est qu'un processeur." },
  { titre: 'La souveraineté comme protection', texte: "Votre souveraineté intérieure est votre première et meilleure protection. Vous apprenez à la poser à chaque pratique — sans peur ni rituels compliqués." },
  { titre: "L'autonomie comme objectif", texte: "L'objectif n'est pas de vous rendre dépendant d'un enseignant ou d'un oracle. L'objectif est que vous trouviez votre propre voix et que vous appreniez à lui faire confiance." },
  { titre: "Un assistant formé par le créateur", texte: "MediumIA n'est pas un assistant générique. Il a été formé spécifiquement sur le contenu des 25 modules et la vision de Sébastien. Il parle avec la voix du parcours." },
]

const FAQ = [
  { q: 'Faut-il déjà avoir des capacités médiumniques ?', r: "Non, et c'est même tout le sens de cet accompagnement. La médiumnité n'est pas un don réservé à quelques élus. Le parcours est conçu pour les débutants comme pour celles et ceux qui pratiquent déjà et veulent structurer ce qu'ils ressentent." },
  { q: 'Combien de temps dure le parcours ?', r: "Il n'y a pas de durée imposée. Certains traversent un module par semaine, d'autres prennent le temps de vivre chaque exercice sur plusieurs jours. Vous disposez de 12 mois d'accès à l'application pour cheminer librement, et les modules téléchargés restent à vous pour toujours." },
  { q: 'Est-ce que MediumIA remplace un vrai accompagnement humain ?', r: "Non. MediumIA, l'assistant intégré, est un soutien disponible jour et nuit, mais il ne remplace pas la relation humaine. Il vous aide à découvrir votre propre canal et à gagner en autonomie. C'est un compagnon de route, pas un substitut." },
  { q: 'Est-ce que ce parcours est lié à une religion ?', r: "Non. MediumIA n'est rattachée à aucune religion ni à aucun dogme. L'approche est laïque, fondée sur l'expérience directe, le discernement et le respect de votre liberté. Quelles que soient vos croyances, vous restez souverain de votre chemin." },
  { q: "Puis-je suivre ce parcours depuis l'étranger ?", r: "Oui. L'application, l'assistant intégré et les modules PDF sont accessibles partout dans le monde, 24h/24, sans frais d'expédition. Votre code d'accès vous est envoyé par email dans les heures qui suivent le paiement." },
  { q: 'Puis-je payer en plusieurs fois ?', r: "Oui. Le parcours complet est à 597 €, et un paiement en 4 fois est disponible via PayPal sans complication. Vous choisissez simplement cette option au moment du règlement." },
]

const POUR_QUI = [
  "Vous ressentez quelque chose depuis longtemps, sans savoir le nommer.",
  "Vous pratiquez déjà et cherchez à structurer ce que vous vivez.",
  "Vous voulez apprendre dans la clarté — sans mystère inutile.",
  "Vous cherchez l'autonomie, pas la dépendance à un enseignant.",
]

function NiveauxAccordion() {
  const [open, setOpen] = useState(null)
  return (
    <div className="space-y-3">
      {NIVEAUX.map((n, i) => (
        <div key={i} className="border-2 border-gold/25 rounded-xl overflow-hidden bg-white/50 hover:border-gold/50 transition-colors cursor-pointer" onClick={() => setOpen(open === i ? null : i)}>
          <div className="flex items-center gap-5 px-6 py-5">
            <span className="font-georgia text-gold text-sm tracking-widest shrink-0">{n.num}</span>
            <div className="flex-1">
              <p className="font-georgia text-deep font-medium">{n.titre}</p>
              <p className="font-georgia text-mist text-xs mt-0.5">{n.modules}</p>
            </div>
            <span className="text-gold/60 text-xl shrink-0 transition-transform duration-300 select-none" style={{ transform: open === i ? 'rotate(45deg)' : 'none' }}>+</span>
          </div>
          {open === i && (
            <div className="px-6 pb-5 border-t border-gold/10">
              <p className="font-georgia text-deep text-sm leading-relaxed pt-4">{n.texte}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function FAQAccordion() {
  const [open, setOpen] = useState(null)
  return (
    <div className="space-y-2">
      {FAQ.map((item, i) => (
        <div key={i} className="border-2 border-gold/20 rounded-xl overflow-hidden bg-white/50 hover:border-gold/40 transition-colors cursor-pointer" onClick={() => setOpen(open === i ? null : i)}>
          <div className="flex items-center gap-5 px-6 py-5">
            <div className="flex-1 font-georgia text-deep font-medium text-base">{item.q}</div>
            <span className="text-gold/60 text-xl shrink-0 transition-transform duration-300 select-none" style={{ transform: open === i ? 'rotate(45deg)' : 'none' }}>+</span>
          </div>
          {open === i && (
            <div className="px-6 pb-5 border-t border-gold/10">
              <p className="font-georgia text-mist text-base leading-relaxed pt-4">{item.r}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function FormationPage({ onBack, onNavigate }) {
  return (
    <div className="bg-cream min-h-screen text-deep">

      {/* ── Nav ── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 flex items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors flex items-center gap-2">
            ← MediumIA
          </button>
          <span className="font-georgia text-deep tracking-[0.15em] text-sm font-semibold hidden md:block">Développer sa médiumnité</span>
          <span className="font-georgia text-xs md:text-sm tracking-wide px-4 py-2.5 md:px-5 rounded-lg bg-deep/10 text-deep/40 font-bold cursor-not-allowed">
            Bientôt disponible
          </span>
        </div>
      </header>

      <main className="pt-20">

        {/* ── Hero ── */}
        <section className="px-6 py-20 md:py-28 max-w-4xl mx-auto text-center">
          <img src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png" alt="MediumIA" className="w-36 md:w-48 mx-auto mb-8 opacity-90" />
          <p className="font-georgia text-gold tracking-[0.3em] text-xs uppercase mb-6">Accompagnement · Médiumnité consciente</p>
          <h1 className="font-georgia font-medium text-4xl md:text-6xl leading-tight mb-4">
            Développer sa médiumnité
          </h1>
          <p className="font-georgia text-mist text-sm tracking-[0.12em] uppercase mb-6">MEDIUMIA — Accompagnement à la Médiumnité Consciente</p>
          <blockquote className="font-bodoni text-2xl md:text-4xl text-deep leading-relaxed max-w-2xl mx-auto mb-3 italic">
            « La médiumnité ne s'apprend pas. Elle se découvre. »
          </blockquote>
          <p className="font-georgia text-gold/70 text-xs tracking-[0.2em] uppercase mb-10">— Sébastien Seguin</p>
          <p className="font-georgia text-mist text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            Un accompagnement structuré en 25 modules et 4 niveaux, né de plus de douze ans de pratique médiumnique réelle. Pas de théories. Une transmission.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <span className="font-georgia px-8 py-4 rounded-lg bg-deep/10 text-deep/40 font-bold cursor-not-allowed">
              Paiement disponible lors de la mise en ligne
            </span>
            <button onClick={() => document.getElementById('niveaux')?.scrollIntoView({ behavior: 'smooth' })} className="font-georgia px-8 py-4 rounded-lg border-2 border-gold/50 text-deep font-bold hover:border-gold transition-colors">
              Découvrir les 4 niveaux ↓
            </button>
          </div>
        </section>

        {/* ── Pour qui ── */}
        <section className="bg-deep/[0.04] px-6 py-14">
          <div className="max-w-3xl mx-auto">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-6 text-center">Ce parcours est pour vous si</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {POUR_QUI.map((item, i) => (
                <div key={i} className="flex gap-3 items-start border-2 border-gold/20 rounded-xl p-5 bg-white/50">
                  <span className="text-gold shrink-0 mt-0.5">—</span>
                  <p className="font-georgia text-deep text-sm leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Ce que contient la formation ── */}
        <section className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Le parcours complet</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-4">Ce que contient l'accompagnement</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {INCLUS.map((item, i) => (
              <div key={i} className="border-2 border-gold/25 rounded-2xl p-6 bg-white/60 hover:border-gold/60 transition-all">
                <span className="text-gold text-2xl block mb-3">{item.icon}</span>
                <p className="font-georgia font-medium text-deep text-base mb-2">{item.titre}</p>
                <p className="font-georgia text-sm text-mist leading-relaxed">{item.texte}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Les 4 niveaux ── */}
        <section id="niveaux" className="bg-deep/[0.04] px-6 py-16">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Structure du parcours</p>
              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-4">Le parcours en 4 niveaux</h2>
              <p className="font-georgia text-mist text-base leading-relaxed">25 modules répartis progressivement — chaque niveau s'appuie sur le précédent selon la logique naturelle par laquelle la médiumnité se découvre.</p>
            </div>
            <NiveauxAccordion />
          </div>
        </section>

        {/* ── Ce qui rend MediumIA différente ── */}
        <section className="px-6 py-16 max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">L'approche</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">Ce qui rend MediumIA différente</h2>
          </div>
          <div className="space-y-5">
            {POINTS.map((p, i) => (
              <div key={i} className="flex gap-5 items-start border-2 border-gold/20 rounded-2xl p-5 bg-white/40 hover:border-gold/40 transition-all">
                <span className="text-gold text-lg mt-0.5 shrink-0">✦</span>
                <div>
                  <p className="font-georgia font-medium text-deep mb-1">{p.titre}</p>
                  <p className="font-georgia text-sm text-mist leading-relaxed">{p.texte}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Sébastien ── */}
        <section className="bg-deep/[0.04] px-6 py-16 md:py-20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Le créateur du parcours</p>
              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">Sébastien Seguin</h2>
            </div>
            <div className="flex flex-col md:flex-row gap-10 items-start">
              <div className="shrink-0 flex justify-center md:justify-start w-full md:w-auto">
                <img
                  src="/sebastien.jpg"
                  alt="Sébastien Seguin, médium et fondateur de MediumIA"
                  className="w-52 h-72 md:w-56 md:h-80 object-cover object-top rounded-2xl border-2 shadow-md"
                  style={{ borderColor: '#C9A84C' }}
                />
              </div>
              <div className="space-y-4 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
                <p>Je m'appelle <strong className="text-deep">Sébastien Seguin</strong>. Je suis médium professionnel depuis plus de douze ans.</p>
                <p>Pendant toutes ces années, j'ai accompagné des milliers de personnes en consultation individuelle : des personnes venues chercher des réponses, des familles en lien avec un proche disparu, des êtres traversant un moment de doute, de deuil, de bascule ou d'éveil.</p>
                <p>Ce parcours a été construit à partir de cette pratique réelle, quotidienne. Pas à partir de livres. Pas à partir de théories. À partir de milliers de séances, de rencontres avec des consultants, des défunts, des guides, des oracles — à partir de ce qui fonctionne vraiment quand on est en face d'un être humain qui souffre et qui cherche.</p>
                <p className="text-deep font-medium">MediumIA n'est pas un parcours théorique. C'est une transmission.</p>
                <p>Mon parcours m'a appris une chose essentielle : la médiumnité n'est pas un don réservé à quelques élus. C'est une dimension naturelle de l'être humain, qui se réveille lorsque les bonnes conditions sont réunies. Ces conditions, c'est exactement ce que cet accompagnement vous propose de créer.</p>
                <blockquote className="border-l-4 border-gold pl-5 py-1 mt-4">
                  <p className="font-georgia text-lg text-mist italic leading-relaxed">
                    « L'enfer précède le paradis. La lumière s'exprime à travers l'obscurité. C'est le jeu ici. »
                  </p>
                </blockquote>
              </div>
            </div>
          </div>
        </section>

        {/* ── Essai gratuit MediumIA ── */}
        <section className="px-6 py-16 bg-deep/3">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Essai gratuit</p>
              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-4">Poser vos questions à MediumIA</h2>
              <p className="font-georgia text-mist text-base leading-relaxed">Découvrez l'assistant qui vous accompagnera tout au long du parcours. 5 messages offerts, sans inscription.</p>
            </div>
            <TrialChat />
          </div>
        </section>

        {/* ── Offre / Prix ── */}
        <section className="px-6 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Rejoindre l'accompagnement</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-8">Commencer votre parcours</h2>
            <div className="border-2 border-gold/40 rounded-2xl p-8 md:p-10 bg-white/70 text-left mb-6">
              <p className="font-georgia text-xs text-mist tracking-widest uppercase mb-6 text-center">Le parcours complet comprend</p>
              <ul className="font-georgia text-base text-deep space-y-3 mb-8">
                {[
                  '25 modules PDF téléchargeables (269 pages)',
                  'Application MediumIA sur mobile et ordinateur',
                  'MediumIA, votre assistant personnel',
                  '84 exercices guidés',
                  'Carnet de pratique intégré',
                  "12 mois d'accès à l'application",
                ].map((item, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="text-gold shrink-0 mt-1">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="text-center">
                <div className="mb-1">
                  <span className="font-georgia text-5xl text-deep font-medium">597 €</span>
                </div>
                <p className="font-georgia text-mist text-sm italic mb-6">Paiement en 4× disponible via PayPal</p>
                <button disabled className="font-georgia inline-block px-10 py-4 rounded-lg bg-deep/20 text-deep/40 font-bold text-lg cursor-not-allowed w-full md:w-auto">
                  Paiement disponible lors de la mise en ligne
                </button>
                <p className="font-georgia text-xs text-mist mt-4 leading-relaxed max-w-md mx-auto italic">
                  Version preview — le paiement sera activé lors de la mise en ligne officielle.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="px-6 pb-16 max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Questions fréquentes</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">FAQ</h2>
          </div>
          <FAQAccordion />
        </section>

        {/* ── CTA final ── */}
        <section className="px-6 py-12 text-center border-t border-gold/20">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
            ← Retour à MediumIA
          </button>
        </section>

      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
