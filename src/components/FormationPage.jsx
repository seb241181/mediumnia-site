import { useState, useEffect, useRef } from 'react'
import LegalFooter from './LegalFooter'
import FormationCreditNotice from './FormationCreditNotice'
import ParcoursOffer from './ParcoursOffer'
import { parcoursFaqAnswer, useParcoursOffer } from '../lib/parcoursOffer.js'
import { formationCheckoutHeaders } from '../lib/formationCredit.js'
import TrialChat from './TrialChat'
import SiteNav from './SiteNav'
import PageRail from './PageRail'
import '../styles/formation-page.css'

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
  { icon: '◉', titre: "12 mois d'accès", texte: "Après confirmation du paiement, votre accès à l'application et à MediumIA est activé pour 12 mois. Les modules PDF téléchargés restent à vous pour votre usage personnel." },
]

const POINTS = [
  { titre: 'Pas de mystère inutile', texte: "Tout est expliqué clairement. Pas de jargon obscur, pas de rituels imposés. Vous comprenez ce que vous faites et pourquoi." },
  { titre: 'Le cœur au centre', texte: "Ce parcours place le cœur comme véritable centre de la pratique médiumnique. Le cœur est votre émetteur-récepteur. Le cerveau n'est qu'un processeur." },
  { titre: 'La souveraineté comme protection', texte: "Votre souveraineté intérieure est votre première et meilleure protection. Vous apprenez à la poser à chaque pratique — sans peur ni rituels compliqués." },
  { titre: "L'autonomie comme objectif", texte: "L'objectif n'est pas de vous rendre dépendant d'un enseignant ou d'un oracle. L'objectif est que vous trouviez votre propre voix et que vous appreniez à lui faire confiance." },
  { titre: "Un assistant formé par le créateur", texte: "MediumIA n'est pas un assistant générique. Il a été formé spécifiquement sur le contenu des 25 modules et la vision de Sébastien. Il parle avec la voix du parcours." },
]

// Once the parcours is open, this answer describes it (closed: unchanged).
const FAQ_PAY_QUESTION = 'Puis-je payer en plusieurs fois ?'
const FAQ = [
  { q: 'Faut-il déjà avoir des capacités médiumniques ?', r: "Non, et c'est même tout le sens de cet accompagnement. La médiumnité n'est pas un don réservé à quelques élus. Le parcours est conçu pour les débutants comme pour celles et ceux qui pratiquent déjà et veulent structurer ce qu'ils ressentent." },
  { q: 'Combien de temps dure le parcours ?', r: "Il n'y a pas de durée imposée. Certains traversent un module par semaine, d'autres prennent le temps de vivre chaque exercice sur plusieurs jours. Vous disposez de 12 mois d'accès à l'application pour cheminer librement, et les modules téléchargés restent à vous pour toujours." },
  { q: 'Est-ce que MediumIA remplace un vrai accompagnement humain ?', r: "Non. MediumIA, l'assistant intégré, est un soutien disponible jour et nuit, mais il ne remplace pas la relation humaine. Il vous aide à découvrir votre propre canal et à gagner en autonomie. C'est un compagnon de route, pas un substitut." },
  { q: 'Est-ce que ce parcours est lié à une religion ?', r: "Non. MediumIA n'est rattachée à aucune religion ni à aucun dogme. L'approche est laïque, fondée sur l'expérience directe, le discernement et le respect de votre liberté. Quelles que soient vos croyances, vous restez souverain de votre chemin." },
  { q: "Puis-je suivre ce parcours depuis l'étranger ?", r: "Oui. L'application, l'assistant intégré et les modules PDF sont accessibles en ligne. Après confirmation du paiement, votre accès est activé sur l'adresse e-mail utilisée avec PayPal." },
  { q: FAQ_PAY_QUESTION, r: "Oui. La Formation MediumIA est à 597 € TTC. Paiement en plusieurs fois disponible avec PayPal selon éligibilité." },
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
  const offer = useParcoursOffer()
  const items = offer ? FAQ.map((item) => (item.q === FAQ_PAY_QUESTION ? { ...item, r: parcoursFaqAnswer(offer) } : item)) : FAQ
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
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

const HERO_APPORTS = [
  '25 modules PDF en 4 niveaux (269 pages) et 84 exercices guidés',
  'MediumIA, un assistant formé sur le parcours, pendant 12 mois',
  'Un carnet de pratique pour relire vos ressentis',
]

const FORMATION_SECTIONS = [
  { id: 'programme', label: 'Programme' },
  { id: 'formation-apercu-reel', label: 'Aperçu' },
  { id: 'offre', label: 'Tarif' },
  { id: 'essayer', label: 'Essayer' },
  { id: 'formateur', label: 'Formateur' },
  { id: 'faq', label: 'FAQ' },
]

// Téléphone, tablette et petits écrans : barre d'ancres sous le menu, avec le prix.
// Sur grand écran, le sommaire latéral (PageRail) prend le relais.
function FormationSectionBar() {
  const go = (id) => (event) => {
    event.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav aria-label="Sections de la page Formation" className="formation-section-bar min-[1360px]:hidden">
      <div className="max-w-6xl mx-auto flex items-center gap-3 px-4">
        <ul className="flex flex-1 gap-1.5 overflow-x-auto py-2 [scrollbar-width:none]">
          {FORMATION_SECTIONS.map((item) => (
            <li key={item.id} className="shrink-0"><a href={`#${item.id}`} onClick={go(item.id)} className="block rounded-full border border-gold/30 bg-white/80 px-3 py-1.5 font-georgia text-xs text-deep">{item.label}</a></li>
          ))}
        </ul>
        <a href="#offre" onClick={go('offre')} className="shrink-0 rounded-lg bg-deep px-3 py-2 font-georgia text-xs font-bold text-gold">597 € · Rejoindre</a>
      </div>
    </nav>
  )
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('mediumia-paypal-sdk')
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('paypal_sdk_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = 'mediumia-paypal-sdk'
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
    script.onload = resolve
    script.onerror = () => reject(new Error('paypal_sdk_load_failed'))
    document.head.appendChild(script)
  })
}

