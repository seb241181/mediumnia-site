import { useEffect, useRef, useState } from 'react'
import './index.css'
import OracleTest from './components/OracleTest'

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
    <section id={id} ref={ref} className={`fade-in px-6 py-12 md:py-16 max-w-3xl mx-auto w-full ${className}`}>
      {children}
    </section>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="font-georgia text-2xl md:text-3xl text-deep font-medium leading-tight mb-6">
      {children}
    </h2>
  )
}

function Ornament() {
  return <p className="text-gold/40 text-sm tracking-widest text-center my-6">◆ ─────── ◆</p>
}

function BtnPrimary({ href = 'https://www.paypal.com/ncp/payment/V7G9ELH4LF6YW', children, className = '' }) {
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
        <a href="#" className="font-georgia text-deep tracking-[0.2em] text-base font-semibold">
          ✦ MEDIUMIA
        </a>
        <div className="flex items-center gap-4">
          <a
            href="https://mediumnia-app.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="font-georgia text-sm tracking-wide text-deep/70 hover:text-gold transition-colors hidden md:block font-bold"
          >
            Déjà inscrit ? Mon espace →
          </a>
          <a href="#prix"
            className="font-georgia text-sm tracking-wide px-5 py-2.5 rounded-lg transition-all hover:opacity-90 hidden md:block font-bold"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 700 }}>
            Rejoindre l'accompagnement
          </a>
        </div>
      </div>
    </header>
  )
}

/* ─── SECTION 1 — HERO ─── */
function Hero() {
  const [showTrialForm, setShowTrialForm] = useState(false)
  return (
    <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 py-20 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #C9A84C 0%, transparent 70%)' }} />
      <div className="relative z-10 hero-fade-in">
        <p className="text-gold text-4xl mb-4 opacity-70">✦</p>
        <h1 className="font-georgia text-5xl md:text-7xl text-deep tracking-[0.25em] font-medium mb-4">
          MEDIUMIA
        </h1>
        <p className="font-georgia text-mist text-base md:text-xl tracking-widest italic mb-8">
          Accompagnement à la Médiumnité Consciente
        </p>
        <p className="font-georgia text-deep text-xl md:text-2xl leading-loose max-w-lg mx-auto mb-4">
          Tout a toujours été là.<br />
          Vous n'avez rien à devenir.<br />
          Vous avez quelque chose à retrouver.
        </p>
        <p className="font-georgia text-mist text-sm md:text-base italic mb-10 max-w-md mx-auto">
          Une méthode claire et progressive, accessible même si vous débutez.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <a
            href="#parcours"
            className="font-georgia text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}
          >
            Découvrir le parcours
          </a>
          <button
            onClick={() => setShowTrialForm(true)}
            className="font-georgia text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 700 }}
          >
            Essayer Mediumia gratuitement
          </button>
        </div>
        <a
          href="#oracle"
          className="inline-block mt-8 font-georgia text-sm tracking-wide px-6 py-3 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]" style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 700 }}
        >
          ✦ Testez gratuitement l'Oracle Au-delà de l'Âme ✦
        </a>
        <div className="mt-4">
          <a
            href="https://sebastien-seguin.reservio.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-georgia text-sm tracking-wide px-6 py-3 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 700 }}
          >
            Prendre RDV avec Sébastien →
          </a>
        </div>
      </div>

      {showTrialForm && <FormulaireEssai onClose={() => setShowTrialForm(false)} />}
    </section>
  )
}

/* ─── FORMULAIRE D'ESSAI GRATUIT ─── */
function generateTrialCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `ESSAI-${part()}-${part()}`
}

