import { useState } from 'react'

const FORM_INIT = {
  prenom: '', nom: '', nom_pro: '', email: '', telephone: '',
  ville: '', departement: '', distance: '', site: '', instagram: '',
  activite: '', specialites: '', annees: '', siret: '',
  pratique: '', approche: '', audience: '', pourquoi: '',
  certifie: false,
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

export default function ReseauJoindre({ onBack }) {
  const [form, setForm] = useState(FORM_INIT)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const e = {}
    if (!form.prenom.trim()) e.prenom = 'Requis'
    if (!form.nom.trim()) e.nom = 'Requis'
    if (!form.email.trim()) e.email = 'Requis'
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
    if (!form.certifie) e.certifie = 'Requis pour continuer'
    return e
  }

  function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSubmitted(true)
    window.scrollTo(0, 0)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20 px-6 py-4">
          <button onClick={onBack} className="font-georgia text-sm text-deep font-semibold">✦ MEDIUMIA</button>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 py-24 text-center">
          <div className="max-w-lg">
            <p className="text-gold text-5xl mb-6">✦</p>
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-4">Demande enregistrée</p>
            <h1 className="font-georgia font-medium text-3xl text-deep mb-6">Votre demande a bien été reçue.</h1>
            <div className="rounded-2xl border border-gold/30 bg-gold/5 px-8 py-6 mb-8">
              <p className="font-georgia text-sm text-mist leading-relaxed italic">
                Version Preview — les demandes ne sont pas encore transmises à l'équipe MediumIA. Le stockage serveur sera activé avant la mise en ligne officielle.
              </p>
            </div>
            <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
              ← Retour à MediumIA
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

        {/* Hero */}
        <div className="text-center mb-12">
          <p className="font-georgia text-gold tracking-[0.28em] text-xs uppercase mb-4">LE RÉSEAU MEDIUMIA</p>
          <h1 className="font-georgia font-medium text-4xl md:text-5xl leading-tight mb-5">
            Rejoindre le réseau MediumIA
          </h1>
          <p className="font-georgia text-mist text-lg italic leading-relaxed mb-5 max-w-xl mx-auto">
            Présentez votre pratique. Faites-vous découvrir. Restez pleinement vous-même.
          </p>
          <p className="font-georgia text-mist leading-relaxed max-w-xl mx-auto">
            MediumIA n'est pas un annuaire automatique. Les profils sont étudiés avant publication afin de construire un réseau cohérent, humain et identifiable.
          </p>
        </div>

        {/* Candidatures fondatrices */}
        <div
          className="rounded-2xl border-2 border-gold/40 px-8 py-8 text-center mb-10"
          style={{ background: 'linear-gradient(135deg,rgba(201,168,76,.08),rgba(201,168,76,.03))' }}
        >
          <p className="text-gold text-2xl mb-3">◈</p>
          <p className="font-georgia text-gold tracking-[0.2em] text-xs uppercase mb-3">Candidatures fondatrices</p>
          <p className="font-georgia text-deep leading-relaxed max-w-md mx-auto">
            Les premiers praticiens sélectionnés participeront à la naissance du réseau MediumIA et pourront être identifiés comme membres fondateurs.
          </p>
        </div>

        {/* Notice Preview */}
        <div className="rounded-xl border border-gold/20 bg-gold/5 px-5 py-4 mb-12 flex gap-3 items-start">
          <span className="text-gold shrink-0 mt-0.5">◌</span>
          <p className="font-georgia text-xs text-mist leading-relaxed italic">
            Version Preview — ce formulaire est complet, mais les demandes ne seront transmises à l'équipe MediumIA qu'après l'activation du stockage serveur, avant la mise en ligne officielle.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          {/* 01 — Informations */}
          <section className="mb-14">
            <SectionHeading num="01" title="Informations" />
            <div className="grid md:grid-cols-2 gap-6">

              <FormField label="Prénom" required error={errors.prenom}>
                <input type="text" value={form.prenom} onChange={e => set('prenom', e.target.value)} className={inputCls} placeholder="Marie" />
              </FormField>

              <FormField label="Nom" required error={errors.nom}>
                <input type="text" value={form.nom} onChange={e => set('nom', e.target.value)} className={inputCls} placeholder="Dupont" />
              </FormField>

              <div className="md:col-span-2">
                <FormField label="Nom professionnel / enseigne">
                  <input type="text" value={form.nom_pro} onChange={e => set('nom_pro', e.target.value)} className={inputCls} placeholder="Si différent de votre nom civil" />
                </FormField>
              </div>

              <div className="md:col-span-2">
                <FormField label="Email professionnel" required error={errors.email}>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="vous@exemple.fr" />
                </FormField>
              </div>

              <FormField label="Téléphone">
                <input type="tel" value={form.telephone} onChange={e => set('telephone', e.target.value)} className={inputCls} placeholder="Facultatif" />
              </FormField>

              <FormField label="Ville" required error={errors.ville}>
                <input type="text" value={form.ville} onChange={e => set('ville', e.target.value)} className={inputCls} placeholder="Paris" />
              </FormField>

              <FormField label="Département" required error={errors.departement}>
                <input type="text" value={form.departement} onChange={e => set('departement', e.target.value)} className={inputCls} placeholder="75" />
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

              <FormField label="Site internet">
                <input type="url" value={form.site} onChange={e => set('site', e.target.value)} className={inputCls} placeholder="https://..." />
              </FormField>

              <FormField label="Instagram / réseau principal">
                <input type="text" value={form.instagram} onChange={e => set('instagram', e.target.value)} className={inputCls} placeholder="@votre_compte" />
              </FormField>

              <div className="md:col-span-2">
                <FormField label="Activité principale" required error={errors.activite}>
                  <input type="text" value={form.activite} onChange={e => set('activite', e.target.value)} className={inputCls} placeholder="Ex : Médiumnité, EFT, Réflexologie, Naturopathie…" />
                </FormField>
              </div>

              <div className="md:col-span-2">
                <FormField label="Spécialités / disciplines" required error={errors.specialites}>
                  <textarea rows={3} value={form.specialites} onChange={e => set('specialites', e.target.value)} className={inputCls} placeholder="Précisez vos disciplines, méthodes ou spécificités…" />
                </FormField>
              </div>

              <FormField label="Années de pratique" required error={errors.annees}>
                <input type="text" value={form.annees} onChange={e => set('annees', e.target.value)} className={inputCls} placeholder="Ex : 8 ans" />
              </FormField>

              <FormField label="SIRET">
                <input type="text" value={form.siret} onChange={e => set('siret', e.target.value)} className={inputCls} placeholder="Facultatif à ce stade" />
              </FormField>

            </div>
          </section>

          {/* 02 — Présentation */}
          <section className="mb-14">
            <SectionHeading num="02" title="Présentation" />
            <div className="space-y-6">

              <FormField label="Présentez votre pratique en quelques lignes" required error={errors.pratique}>
                <textarea rows={4} value={form.pratique} onChange={e => set('pratique', e.target.value)} className={inputCls} placeholder="Décrivez ce que vous faites, votre univers, votre approche générale…" />
              </FormField>

              <FormField label="Quelle est votre approche de l'accompagnement ?" required error={errors.approche}>
                <textarea rows={4} value={form.approche} onChange={e => set('approche', e.target.value)} className={`${inputCls} resize-none`} placeholder="Comment travaillez-vous avec vos consultants ? Qu'est-ce qui vous différencie ?" />
              </FormField>

              <FormField label="À qui vous adressez-vous principalement ?" required error={errors.audience}>
                <textarea rows={3} value={form.audience} onChange={e => set('audience', e.target.value)} className={`${inputCls} resize-none`} placeholder="Décrivez vos consultants idéaux, leur situation, leurs besoins…" />
              </FormField>

              <FormField label="Pourquoi souhaitez-vous rejoindre MediumIA ?" required error={errors.pourquoi}>
                <textarea rows={4} value={form.pourquoi} onChange={e => set('pourquoi', e.target.value)} className={`${inputCls} resize-none`} placeholder="Ce qui vous a attiré vers MediumIA, ce que vous espérez de cette présence…" />
              </FormField>

            </div>
          </section>

          {/* Consentement */}
          <section className="mb-10">
            <label className="flex gap-4 items-start cursor-pointer group">
              <div className="shrink-0 mt-0.5">
                <input type="checkbox" checked={form.certifie} onChange={e => set('certifie', e.target.checked)} className="sr-only" />
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${form.certifie ? 'bg-gold border-gold' : 'border-gold/40 group-hover:border-gold/70'}`}>
                  {form.certifie && <span className="text-deep text-[11px] font-bold leading-none">✓</span>}
                </div>
              </div>
              <p className="font-georgia text-sm text-mist leading-relaxed">
                Je certifie que les informations transmises sont exactes. Je comprends que l'envoi de ce formulaire ne garantit pas ma publication sur MediumIA et que ma candidature sera examinée avant toute décision.
              </p>
            </label>
            {errors.certifie && <p className="font-georgia text-xs text-red-500 mt-2 ml-9">{errors.certifie}</p>}
          </section>

          {/* Submit */}
          <div>
            <button
              type="submit"
              className="w-full font-georgia py-4 px-8 rounded-xl bg-deep text-gold font-bold text-base hover:bg-deep/90 transition-colors"
            >
              Envoyer ma demande d'inscription →
            </button>
            <p className="font-georgia text-xs text-mist text-center mt-4 italic leading-relaxed">
              En version Preview, les données ne sont pas transmises à l'équipe. Elles seront enregistrées lors de la mise en ligne officielle.
            </p>
          </div>

        </form>
      </main>

      <footer className="border-t border-gold/20 px-6 py-8 text-center">
        <img src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png" alt="MediumIA" className="w-32 md:w-40 mx-auto mb-4" />
        <p className="font-georgia text-mist text-xs">Réseau MediumIA · Praticiens du spirituel et du bien-être</p>
      </footer>
    </div>
  )
}