function FormationCheckout() {
  const [config, setConfig] = useState(null)
  const [availability, setAvailability] = useState('loading')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [immediateAccessAccepted, setImmediateAccessAccepted] = useState(false)
  const [status, setStatus] = useState('')
  const [success, setSuccess] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/rdv-config?paypalAction=config', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return null
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'paypal_unavailable')
        return data
      })
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setAvailability('disabled')
          return
        }
        setConfig(data)
        setAvailability('ready')
      })
      .catch(() => {
        if (!cancelled) setAvailability('error')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!config || !termsAccepted || !immediateAccessAccepted || success) return
    let cancelled = false
    const node = containerRef.current
    if (!node) return
    node.innerHTML = ''

    loadPayPalSdk(config.clientId)
      .then(() => {
        if (cancelled || !window.paypal?.Buttons) return
        return window.paypal.Buttons({
          createOrder: async () => {
            setStatus('Création sécurisée de la commande…')
            const res = await fetch('/api/rdv-config?paypalAction=create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await formationCheckoutHeaders()) },
              body: JSON.stringify({ termsAccepted: true, immediateAccessAccepted: true }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.id) throw new Error(data.error || 'paypal_create_order_failed')
            return data.id
          },
          onApprove: async (data) => {
            setStatus('Paiement confirmé par PayPal. Activation de votre accès…')
            const res = await fetch('/api/rdv-config?paypalAction=capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderID }),
            })
            const result = await res.json().catch(() => ({}))
            if (!res.ok || result.access?.status !== 'provisioned') throw new Error(result.error || 'access_provision_failed')
            setSuccess(true)
            setStatus(`Accès activé jusqu'au ${new Date(result.access.accessExpiresAt).toLocaleDateString('fr-FR')}.`)
            node.innerHTML = ''
          },
          onCancel: () => setStatus('Paiement annulé. Aucun accès n’a été activé.'),
          onError: (err) => setStatus(/price_changed|discovery_credit_unavailable|session_expired/.test(String(err?.message || '')) ? 'Le montant à régler a changé depuis l’affichage de la page (vérification de votre Découverte). Rechargez la page avant de payer : rien n’a été débité.' : 'Le paiement n’a pas pu aboutir. Vous pouvez réessayer sans être débité deux fois.'),
        }).render(node)
      })
      .catch(() => setStatus('PayPal est momentanément indisponible. Réessayez dans quelques instants.'))

    return () => {
      cancelled = true
      if (node) node.innerHTML = ''
    }
  }, [config, termsAccepted, immediateAccessAccepted, success])

  if (availability === 'loading') {
    return <p className="font-georgia text-sm text-mist text-center">Chargement du paiement sécurisé…</p>
  }

  if (availability === 'disabled') {
    return (
      <div className="text-center">
        <button disabled className="font-georgia inline-block px-10 py-4 rounded-lg bg-deep/20 text-deep/40 font-bold text-lg cursor-not-allowed w-full md:w-auto">
          Paiement bientôt disponible
        </button>
      </div>
    )
  }

  if (availability === 'error') {
    return <p className="font-georgia text-sm text-mist text-center">Le paiement est temporairement indisponible.</p>
  }

  return (
    <div className="max-w-lg mx-auto">
      {config?.env === 'sandbox' && (
        <div className="mb-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-center">
          <p className="font-georgia text-xs font-bold tracking-wider uppercase text-deep">Preview Sandbox — aucun argent réel</p>
          <p className="font-georgia text-xs text-mist mt-1">Le bouton PayPal ci-dessous utilisera un montant fictif de 1,00 €.</p>
        </div>
      )}

      {!success && (
        <div className="space-y-4 text-left mb-5">
          <label className="flex gap-3 items-start cursor-pointer">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-1 h-4 w-4" />
            <span className="font-georgia text-sm text-mist leading-relaxed">
              J’ai lu et j’accepte les <a href="/cgv-formation.html" target="_blank" rel="noopener noreferrer" className="text-gold underline">conditions générales de vente de l’accompagnement MediumIA</a>.
            </span>
          </label>
          <label className="flex gap-3 items-start cursor-pointer">
            <input type="checkbox" checked={immediateAccessAccepted} onChange={(e) => setImmediateAccessAccepted(e.target.checked)} className="mt-1 h-4 w-4" />
            <span className="font-georgia text-sm text-mist leading-relaxed">
              Je demande la fourniture immédiate des contenus numériques et reconnais qu’après le début de leur exécution, je perds mon droit de rétractation pour ces contenus numériques.
            </span>
          </label>
        </div>
      )}

      {success ? (
        <div className="rounded-2xl border-2 border-gold/40 bg-white p-6 text-center">
          <p className="text-gold text-3xl mb-3">✦</p>
          <p className="font-georgia text-deep font-bold text-lg mb-2">Votre accès MediumIA est activé.</p>
          <p className="font-georgia text-sm text-mist mb-5">{status}</p>
          <a href="https://espace.mediumia.fr" className="font-georgia inline-block px-7 py-3 rounded-lg bg-deep text-gold font-bold">Accéder à mon espace élève →</a>
        </div>
      ) : (
        <>
          <div ref={containerRef} className={termsAccepted && immediateAccessAccepted ? 'min-h-[48px]' : 'hidden'} />
          {(!termsAccepted || !immediateAccessAccepted) && (
            <p className="font-georgia text-xs text-mist text-center italic">Cochez les deux cases ci-dessus pour afficher les boutons de paiement : carte bancaire (sans compte PayPal) ou PayPal, en une ou plusieurs fois.</p>
          )}
          {status && <p className="font-georgia text-xs text-mist text-center mt-3">{status}</p>}
        </>
      )}
    </div>
  )
}