function FormulaireEssai({ onClose }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | success | error
  const [code, setCode] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    const trialCode = generateTrialCode()
    setCode(trialCode)

    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: '9d7eb809-6bd2-4fc3-93b2-c675a63b259e',
          subject: '🎉 Nouvel essai gratuit Mediumia',
          email: email.trim(),
          message: `Nouvel essai gratuit Mediumia

Email : ${email.trim()}
Code d'accès : ${trialCode}
Date : ${new Date().toLocaleDateString('fr-FR')}

L'utilisateur peut se connecter sur : https://mediumnia-app.vercel.app`,
        }),
      })
      if (!res.ok) throw new Error('Erreur')
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  // Fermeture au clic sur l'overlay ou Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-deep/60 backdrop-blur-sm" />
      <div className="relative bg-cream w-full max-w-md rounded-2xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-mist/50 hover:text-mist text-2xl leading-none" aria-label="Fermer">×</button>

        {status === 'success' ? (
          <div className="text-center py-4">
            <p className="text-4xl mb-4">✨</p>
            <h3 className="font-georgia text-xl text-deep font-medium mb-3">Code envoyé !</h3>
            <p className="font-georgia text-sm text-mist leading-relaxed mb-6">
              Votre code d'essai a été envoyé à <strong className="text-deep">{email}</strong>.
            </p>
            <div className="bg-deep/5 rounded-xl p-4 mb-6">
              <p className="font-georgia text-xs text-mist/70 mb-2">Votre code :</p>
              <p className="font-georgia text-lg text-gold font-bold tracking-wider">{code}</p>
            </div>
            <p className="font-georgia text-xs text-mist/60 leading-relaxed mb-6">
              Rendez-vous sur <a href="https://mediumnia-app.vercel.app" target="_blank" rel="noopener noreferrer" className="text-gold underline">mediumnia-app.vercel.app</a> et saisissez ce code pour commencer.
            </p>
            <button onClick={onClose}
              className="font-georgia text-sm px-6 py-3 rounded-lg transition-all hover:opacity-90"
              style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}>
              C'est noté !
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <p className="text-3xl mb-3">✨</p>
              <h3 className="font-georgia text-xl text-deep font-medium mb-2">Essayez Mediumia gratuitement</h3>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Recevez un code d'accès pour discuter avec Mediumia, découvrir la formation et poser toutes vos questions.<br />
                <strong className="text-deep">30 messages offerts.</strong>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="font-georgia text-xs text-mist uppercase tracking-wider block mb-1.5">
                  Votre email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="vous@exemple.fr"
                  required
                  className="w-full font-georgia text-sm text-deep bg-white/70 border border-gold/30 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors"
                />
              </div>
              <button type="submit" disabled={status === 'sending' || !email.trim()}
                className="w-full font-georgia text-sm tracking-wide px-6 py-3 rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}>
                {status === 'sending' ? 'Envoi en cours...' : 'Recevoir mon code d\'essai'}
              </button>
              {status === 'error' && (
                <p className="font-georgia text-xs text-red-500 text-center">Une erreur est survenue. Réessayez ou contactez-nous.</p>
              )}
            </form>

            <p className="font-georgia text-xs text-mist/50 text-center mt-6 leading-relaxed">
              Code utilisable immédiatement. Accès à Mediumia uniquement. 30 messages. Valable 7 jours.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── SECTION MIROIR — EST-CE QUE CELA VOUS PARLE ? ─── */
function EstCeQueCelaVousParle() {
  return (
    <Section id="miroir">
      <Ornament />
      <SectionTitle>Est-ce que cela vous parle ?</SectionTitle>
      <p className="font-georgia text-mist text-base md:text-lg italic -mt-4 mb-10">
        Avant de parler de méthode, parlons de vous.
      </p>
      <div className="space-y-7 mb-12">
        {[
          "Vous ressentez parfois des choses que vous ne savez pas expliquer, et vous vous demandez si c'est réel ou si vous l'imaginez.",
          "Une intuition vous traverse, juste, précise, et vous ne savez pas d'où elle vient.",
          "Vous avez lu des livres, suivi des vidéos, et il vous est resté ce sentiment qu'une porte était là, tout près, sans s'ouvrir vraiment.",
          "Vous sentez que quelque chose en vous demande à être écouté, mais personne ne vous a jamais montré comment.",
        ].map((phrase, i) => (
          <div key={i} className="flex gap-5 items-start">
            <span className="text-gold text-lg mt-1 shrink-0">✦</span>
            <p className="font-georgia text-base md:text-lg text-deep/80 leading-relaxed">{phrase}</p>
          </div>
        ))}
      </div>
      <p className="font-georgia text-center text-lg md:text-xl text-deep italic leading-relaxed max-w-2xl mx-auto border-t border-gold/20 pt-6">
        Si l'une de ces phrases résonne, vous êtes au bon endroit. Ce n'est pas une question de don réservé à quelques-uns. C'est une dimension naturelle qui demande seulement les bonnes conditions pour se révéler.
      </p>
    </Section>
  )
}

/* ─── SECTION 2 — LE CONSTAT ─── */
function Constat() {
  return (
    <Section id="constat">
      <Ornament />
      <SectionTitle>En quoi cet accompagnement est différent</SectionTitle>
      <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
        <p>
          Peut-être avez-vous déjà exploré des livres, des stages ou des vidéos sur la médiumnité. Et peut-être avez-vous eu ce sentiment persistant : quelque chose de juste était là, mais pas encore pleinement accessible.
        </p>
        <p>
          Ce n'est pas une question de capacité. C'est une question d'approche.
        </p>
        <p>
          La plupart des chemins vers la médiumnité proposent des méthodes à appliquer depuis l'extérieur. Des techniques à ajouter. Des rituels à reproduire. Mediumia part d'un postulat différent : votre perception est déjà là. Elle n'attend pas d'être construite. Elle attend d'être reconnue.
        </p>
        <p className="text-deep font-medium text-xl md:text-2xl mt-5 leading-snug">
          C'est cette différence fondamentale qui change tout.
        </p>
      </div>
    </Section>
  )
}

/* ─── SECTION 3 — LA SOLUTION ─── */
function Solution() {
  return (
    <section id="parcours" className="bg-deep/[0.03]">
      <Section className="!pt-12 !pb-12">
        <SectionTitle>Mediumia : un accompagnement qui libère au lieu d'enfermer</SectionTitle>
        <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
          <p>
            Mediumia ne vous enseigne pas la médiumnité comme une technique extérieure. Elle vous accompagne dans la redécouverte de ce que vous portez déjà en vous.
          </p>
          <p>
            Ce parcours a été construit à partir de plus de douze ans de pratique médiumnique au quotidien. Pas à partir de livres. Pas à partir de théories. À partir de milliers de séances, de rencontres avec des consultants, des défunts, des guides, des oracles. À partir de ce qui fonctionne vraiment quand on est en face d'un être humain qui souffre et qui cherche.
          </p>
          <p>
            Mediumia est structuré en 25 modules et 4 niveaux. Chaque module s'appuie sur le précédent. L'ordre n'est pas arbitraire. Il suit la logique exacte par laquelle la médiumnité se découvre : d'abord les fondations, puis la technique du canal, puis la maîtrise, puis l'art du médium accompli.
          </p>
        </div>
        <blockquote className="mt-8 border-l-4 border-gold pl-6 py-2">
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
  { icon: '📚', titre: '25 modules imprimés', texte: "Envoyés chez vous par courrier. 25 modules complets répartis en 4 niveaux, plus une introduction et un lexique. Écrits dans un langage clair, profond et accessible. Chaque module contient des explications, des exercices pratiques, des questions de réflexion et une citation centrale." },
  { icon: '⏱️', titre: '32 exercices guidés', texte: "Chaque exercice est accompagné d'un minuteur, d'étapes claires et d'une question de carnet. Du plus simple au plus avancé, ils construisent progressivement votre pratique." },
  { icon: '📝', titre: 'Votre carnet de pratique', texte: "Intégré dans l'application, il vous permet de noter vos ressentis, vos perceptions, vos questions après chaque exercice. Avec le temps, il devient votre outil de discernement le plus précieux." },
  { icon: '✦', titre: 'Mediumia, votre coach IA personnel', texte: "Intégrée dans l'application, Mediumia est une intelligence artificielle formée spécifiquement sur le contenu du parcours. Elle répond à vos questions, vous aide à relire vos ressentis avec discernement, et vous accompagne module après module. Elle ne canalise pas à votre place. Elle vous aide à découvrir votre propre canal." },
  { icon: '🔓', titre: "12 mois d'accès", texte: "Votre code personnel vous donne accès à l'application et à Mediumia pendant 12 mois. Les modules imprimés, eux, restent à vous pour toujours." },
]

function Contenu() {
  return (
    <Section id="contenu">
      <Ornament />
      <SectionTitle>Ce que contient le parcours</SectionTitle>
      <div className="grid md:grid-cols-2 gap-5">
        {INCLUS.map((item, i) => (
          <div key={i} className="border border-gold/20 rounded-xl p-6 bg-white/60 hover:border-gold/50 transition-all">
            <p className="text-2xl mb-3">{item.icon}</p>
            <p className="font-georgia font-medium text-deep text-base mb-2">{item.titre}</p>
            <p className="font-georgia text-sm text-mist leading-relaxed">{item.texte}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ─── SECTION 5 — LES 4 NIVEAUX ─── */
const NIVEAUX = [
  { num: '01', titre: 'Les Fondations', modules: 'Modules 1 à 6', texte: "Poser l'intention juste. Recevoir avant d'interpréter. Découvrir votre canal dominant. Comprendre ce qu'est vraiment un oracle. Développer le discernement vibratoire. Entrer en contact avec vos guides." },
  { num: '02', titre: 'La Technique du Canal', modules: 'Modules 7 à 13', texte: "Le contact avec les défunts. La consécration d'un oracle. L'art de la canalisation consciente. L'ouverture et la fermeture du canal. Les trois sources d'information intérieure. Le canal intérieur. Les codes vibratoires." },
  { num: '03', titre: 'Maîtrise et Autonomie', modules: 'Modules 14 à 20', texte: "La gestion des émotions du médium. La lecture des signes et synchronicités. La conscience du canal. L'approfondissement de la relation avec vos guides. L'art de filtrer les informations. Le contact avancé avec les défunts. La médiumnité mature." },
  { num: '04', titre: "L'Art du Médium Maître", modules: 'Modules 21 à 25', texte: "La canalisation créative. La réception instantanée. La canalisation en séance. La lecture médiumnique structurée. Et le module final : accompagner les vivants." },
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
                  <p className="font-georgia text-mist text-xs mt-0.5">{n.modules}</p>
                </div>
                <span className="text-gold/60 text-xl shrink-0 transition-transform duration-300 select-none"
                  style={{ transform: open === i ? 'rotate(45deg)' : 'rotate(0deg)' }}>
                  +
                </span>
              </div>
              {open === i && (
                <div className="px-6 pb-6 border-t border-gold/10">
                  <p className="font-georgia text-sm text-deep leading-relaxed pt-4">{n.texte}</p>
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
      <SectionTitle>Qui vous transmet ce parcours</SectionTitle>
      <div className="flex flex-col md:flex-row gap-8 items-start mb-8">
        <div className="flex-shrink-0 flex justify-center">
          <img
            src="/sebastien.jpg"
            alt="Sébastien Seguin"
            className="w-52 h-72 md:w-56 md:h-80 object-cover object-top rounded-2xl border-2 shadow-md"
            style={{ borderColor: '#C9A84C' }}
          />
        </div>
        <div className="space-y-5 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
        <p>Je m'appelle <strong className="text-deep">Sébastien Seguin</strong>. Je suis médium professionnel depuis plus de douze ans.</p>
        <p>Pendant toutes ces années, j'ai accompagné des milliers de personnes en consultation individuelle : des personnes venues chercher des réponses, des familles en lien avec un proche disparu, des êtres traversant un moment de doute, de deuil, de bascule ou d'éveil.</p>
        <p>Avec le temps, la demande est devenue très forte. Mon délai de rendez-vous a parfois atteint près d'un an. J'ai alors fait le choix de réorganiser mon activité pour retrouver un rythme plus juste, plus humain, et ramener cette attente à plusieurs mois.</p>
        <p>Je ne partage pas cela pour impressionner. Je le dis simplement pour situer l'origine de ce parcours : Mediumia est né d'une pratique réelle, quotidienne, éprouvée par des milliers de séances, des milliers d'histoires, des milliers de ressentis confrontés au réel.</p>
        <p>Je n'ai pas appris la médiumnité dans les livres. Je l'ai découverte dans mon propre corps, à travers mes perceptions, mes épreuves, mes doutes, mes erreurs, mes traversées et mes années de pratique.</p>
        <p>C'est cette expérience directe que j'ai voulu transmettre ici.</p>
        <p className="text-deep font-medium text-lg">Mediumia n'est pas un parcours théorique. C'est une transmission.</p>
        <p>Mon parcours m'a appris une chose essentielle : la médiumnité n'est pas un don réservé à quelques élus. C'est une dimension naturelle de l'être humain, qui se réveille lorsque les bonnes conditions sont réunies.</p>
        <p>Ces conditions, c'est exactement ce que cet accompagnement vous propose de créer : un cadre, une progression, des exercices, du discernement, de la sécurité intérieure et une véritable méthode.</p>
        <p>Je ne vous promets pas que vous deviendrez médium professionnel en 25 modules.</p>
        <p>Je vous promets quelque chose de plus juste : vous allez apprendre à reconnaître ce qui vit déjà en vous, à l'écouter, à le structurer, et à ne plus confondre intuition, émotion, mental et perception subtile.</p>
        <p>Et cette découverte peut profondément changer votre façon de vous percevoir, de percevoir les autres, et de vous relier au monde.</p>
        </div>
      </div>
      <blockquote className="mt-8 border-l-4 border-gold pl-6 py-2">
        <p className="font-georgia text-lg md:text-xl text-mist italic leading-relaxed">
          « L'enfer précède le paradis. La lumière s'exprime à travers l'obscurité. C'est le jeu ici. »
        </p>
      </blockquote>
      <div className="text-center mt-10">
        <a href="https://sebastien-seguin.reservio.com" target="_blank" rel="noopener noreferrer"
          className="inline-block font-georgia text-base tracking-wide px-8 py-4 rounded-lg transition-all hover:opacity-90 hover:scale-[1.02]"
          style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}>
          Prendre RDV avec Sébastien →
        </a>
      </div>
    </Section>
  )
}

/* ─── SECTION 7 — TÉMOIGNAGES ─── */
const TEMOIGNAGES = [
  { texte: "« Vraiment incroyable. Le sentiment que j'ai eu c'est comme si on partait dans une aventure de découverte, très complexe dans la simplicité dont vous avez écrit. J'ai pas ressenti un effort intellectuel pour comprendre, tout était très clair et ça a touché plus mes émotions que l'intellectuel. Quand j'avais lu d'autres livres sur la médiumnité je restais toujours confuse. Cette fois-ci j'ai eu plutôt un sentiment de paix. »", source: 'Retour de parcours' },
  { texte: "« J'ai retrouvé ma petite voix, il y a longtemps que je ne l'entendais plus et grâce à vos exercices, elle est revenue. J'ai retrouvé une partie de moi-même. »", source: "Retour d'atelier" },
  { texte: "« I love the Mediumia app! It is very easy to navigate. Great work, I really like it and I don't have any comments, I am excited for the launch! »", source: 'Nuri — Retour sur l\'application' },
  { texte: "« Ils ont surtout compris que tout est simple et accessible, il suffit de se l'autoriser. Pour eux, c'est une révélation choquante car elle est pourvue de simplicité. »", source: "Retour d'atelier" },
]

function FormulaireAvis() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(0)
  const [hover, setHover] = useState(0)
  const [status, setStatus] = useState('idle') // idle | sending | success | error

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('sending')
    const form = e.target
    const data = {
      access_key: '9d7eb809-6bd2-4fc3-93b2-c675a63b259e',
      subject: 'Nouvel avis Mediumia (en attente de modération)',
      name: form.nom.value,
      message: `Note : ${note > 0 ? note + '/5' : 'non renseignée'}\n\n${form.message.value}`,
    }
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="mt-12 border-t border-gold/20 pt-10">
      {!open ? (
        <div className="text-center">
          <button
            onClick={() => setOpen(true)}
            className="font-georgia text-sm tracking-wide text-gold border border-gold/40 px-6 py-3 rounded-lg hover:bg-gold/10 transition-all"
          >
            Partager mon expérience
          </button>
        </div>
      ) : status === 'success' ? (
        <p className="font-georgia text-center text-base text-mist/80 italic py-4">
          Merci pour votre témoignage. Il sera publié après validation.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-5" aria-label="Formulaire de témoignage">
          <p className="font-georgia text-base text-deep font-medium text-center mb-6">Partagez votre expérience</p>

          <div>
            <label htmlFor="avis-nom" className="font-georgia text-xs text-mist tracking-wide uppercase block mb-1.5">
              Votre prénom
            </label>
            <input
              id="avis-nom"
              name="nom"
              type="text"
              required
              placeholder="Prénom ou initiale"
              className="w-full font-georgia text-sm text-deep bg-white/70 border border-gold/30 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors"
            />
          </div>

          <div>
            <label className="font-georgia text-xs text-mist tracking-wide uppercase block mb-2">
              Note (optionnelle)
            </label>
            <div className="flex gap-2" role="group" aria-label="Note de 1 à 5 étoiles">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
                  onClick={() => setNote(star === note ? 0 : star)}
                  onMouseEnter={() => setHover(star)}
                  onMouseLeave={() => setHover(0)}
                  className="text-2xl transition-opacity"
                  style={{ color: star <= (hover || note) ? '#C9A84C' : '#C9A84C', opacity: star <= (hover || note) ? 1 : 0.25 }}
                >
                  ✦
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="avis-message" className="font-georgia text-xs text-mist/60 tracking-wide uppercase block mb-1.5">
              Votre témoignage
            </label>
            <textarea
              id="avis-message"
              name="message"
              required
              rows={4}
              placeholder="Décrivez votre expérience avec le parcours..."
              className="w-full font-georgia text-sm text-deep bg-white/70 border border-gold/30 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors resize-none"
            />
          </div>

          <p className="font-georgia text-xs text-mist leading-relaxed">
            En envoyant cet avis, vous acceptez qu'il soit publié après modération. Aucune donnée n'est conservée au-delà de cet envoi.
          </p>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={status === 'sending'}
              className="font-georgia text-sm tracking-wide px-6 py-3 rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}
            >
              {status === 'sending' ? 'Envoi...' : 'Envoyer'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-georgia text-sm text-mist/70 hover:text-mist transition-colors px-4"
            >
              Annuler
            </button>
          </div>
          {status === 'error' && (
            <p className="font-georgia text-xs text-red-500">Une erreur est survenue. Veuillez réessayer ou nous contacter par email.</p>
          )}
        </form>
      )}
    </div>
  )
}

function Temoignages() {
  return (
    <section className="bg-deep/[0.03]">
      <Section id="temoignages">
        <SectionTitle>Ce qu'en disent ceux qui l'ont vécu</SectionTitle>
        <div className="grid md:grid-cols-2 gap-5">
          {TEMOIGNAGES.map((t, i) => (
            <div key={i} className="bg-white/80 border border-gold/20 rounded-xl p-6">
              <p className="font-georgia text-sm md:text-base text-deep/80 italic leading-relaxed mb-4">{t.texte}</p>
              <p className="font-georgia text-xs text-gold tracking-wide font-bold">— {t.source}</p>
            </div>
          ))}
        </div>
        <FormulaireAvis />
      </Section>
    </section>
  )
}

/* ─── SECTION 8 — APPROCHE UNIQUE ─── */
const POINTS = [
  { titre: 'Pas de mystère inutile', texte: "Tout est expliqué clairement. Pas de jargon obscur, pas de rituels imposés, pas de hiérarchie invisible. Vous comprenez ce que vous faites et pourquoi." },
  { titre: 'Le cœur au centre', texte: "Ce parcours place le cœur, et non le cerveau, comme véritable centre de la pratique médiumnique. Le cœur est votre émetteur-récepteur. Le cerveau n'est qu'un processeur." },
  { titre: 'La souveraineté comme protection', texte: "Pas de peur, pas de rituels de protection compliqués. Votre souveraineté intérieure est votre première et meilleure protection. Vous apprenez à la poser à chaque pratique." },
  { titre: "Un coach IA formé par le créateur", texte: "Mediumia n'est pas un chatbot générique. Elle a été formée spécifiquement sur le contenu des 25 modules et sur la vision de Sébastien. Elle parle avec la voix du parcours." },
  { titre: "L'autonomie comme objectif", texte: "L'objectif n'est pas de vous rendre dépendant d'un enseignant, d'un oracle ou d'un guide. L'objectif est que vous trouviez votre propre voix et que vous appreniez à lui faire confiance." },
]

function Approche() {
  return (
    <Section id="approche">
      <Ornament />
      <SectionTitle>Ce qui rend Mediumia différente</SectionTitle>
      <div className="space-y-4">
        {POINTS.map((p, i) => (
          <div key={i} className="flex gap-5 items-start">
            <span className="text-gold text-lg mt-0.5 shrink-0">✦</span>
            <div>
              <p className="font-georgia font-medium text-deep mb-1">{p.titre}</p>
              <p className="font-georgia text-sm md:text-base text-mist leading-relaxed">{p.texte}</p>
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
        <SectionTitle>Rejoindre Mediumia</SectionTitle>
        <div className="border-2 border-gold/40 rounded-2xl p-8 md:p-12 bg-white/70 text-center">
          <p className="font-georgia text-xs text-mist tracking-widest uppercase mb-8">Le parcours complet comprend</p>
          <ul className="font-georgia text-base md:text-lg text-deep space-y-3 text-left max-w-sm mx-auto mb-10">
            {[
              '25 modules imprimés envoyés chez vous',
              'Application Mediumia sur votre téléphone',
              'Mediumia, votre coach IA personnel',
              '32 exercices guidés avec chronomètre',
              'Carnet de pratique intégré',
              "12 mois d'accès à l'application",
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
          <p className="font-georgia text-mist text-sm italic mb-8">Paiement en 4× disponible via PayPal</p>
          <BtnPrimary href="https://www.paypal.com/ncp/payment/V7G9ELH4LF6YW" className="text-lg px-12 py-5">
            Commencer le parcours →
          </BtnPrimary>
          <p className="font-georgia text-xs text-mist mt-6 leading-relaxed max-w-md mx-auto">
            Paiement sécurisé par PayPal. Expédition sous 72h.
          </p>
        </div>
      </Section>
    </section>
  )
}

/* ─── SECTION 10 — FAQ ─── */
const FAQ_ITEMS = [
  { q: 'Faut-il déjà avoir des capacités médiumniques ?', r: "Non, et c'est même tout le sens de cet accompagnement. La médiumnité n'est pas un don réservé à quelques élus, c'est une dimension naturelle de l'être humain qui se réveille lorsque les bonnes conditions sont réunies. Le parcours est conçu pour les débutants comme pour celles et ceux qui pratiquent déjà et veulent structurer ce qu'ils ressentent. Vous partez d'où vous êtes." },
  { q: 'Combien de temps dure le parcours ?', r: "Il n'y a pas de durée imposée. Le parcours est composé de 25 modules répartis en 4 niveaux, et chacun avance à son rythme. Certains traversent un module par semaine, d'autres prennent le temps de vivre chaque exercice sur plusieurs jours. Vous disposez de 12 mois d'accès à l'application pour cheminer librement, et les modules imprimés restent à vous pour toujours." },
  { q: 'Est-ce que Mediumia remplace un vrai accompagnement humain ?', r: "Non. Mediumia, le coach IA, est un soutien disponible jour et nuit pour répondre à vos questions, relire vos ressentis avec vous et vous guider dans les exercices. Mais elle ne canalise pas à votre place et ne remplace pas la relation humaine. Elle vous aide à découvrir votre propre canal et à gagner en autonomie. C'est un compagnon de route, pas un substitut au lien humain." },
  { q: 'Est-ce que ce parcours est lié à une religion ?', r: "Non. Mediumia n'est rattachée à aucune religion ni à aucun dogme. L'approche est laïque, fondée sur l'expérience directe, le discernement et le respect de votre liberté. Quelles que soient vos croyances, vous restez souverain de votre chemin. Vous n'avez rien à adopter, seulement à expérimenter." },
  { q: "Puis-je suivre ce parcours depuis l'étranger ?", r: "Oui. L'application Mediumia et le coach IA sont accessibles partout dans le monde, 24h/24. Pour les modules imprimés envoyés par courrier, l'expédition est possible à l'international. Contactez-nous avant l'achat si vous résidez hors de France métropolitaine afin de confirmer les délais et les frais d'expédition." },
  { q: 'Puis-je payer en plusieurs fois ?', r: "Oui. Le parcours complet est à 597 €, et un paiement en 4 fois est disponible via PayPal, sans complication. Vous choisissez simplement cette option au moment du règlement." },
  { q: 'Ce parcours peut-il remplacer un suivi médical ou psychologique ?', r: "Non, en aucun cas. Mediumia est un parcours de développement médiumnique et personnel. Il ne remplace ni un suivi médical, ni un accompagnement psychologique ou psychiatrique. Si vous traversez une souffrance psychique, une période de grande fragilité ou un deuil difficile, entourez-vous de professionnels de santé. La pratique médiumnique se construit sur des fondations intérieures stables, et prendre soin de soi vient toujours en premier." },
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
                <p className="font-georgia text-sm md:text-base text-deep leading-relaxed pt-4">{item.r}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ─── MODAL POLITIQUE DE CONFIDENTIALITÉ ─── */
const POLITIQUE = [
  {
    titre: 'Données collectées',
    texte: "Lors de votre achat, nous collectons votre nom, prénom, adresse postale (pour l'envoi des modules imprimés) et adresse email (pour l'envoi du code d'accès). Le paiement est traité directement par PayPal, nous n'avons jamais accès à vos données bancaires.",
  },
  {
    titre: 'Utilisation des données',
    texte: "Vos données personnelles sont utilisées exclusivement pour traiter votre commande et vous envoyer votre parcours. Elles ne sont jamais partagées avec des tiers à des fins commerciales.",
  },
  {
    titre: "Données dans l'application",
    texte: "Toutes les données générées dans l'application Mediumia (carnet de pratique, conversations avec Mediumia, progression dans les modules) sont stockées localement sur votre appareil. Aucune donnée personnelle n'est transmise à nos serveurs.",
  },
  {
    titre: 'Conversations avec Mediumia',
    texte: "Les conversations que vous avez avec Mediumia transitent par les serveurs d'Anthropic (qui propulse l'intelligence artificielle) pour traitement, mais ne sont pas conservées par nous. Anthropic applique sa propre politique de confidentialité, consultable sur anthropic.com.",
  },
  {
    titre: 'Conservation',
    texte: "Vos données de commande (nom, adresse, email) sont conservées pendant la durée légale de conservation des factures, soit 10 ans.",
  },
  {
    titre: 'Vos droits',
    texte: "Conformément au RGPD, vous disposez d'un droit d'accès, de rectification et de suppression de vos données personnelles. Pour exercer ces droits, contactez-nous par email.",
  },
  {
    titre: 'Cookies',
    texte: "Le site mediumia.fr n'utilise pas de cookies de tracking. Seuls les cookies techniques nécessaires au fonctionnement du paiement PayPal peuvent être utilisés.",
  },
]

function PolitiqueModal({ onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center px-0 md:px-6"
      onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-deep/60 backdrop-blur-sm" />
      {/* Panneau */}
      <div
        className="relative bg-cream w-full md:max-w-2xl max-h-[85vh] rounded-t-2xl md:rounded-2xl overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-cream border-b border-gold/20 px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold font-georgia mb-0.5 font-bold">Mediumia</p>
            <h3 className="font-georgia text-deep text-lg font-medium">Politique de confidentialité</h3>
          </div>
          <button onClick={onClose}
            className="text-mist/70 hover:text-mist transition-colors text-2xl leading-none ml-4"
            aria-label="Fermer">
            ×
          </button>
        </div>
        {/* Contenu */}
        <div className="px-6 py-8 space-y-7">
          {POLITIQUE.map((section, i) => (
            <div key={i}>
              <p className="font-georgia font-medium text-deep mb-2">{section.titre}</p>
              <p className="font-georgia text-sm text-mist leading-relaxed">{section.texte}</p>
            </div>
          ))}
        </div>
        <div className="px-6 pb-8 text-center">
          <p className="font-georgia text-xs text-mist/70">
            Pour toute question : <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors underline">contact@mediumia.fr</a>
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── MODAL MENTIONS LÉGALES ─── */
const MENTIONS = [
  {
    titre: 'Éditeur du site',
    texte: 'Sébastien Seguin — SIRET : 81918584400027 — Contact : contact@mediumia.fr',
  },
  {
    titre: 'Hébergement',
    texte: 'Vercel Inc. — vercel.com',
  },
  {
    titre: 'Nature du parcours',
    texte: "Mediumia est un parcours de développement personnel axé sur la découverte de la perception subtile. Il ne constitue en aucun cas un parcours professionnel certifiant, un enseignement médical, paramédical, psychologique ou psychiatrique.",
  },
  {
    titre: 'Responsabilité',
    texte: "La pratique de la médiumnité relève d'une démarche personnelle et volontaire. Sébastien Seguin ne saurait être tenu responsable de l'usage que l'élève fait des enseignements, exercices et outils proposés dans ce parcours. L'élève reconnaît que ce parcours ne se substitue à aucun suivi médical, psychologique ou psychiatrique. En cas de troubles psychiques, de détresse émotionnelle ou de tout symptôme nécessitant une prise en charge, l'élève s'engage à consulter un professionnel de santé qualifié. L'utilisation de Mediumia (coach IA pédagogique) est proposée à titre d'accompagnement dans la compréhension du parcours. Mediumia n'est ni médium, ni thérapeute, ni professionnel de santé. Ses réponses ne constituent en aucun cas un diagnostic, un avis médical ou une guidance spirituelle.",
  },
  {
    titre: 'Propriété intellectuelle',
    texte: "L'ensemble du contenu de ce site et du parcours Mediumia (textes, exercices, structure, méthodologie, application) est la propriété intellectuelle de Sébastien Seguin. Toute reproduction, partielle ou totale, est interdite sans autorisation écrite préalable.",
  },
]

function MentionsModal({ onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center px-0 md:px-6"
      onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-deep/60 backdrop-blur-sm" />
      {/* Panneau */}
      <div
        className="relative bg-cream w-full md:max-w-2xl max-h-[85vh] rounded-t-2xl md:rounded-2xl overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-cream border-b border-gold/20 px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold font-georgia mb-0.5 font-bold">Mediumia</p>
            <h3 className="font-georgia text-deep text-lg font-medium">Mentions légales</h3>
          </div>
          <button onClick={onClose}
            className="text-mist/40 hover:text-mist transition-colors text-2xl leading-none ml-4"
            aria-label="Fermer">
            ×
          </button>
        </div>
        {/* Contenu */}
        <div className="px-6 py-8 space-y-7">
          {MENTIONS.map((section, i) => (
            <div key={i}>
              <p className="font-georgia font-medium text-deep mb-2">{section.titre}</p>
              <p className="font-georgia text-sm text-mist/80 leading-relaxed">{section.texte}</p>
            </div>
          ))}
        </div>
        <div className="px-6 pb-8 text-center">
          <p className="font-georgia text-xs text-mist/40">
            Pour toute question : <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors underline">contact@mediumia.fr</a>
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── FOOTER ─── */
function Footer({ onPolitique, onMentions }) {
  return (
    <footer className="border-t border-gold/20 px-6 py-16 text-center">
      <p className="font-georgia text-lg md:text-xl text-mist italic leading-relaxed max-w-xl mx-auto mb-6">
        « La médiumnité ne s'apprend pas. Elle se découvre.<br />Tout a toujours été là. »
      </p>
      <p className="text-gold text-3xl mb-10">✦</p>
      <div className="font-georgia text-xs text-mist space-y-1 mb-8">
        <p>Mediumia — Accompagnement à la Médiumnité Consciente</p>
        <p>Sébastien Seguin — Médium professionnel</p>
        <p>SIRET : 81918584400027</p>
      </div>
      <div className="flex items-center justify-center gap-6 font-georgia text-xs text-mist/70">
        <a href="mailto:contact@mediumia.fr" className="hover:text-gold transition-colors">Contact</a>
        <span>·</span>
        <button onClick={onMentions} className="hover:text-gold transition-colors">
          Mentions légales
        </button>
        <span>·</span>
        <button onClick={onPolitique} className="hover:text-gold transition-colors">
          Politique de confidentialité
        </button>
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
        <p className="font-georgia text-sm text-gold font-bold">597 € · Paiement en 4× via PayPal</p>
        <a href="https://www.paypal.com/ncp/payment/V7G9ELH4LF6YW"
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
  const [showPolitique, setShowPolitique] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  return (
    <div className="bg-cream min-h-screen">
      <Nav />
      <main>
        <Hero />
        <EstCeQueCelaVousParle />
        <Constat />
        <Approche />
        <Sebastien />
        <Solution />
        <Niveaux />
        <Contenu />
        <Prix />
        <Temoignages />
        <FaqSection />
        <OracleTest />
      </main>
      <Footer onPolitique={() => setShowPolitique(true)} onMentions={() => setShowMentions(true)} />
      <StickyBar />
      {showPolitique && <PolitiqueModal onClose={() => setShowPolitique(false)} />}
      {showMentions && <MentionsModal onClose={() => setShowMentions(false)} />}
    </div>
  )
}
