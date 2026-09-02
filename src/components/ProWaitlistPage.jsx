import { useState, useEffect } from 'react'
import LegalFooter from './LegalFooter'

const NEEDS = [
  'Assistant IA pour mes clients',
  'Rendez-vous et organisation',
  'Communication / réseaux',
  'Documents et mémoire métier',
  'Automatisations',
  'Autre',
]

const CAPABILITIES = [
  {
    icon: '✦',
    title: 'Assistant Cabinet',
    description: "Un assistant formé sur votre pratique, capable d’accueillir vos clients, répondre à leurs questions et refléter votre approche.",
  },
  {
    icon: '◇',
    title: 'Assistant Formation',
    description: 'Accompagnez vos élèves avec un assistant qui connaît votre contenu pédagogique et guide chaque étape du parcours.',
  },
  {
    icon: '◈',
    title: 'Assistant Boutique',
    description: "Présentez vos créations et produits avec un assistant qui en connaît l'histoire, la provenance et les usages.",
  },
  {
    icon: '◌',
    title: 'Assistant Communication',
    description: 'Rédigez vos contenus, publications et messages dans votre ton — sans perdre votre identité.',
  },
  {
    icon: '✺',
    title: 'Mémoire métier',
    description: 'Centralisez vos documents, vos notes et vos ressources dans un espace structuré, accessible à vos assistants.',
  },
  {
    icon: '◉',
    title: 'MediumIA Rendez-vous',
    description: 'Gérez vos créneaux, vos confirmations et vos rappels depuis un espace pensé pour votre rythme de travail.',
  },
]

