import { useEffect, useState } from 'react'
import LegalFooter from './LegalFooter'
import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'
import { CONFERENCE_PUBLIC_API, registrationSource } from '../lib/conferenceApi.js'

const EVENT_SLUG = 'premiere-conference-mediumia'
const CONFERENCE_API = CONFERENCE_PUBLIC_API
const RAFFLE_RULES_URL = '/reglement-tirage-conference-mediumia-22-10-2026.html'

function Step({ number, title, children }) {
  return <div className="rounded-2xl border border-gold/20 bg-white/65 p-5"><div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-gold/35 bg-gold/10 font-georgia text-sm font-semibold text-gold">{number}</div><h3 className="font-georgia text-lg font-medium text-deep">{title}</h3><p className="mt-2 font-georgia text-sm leading-relaxed text-mist">{children}</p></div>
}

function FeatureCard({ eyebrow, title, children }) {
  return <article className="rounded-3xl border border-gold/20 bg-white/70 p-6 shadow-[0_10px_28px_rgba(26,21,53,.04)] md:p-7"><p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">{eyebrow}</p><h3 className="mt-3 font-georgia text-xl font-medium leading-tight text-deep">{title}</h3><p className="mt-3 font-georgia text-sm leading-relaxed text-mist">{children}</p></article>
}

