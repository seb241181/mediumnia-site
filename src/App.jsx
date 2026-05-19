import { useEffect, useRef, useState } from 'react'
import './index.css'

/* ─── Hook d'animation au scroll ─── */
function useFadeIn() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) el.classList.add('visible') },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

/* ─── Composants réutilisables ─── */
function Section({ id, children, className = '' }) {
  const ref = useFadeIn()
  return (
    <section id={id} ref={ref} className={`fade-in px-6 py-20 md:py-28 max-w-3xl mx-auto w-full ${className}`}>
      {children}
    </section>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="font-georgia text-2xl md:text-3xl text-deep font-medium leading-tight mb-10">
      {children}
    </h2>
  )
}

function Ornament() {
  return <p className="text-gold/40 text-sm tracking-widest text-center my-10">◆ ─────── ◆</p>
}

function BtnPrimary({ href = '#stripe', children, className = '' }) {
  return (
    <a
      href={href}
      className={`inline-block font-georgia text-sm md:text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02] ${className}`}
      style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}
    >
      {children}
    </a>
  )
}

/* ─── NAV TOP ─── */
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-cream/95 backdrop-blur-sm border-b border-gold/20 shadow-sm' : ''}`}>
      <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#" className="font-georgia text-deep tracking-[0.2em] text-sm font-medium">
          ✦ MEDIUMNIA
        </a>
        <a href="#prix"
          className="font-georgia text-xs tracking-wide px-4 py-2 rounded-lg border border-gold/40 text-gold hover:bg-gold/10 transition-all hidden md:block">
          Rejoindre la formation
        </a>
      </div>
    </header>
  )
}

/* ─── SECTION 1 — HERO ─── */
function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 py-20 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #C9A84C 0%, transparent 70%)' }} />
      <div className="relative z-10">
        <p className="text-gold text-5xl mb-6 opacity-70">✦</p>
        <h1 className="font-georgia text-5xl md:text-7xl text-deep tracking-[0.25em] font-medium mb-4">
          MEDIUMNIA
        </h1>
        <p className="font-georgia text-mist text-base md:text-xl tracking-widest italic mb-12">
          Formation à la Médiumnité Consciente
        </p>
        <p className="font-georgia text-deep text-xl md:text-2xl leading-loose max-w-lg mx-auto mb-14">
          Tout a toujours été là.<br />
          Vous n'avez rien à devenir.<br />
          Vous avez quelque chose à retrouver.
        </p>
        <a
          href="#formation"
          className="font-georgia text-base tracking-wide text-gold border border-gold/50 px-8 py-4 rounded-lg hover:bg-gold/10 transition-all"
        >
          Découvrir la formation ↓
        </a>
      </div>
    </section>
  )
}

/* ─── SECTION 2 — LE CONSTAT ─── */
function Constat() {
  return (
    <Section id="constat">
      <Ornament />
      <SectionTitle>Pourquoi les autres formations ne fonctionnent pas</SectionTitle>
      <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
        <p>
          Vous avez peut-être déjà lu des livres sur la médiumnité. Suivi des stages. Regardé des vidéos. Et pourtant, à chaque fois, le même sentiment revient : quelque chose manque. Un flou persiste. Les techniques s'empilent mais la clarté n'arrive pas.
        </p>
        <p>
          La plupart des formations sur la médiumnité font la même erreur. Elles vous donnent des méthodes à appliquer de l'extérieur. Comme si la médiumnité était une compétence technique qu'on visse sur soi. Visualisez ceci. Ressentez cela. Ouvrez tel chakra. Appelez tel guide.
        </p>
        <p>
          Et vous, au milieu de tout ça, vous restez avec vos doutes. <em>Est-ce que c'est mon mental ? Est-ce que j'invente ? Est-ce que je suis vraiment fait pour ça ?</em>
        </p>
        <p className="text-deep font-medium text-xl md:text-2xl mt-8 leading-snug">
          Le problème n'est pas en vous.<br />Le problème, c'est l'approche.
        </p>
      </div>
    </Section>
  )
}

