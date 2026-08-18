import { useState, useEffect } from 'react'
import { rdvPractitioners } from '../../data/rdvData'

function StatusBadge({ status }) {
  if (status === 'ok') return <span className="font-georgia text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">✓ Actif</span>
  if (status === 'warn') return <span className="font-georgia text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">⚠ Configuration requise</span>
  return <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/20 rounded-full px-3 py-1">— Non configuré</span>
}

export default function RdvDashboard({ onBack, onOpenPublic }) {
  const slugs = Object.keys(rdvPractitioners)

  // Slug initial : depuis l'URL si présent (retour OAuth)
  const urlParams = new URLSearchParams(window.location.search)
  const urlPractitioner = urlParams.get('practitioner')
  const initialSlug = slugs.includes(urlPractitioner) ? urlPractitioner : slugs[0]

  const [activeSlug, setActiveSlug] = useState(initialSlug)
  const p = rdvPractitioners[activeSlug]
  const [calStatus, setCalStatus] = useState(null)   // null=chargement, {connected, email, ...}
  const [calLoading, setCalLoading] = useState(false)
  const [oauthNotice, setOauthNotice] = useState(() => {
    const success = urlParams.get('oauth_success')
    const err = urlParams.get('oauth_error')
    if (success) return { type: 'success', msg: 'Google Agenda connecté avec succès.' }
    if (err) return { type: 'error', msg: `Erreur de connexion Google (${err}). Réessayez.` }
    return null
  })

  useEffect(() => {
    // Nettoyer les paramètres OAuth de l'URL sans recharger la page
    if (urlParams.has('oauth_success') || urlParams.has('oauth_error')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setCalStatus(null)
    setCalLoading(true)
    fetch(`/api/google-calendar/status?practitioner=${encodeURIComponent(activeSlug)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) { setCalStatus(data); setCalLoading(false) } })
      .catch(() => { if (!cancelled) { setCalStatus({ connected: false, reason: 'fetch_error' }); setCalLoading(false) } })
    return () => { cancelled = true }
  }, [activeSlug])

  async function handleDisconnect() {
    if (!window.confirm('Déconnecter Google Agenda ? Les créneaux passeront en mode démonstration.')) return
    try {
      const res = await fetch('/api/google-calendar/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ practitioner: activeSlug }),
      })
      const data = await res.json()
      if (data.disconnected) {
        setCalStatus({ connected: false, reason: 'disconnected' })
        setOauthNotice({ type: 'success', msg: 'Google Agenda déconnecté.' })
      }
    } catch {
      setOauthNotice({ type: 'error', msg: 'Erreur lors de la déconnexion. Réessayez.' })
    }
  }

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
        <div className="rounded-xl border border-gold/25 bg-gold/5 px-5 py-3.5 mb-4 flex gap-3 items-start">
          <span className="text-gold shrink-0 mt-0.5">◌</span>
          <p className="font-georgia text-xs text-mist leading-relaxed italic">
            Version Preview — la connexion Google Agenda est opérationnelle si les variables d'environnement sont configurées. La persistance des réservations et les emails de confirmation nécessitent une configuration Supabase supplémentaire.
          </p>
        </div>

        {/* Notification OAuth */}
        {oauthNotice && (
          <div className={`rounded-xl border px-5 py-3.5 mb-4 flex items-center justify-between gap-4 ${
            oauthNotice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            <p className="font-georgia text-xs">{oauthNotice.msg}</p>
            <button onClick={() => setOauthNotice(null)} className="font-georgia text-xs opacity-60 hover:opacity-100 shrink-0">✕</button>
          </div>
        )}

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
                {calLoading
                  ? <span className="font-georgia text-[10px] uppercase tracking-wide text-mist bg-deep/5 border border-gold/20 rounded-full px-3 py-1">Chargement…</span>
                  : <StatusBadge status={calStatus?.connected ? 'ok' : 'warn'} />
                }
              </div>

              {calStatus?.connected ? (
                <>
                  <p className="font-georgia text-sm text-mist leading-relaxed mb-2">
                    Agenda connecté — les créneaux disponibles sont calculés en temps réel à partir de vos indisponibilités.
                  </p>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4">
                    <p className="font-georgia text-xs text-emerald-800 font-semibold mb-0.5">Compte Google connecté</p>
                    <p className="font-georgia text-xs text-emerald-700">{calStatus.email}</p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="font-georgia text-xs px-5 py-2.5 rounded-xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    Déconnecter Google Agenda
                  </button>
                </>
              ) : (
                <>
                  <p className="font-georgia text-sm text-mist leading-relaxed mb-4">
                    Connectez votre compte Google pour que vos indisponibilités soient lues automatiquement. Seule la lecture des plages occupées est utilisée — aucun titre ni détail d'événement n'est accessible.
                  </p>
                  {calStatus?.reason === 'supabase_not_configured' && (
                    <div className="rounded-xl border border-gold/15 bg-deep/5 px-4 py-3 mb-4 font-georgia text-xs leading-relaxed">
                      <p className="text-mist mb-1">Variables manquantes :</p>
                      <code className="text-deep font-mono">SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REDIRECT_URI · CALENDAR_TOKEN_ENCRYPTION_KEY</code>
                    </div>
                  )}
                  {/* Navigation réelle (non-SPA) pour lancer le flux OAuth côté serveur */}
                  <a
                    href={`/api/google-calendar/connect?practitioner=${encodeURIComponent(activeSlug)}`}
                    className="inline-block font-georgia text-xs px-5 py-2.5 rounded-xl bg-deep text-gold hover:bg-deep/90 transition-colors"
                  >
                    Connecter Google Agenda →
                  </a>
                </>
              )}
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
