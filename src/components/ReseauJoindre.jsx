import { useState } from 'react'
import LegalFooter from './LegalFooter'

const FORM_INIT = {
  prenom: '', nom: '', nom_pro: '', email: '', telephone: '',
  ville: '', departement: '', distance: '', site: '', social: '',
  activite: '', specialites: '', annees: '', siret: '',
  pratique: '', approche: '', audience: '', pourquoi: '',
  consent_exactitude: false,
  consent_traitement: false,
  _hp: '',
}

const inputCls = "w-full font-georgia text-sm text-deep bg-white border border-gold/30 rounded-xl px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors placeholder:text-mist/40"
const labelCls = "block font-georgia text-xs tracking-[0.15em] uppercase text-mist mb-2"

function FormField({ label, required, error, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label}{required && <span className="text-gold ml-1">*</span>}
      </label>
      {children}
      {error && <p className="font-georgia text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

function SectionHeading({ num, title }) {
  return (
    <div className="mb-8">
      <p className="font-georgia text-gold tracking-[0.24em] text-[10px] uppercase mb-1">{num}</p>
      <h2 className="font-georgia font-medium text-2xl text-deep">{title}</h2>
      <div className="h-px bg-gold/25 mt-3" />
    </div>
  )
}

function FounderBlock() {
  return (
    <div
      className="rounded-2xl border-2 border-gold/40 px-8 py-10 text-center mb-10"
      style={{ background: 'linear-gradient(135deg,rgba(201,168,76,.08),rgba(201,168,76,.03))' }}
    >
      <p className="text-gold text-2xl mb-4">◈</p>
      <p className="font-georgia text-gold tracking-[0.2em] text-xs uppercase mb-5">Candidatures fondatrices</p>

      <p className="font-georgia text-deep text-2xl md:text-3xl font-medium mb-8">
        50 Membres Fondateurs Mediumia
      </p>

      <div className="grid sm:grid-cols-2 gap-4 max-w-lg mx-auto mb-8">
        <div className="rounded-xl border border-gold/25 bg-white/50 px-5 py-5">
          <p className="font-georgia text-gold text-3xl font-medium mb-1">10</p>
          <p className="font-georgia text-mist text-sm leading-snug">
            Professionnels invités<br />personnellement par Mediumia
          </p>
        </div>
        <div className="rounded-xl border border-gold/25 bg-white/50 px-5 py-5">
          <p className="font-georgia text-gold text-3xl font-medium mb-1">40</p>
          <p className="font-georgia text-mist text-sm leading-snug">
            Places ouvertes<br />aux candidatures
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-8 mb-6">
        <div>
          <p className="font-georgia text-deep text-xl font-medium">9,90 € <span className="text-mist text-sm font-normal">TTC / mois</span></p>
        </div>
        <p className="font-georgia text-mist text-sm self-center">ou</p>
        <div>
          <p className="font-georgia text-deep text-xl font-medium">99 € <span className="text-mist text-sm font-normal">TTC / an</span></p>
        </div>
      </div>

      <p className="font-georgia text-mist text-sm italic">
        Tarif fondateur maintenu tant que l'adhésion reste continue.
      </p>
    </div>
  )
}

export default function ReseauJoindre({ onBack, onNavigate }) {
  const [form, setForm] = useState(FORM_INIT)
  const [status, setStatus] = useState('idle')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const e = {}
    if (!form.prenom.trim()) e.prenom = 'Requis'
    if (!form.nom.trim()) e.nom = 'Requis'
    const emailTrimmed = form.email.trim().toLowerCase()
    if (!emailTrimmed) e.email = 'Requis'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) e.email = 'Format invalide'
    if (!form.ville.trim()) e.ville = 'Requis'
    if (!form.departement.trim()) e.departement = 'Requis'
    if (!form.distance) e.distance = 'Sélectionnez une option'
    if (!form.activite.trim()) e.activite = 'Requis'
    if (!form.specialites.trim()) e.specialites = 'Requis'
    if (!form.annees.trim()) e.annees = 'Requis'
    if (!form.pratique.trim()) e.pratique = 'Requis'
    if (!form.approche.trim()) e.approche = 'Requis'
    if (!form.audience.trim()) e.audience = 'Requis'
    if (!form.pourquoi.trim()) e.pourquoi = 'Requis'
    if (!form.consent_exactitude) e.consent_exactitude = 'Requis pour continuer'
    if (!form.consent_traitement) e.consent_traitement = 'Requis pour continuer'
    if (form.site.trim() && !/^https?:\/\//i.test(form.site.trim())) e.site = "L'URL doit commencer par http:// ou https://"
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      const firstErrorField = document.querySelector('[data-field-error]')
      if (firstErrorField) firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setErrors({})
    setServerError('')
    setStatus('sending')

    try {
      const payload = {
        first_name: form.prenom.trim(),
        last_name: form.nom.trim(),
        professional_name: form.nom_pro.trim() || null,
        email: form.email.trim().toLowerCase(),
        phone: form.telephone.trim() || null,
        city: form.ville.trim(),
        department: form.departement.trim(),
        remote_sessions: form.distance === 'Oui' ? 'yes' : 'no',
        website: form.site.trim() || null,
        social_link: form.social.trim() || null,
        main_activity: form.activite.trim(),
        specialties: form.specialites.trim(),
        years_practice: form.annees.trim(),
        siret: form.siret.trim() || null,
        practice_description: form.pratique.trim(),
        approach_description: form.approche.trim(),
        target_audience: form.audience.trim(),
        motivation: form.pourquoi.trim(),
        consent_accuracy: true,
        consent_processing: true,
        source_page: window.location.pathname,
        _hp: form._hp,
      }

      const res = await fetch('/api/reseau-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'server_error')
      }

      setStatus('success')
      window.scrollTo(0, 0)
    } catch {
      setStatus('error')
      setServerError("Votre candidature n'a pas pu être transmise. Rien n'a été perdu : vérifiez votre connexion puis réessayez.")
    }
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20 px-6 py-4">
          <button onClick={onBack} className="font-georgia text-sm text-deep font-semibold">✦ MEDIUMIA</button>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 py-24 text-center">
          <div className="max-w-lg">
            <p className="text-gold text-5xl mb-6">✦</p>
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Candidature reçue</p>
            <h1 className="font-georgia font-medium text-3xl text-deep mb-6">Merci.</h1>
            <div className="rounded-2xl border border-gold/30 bg-gold/5 px-8 py-6 mb-8 text-left space-y-4">
              <p className="font-georgia text-sm text-deep leading-relaxed">
                Votre candidature a bien été transmise à Mediumia.
              </p>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Chaque profil est étudié individuellement afin de préserver la cohérence humaine et professionnelle du Réseau.
              </p>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Aucun paiement n'est demandé à ce stade.
              </p>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Si votre candidature est retenue, Mediumia vous contactera pour préparer votre fiche et, selon votre situation, vous présenter votre formule d'adhésion.
              </p>
            </div>
            <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
              ← Retour à Mediumia
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">✦ MEDIUMIA</button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">← Retour</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-16 pb-24">

        <div className="text-center mb-12">
          <p className="font-georgia text-gold tracking-[0.28em] text-xs uppercase mb-4">Le réseau Mediumia</p>
          <h1 className="font-georgia font-medium text-4xl md:text-5xl leading-tight mb-5">
            Rejoindre le réseau Mediumia
          </h1>
          <p className="font-georgia text-mist text-lg italic leading-relaxed mb-5 max-w-xl mx-auto">
            Présentez votre pratique. Faites-vous découvrir. Restez pleinement vous-même.
          </p>
          <p className="font-georgia text-mist leading-relaxed max-w-xl mx-auto">
            Mediumia n'est pas un annuaire automatique. Les profils sont étudiés avant publication afin de construire un réseau cohérent, humain et identifiable.
          </p>
        </div>

        <FounderBlock />

        <div className="rounded-xl border border-gold/20 bg-gold/5 px-5 py-4 mb-12 flex gap-3 items-start">
          <span className="text-gold shrink-0 mt-0.5">◌</span>
          <p className="font-georgia text-xs text-mist leading-relaxed">
            Aucun paiement n'est demandé lors de votre candidature. Si votre profil est retenu, les conditions d'adhésion et la formule choisie vous seront présentées avant tout engagement.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          {/* Honeypot */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', tabIndex: -1 }}>
            <label htmlFor="__hp_field">Ne pas remplir</label>
            <input id="__hp_field" type="text" name="_hp" autoComplete="off" tabIndex={-1}
              value={form._hp} onChange={e => set('_hp', e.target.value)} />
          </div>

          {/* 01 — Identité professionnelle */}
          <section className="mb-14">
            <SectionHeading num="01" title="Identité professionnelle" />
            <div className="grid md:grid-cols-2 gap-6">

              <FormField label="Prénom" required error={errors.prenom}>
                <input type="text" value={form.prenom} onChange={e => set('prenom', e.target.value)}
                  className={inputCls} placeholder="Marie" maxLength={100}
                  {...(errors.prenom ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="Nom" required error={errors.nom}>
                <input type="text" value={form.nom} onChange={e => set('nom', e.target.value)}
                  className={inputCls} placeholder="Dupont" maxLength={100}
                  {...(errors.nom ? { 'data-field-error': true } : {})} />
              </FormField>

              <div className="md:col-span-2">
                <FormField label="Nom professionnel / enseigne">
                  <input type="text" value={form.nom_pro} onChange={e => set('nom_pro', e.target.value)}
                    className={inputCls} placeholder="Si différent de votre nom civil" maxLength={100} />
                </FormField>
              </div>

              <div className="md:col-span-2">
                <FormField label="Email professionnel" required error={errors.email}>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    className={inputCls} placeholder="vous@exemple.fr" maxLength={254}
                    {...(errors.email ? { 'data-field-error': true } : {})} />
                </FormField>
              </div>

              <FormField label="Téléphone">
                <input type="tel" value={form.telephone} onChange={e => set('telephone', e.target.value)}
                  className={inputCls} placeholder="Facultatif" maxLength={30} />
              </FormField>

              <FormField label="Ville" required error={errors.ville}>
                <input type="text" value={form.ville} onChange={e => set('ville', e.target.value)}
                  className={inputCls} placeholder="Paris" maxLength={100}
                  {...(errors.ville ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="Département" required error={errors.departement}>
                <input type="text" value={form.departement} onChange={e => set('departement', e.target.value)}
                  className={inputCls} placeholder="75" maxLength={10}
                  {...(errors.departement ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="Consultations à distance" required error={errors.distance}>
                <div className="flex gap-3">
                  {['Oui', 'Non'].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set('distance', v)}
                      className={`font-georgia text-sm px-6 py-3 rounded-xl border-2 flex-1 transition-all ${form.distance === v ? 'border-gold bg-gold/10 text-deep font-bold' : 'border-gold/25 text-mist hover:border-gold/50'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Site internet" error={errors.site}>
                <input type="url" value={form.site} onChange={e => set('site', e.target.value)}
                  className={inputCls} placeholder="https://..." maxLength={500} />
              </FormField>

              <FormField label="Réseau social principal">
                <input type="text" value={form.social} onChange={e => set('social', e.target.value)}
                  className={inputCls} placeholder="@votre_compte ou URL" maxLength={500} />
              </FormField>

              <div className="md:col-span-2">
                <FormField label="Activité principale" required error={errors.activite}>
                  <input type="text" value={form.activite} onChange={e => set('activite', e.target.value)}
                    className={inputCls} placeholder="Ex : Médiumnité, EFT, Réflexologie, Naturopathie…" maxLength={200}
                    {...(errors.activite ? { 'data-field-error': true } : {})} />
                </FormField>
              </div>

              <div className="md:col-span-2">
                <FormField label="Spécialités / disciplines" required error={errors.specialites}>
                  <textarea rows={3} value={form.specialites} onChange={e => set('specialites', e.target.value)}
                    className={inputCls} placeholder="Précisez vos disciplines, méthodes ou spécificités…" maxLength={2000}
                    {...(errors.specialites ? { 'data-field-error': true } : {})} />
                </FormField>
              </div>

              <FormField label="Années de pratique" required error={errors.annees}>
                <input type="text" value={form.annees} onChange={e => set('annees', e.target.value)}
                  className={inputCls} placeholder="Ex : 8 ans" maxLength={50}
                  {...(errors.annees ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="SIRET">
                <input type="text" value={form.siret} onChange={e => set('siret', e.target.value)}
                  className={inputCls} placeholder="Facultatif à ce stade" maxLength={30} />
              </FormField>

            </div>
          </section>

          {/* 02 — Présentation */}
          <section className="mb-14">
            <SectionHeading num="02" title="Présentation" />
            <div className="space-y-6">

              <FormField label="Présentez votre pratique en quelques lignes" required error={errors.pratique}>
                <textarea rows={4} value={form.pratique} onChange={e => set('pratique', e.target.value)}
                  className={inputCls} placeholder="Décrivez ce que vous faites, votre univers, votre approche générale…" maxLength={5000}
                  {...(errors.pratique ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="Quelle est votre approche de l'accompagnement ?" required error={errors.approche}>
                <textarea rows={4} value={form.approche} onChange={e => set('approche', e.target.value)}
                  className={`${inputCls} resize-none`} placeholder="Comment travaillez-vous avec vos consultants ? Qu'est-ce qui vous différencie ?" maxLength={5000}
                  {...(errors.approche ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="À qui vous adressez-vous principalement ?" required error={errors.audience}>
                <textarea rows={3} value={form.audience} onChange={e => set('audience', e.target.value)}
                  className={`${inputCls} resize-none`} placeholder="Décrivez vos consultants idéaux, leur situation, leurs besoins…" maxLength={3000}
                  {...(errors.audience ? { 'data-field-error': true } : {})} />
              </FormField>

              <FormField label="Pourquoi souhaitez-vous rejoindre Mediumia ?" required error={errors.pourquoi}>
                <textarea rows={4} value={form.pourquoi} onChange={e => set('pourquoi', e.target.value)}
                  className={`${inputCls} resize-none`} placeholder="Ce qui vous a attiré vers Mediumia, ce que vous espérez de cette présence…" maxLength={5000}
                  {...(errors.pourquoi ? { 'data-field-error': true } : {})} />
              </FormField>

            </div>
          </section>

          {/* Photo notice */}
          <div className="rounded-xl border border-gold/20 bg-gold/5 px-5 py-4 mb-10 flex gap-3 items-start">
            <span className="text-gold shrink-0 mt-0.5">◌</span>
            <p className="font-georgia text-xs text-mist leading-relaxed">
              Une photographie professionnelle vous sera demandée si votre candidature est retenue.
            </p>
          </div>

          {/* 03 — Consentements */}
          <section className="mb-10 space-y-5">
            <SectionHeading num="03" title="Consentements" />

            <div>
              <label className="flex gap-4 items-start cursor-pointer group">
                <div className="shrink-0 mt-0.5">
                  <input type="checkbox" checked={form.consent_exactitude} onChange={e => set('consent_exactitude', e.target.checked)} className="sr-only" />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${form.consent_exactitude ? 'bg-gold border-gold' : 'border-gold/40 group-hover:border-gold/70'}`}>
                    {form.consent_exactitude && <span className="text-deep text-[11px] font-bold leading-none">✓</span>}
                  </div>
                </div>
                <p className="font-georgia text-sm text-mist leading-relaxed">
                  Je certifie que les informations transmises sont exactes et je comprends que l'envoi de cette candidature ne garantit pas mon admission au sein de Mediumia Réseau.
                </p>
              </label>
              {errors.consent_exactitude && <p className="font-georgia text-xs text-red-500 mt-2 ml-9">{errors.consent_exactitude}</p>}
            </div>

            <div>
              <label className="flex gap-4 items-start cursor-pointer group">
                <div className="shrink-0 mt-0.5">
                  <input type="checkbox" checked={form.consent_traitement} onChange={e => set('consent_traitement', e.target.checked)} className="sr-only" />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${form.consent_traitement ? 'bg-gold border-gold' : 'border-gold/40 group-hover:border-gold/70'}`}>
                    {form.consent_traitement && <span className="text-deep text-[11px] font-bold leading-none">✓</span>}
                  </div>
                </div>
                <p className="font-georgia text-sm text-mist leading-relaxed">
                  J'autorise Mediumia à utiliser les informations transmises afin d'étudier ma candidature et, uniquement si celle-ci est acceptée, à préparer ma fiche professionnelle avant validation définitive avec moi.
                </p>
              </label>
              {errors.consent_traitement && <p className="font-georgia text-xs text-red-500 mt-2 ml-9">{errors.consent_traitement}</p>}
            </div>
          </section>

          {/* Erreur serveur */}
          {serverError && (
            <div className="rounded-xl border border-red-400/30 bg-red-50 px-5 py-4 mb-6">
              <p className="font-georgia text-sm text-deep leading-relaxed">{serverError}</p>
            </div>
          )}

          {/* Submit */}
          <div>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full font-georgia py-4 px-8 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'sending' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-gold/40 border-t-gold rounded-full animate-spin" />
                  Envoi de votre candidature…
                </span>
              ) : 'Envoyer ma candidature →'}
            </button>
            <p className="font-georgia text-xs text-mist text-center mt-4 italic leading-relaxed">
              Vos données sont transmises de manière sécurisée et utilisées uniquement dans le cadre de l'étude de votre candidature.
            </p>
          </div>

        </form>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