/* ─── SECTION 3 — LA SOLUTION ─── */
function Solution() {
  return (
    <section id="formation" className="bg-deep/[0.03]">
      <Section className="!pt-20 !pb-20">
        <SectionTitle>Mediumnia : une formation qui libère au lieu d'enfermer</SectionTitle>
        <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
          <p>
            Mediumnia ne vous enseigne pas la médiumnité comme une technique extérieure. Elle vous accompagne dans la redécouverte de ce que vous portez déjà en vous.
          </p>
          <p>
            Cette formation a été construite à partir de plus de douze ans de pratique médiumnique au quotidien. Pas à partir de livres. Pas à partir de théories. À partir de milliers de séances, de rencontres avec des consultants, des défunts, des guides, des oracles. À partir de ce qui fonctionne vraiment quand on est en face d'un être humain qui souffre et qui cherche.
          </p>
          <p>
            Mediumnia est structurée en 25 modules et 4 niveaux. Chaque module s'appuie sur le précédent. L'ordre n'est pas arbitraire. Il suit la logique exacte par laquelle la médiumnité se découvre : d'abord les fondations, puis la technique du canal, puis la maîtrise, puis l'art du médium accompli.
          </p>
        </div>
        <blockquote className="mt-12 border-l-4 border-gold pl-6 py-2">
          <p className="font-georgia text-xl md:text-2xl text-deep italic leading-relaxed">
            « La médiumnité ne s'apprend pas. Elle se découvre. »
          </p>
        </blockquote>
      </Section>
    </section>
  )
}

/* ─── SECTION 4 — CE QUE VOUS RECEVEZ ─── */
const INCLUS = [
  { icon: '📚', titre: '25 modules imprimés', texte: 'Envoyés chez vous par courrier. 25 modules complets répartis en 4 niveaux, plus une introduction et un lexique. Écrits dans un langage clair, profond et accessible. Chaque module contient des explications, des exercices pratiques, des questions de réflexion et une citation centrale.' },
  { icon: '📱', titre: 'L\'application Mediumnia', texte: 'Installable sur votre téléphone, accessible 24h/24. Elle contient tous vos modules en version numérique, 32 exercices guidés avec chronomètre, un carnet de pratique personnel et le suivi de votre progression.' },
  { icon: '✦', titre: 'Mediumia, votre coach IA personnel', texte: 'Intégrée dans l\'application, Mediumia est une intelligence artificielle formée spécifiquement sur le contenu de la formation. Elle répond à vos questions, vous aide à relire vos ressentis avec discernement, et vous accompagne module après module. Elle ne canalise pas à votre place. Elle vous aide à découvrir votre propre canal.' },
  { icon: '⏱️', titre: '32 exercices guidés', texte: 'Chaque exercice est accompagné d\'un minuteur, d\'étapes claires et d\'une question de carnet. Du plus simple au plus avancé, ils construisent progressivement votre pratique.' },
  { icon: '📝', titre: 'Votre carnet de pratique', texte: 'Intégré dans l\'application, il vous permet de noter vos ressentis, vos perceptions, vos questions après chaque exercice. Avec le temps, il devient votre outil de discernement le plus précieux.' },
  { icon: '🔓', titre: '12 mois d\'accès', texte: 'Votre code personnel vous donne accès à l\'application et à Mediumia pendant 12 mois. Les modules imprimés, eux, restent à vous pour toujours.' },
]

