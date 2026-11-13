// Compléments du formulaire de réservation :
// - consultation à distance : WhatsApp ou FaceTime (jamais de lien de visio) ;
// - proposition, facultative, de créer son espace personnel MediumIA.
// Aucun de ces choix ne déclenche d'action avant le paiement : le créneau et
// le règlement ne sont jamais retardés.

import { MARKETING_CONSENT_HINT, MARKETING_CONSENT_TEXT } from '../../../lib/marketingConsentText.js'

const CHANNELS = [
  ['whatsapp', 'WhatsApp'],
  ['facetime', 'FaceTime'],
]

const card = (active) => `flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 font-georgia text-sm transition-colors ${active ? 'border-gold bg-gold/10 text-deep' : 'border-gold/25 bg-white text-deep hover:border-gold/60'}`

export function VideoChannelField({ value, onChange, error }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">
        Consultation à distance : par quel moyen ? <span className="text-gold">*</span>
      </legend>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Moyen de contact pour la consultation à distance">
        {CHANNELS.map(([id, text]) => (
          <label key={id} className={card(value === id)}>
            <input type="radio" name="rdv-video-channel" value={id} checked={value === id} onChange={() => onChange(id)} className="h-4 w-4 accent-[#C9A84C]" />
            <span className="font-semibold">{text}</span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 font-georgia text-[11px] leading-relaxed text-mist/80">
        Le jour de votre rendez-vous, Sébastien vous contactera directement via WhatsApp ou FaceTime, selon votre choix. Il n’y a aucun lien à ouvrir.
      </p>
      {error && <p className="mt-1 font-georgia text-xs text-red-500">{error}</p>}
    </fieldset>
  )
}

export function AccountChoice({ value, onChange }) {
  return (
    <fieldset className="rounded-2xl border border-gold/30 bg-gold/[.05] p-4">
      <legend className="px-1 font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre espace personnel MediumIA</legend>
      <p className="font-georgia text-sm leading-relaxed text-deep/85">
        Créez gratuitement votre compte pour retrouver tous vos rendez-vous, vos paiements, votre historique et les informations de vos consultations au même endroit.
        Vous n’aurez plus besoin de rechercher vos anciens e-mails et vos coordonnées pourront être préremplies lors de vos prochaines réservations.
      </p>
      <div className="mt-3 space-y-2">
        <label className={card(value === 'yes')}>
          <input type="radio" name="rdv-account-choice" value="yes" checked={value === 'yes'} onChange={() => onChange('yes')} className="h-4 w-4 shrink-0 accent-[#C9A84C]" />
          <span className="font-semibold">Créer mon espace MediumIA gratuitement</span>
        </label>
        <label className={card(value === 'no')}>
          <input type="radio" name="rdv-account-choice" value="no" checked={value === 'no'} onChange={() => onChange('no')} className="h-4 w-4 shrink-0 accent-[#C9A84C]" />
          <span>Continuer sans créer de compte</span>
        </label>
      </div>
      <p className="mt-2 font-georgia text-[11px] leading-relaxed text-mist/80">
        Facultatif : votre réservation est identique dans les deux cas. Si vous choisissez de créer votre espace, un code vous sera envoyé par e-mail après la confirmation du rendez-vous.{' '}
        <a href="/mon-espace" target="_blank" rel="noopener" className="text-gold underline">Déjà un espace ? Se connecter</a> (nouvel onglet).
      </p>
    </fieldset>
  )
}

export function SignedInNotice({ email }) {
  return (
    <p className="rounded-xl border border-gold/30 bg-gold/[.06] px-4 py-3 font-georgia text-sm leading-relaxed text-deep">
      Vous êtes connecté à votre espace MediumIA{email ? <> (<span className="break-all">{email}</span>)</> : null}. Ce rendez-vous y apparaîtra s’il est réservé avec cette adresse.
    </p>
  )
}

// Actualités par e-mail : case décochée, facultative, distincte des conditions
// de vente. Ne conditionne ni la réservation ni les e-mails de rendez-vous.
export function MarketingConsentField({ checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gold/25 bg-white px-4 py-3">
      <input type="checkbox" name="rdv-marketing-opt-in" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#C9A84C]" />
      <span className="font-georgia text-sm leading-relaxed text-deep">
        {MARKETING_CONSENT_TEXT}
        <span className="mt-1 block text-[11px] text-mist/80">{MARKETING_CONSENT_HINT}</span>
      </span>
    </label>
  )
}