export default function ProWaitlistPage({ onBack, onNavigate }) {
  const [form, setForm] = useState({
    firstName: '',
    email: '',
    activity: '',
    primaryNeed: '',
    message: '',
    consent: false,
  })
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])

  const canSubmit = form.firstName.trim() && form.email.trim() && form.activity.trim() && form.primaryNeed && form.consent && !sending

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return

    setSending(true)
    setError('')

    const params = new URLSearchParams(window.location.search)

    try {
      const res = await fetch('/api/mediumia-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'pro-waitlist',
          firstName: form.firstName.trim(),
          email: form.email.trim(),
          activity: form.activity.trim(),
          primaryNeed: form.primaryNeed,
          message: form.message.trim(),
          consent: form.consent,
          sourcePage: '/pro',
          utmSource: (params.get('utm_source') || '').slice(0, 200),
          utmMedium: (params.get('utm_medium') || '').slice(0, 200),
          utmCampaign: (params.get('utm_campaign') || '').slice(0, 200),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Une erreur est survenue. Réessayez dans quelques instants.')
        setSending(false)
        return
      }

      setSuccess(true)
    } catch {
      setError('Impossible de contacter le serveur. Réessayez dans quelques instants.')
    }
    setSending(false)
  }

  return (
    <div className="bg-cream min-h-screen text-deep">

      <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 flex items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors flex items-center gap-2">
            ← MediumIA
          </button>
          <span className="font-georgia text-deep tracking-[0.2em] text-sm font-semibold">MEDIUMIA PRO</span>
        </div>
      </header>

      <main>

        {/* ── Hero ── */}
        <section className="min-h-[80vh] flex flex-col items-center justify-center text-center px-6 pt-28 pb-16">
          <span className="inline-block font-georgia text-[10px] uppercase tracking-[0.22em] rounded-full px-4 py-1.5 mb-6 border border-gold/40 text-gold bg-gold/5">
            Accès prioritaire · bientôt disponible
          </span>
          <p className="font-georgia text-gold tracking-[0.3em] text-xs uppercase mb-4">MediumIA Pro</p>
          <h1 className="font-bodoni text-deep text-3xl md:text-5xl lg:text-6xl leading-tight max-w-4xl mx-auto mb-6">
            Votre pratique. Votre savoir.<br />
            <span className="text-gold">Amplifiés par des outils qui vous ressemblent.</span>
          </h1>
          <p className="font-georgia text-mist text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            MediumIA Pro prépare des assistants IA et des outils pensés pour les professionnels de l'accompagnement, du bien-être, de la médiumnité, de la formation et des métiers fondés sur la relation humaine.
          </p>
          <a href="#waitlist" className="font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold hover:bg-gold/90 transition-colors">
            Rejoindre la liste prioritaire →
          </a>
        </section>

        {/* ── Capacités ── */}
        <section className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Ce qui se prépare</p>
            <h2 className="font-georgia font-medium text-2xl md:text-4xl leading-tight mb-5">Des outils pensés pour votre métier.</h2>
            <p className="font-georgia text-mist text-base md:text-lg leading-relaxed">
              Chaque outil sera conçu pour s'adapter à votre identité, votre contenu et votre manière d'accompagner.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {CAPABILITIES.map(cap => (
              <article
                key={cap.title}
                className="rounded-2xl border border-gold/20 p-7 bg-white/55 shadow-sm flex flex-col"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <span className="text-gold text-2xl">{cap.icon}</span>
                  <span className="font-georgia text-[9px] uppercase tracking-[0.14em] rounded-full px-3 py-1 bg-deep/5 text-mist">En préparation</span>
                </div>
                <h3 className="font-georgia text-lg font-medium text-deep mb-3">{cap.title}</h3>
                <p className="font-georgia text-sm text-mist leading-relaxed flex-1">{cap.description}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Waitlist ── */}
        <section id="waitlist" className="px-6 py-16">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Accès prioritaire</p>
              <h2 className="font-georgia font-medium text-2xl md:text-4xl leading-tight mb-4">
                Rejoindre la liste prioritaire MediumIA Pro
              </h2>
              <p className="font-georgia text-mist text-base leading-relaxed">
                Soyez parmi les premiers professionnels informés de l'ouverture.
              </p>
            </div>

            {success ? (
              <div className="rounded-2xl border border-gold/30 bg-white/70 p-8 md:p-12 text-center shadow-sm">
                <span className="text-gold text-4xl block mb-4">✦</span>
                <h3 className="font-georgia text-xl font-medium text-deep mb-3">Votre demande est enregistrée.</h3>
                <p className="font-georgia text-mist text-sm leading-relaxed max-w-md mx-auto">
                  Vous ferez partie des premiers professionnels informés de l'ouverture de MediumIA Pro.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="rounded-2xl border border-gold/25 bg-white/70 p-7 md:p-10 shadow-sm space-y-5">
                <div>
                  <label className="font-georgia text-sm font-medium text-deep block mb-1.5">Prénom *</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value.slice(0, 80) }))}
                    className="w-full font-georgia text-sm border border-gold/25 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-gold/60 transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="font-georgia text-sm font-medium text-deep block mb-1.5">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value.slice(0, 254) }))}
                    className="w-full font-georgia text-sm border border-gold/25 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-gold/60 transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="font-georgia text-sm font-medium text-deep block mb-1.5">Activité / métier *</label>
                  <input
                    type="text"
                    value={form.activity}
                    onChange={e => setForm(f => ({ ...f, activity: e.target.value.slice(0, 120) }))}
                    className="w-full font-georgia text-sm border border-gold/25 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-gold/60 transition-colors"
                    placeholder="Ex : Médium, praticien bien-être, formateur…"
                    required
                  />
                </div>

                <div>
                  <label className="font-georgia text-sm font-medium text-deep block mb-1.5">Besoin principal *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {NEEDS.map(need => (
                      <button
                        key={need}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, primaryNeed: need }))}
                        className="font-georgia text-sm text-left px-4 py-3 rounded-lg border transition-all"
                        style={form.primaryNeed === need
                          ? { background: '#1A1535', color: '#C9A84C', borderColor: '#1A1535' }
                          : { background: 'white', color: '#4A3F6B', borderColor: 'rgba(201,168,76,.25)' }
                        }
                      >
                        {need}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="font-georgia text-sm font-medium text-deep block mb-1.5">
                    Qu'est-ce qui vous ferait gagner le plus de temps ? <span className="text-mist font-normal">(facultatif)</span>
                  </label>
                  <textarea
                    value={form.message}
                    onChange={e => setForm(f => ({ ...f, message: e.target.value.slice(0, 1000) }))}
                    rows={3}
                    className="w-full font-georgia text-sm border border-gold/25 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-gold/60 transition-colors resize-none"
                  />
                  <p className="font-georgia text-[10px] text-mist/50 text-right mt-1">{form.message.length}/1000</p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={e => setForm(f => ({ ...f, consent: e.target.checked }))}
                    className="mt-1 shrink-0 accent-gold"
                  />
                  <span className="font-georgia text-xs text-mist leading-relaxed">
                    Je souhaite rejoindre la liste prioritaire MediumIA Pro et recevoir par e-mail les informations liées à son lancement.
                    {' '}
                    <button type="button" onClick={() => onNavigate('/confidentialite')} className="text-gold hover:underline">Politique de confidentialité</button>
                  </span>
                </label>

                {error && <p className="font-georgia text-xs text-red-500 text-center">{error}</p>}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full font-georgia px-8 py-4 rounded-lg bg-gold text-deep font-bold text-base hover:bg-gold/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? 'Envoi en cours…' : "Rejoindre l'accès prioritaire →"}
                </button>
              </form>
            )}
          </div>
        </section>

      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