function Contenu() {
  return (
    <Section id="contenu">
      <Ornament />
      <SectionTitle>Ce que contient la formation</SectionTitle>
      <div className="grid md:grid-cols-2 gap-5">
        {INCLUS.map((item, i) => (
          <div key={i} className="border border-gold/20 rounded-xl p-6 bg-white/60 hover:border-gold/50 transition-all">
            <p className="text-2xl mb-3">{item.icon}</p>
            <p className="font-georgia font-medium text-deep text-base mb-2">{item.titre}</p>
            <p className="font-georgia text-sm text-mist/80 leading-relaxed">{item.texte}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ─── SECTION 5 — LES 4 NIVEAUX ─── */
const NIVEAUX = [
  { num: '01', titre: 'Les Fondations', modules: 'Modules 1 à 6', texte: 'Poser l\'intention juste. Recevoir avant d\'interpréter. Découvrir votre canal dominant. Comprendre ce qu\'est vraiment un oracle. Développer le discernement vibratoire. Entrer en contact avec vos guides.' },
  { num: '02', titre: 'La Technique du Canal', modules: 'Modules 7 à 13', texte: 'Le contact avec les défunts. La consécration d\'un oracle. L\'art de la canalisation consciente. L\'ouverture et la fermeture du canal. Les trois sources d\'information intérieure. Le canal intérieur. Les codes vibratoires.' },
  { num: '03', titre: 'Maîtrise et Autonomie', modules: 'Modules 14 à 20', texte: 'La gestion des émotions du médium. La lecture des signes et synchronicités. La conscience du canal. L\'approfondissement de la relation avec vos guides. L\'art de filtrer les informations. Le contact avancé avec les défunts. La médiumnité mature.' },
  { num: '04', titre: 'L\'Art du Médium Maître', modules: 'Modules 21 à 25', texte: 'La canalisation créative. La réception instantanée. La canalisation en séance. La lecture médiumnique structurée. Et le module final : accompagner les vivants.' },
]

function Niveaux() {
  const [open, setOpen] = useState(null)
  return (
    <section className="bg-deep/[0.03]">
      <Section id="niveaux">
        <SectionTitle>Le parcours en 4 niveaux</SectionTitle>
        <div className="space-y-3">
          {NIVEAUX.map((n, i) => (
            <div key={i}
              className="border border-gold/20 rounded-xl overflow-hidden cursor-pointer hover:border-gold/50 transition-all bg-white/50"
              onClick={() => setOpen(open === i ? null : i)}
            >
              <div className="flex items-center gap-5 px-6 py-5">
                <span className="font-georgia text-gold text-sm tracking-widest opacity-50 shrink-0">{n.num}</span>
                <div className="flex-1">
                  <p className="font-georgia text-deep font-medium">{n.titre}</p>
                  <p className="font-georgia text-mist/60 text-xs mt-0.5">{n.modules}</p>
                </div>
                <span className="text-gold/60 text-xl shrink-0 transition-transform duration-300 select-none"
                  style={{ transform: open === i ? 'rotate(45deg)' : 'rotate(0deg)' }}>
                  +
                </span>
              </div>
              {open === i && (
                <div className="px-6 pb-6 border-t border-gold/10">
                  <p className="font-georgia text-sm text-mist/80 leading-relaxed pt-4">{n.texte}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </section>
  )
}

/* ─── SECTION 6 — QUI EST SÉBASTIEN ─── */
function Sebastien() {
  return (
    <Section id="sebastien">
      <Ornament />
      <SectionTitle>Qui vous transmet cette formation</SectionTitle>
      <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
        <p>Je m'appelle <strong className="text-deep">Sébastien Seguin</strong>. Les gens qui me connaissent m'appellent Frérot.</p>
        <p>Je suis médium professionnel depuis plus de douze ans. Pendant cette période, j'ai accompagné des milliers de personnes en consultation individuelle. Des vivants qui cherchaient des réponses. Des familles qui voulaient entrer en contact avec un proche disparu. Des êtres perdus qui avaient juste besoin d'entendre qu'ils n'étaient pas seuls.</p>
        <p>Ma liste d'attente a atteint un an. J'ai dû arrêter certaines activités pour la réduire à quatre mois. Ce n'est pas pour me vanter. C'est pour vous dire que ce que je transmets dans cette formation vient d'une pratique réelle, quotidienne, intense, testée par la réalité de milliers de séances.</p>
        <p>Je n'ai pas appris la médiumnité dans les livres. Je l'ai découverte dans mon propre corps, à travers mes propres épreuves, mes propres doutes, mes propres traversées. Et c'est cette expérience directe que j'ai voulu transmettre ici.</p>
        <p className="text-deep font-medium text-lg">Mediumnia n'est pas une formation théorique. C'est une transmission.</p>
        <p>Mon parcours m'a appris une chose que je veux partager avec vous avant toute autre. La médiumnité n'est pas un don réservé à quelques élus. C'est une dimension naturelle de l'être humain qui se réveille quand les conditions sont réunies. Ces conditions, c'est exactement ce que cette formation vous propose de créer.</p>
        <p>Je ne vous promets pas que vous deviendrez médium professionnel en 25 modules. Je vous promets que vous découvrirez quelque chose de réel en vous. Et que cette découverte changera votre façon de percevoir le monde.</p>
      </div>
      <blockquote className="mt-12 border-l-4 border-gold pl-6 py-2">
        <p className="font-georgia text-lg md:text-xl text-mist italic leading-relaxed">
          « L'enfer précède le paradis. La lumière s'exprime à travers l'obscurité. C'est le jeu ici. »
        </p>
      </blockquote>
    </Section>
  )
}

/* ─── SECTION 7 — TÉMOIGNAGES ─── */
const TEMOIGNAGES = [
  { texte: '« Vraiment incroyable. Le sentiment que j\'ai eu c\'est comme si on partait dans une aventure de découverte, très complexe dans la simplicité dont vous avez écrit. J\'ai pas ressenti un effort intellectuel pour comprendre, tout était très clair et ça a touché plus mes émotions que l\'intellectuel. Quand j\'avais lu d\'autres livres sur la médiumnité je restais toujours confuse. Cette fois-ci j\'ai eu plutôt un sentiment de paix. »', source: 'Retour de formation' },
  { texte: '« J\'ai retrouvé ma petite voix, il y a longtemps que je ne l\'entendais plus et grâce à vos exercices, elle est revenue. J\'ai retrouvé une partie de moi-même. »', source: 'Retour d\'atelier' },
  { texte: '« I love the Mediumnia app! It is very easy to navigate. Great work, I really like it and I don\'t have any comments, I am excited for the launch! »', source: 'Nuri — Retour sur l\'application' },
  { texte: '« Ils ont surtout compris que tout est simple et accessible, il suffit de se l\'autoriser. Pour eux, c\'est une révélation choquante car elle est pourvue de simplicité. »', source: 'Retour d\'atelier' },
]

function Temoignages() {
  return (
    <section className="bg-deep/[0.03]">
      <Section id="temoignages">
        <SectionTitle>Ce qu'en disent ceux qui l'ont vécu</SectionTitle>
        <div className="grid md:grid-cols-2 gap-5">
          {TEMOIGNAGES.map((t, i) => (
            <div key={i} className="bg-white/80 border border-gold/20 rounded-xl p-6">
              <p className="font-georgia text-sm md:text-base text-deep/80 italic leading-relaxed mb-4">{t.texte}</p>
              <p className="font-georgia text-xs text-gold/70 tracking-wide">— {t.source}</p>
            </div>
          ))}
        </div>
      </Section>
    </section>
  )
}

/* ─── SECTION 8 — APPROCHE UNIQUE ─── */
const POINTS = [
  { titre: 'Pas de mystère inutile', texte: 'Tout est expliqué clairement. Pas de jargon obscur, pas de rituels imposés, pas de hiérarchie invisible. Vous comprenez ce que vous faites et pourquoi.' },
  { titre: 'Le cœur au centre', texte: 'La formation place le cœur, et non le cerveau, comme véritable centre de la pratique médiumnique. Le cœur est votre émetteur-récepteur. Le cerveau n\'est qu\'un processeur.' },
  { titre: 'La souveraineté comme protection', texte: 'Pas de peur, pas de rituels de protection compliqués. Votre souveraineté intérieure est votre première et meilleure protection. Vous apprenez à la poser à chaque pratique.' },
  { titre: 'Un coach IA formé par le créateur', texte: 'Mediumia n\'est pas un chatbot générique. Elle a été formée spécifiquement sur le contenu des 25 modules et sur la vision de Sébastien. Elle parle avec la voix de la formation.' },
  { titre: 'L\'autonomie comme objectif', texte: 'L\'objectif n\'est pas de vous rendre dépendant d\'un enseignant, d\'un oracle ou d\'un guide. L\'objectif est que vous trouviez votre propre voix et que vous appreniez à lui faire confiance.' },
]

function Approche() {
  return (
    <Section id="approche">
      <Ornament />
      <SectionTitle>Ce qui rend Mediumnia différente</SectionTitle>
      <div className="space-y-6">
        {POINTS.map((p, i) => (
          <div key={i} className="flex gap-5 items-start">
            <span className="text-gold text-lg mt-0.5 shrink-0">✦</span>
            <div>
              <p className="font-georgia font-medium text-deep mb-1">{p.titre}</p>
              <p className="font-georgia text-sm md:text-base text-mist/80 leading-relaxed">{p.texte}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ─── SECTION 9 — LE PRIX ─── */
function Prix() {
  return (
    <section id="prix" className="bg-deep/[0.03]">
      <Section>
        <SectionTitle>Rejoindre Mediumnia</SectionTitle>
        <div className="border-2 border-gold/40 rounded-2xl p-8 md:p-12 bg-white/70 text-center">
          <p className="font-georgia text-xs text-mist/50 tracking-widest uppercase mb-8">La formation complète comprend</p>
          <ul className="font-georgia text-base md:text-lg text-deep/80 space-y-3 text-left max-w-sm mx-auto mb-10">
            {[
              '25 modules imprimés envoyés chez vous',
              'Application Mediumnia sur votre téléphone',
              'Mediumia, votre coach IA personnel',
              '32 exercices guidés avec chronomètre',
              'Carnet de pratique intégré',
              '12 mois d\'accès à l\'application',
            ].map((item, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="text-gold shrink-0 mt-1">—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mb-2">
            <span className="font-georgia text-5xl md:text-6xl text-deep font-medium">597 €</span>
          </div>
          <p className="font-georgia text-mist/60 text-sm italic mb-8">ou 3 × 199 €</p>
          <BtnPrimary href="#stripe" className="text-lg px-12 py-5">
            Commencer la formation →
          </BtnPrimary>
          <p className="font-georgia text-xs text-mist/50 mt-6 leading-relaxed max-w-md mx-auto">
            Paiement sécurisé par Stripe. Vous recevrez vos modules imprimés sous 10 jours ouvrés et votre code d'accès personnel par email dans les 24 heures suivant votre achat.
          </p>
        </div>
      </Section>
    </section>
  )
}

/* ─── SECTION 10 — FAQ ─── */
const FAQ_ITEMS = [
  { q: 'Faut-il déjà avoir des capacités médiumniques ?', r: 'Non. La formation est conçue pour les débutants comme pour ceux qui ont déjà des perceptions. Elle commence par les fondations et avance progressivement. Quel que soit votre point de départ, vous êtes au bon endroit.' },
  { q: 'Combien de temps dure la formation ?', r: 'C\'est vous qui décidez de votre rythme. Certains la traversent en trois mois, d\'autres en un an. Votre accès à l\'application dure 12 mois. Les modules imprimés restent à vous pour toujours.' },
  { q: 'Est-ce que Mediumia remplace un vrai accompagnement humain ?', r: 'Mediumia est un coach IA formé sur le contenu exact de la formation. Elle ne remplace pas un accompagnement thérapeutique ou un suivi médical. Elle vous aide à comprendre les modules, à relire vos ressentis et à construire votre pratique avec discernement.' },
  { q: 'Est-ce que la formation est liée à une religion ?', r: 'Non. Mediumnia ne s\'inscrit dans aucune religion ni aucun dogme. Elle respecte toutes les croyances et propose un cadre universel basé sur l\'expérience directe.' },
  { q: 'Puis-je suivre la formation depuis l\'étranger ?', r: 'L\'application fonctionne partout dans le monde. Les modules imprimés sont envoyés par courrier, les frais de port internationaux peuvent varier. Contactez-nous pour plus d\'informations.' },
  { q: 'Et si je ne suis pas satisfait ?', r: 'Si dans les 14 jours suivant la réception de vos modules vous estimez que la formation ne vous convient pas, vous pouvez demander un remboursement intégral en nous contactant par email.' },
  { q: 'Comment fonctionne le paiement en 3 fois ?', r: 'Vous payez 199 € au moment de l\'achat, puis 199 € un mois après, puis 199 € deux mois après. Le paiement est automatique et sécurisé par Stripe.' },
]

function FaqSection() {
  const [open, setOpen] = useState(null)
  return (
    <Section id="faq">
      <Ornament />
      <SectionTitle>Questions fréquentes</SectionTitle>
      <div className="space-y-3">
        {FAQ_ITEMS.map((item, i) => (
          <div key={i}
            className="border border-gold/20 rounded-xl overflow-hidden cursor-pointer hover:border-gold/40 transition-all bg-white/40"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <div className="flex items-center justify-between px-6 py-5 gap-4">
              <p className="font-georgia text-sm md:text-base text-deep font-medium leading-snug text-left">{item.q}</p>
              <span className="text-gold/60 text-xl shrink-0 transition-transform duration-300 select-none"
                style={{ transform: open === i ? 'rotate(45deg)' : 'rotate(0deg)' }}>
                +
              </span>
            </div>
            {open === i && (
              <div className="px-6 pb-6 border-t border-gold/10">
                <p className="font-georgia text-sm md:text-base text-mist/80 leading-relaxed pt-4">{item.r}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ─── FOOTER ─── */
function Footer() {
  return (
    <footer className="border-t border-gold/20 px-6 py-16 text-center">
      <p className="font-georgia text-lg md:text-xl text-mist italic leading-relaxed max-w-xl mx-auto mb-6">
        « La médiumnité ne s'apprend pas. Elle se découvre.<br />Tout a toujours été là. »
      </p>
      <p className="text-gold text-3xl mb-10">✦</p>
      <div className="font-georgia text-xs text-mist/50 space-y-1 mb-8">
        <p>Mediumnia — Formation à la Médiumnité Consciente</p>
        <p>Sébastien Seguin — Médium professionnel</p>
        <p>SIRET : 81918584400027</p>
      </div>
      <div className="flex items-center justify-center gap-6 font-georgia text-xs text-mist/40">
        <a href="mailto:contact@mediumnia.fr" className="hover:text-gold transition-colors">Contact</a>
        <span>·</span>
        <a href="#" className="hover:text-gold transition-colors">Mentions légales</a>
        <span>·</span>
        <a href="#" className="hover:text-gold transition-colors">Politique de confidentialité</a>
      </div>
    </footer>
  )
}

/* ─── BARRE STICKY MOBILE ─── */
function StickyBar() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 md:hidden transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'}`}>
      <div className="flex items-center justify-between px-5 py-4 border-t border-gold/20"
        style={{ backgroundColor: '#1A1535' }}>
        <p className="font-georgia text-sm text-gold/80">597 € · Paiement en 3× possible</p>
        <a href="#stripe"
          className="font-georgia text-sm px-5 py-2.5 rounded-lg transition-all hover:opacity-90 shrink-0 ml-4"
          style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}>
          Commencer →
        </a>
      </div>
    </div>
  )
}

/* ─── APP ─── */
export default function App() {
  return (
    <div className="bg-cream min-h-screen">
      <Nav />
      <main>
        <Hero />
        <Constat />
        <Solution />
        <Contenu />
        <Niveaux />
        <Sebastien />
        <Temoignages />
        <Approche />
        <Prix />
        <FaqSection />
      </main>
      <Footer />
      <StickyBar />
    </div>
  )
}
