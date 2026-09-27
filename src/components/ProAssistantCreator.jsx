import { useState } from 'react'
import { ASSISTANT_QUESTIONS } from '../lib/proAssistantDraft.js'

// Création ou réglage de l'assistant, guidé par Lumi : une question par écran,
// puis un récapitulatif. Les réponses sont pré-remplies depuis la fiche Réseau
// et le praticien les relit toutes avant d'enregistrer.

const ERROR_LABELS = {
  name_required: 'Donnez un nom à votre assistant (2 caractères minimum).',
  mission_required: 'Décrivez sa mission en une phrase au moins.',
  pro_access_required: 'Votre accès pro n’est pas actif.',
  reseau_profile_already_has_assistant: 'Cette fiche du Réseau a déjà un assistant.',
}

export default function ProAssistantCreator({ initial, mode = 'create', saving, error, onSave, onCancel }) {
  const [values, setValues] = useState(initial)
  const [step, setStep] = useState(mode === 'edit' ? ASSISTANT_QUESTIONS.length : 0)
  const total = ASSISTANT_QUESTIONS.length
  const onRecap = step >= total
  const current = ASSISTANT_QUESTIONS[step]
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }))

  const input = 'w-full rounded-2xl border border-gold/30 bg-white px-4 py-3 font-georgia text-base leading-relaxed text-deep outline-none focus:border-gold/70'

  if (onRecap) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-gold/30 bg-white/80 p-6 shadow-sm md:p-9" aria-labelledby="assistant-recap-title">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">{mode === 'edit' ? 'Réglages de votre assistant' : 'Dernière relecture'}</p>
        <h1 id="assistant-recap-title" className="mt-2 font-georgia text-2xl font-medium text-deep md:text-3xl">{values.name || 'Votre assistant'}</h1>
        <p className="mt-2 font-georgia text-sm text-mist">Relisez chaque réponse. Votre assistant ne répondra qu’à partir de ces informations et des documents que vous validerez.</p>
        <dl className="mt-6 space-y-4">
          {ASSISTANT_QUESTIONS.map((q, i) => (
            <div key={q.key} className="rounded-2xl border border-gold/20 bg-cream/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <dt className="font-georgia text-[11px] uppercase tracking-[0.14em] text-gold">{q.label}</dt>
                <button type="button" onClick={() => setStep(i)} className="shrink-0 font-georgia text-xs font-semibold text-deep underline decoration-gold/50 underline-offset-4">Modifier</button>
              </div>
              <dd className="mt-1.5 whitespace-pre-line font-georgia text-sm leading-relaxed text-deep">{values[q.key] || <span className="italic text-mist">Non renseigné</span>}</dd>
            </div>
          ))}
        </dl>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">{ERROR_LABELS[error] || 'L’enregistrement a échoué. Réessayez dans un instant.'}</p>}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {onCancel && <button type="button" onClick={onCancel} className="rounded-xl border border-gold/40 px-5 py-3 font-georgia text-sm font-semibold text-deep">Annuler</button>}
          <button type="button" disabled={saving} onClick={() => onSave(values)} className="rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-60">
            {saving ? 'Enregistrement…' : mode === 'edit' ? 'Enregistrer les réglages' : 'Créer mon assistant'}
          </button>
        </div>
      </section>
    )
  }

  const value = values[current.key] || ''
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-gold/30 bg-white/80 p-6 shadow-sm md:p-9" aria-labelledby="lumi-question">
      <div className="flex items-center justify-between gap-3">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Lumi · question {step + 1} sur {total}</p>
        <p className="font-georgia text-xs text-mist tabular-nums">{value.length} / {current.max}</p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-deep/[.06]">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
      </div>
      <h1 id="lumi-question" className="mt-6 font-georgia text-2xl font-medium leading-snug text-deep">{current.question}</h1>
      <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">{current.help}</p>
      <label className="sr-only" htmlFor={`assistant-${current.key}`}>{current.label}</label>
      {current.rows === 1 ? (
        <input id={`assistant-${current.key}`} value={value} maxLength={current.max} onChange={(e) => set(current.key, e.target.value)} className={`mt-5 ${input}`} />
      ) : (
        <textarea id={`assistant-${current.key}`} value={value} rows={current.rows} maxLength={current.max} onChange={(e) => set(current.key, e.target.value)} className={`mt-5 ${input}`} />
      )}
      <p className="mt-2 font-georgia text-xs text-mist">Pré-rempli depuis votre fiche du Réseau : relisez et ajustez librement.</p>
      <div className="mt-7 flex items-center justify-between gap-3">
        <button type="button" onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))} className="font-georgia text-sm text-mist hover:text-deep" disabled={step === 0 && !onCancel}>
          {step === 0 ? (onCancel ? '← Annuler' : '') : '← Précédent'}
        </button>
        <button type="button" onClick={() => setStep(step + 1)} className="rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">
          {step === total - 1 ? 'Relire mes réponses →' : 'Suivant →'}
        </button>
      </div>
    </section>
  )
}