export default function FormationPage({ onBack, onNavigate }) {
  const offer = useParcoursOffer()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="cosmic-page cosmic-page--formation bg-cream min-h-screen text-deep">
      <SiteNav current="formation" onHome={onBack} onOpenFormation={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
      <PageRail items={FORMATION_SECTIONS} cta={{ label: '597 € · Rejoindre', target: 'offre' }} />
      <FormationSectionBar />

      <main className="formation-main">
        {/* ── Premier écran : quoi, pour qui, ce que ça apporte, prix, comment rejoindre ── */}
        <section id="formation-top" className="px-6 pt-6 pb-14 md:pt-12 md:pb-20">
          <div className="max-w-6xl mx-auto grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Formation MediumIA · en ligne</p>
              <h1 className="font-georgia font-medium text-4xl md:text-6xl leading-[1.08] mb-5">Développer sa médiumnité, pas à pas</h1>
              <p className="font-georgia text-lg md:text-xl text-deep/85 leading-relaxed mb-4">Une formation en 25 modules et 4 niveaux, avec un assistant dédié, pour comprendre et structurer votre pratique dans la clarté.</p>
              <p className="font-georgia text-base text-mist leading-relaxed mb-6"><strong className="text-deep">Pour qui :</strong> les personnes sensibles qui veulent comprendre ce qu’elles perçoivent, qu’elles débutent ou pratiquent déjà.</p>
              <ul className="font-georgia text-base text-deep space-y-2">
                {HERO_APPORTS.map((item) => (
                  <li key={item} className="flex gap-3 items-start"><span className="text-gold shrink-0" aria-hidden="true">✓</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <aside className="rounded-2xl border-2 border-gold/55 bg-white/90 p-6 md:p-8 shadow-[0_18px_50px_rgba(26,21,53,0.08)]" aria-label="Tarifs de la Formation MediumIA">
              {offer ? (
                <>
                  <p className="font-georgia text-xs uppercase tracking-[0.18em] text-gold mb-3">Paiement progressif</p>
                  <div className="rounded-2xl border border-gold/35 bg-gold/10 p-5 mb-4">
                    <p className="font-georgia text-deep leading-none"><span className="text-5xl font-medium">{money(offer.discoveryCents)}</span></p>
                    <p className="font-georgia text-sm font-bold text-deep mt-2">pour commencer</p>
                    <p className="font-georgia text-sm text-mist mt-3">puis {offer.regularCount} × {money(offer.stepCents)} · dernière étape {money(offer.finalCents)}</p>
                    <p className="font-georgia text-xs text-mist mt-2">Total maximum {money(offer.capCents)} · arrêt et reprise possibles</p>
                  </div>
                  <p className="font-georgia text-sm text-mist mb-6">Ou <strong className="text-deep">{money(offer.capCents)} TTC en une fois</strong>.</p>
                </>
              ) : (
                <>
                  <p className="font-georgia text-xs uppercase tracking-[0.18em] text-mist mb-2">Formation complète</p>
                  <p className="font-georgia text-deep"><span className="text-5xl font-medium">597 €</span> <span className="text-lg text-mist">TTC</span></p>
                  <p className="font-georgia text-sm text-mist mt-2 mb-6">Paiement sécurisé par carte bancaire ou PayPal.</p>
                </>
              )}
              <div className="flex flex-col gap-3">
                <button onClick={() => goTo('offre')} className="font-georgia px-7 py-4 rounded-lg bg-deep text-gold font-bold">Voir les options de paiement →</button>
                <button onClick={() => goTo('programme')} className="font-georgia px-7 py-3.5 rounded-lg border-2 border-gold/50 text-deep font-bold hover:border-gold transition-colors">Explorer le programme</button>
              </div>
              <p className="font-georgia text-xs text-mist mt-5">Par Sébastien Seguin, médium depuis plus de douze ans. 12 mois d’accès, PDF à vous pour votre usage personnel.</p>
            </aside>
          </div>
        </section>

        <section id="offre" className="px-6 py-14 scroll-mt-40">
          <div className="max-w-4xl mx-auto text-center">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Choisir votre rythme</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-3">Commencer progressivement ou tout débloquer</h2>
            <p className="font-georgia text-mist text-base leading-relaxed max-w-2xl mx-auto mb-4">Le contenu est le même. Vous choisissez simplement la façon d’avancer et de régler votre formation.</p>

            <ParcoursOffer />

            <details className="group max-w-2xl mx-auto mt-5 rounded-2xl border-2 border-gold/25 bg-white/70 text-left open:border-gold/45">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-5 [&::-webkit-details-marker]:hidden">
                <div className="flex-1">
                  <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold mb-1">Autre option</p>
                  <p className="font-georgia text-lg font-bold text-deep">Tout débloquer maintenant · 597 € TTC</p>
                  <p className="font-georgia text-xs text-mist mt-1">Carte bancaire ou PayPal · ouvrez pour afficher le paiement.</p>
                </div>
                <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <div className="border-t border-gold/15 px-6 py-6 md:px-8">
                <ul className="font-georgia text-sm text-deep space-y-2 mb-7">
                  {['25 modules PDF téléchargeables (269 pages)','Application MediumIA sur mobile et ordinateur','MediumIA, votre assistant personnel','84 exercices guidés','Carnet de pratique intégré',"12 mois d'accès à l'application"].map((item, i) => (
                    <li key={i} className="flex gap-3 items-start"><span className="text-gold shrink-0 mt-0.5">✓</span><span>{item}</span></li>
                  ))}
                </ul>
                <p className="font-georgia text-mist text-xs text-center mb-5">Paiement sécurisé par carte bancaire ou PayPal. Le paiement fractionné proposé directement par PayPal dépend de son éligibilité.</p>
                <FormationCreditNotice />
                <FormationCheckout />
              </div>
            </details>
          </div>
        </section>

        <section className="bg-deep/[0.04] px-6 py-12">
          <div className="max-w-4xl mx-auto">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-5 text-center">Ce parcours est pour vous si</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {POUR_QUI.map((item, i) => (
                <div key={i} className="flex gap-3 items-start rounded-xl border border-gold/25 p-4 bg-white/60"><span className="text-gold shrink-0 mt-0.5" aria-hidden="true">—</span><p className="font-georgia text-deep text-sm leading-relaxed">{item}</p></div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Programme : contenu et 4 niveaux, détails repliés ── */}
        <details id="programme" className="group mx-auto max-w-5xl scroll-mt-40 px-6 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl border-2 border-gold/25 bg-white/70 px-5 py-5 shadow-[0_8px_24px_rgba(26,21,53,.04)] hover:border-gold/45 [&::-webkit-details-marker]:hidden">
            <div className="flex-1 text-left">
              <p className="font-georgia text-lg md:text-xl font-bold text-deep">Programme · 25 modules en 4 niveaux</p>
              <p className="font-georgia text-xs md:text-sm text-mist mt-1">Ouvrir pour voir le contenu, les 84 exercices et le détail des niveaux.</p>
            </div>
            <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="px-6 py-16">
<div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Programme</p>
              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-3">Ce que contient la formation</h2>
              <p className="font-georgia text-mist text-base leading-relaxed">Ouvrez chaque élément pour le détail.</p>
            </div>
            <div className="space-y-2 mb-12">
              {INCLUS.map((item) => (
                <details key={item.titre} className="group rounded-xl border-2 border-gold/20 bg-white/60 open:border-gold/45">
                  <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 font-georgia text-deep font-medium [&::-webkit-details-marker]:hidden">
                    <span className="text-gold text-lg shrink-0" aria-hidden="true">{item.icon}</span>
                    <span className="flex-1">{item.titre}</span>
                    <span className="text-gold/70 text-xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="px-5 pb-5 pl-14 font-georgia text-sm text-mist leading-relaxed">{item.texte}</p>
                </details>
              ))}
            </div>
            <div id="niveaux" className="scroll-mt-40">
              <h3 className="font-georgia font-medium text-2xl text-center mb-2">Le parcours en 4 niveaux</h3>
              <p className="font-georgia text-mist text-sm text-center mb-6">25 modules, des fondations à la pratique accomplie.</p>
              <NiveauxAccordion />
            </div>
          </div>
        


          </div>
        </details>

        <details id="formation-apercu-reel" className="group mx-auto max-w-5xl scroll-mt-40 px-6 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl border-2 border-gold/25 bg-white/70 px-5 py-5 shadow-[0_8px_24px_rgba(26,21,53,.04)] hover:border-gold/45 [&::-webkit-details-marker]:hidden">
            <div className="flex-1 text-left">
              <p className="font-georgia text-lg md:text-xl font-bold text-deep">Aperçu réel · Module 1</p>
              <p className="font-georgia text-xs md:text-sm text-mist mt-1">Ouvrir pour lire un extrait de la pédagogie MediumIA.</p>
            </div>
            <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="px-6 py-16 md:py-20">
<div className="max-w-4xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Aperçu réel · Module 1</p>
              <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-4">L'Intention comme Porte</h2>
              <p className="font-georgia text-mist text-base leading-relaxed">Avant d'investir dans le parcours complet, découvrez un vrai extrait de la pédagogie MediumIA.</p>
            </div>

            <article className="rounded-3xl border-2 border-gold/30 bg-white/70 p-7 md:p-10 shadow-[0_12px_34px_rgba(26,21,53,.06)]">
              <div className="flex flex-wrap items-center gap-3 mb-7">
                <span className="rounded-full bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Niveau 1 · Les Fondations</span>
                <span className="font-georgia text-xs text-mist">Extrait du contenu réellement remis aux élèves</span>
              </div>

              <blockquote className="border-l-4 border-gold pl-5 md:pl-6 py-1 mb-7">
                <p className="font-bodoni text-2xl md:text-3xl italic leading-relaxed text-deep">« Avant de recevoir, il faut avoir décidé d'être disponible. »</p>
              </blockquote>

              <p className="font-georgia text-base md:text-lg leading-relaxed text-deep/80">
                On commence toujours par la porte. Pas par la technique, pas par les exercices spectaculaires, pas par les protocoles compliqués. La porte. Ce qui ouvre tout le reste. Et la porte de la médiumnité, c'est l'intention.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gold/25 bg-cream p-5">
                  <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold mb-2">Ce que le module installe</p>
                  <p className="font-georgia text-sm leading-relaxed text-deep">Comprendre que l'intention n'est pas un simple souhait : elle donne une direction consciente à la pratique et à la qualité de l'information recherchée.</p>
                </div>
                <div className="rounded-2xl border border-gold/25 bg-cream p-5">
                  <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold mb-2">Mise en pratique</p>
                  <p className="font-georgia text-sm leading-relaxed text-deep">Vous formulez votre propre intention d'ouverture de canal avec vos mots, puis vous l'installez progressivement comme une signature de pratique.</p>
                </div>
              </div>

              <div className="mt-8 flex flex-col items-center text-center">
                <p className="font-georgia text-xs leading-relaxed text-mist max-w-xl mb-5">Cet aperçu est volontairement partiel : le parcours complet contient les explications, exercices, questions de réflexion et la progression des 25 modules.</p>
                <button onClick={() => document.getElementById('essayer')?.scrollIntoView({ behavior: 'smooth' })} className="font-georgia px-7 py-3.5 rounded-lg border-2 border-gold/50 text-deep font-bold hover:border-gold transition-colors">
                  Tester ensuite MediumIA →
                </button>
              </div>
            </article>
          </div>
        


          </div>
        </details>

        <details id="essayer" className="group mx-auto max-w-5xl scroll-mt-40 px-6 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl border-2 border-gold/25 bg-white/70 px-5 py-5 shadow-[0_8px_24px_rgba(26,21,53,.04)] hover:border-gold/45 [&::-webkit-details-marker]:hidden">
            <div className="flex-1 text-left">
              <p className="font-georgia text-lg md:text-xl font-bold text-deep">Tester MediumIA gratuitement</p>
              <p className="font-georgia text-xs md:text-sm text-mist mt-1">Ouvrir pour essayer l’assistant et découvrir les exercices offerts.</p>
            </div>
            <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="pt-2">
{/* ── Essayer gratuitement : l'assistant et 3 exercices par e-mail ── */}
        <section className="bg-deep/[0.04] px-6 pt-16 scroll-mt-40">
          <div className="max-w-3xl mx-auto text-center">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Essayer gratuitement</p>
            <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-3">Avant de vous décider</h2>
            <p className="font-georgia text-mist text-base leading-relaxed">Posez vos questions à l’assistant ou recevez 3 exercices par e-mail.</p>
          </div>
        </section>

        <section id="essai-assistant" className="px-6 py-12 bg-deep/[0.04]">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8"><h3 className="font-georgia font-medium text-2xl leading-tight mb-2">Poser vos questions à MediumIA</h3><p className="font-georgia text-mist text-base leading-relaxed">Découvrez l'assistant qui vous accompagnera tout au long du parcours. 5 messages offerts, sans inscription.</p></div>
            <TrialChat />
          </div>
        </section>

        <FormationExerciseLead />


          </div>
        </details>

        {/* ── Le formateur et l'approche : l'essentiel visible, le reste replié ── */}
        <details id="formateur" className="group mx-auto max-w-5xl scroll-mt-40 px-6 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl border-2 border-gold/25 bg-white/70 px-5 py-5 shadow-[0_8px_24px_rgba(26,21,53,.04)] hover:border-gold/45 [&::-webkit-details-marker]:hidden">
            <div className="flex-1 text-left">
              <p className="font-georgia text-lg md:text-xl font-bold text-deep">Sébastien & l’approche MediumIA</p>
              <p className="font-georgia text-xs md:text-sm text-mist mt-1">Ouvrir pour découvrir le formateur et ce qui rend la méthode différente.</p>
            </div>
            <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="px-6 py-16">
<div className="max-w-5xl mx-auto">
            <div className="text-center mb-10"><p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Le formateur</p><h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">Sébastien Seguin</h2></div>
            <div className="flex flex-col md:flex-row gap-10 items-start">
              <div className="shrink-0 flex justify-center md:justify-start w-full md:w-auto"><img src="/sebastien.jpg" alt="Sébastien Seguin, médium et fondateur de MediumIA" loading="lazy" decoding="async" className="w-44 h-60 md:w-52 md:h-72 object-cover object-top rounded-2xl border-2 shadow-md" style={{ borderColor: '#C9A84C' }} /></div>
              <div className="space-y-4 font-georgia text-base md:text-lg text-deep/80 leading-relaxed">
                <p>Je m'appelle <strong className="text-deep">Sébastien Seguin</strong>. Je suis médium professionnel depuis plus de douze ans.</p>
                <p>Ce parcours a été construit à partir de cette pratique réelle, quotidienne : des milliers de séances, de rencontres avec des consultants, des défunts, des guides, des oracles. <strong className="text-deep">MediumIA n'est pas un parcours théorique. C'est une transmission.</strong></p>
                <details className="group">
                  <summary className="cursor-pointer list-none font-georgia text-sm font-bold text-gold [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">Lire la suite →</span><span className="hidden group-open:inline">Réduire ↑</span></summary>
                  <div className="space-y-4 pt-4">
                    <p>Pendant toutes ces années, j'ai accompagné des milliers de personnes en consultation individuelle : des personnes venues chercher des réponses, des familles en lien avec un proche disparu, des êtres traversant un moment de doute, de deuil, de bascule ou d'éveil.</p>
                    <p>Mon parcours m'a appris une chose essentielle : la médiumnité n'est pas un don réservé à quelques élus. C'est une dimension naturelle de l'être humain, qui se réveille lorsque les bonnes conditions sont réunies. Ces conditions, c'est exactement ce que cet accompagnement vous propose de créer.</p>
                    <blockquote className="border-l-4 border-gold pl-5 py-1"><p className="font-georgia text-lg text-mist italic leading-relaxed">« La médiumnité ne s'apprend pas. Elle se découvre. »</p></blockquote>
                  </div>
                </details>
              </div>
            </div>

            <div className="mt-12 max-w-3xl mx-auto">
              <h3 className="font-georgia font-medium text-2xl text-center mb-6">Ce qui rend MediumIA différente</h3>
              <div className="space-y-2">
                {POINTS.map((p) => (
                  <details key={p.titre} className="group rounded-xl border-2 border-gold/20 bg-white/50 open:border-gold/45">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 font-georgia text-deep font-medium [&::-webkit-details-marker]:hidden">
                      <span className="text-gold shrink-0" aria-hidden="true">✦</span>
                      <span className="flex-1">{p.titre}</span>
                      <span className="text-gold/70 text-xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                    </summary>
                    <p className="px-5 pb-5 pl-12 font-georgia text-sm text-mist leading-relaxed">{p.texte}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        


          </div>
        </details>

        <details id="faq" className="group mx-auto max-w-5xl scroll-mt-40 px-6 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl border-2 border-gold/25 bg-white/70 px-5 py-5 shadow-[0_8px_24px_rgba(26,21,53,.04)] hover:border-gold/45 [&::-webkit-details-marker]:hidden">
            <div className="flex-1 text-left">
              <p className="font-georgia text-lg md:text-xl font-bold text-deep">Questions fréquentes</p>
              <p className="font-georgia text-xs md:text-sm text-mist mt-1">Ouvrir les réponses sur l’accès, la durée, le paiement et le fonctionnement.</p>
            </div>
            <span className="text-gold/70 text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <div className="px-6 pb-16 max-w-3xl mx-auto">
<div className="text-center mb-10"><p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Questions fréquentes</p><h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight">FAQ</h2></div>
          <FAQAccordion />
        


          </div>
        </details>

        <section className="px-6 py-14 text-center border-t border-gold/20">
          <p className="font-georgia text-2xl text-deep mb-1">{offer ? `Commencez à ${money(offer.discoveryCents)} · total maximum ${money(offer.capCents)}` : 'Formation MediumIA · 597 € TTC'}</p>
          <p className="font-georgia text-sm text-mist mb-6">{offer ? `Puis ${offer.regularCount} × ${money(offer.stepCents)} · dernière étape ${money(offer.finalCents)} · ou paiement complet en une fois` : 'Paiement sécurisé par carte bancaire ou PayPal.'}</p>
          <button onClick={() => goTo('offre')} className="font-georgia px-8 py-4 rounded-lg bg-deep text-gold font-bold">Rejoindre la formation →</button>
          <div className="mt-8"><button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">← Retour à MediumIA</button></div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