function durationLabel(event) {
  if (!event?.startsAt || !event?.endsAt) return '1 h'
  const minutes = Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes === 60) return '1 h'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest}` : `${hours} h`
}

export default function ConferencesPage({ onBack, onNavigate }) {
  const [event, setEvent] = useState(null)
  const [raffle, setRaffle] = useState(null)
  const [form, setForm] = useState({ firstName: '', email: '' })
  const [submitState, setSubmitState] = useState('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    trackMediumiaMetric('conference_page_view', 'conferences')
    fetch(`${CONFERENCE_API}?slug=${encodeURIComponent(EVENT_SLUG)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setEvent(data?.event || null)
        setRaffle(data?.raffle || null)
      })
      .catch(() => {})
  }, [])

  const submitRegistration = async (e) => {
    e.preventDefault()
    setSubmitState('loading')
    setMessage('')
    try {
      const response = await fetch(CONFERENCE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, slug: EVENT_SLUG, source: registrationSource(window.location.search) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Inscription impossible pour le moment.')
      setSubmitState('success')
      setMessage(data.alreadyRegistered ? 'Vous êtes déjà inscrit avec cette adresse. Votre place est bien conservée.' : 'Votre place est enregistrée. Votre carnet et votre accès Zoom arrivent par e-mail.')
      trackMediumiaMetric('conference_registration_success', 'conferences')
    } catch (error) {
      setSubmitState('error')
      setMessage(error.message)
    }
  }

  const registrationOpen = event?.registrationOpen === true
  const title = event?.title || 'Et si la médiumnité devenait accessible ?'
  const eventDate = event?.startsAt
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone || 'Europe/Paris' }).format(new Date(event.startsAt))
    : 'Jeudi 22 octobre 2026 à 19 h'
  const duration = durationLabel(event)
  const prizeValue = raffle?.prizeValueCents
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: raffle.currency || 'EUR', maximumFractionDigits: 0 }).format(raffle.prizeValueCents / 100)
    : '597 €'

  return (
    <div className="cosmic-page cosmic-page--conferences min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-40 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-4 md:px-6">
          <a
            href="/"
            onClick={(event) => {
              if (typeof onBack === 'function') {
                event.preventDefault()
                onBack()
              }
            }}
            className="justify-self-start font-georgia text-xs text-mist transition-colors hover:text-deep"
          >
            ← MediumIA
          </a>
          <div className="flex items-center gap-2.5"><img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" className="h-8 w-auto" /><span className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">CONFÉRENCES</span></div>
          <span aria-hidden="true" />
        </div>
      </header>

      <main>
        <section
          className="relative isolate overflow-hidden px-6 py-24 text-cream md:py-32"
          style={{
            backgroundImage: "linear-gradient(90deg, rgba(9,15,40,.92), rgba(17,22,56,.76) 50%, rgba(9,15,40,.9)), url('/images/home/mediumia-cosmic-library-hero.webp')",
            backgroundSize: 'cover',
            backgroundPosition: 'center 42%',
          }}
        >
          <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full border border-gold/10" />
          <div className="pointer-events-none absolute left-[12%] top-[18%] h-2 w-2 rounded-full bg-gold/70 shadow-[0_0_30px_rgba(201,168,76,.8)]" />
          <div className="relative mx-auto max-w-5xl text-center">
            <p className="font-georgia text-[11px] uppercase tracking-[0.28em] text-gold">MEDIUMIA · EN DIRECT · CONFÉRENCE OFFERTE</p>
            <h1 className="mx-auto mt-5 max-w-5xl font-georgia text-5xl font-medium leading-[1.05] md:text-7xl">{title}</h1>
            <p className="mx-auto mt-6 max-w-2xl font-georgia text-base leading-relaxed text-cream/70 md:text-lg">Une heure avec Sébastien Seguin pour comprendre l’approche MediumIA, expérimenter les premières bases de la pratique et poser vos questions en direct.</p>
            <p className="mt-5 font-georgia text-lg font-semibold tracking-wide text-gold md:text-2xl">{eventDate} · {duration}</p>
            <div className="mx-auto mt-7 max-w-2xl rounded-2xl border border-gold/35 bg-gold/10 px-5 py-4">
              <p className="font-georgia text-sm font-semibold text-gold">🎁 1 formation MediumIA complète offerte en direct — valeur {prizeValue}</p>
              <p className="mt-1 font-georgia text-xs leading-relaxed text-cream/55">Tirage au sort parmi les participants présents ayant validé leur participation pendant le direct. Sans obligation d’achat.</p>
            </div>
            <div className="mt-9 flex items-center justify-center">
              <a
                href="#experience"
                onClick={() => trackMediumiaMetric('conference_interest_click', 'conferences:experience')}
                className="rounded-full border border-[#d9ac56]/60 bg-[#101938]/75 px-8 py-4 font-georgia text-sm font-bold text-cream shadow-[0_12px_30px_rgba(0,0,0,.22)] backdrop-blur-md"
              >
                Voir l’expérience
              </a>
            </div>
          </div>
        </section>

        <section id="inscription" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="overflow-hidden rounded-[2rem] border border-gold/35 bg-[#fffefa]/90 shadow-[0_24px_70px_rgba(16,25,56,.13)] backdrop-blur-xl">
            <div className="grid md:grid-cols-[1.45fr_.75fr]">
              <div className="p-7 md:p-10">
                <span className="inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Première conférence publique MediumIA</span>
                <h2 className="mt-5 max-w-2xl font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">{title}</h2>
                <p className="mt-4 max-w-2xl font-georgia leading-relaxed text-mist">Rendez-vous {eventDate} pour {duration}. L’accès est gratuit sur inscription et chaque participant reçoit avant le direct un carnet de préparation MediumIA.</p>
                <div className="mt-6 grid gap-3 text-sm text-mist sm:grid-cols-2">
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">Accès gratuit</strong>Sur inscription personnelle.</div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">En direct sur Zoom</strong>Lien envoyé aux inscrits.</div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">PDF offert</strong>Introduction + Module 1 + 3 exercices.</div>
                  <div className="rounded-2xl border border-gold/15 bg-cream/70 p-4"><strong className="block font-georgia text-deep">Questions en direct</strong>Via l’espace live MediumIA.</div>
                  <div className="rounded-2xl border border-gold/30 bg-gold/10 p-4 sm:col-span-2"><strong className="block font-georgia text-deep">🎁 Une formation complète à gagner</strong>Valeur {prizeValue}. Le tirage est réservé aux participants présents qui valident leur participation pendant le direct.</div>
                </div>
              </div>

              <div
                className="relative flex flex-col justify-center overflow-hidden p-7 text-cream md:p-8"
                style={{
                  backgroundImage: "linear-gradient(145deg, rgba(16,25,56,.94), rgba(28,43,85,.88)), url('/images/home/mediumia-cosmic-library-hero.webp')",
                  backgroundSize: 'cover',
                  backgroundPosition: '70% center',
                }}
              >
                <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">INSCRIPTIONS</p>
                {registrationOpen ? <>
                  <p className="mt-3 font-georgia text-2xl font-medium">Réserver ma place</p>
                  <form onSubmit={submitRegistration} className="mt-5 space-y-3">
                    <input required maxLength={80} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Votre prénom" className="w-full rounded-xl border border-gold/25 bg-cream/95 px-4 py-3 font-georgia text-sm text-deep outline-none placeholder:text-mist/70" />
                    <input required type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Votre e-mail" className="w-full rounded-xl border border-gold/25 bg-cream/95 px-4 py-3 font-georgia text-sm text-deep outline-none placeholder:text-mist/70" />
                    <button disabled={submitState === 'loading' || submitState === 'success'} className="w-full rounded-xl bg-gold px-5 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-60">{submitState === 'loading' ? 'Inscription…' : submitState === 'success' ? 'Place enregistrée' : 'Je réserve ma place gratuitement'}</button>
                  </form>
                  {message && <p className="mt-4 font-georgia text-xs leading-relaxed text-cream/70" role="status">{message}</p>}
                  <p className="mt-4 font-georgia text-[11px] leading-relaxed text-cream/45">Votre e-mail est utilisé pour gérer cette inscription et vous transmettre les informations liées à la conférence. L’inscription à la conférence n’inscrit pas automatiquement à une prospection commerciale.</p>
                </> : <>
                  <p className="mt-3 font-georgia text-2xl font-medium">Ouverture prochaine</p>
                  <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/60">La conférence du 22 octobre est enregistrée. Le formulaire s’ouvrira ici dès que le parcours live et le tirage auront passé leurs derniers tests.</p>
                  <div className="mt-6 rounded-2xl border border-gold/30 bg-cream/95 p-4 font-georgia text-xs leading-relaxed text-deep">Aucun paiement ne sera demandé pour participer à cette première conférence ni au tirage au sort.</div>
                </>}
              </div>
            </div>
          </div>
        </section>

        <section
          id="experience"
          className="border-y border-gold/15 px-6 py-20 md:py-24"
          style={{
            backgroundImage: "linear-gradient(rgba(255,254,250,.93), rgba(245,241,232,.94)), url('/images/home/mediumia-cosmic-library-hero.webp')",
            backgroundSize: 'cover',
            backgroundPosition: 'center 58%',
          }}
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-10 max-w-3xl text-center"><p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">AVANT · PENDANT · APRÈS</p><h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Une conférence pensée comme une expérience complète.</h2></div>
            <div className="grid gap-4 md:grid-cols-4">
              <Step number="1" title="Vous vous inscrivez">Prénom et e-mail suffisent. Votre place est liée à votre adresse afin de personnaliser la suite du parcours.</Step>
              <Step number="2" title="Vous vous préparez">Vous recevez le carnet MediumIA : introduction, Module 1 « L’Intention comme Porte » et trois exercices pratiques.</Step>
              <Step number="3" title="Vous vivez le direct">Vous rejoignez la conférence sur Zoom et pouvez envoyer vos questions depuis un espace MediumIA dédié.</Step>
              <Step number="4" title="Vous tentez votre chance">En fin de direct, les personnes présentes peuvent valider leur participation au tirage de la formation complète.</Step>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div
            className="relative overflow-hidden rounded-[2rem] border border-gold/40 px-7 py-10 text-cream shadow-[0_24px_70px_rgba(16,25,56,.16)] md:px-10 md:py-12"
            style={{
              backgroundImage: "linear-gradient(115deg, rgba(8,14,38,.94), rgba(27,40,79,.84)), url('/images/home/mediumia-cosmic-library-hero.webp')",
              backgroundSize: 'cover',
              backgroundPosition: 'center 46%',
            }}
          >
            <div className="grid gap-8 md:grid-cols-[1fr_.8fr] md:items-center">
              <div>
                <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">LE TIRAGE DU 22 OCTOBRE</p>
                <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Une personne repartira avec MediumIA complet.</h2>
                <p className="mt-4 max-w-2xl font-georgia leading-relaxed text-cream/65">Vers la fin du direct, une fenêtre de participation s’ouvrira dans l’espace MediumIA. Vous confirmez votre participation en un clic. Le gagnant est ensuite choisi aléatoirement parmi les participants présents et éligibles.</p>
                <p className="mt-5 font-georgia text-sm text-gold"><strong>Lot :</strong> 1 accès complet à la formation MediumIA · valeur {prizeValue}</p>
              </div>
              <div className="rounded-2xl border border-gold/30 bg-cream/95 p-6 font-georgia text-sm leading-relaxed text-mist shadow-[0_14px_36px_rgba(0,0,0,.12)]">
                <p><strong className="text-deep">Gratuit.</strong> Aucun achat nécessaire.</p>
                <p className="mt-3"><strong className="text-deep">Présence requise.</strong> Il faut être présent au direct et valider sa participation dans la fenêtre prévue.</p>
                <p className="mt-3"><strong className="text-deep">Une participation.</strong> Une seule entrée par inscription.</p>
                <p className="mt-3"><strong className="text-deep">Pas de cash.</strong> Le lot n’est pas échangeable contre sa valeur en argent.</p>
                <a href={RAFFLE_RULES_URL} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-xs font-semibold text-gold underline decoration-gold/40 underline-offset-4">Consulter les modalités du tirage</a>
              </div>
            </div>
          </div>
        </section>

        <section
          className="mx-auto max-w-6xl rounded-[2.5rem] px-6 pb-20 pt-10 md:pb-24 md:pt-14"
          style={{
            backgroundImage: "radial-gradient(circle at 18% 18%, rgba(227,195,124,.18), transparent 28rem), linear-gradient(rgba(255,254,250,.9), rgba(251,250,245,.94))",
          }}
        >
          <div className="mb-10 max-w-3xl"><p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">LE CARNET DE PRÉPARATION</p><h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Vous ne viendrez pas à la conférence les mains vides.</h2><p className="mt-4 font-georgia leading-relaxed text-mist">Chaque inscrit recevra avant la rencontre une première porte du parcours MediumIA afin d’arriver avec ses propres ressentis, observations et questions.</p></div>
          <div className="grid gap-5 md:grid-cols-3">
            <FeatureCard eyebrow="Exercice 1" title="L’intention quotidienne">Une pratique courte sur plusieurs jours pour observer ce qui change lorsque vous orientez consciemment votre disponibilité intérieure.</FeatureCard>
            <FeatureCard eyebrow="Exercice 2" title="Votre intention personnelle">Vous construisez votre propre formulation d’ouverture avec direction, qualité recherchée et cadre de sécurité.</FeatureCard>
            <FeatureCard eyebrow="Exercice 3" title="Souhait, prière ou intention ?">Une expérience d’observation pour ressentir la différence entre vouloir, demander et décider intérieurement.</FeatureCard>
          </div>
        </section>

        <section
          className="relative isolate overflow-hidden px-6 py-20 text-cream md:py-28"
          style={{
            backgroundImage: "linear-gradient(100deg, rgba(8,14,38,.95), rgba(18,29,67,.8)), url('/images/home/mediumia-cosmic-library-hero.webp')",
            backgroundSize: 'cover',
            backgroundPosition: 'center 60%',
          }}
        >
          <div className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full border border-gold/10" />
          <div className="pointer-events-none absolute right-[8%] top-[12%] h-56 w-56 rounded-full bg-gold/10 blur-3xl" />
          <div className="pointer-events-none absolute left-[14%] top-[24%] h-2 w-2 rounded-full bg-gold/80 shadow-[0_0_26px_rgba(201,168,76,.9)]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 md:grid-cols-[.9fr_1.1fr] md:items-center">
            <div>
              <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">QUESTIONS EN DIRECT</p>
              <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Vos questions ne se perdront pas dans un chat qui défile.</h2>
              <p className="mt-4 font-georgia leading-relaxed text-cream/70">Pendant la conférence, un espace MediumIA recueillera les questions du public. Le système pourra regrouper les sujets proches afin de faire émerger les thèmes les plus demandés.</p>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-gold/35 bg-[#101938]/55 p-6 shadow-[0_24px_70px_rgba(0,0,0,.24)] backdrop-blur-xl md:p-8">
              <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold/15 blur-3xl" />
              <div className="relative">
                <p className="font-georgia text-xs uppercase tracking-[0.18em] text-gold">Cockpit conférence</p>
                <p className="mt-2 font-georgia text-sm leading-relaxed text-cream/65">Une vue claire des sujets qui émergent pendant le direct.</p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl border border-gold/20 bg-cream/95 p-4 text-deep shadow-sm">
                    <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Questions les plus demandées</p>
                    <p className="mt-2 font-georgia text-sm leading-relaxed">« Comment reconnaître une vraie perception ? »</p>
                  </div>

                  <div className="rounded-2xl border border-gold/45 bg-cream/95 p-4 text-deep shadow-sm">
                    <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Question sélectionnée pour le direct</p>
                    <p className="mt-2 font-georgia text-sm leading-relaxed">« Quelle différence entre intuition, mental et médiumnité ? »</p>
                  </div>

                  <div className="rounded-2xl border border-gold/30 bg-gold/10 p-4 text-cream">
                    <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Copilote MediumIA</p>
                    <p className="mt-2 font-georgia text-sm leading-relaxed text-cream/80">Regroupe les thèmes proches et aide à faire émerger les priorités. La réponse reste humaine.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="rounded-[2rem] border border-gold/30 bg-[#fffefa]/90 px-7 py-10 text-center shadow-[0_20px_60px_rgba(16,25,56,.1)] backdrop-blur-xl"><p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">APRÈS LA CONFÉRENCE</p><h2 className="mt-3 font-georgia text-3xl font-medium">Un Pass MediumIA personnel, jamais un code public.</h2><p className="mx-auto mt-4 max-w-2xl font-georgia text-sm leading-relaxed text-mist">Si une offre spéciale est ouverte aux participants, chaque Pass sera généré individuellement, lié à l’e-mail d’inscription, utilisable une seule fois et valable 1 mois.</p></div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
