import { useState } from 'react'
import { rdvPractitioners } from '../../data/rdvData'

function StatusBadge({ status }) {
  if (status === 'ok') return <span className="font-georgia text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">✓ Actif</span>
  if (status === 'warn') return <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">⚠ Configuration requise</span>
  return <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/20 rounded-full px-3 py-1">— Non configuré</span>
}

export default function RdvDashboard({ onBack, onOpenPublic }) {
  const slugs = Object.keys(rdvPractitioners)
  const [activeSlug, setActiveSlug] = useState(slugs[0])
  const p = rdvPractitioners[activeSlug]

  return (
    <div className="min-h-screen bg-cream text-deep">

      {/* Header */}
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Espace Pro</button>
            <span className="text-gold/30">·</span>
            <span className="font-georgia text-sm font-semibold text-deep">MediumIA Rendez-vous</span>
          </div>
          <button
            onClick={() => onOpenPublic(activeSlug)}
            className="font-georgia text-xs text-gold border border-gold/40 px-4 py-2 rounded-lg hover:bg-gold/10 transition-colors"
          >
            Voir ma page publique →
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10 pb-24">

        {/* Preview notice */}
        <div className="rounded-xl border border-gold/25 bg-gold/5 px-5 py-3.5 mb-8 flex gap-3 items-start">
          <span className="text-gold shrink-0 mt-0.5">◌</span>
          <p className="font-georgia text-xs text-mist leading-relaxed italic">
            Version Preview — interface complète mais non fonctionnelle. Google Agenda, la persistance des réservations et les emails de confirmation nécessitent une configuration serveur avant mise en ligne.
          </p>
        </div>

        {/* Page heading */}
        <div className="mb-8">
          <p className="font-georgia text-gold tracking-[0.24em] text-[11px] uppercase mb-2">ESPACE PRO</p>
          <h1 className="font-georgia font-medium text-3xl md:text-4xl leading-tight mb-2">MediumIA Rendez-vous</h1>
          <p className="font-georgia text-mist">Votre pratique. Votre agenda. Vos rendez-vous réunis.</p>
        </div>

        {/* Practitioner tabs */}
        <div className="flex gap-2 mb-8">
          {slugs.map(slug => {
            const pr = rdvPractitioners[slug]
            return (
              <button
                key={slug}
                onClick={() => setActiveSlug(slug)}
                className={`flex items-center gap-2.5 font-georgia text-sm px-4 py-2.5 rounded-xl border transition-all ${
                  activeSlug === slug ? 'bg-deep text-gold border-deep' : 'border-gold/30 text-mist hover:border-gold/60 hover:text-deep'
                }`}
              >
                <img src={pr.photo} alt="" className="w-6 h-6 rounded-full object-cover" />
                {pr.name.split(' ')[0]}
              </button>
            )
          })}
        </div>

        <div className="grid md:grid-cols-3 gap-5">

          {/* Main column */}
          <div className="md:col-span-2 space-y-5">

            {/* Google Calendar */}
            <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Synchronisation</p>
                  <h2 className="font-georgia text-lg font-medium">Google Agenda</h2>
                </div>
                <StatusBadge status="warn" />
              </div>
              <p className="font-georgia text-sm text-mist leading-relaxed mb-4">
                Connectez votre compte Google pour que vos indisponibilités soient lues automatiquement et que chaque réservation confirme crée un événement dans votre agenda.
              </p>
              <div className="rounded-xl border border-gold/15 bg-deep/5 px-4 py-3 mb-4 font-georgia text-xs leading-relaxed">
                <p className="text-mist mb-1">Variables d'environnement requises :</p>
                <code className="text-deep font-mono">GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REDIRECT_URI</code>
              </div>
              <button disabled className="font-georgia text-xs px-5 py-2.5 rounded-xl bg-deep/8 text-mist cursor-not-allowed border border-gold/15">
                Connecter Google Agenda — disponible après configuration
              </button>
            </section>

            {/* Services */}
            <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Prestations</p>
                  <h2 className="font-georgia text-lg font-medium">{p.name}</h2>
                </div>
              </div>
              <div className="space-y-3">
                {p.services.map(svc => (
                  <div key={svc.id} className="rounded-xl border border-gold/20 bg-white/40 p-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2 mb-1.5">
                        <p className="font-georgia text-sm font-semibold text-deep">{svc.title}</p>
                        {svc.provisional && (
                          <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">À confirmer</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 font-georgia text-xs text-mist mb-2">
                        <span>⏱ {svc.durationLabel}</span>
                        <span>·</span>
                        <span>{svc.priceLabel}</span>
                        <span>·</span>
                        <span>{svc.modalityLabel}</span>
                      </div>
                      <p className="font-georgia text-xs text-mist/80 leading-relaxed">{svc.description}</p>
                    </div>
                    <button disabled className="shrink-0 font-georgia text-xs text-mist/50 border border-gold/15 px-3 py-1.5 rounded-lg cursor-not-allowed">
                      Modifier
                    </button>
                  </div>
                ))}
              </div>
              <button disabled className="mt-4 font-georgia text-xs text-mist/50 px-4 py-2.5 rounded-xl border border-dashed border-gold/25 cursor-not-allowed w-full">
                + Ajouter une prestation — bientôt disponible
              </button>
            </section>

            {/* Upcoming bookings */}
            <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Agenda</p>
                  <h2 className="font-georgia text-lg font-medium">Prochains rendez-vous</h2>
                </div>
                <StatusBadge status="none" />
              </div>
              <div className="rounded-xl border border-gold/15 bg-deep/3 px-6 py-10 text-center">
                <p className="text-gold text-3xl mb-3">◈</p>
                <p className="font-georgia text-sm text-mist leading-relaxed max-w-xs mx-auto">
                  Les réservations apparaîtront ici une fois la connexion Supabase et Google Agenda activées.
                </p>
              </div>
            </section>

          </div>

          {/* Side column */}
          <div className="space-y-5">

            {/* Settings */}
            <section className="rounded-2xl border border-gold/25 bg-white/60 p-5">
              <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-4">Paramètres</p>
              {[
                ['Fuseau horaire', p.settings.timezone],
                ['Tampon entre séances', 'À configurer'],
                ['Délai minimum', 'À configurer'],
                ['Horizon de réservation', 'À configurer'],
              ].map(([label, val]) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-gold/10 last:border-0">
                  <span className="font-georgia text-xs text-mist">{label}</span>
                  <span className="font-georgia text-xs font-semibold text-deep">{val}</span>
                </div>
              ))}
              {p.settings.note && (
                <p className="font-georgia text-[10px] text-amber-700 mt-3 italic leading-relaxed">{p.settings.note}</p>
              )}
              <button disabled className="mt-4 font-georgia text-xs text-mist/50 border border-dashed border-gold/20 px-3 py-2 rounded-xl cursor-not-allowed w-full">
                Modifier — bientôt disponible
              </button>
            </section>

            {/* Public page */}
            <section
              className="rounded-2xl border-2 border-gold/35 p-5"
              style={{ background: 'linear-gradient(135deg,rgba(201,168,76,.08),rgba(201,168,76,.02))' }}
            >
              <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-2">Page publique</p>
              <p className="font-georgia text-xs text-mist leading-relaxed mb-4">
                Votre page de réservation — aucune connexion requise pour vos clients.
              </p>
              <code className="font-mono text-[10px] text-deep bg-white/60 border border-gold/20 px-3 py-1.5 rounded-lg block mb-4 break-all">
                /rdv/{activeSlug}
              </code>
              <button
                onClick={() => onOpenPublic(activeSlug)}
                className="font-georgia text-xs font-bold text-gold w-full text-center hover:text-gold/80 transition-colors"
              >
                Voir ma page publique →
              </button>
            </section>

            {/* Email */}
            <section className="rounded-2xl border border-gold/25 bg-white/60 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold">Emails</p>
                <StatusBadge status="none" />
              </div>
              <p className="font-georgia text-xs text-mist leading-relaxed">
                Confirmation client · Confirmation praticien · Annulation · Modification
              </p>
              <div className="mt-3 font-georgia text-[10px] text-mist/60">Nécessite : EMAIL_FROM · EMAIL_API_KEY</div>
            </section>

          </div>
        </div>
      </main>
    </div>
  )
}
