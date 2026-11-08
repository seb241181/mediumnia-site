import { useEffect, useRef, useState } from 'react'
import { issueContext, readPaymentAttempt } from '../lib/paymentAttempt.js'

// Formulaire « Signaler un problème de paiement » : sans connexion, aucun appel
// à PayPal. Joint automatiquement le parcours, l'étape et la dernière tentative.

const REASONS = [
  ['payment_failed', 'Le paiement n’a pas abouti'],
  ['charged_no_service', 'J’ai été débité mais je n’ai pas reçu le service'],
  ['double_charge', 'J’ai été débité deux fois'],
  ['page_error', 'La page affiche une erreur ou reste bloquée'],
  ['session_expired', 'Ma session a expiré pendant le paiement'],
  ['other', 'Autre problème'],
]

const JOURNEY_LABELS = {
  chronosphere: 'ChronoSphère',
  chronosphere_max: 'ChronoSphère MAX',
  rdv_deposit: 'Réservation',
  rdv_balance: 'Solde d’un rendez-vous',
  formation: 'Formation',
  parcours: 'Mensualités de la formation',
  email_question: 'Guidance par e-mail',
  gift_card: 'Carte cadeau',
  conference_pass: 'Pass conférence',
  oracle: 'Oracle',
  other: 'Autre',
}

const ERRORS = {
  invalid_email: 'Vérifiez votre adresse e-mail.',
  invalid_reason: 'Choisissez un motif.',
  too_fast: 'Prenez quelques secondes pour décrire le problème, puis réessayez.',
  rate_limited: 'Plusieurs signalements viennent d’être envoyés. Réessayez dans une heure ou écrivez à contact@mediumia.fr.',
  payload_too_large: 'Votre message est trop long.',
  reporting_unavailable: 'Le signalement est momentanément indisponible. Écrivez à contact@mediumia.fr.',
}

export default function PaymentIssueReport({ journey, onClose }) {
  const [context] = useState(() => issueContext(journey, readPaymentAttempt()))
  const [openedAt] = useState(() => Date.now())
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    dialogRef.current?.querySelector('input,select,textarea,button')?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    if (!reason) { setError(ERRORS.invalid_reason); return }
    setSending(true)
    setError(null)
    try {
      const response = await fetch('/api/rdv-config?paymentIssueAction=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, reason, comment, website,
          journey: context.journey,
          step: context.step,
          attempt_ref: context.attemptRef,
          attempt_at: context.attemptAt,
          page_path: window.location.pathname,
          elapsed_ms: Date.now() - openedAt,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(ERRORS[body.error] || ERRORS.reporting_unavailable)
      setDone(body.reference || 'reçu')
    } catch (err) {
      setError(err.message || ERRORS.reporting_unavailable)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-deep/40 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="payment-issue-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gold/30 bg-white p-5 font-georgia text-deep shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="payment-issue-title" className="text-lg font-semibold">Signaler un problème de paiement</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-mist hover:bg-gold/10" aria-label="Fermer">✕</button>
        </div>

        {done ? (
          <div className="mt-3 space-y-3 text-sm leading-relaxed" role="status">
            <p className="font-semibold text-emerald-800">Merci, votre signalement est bien enregistré{done !== 'reçu' ? ` (référence ${done})` : ''}.</p>
            <p>Sébastien le vérifie et vous répond par e-mail. Un accusé de réception vient de vous être envoyé.</p>
            <p><strong>Si votre compte a été débité, ne refaites pas de paiement.</strong> Ce signalement ne déclenche aucun débit.</p>
            <button type="button" onClick={onClose} className="mt-2 rounded-lg bg-deep px-4 py-2 text-white">Fermer</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3 text-sm" noValidate>
            <p className="text-mist">Aucune connexion nécessaire. Ce formulaire ne relance aucun paiement.</p>
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-deep">
              Parcours : <strong>{JOURNEY_LABELS[context.journey] || 'Autre'}</strong>
              {context.attemptRef && <> · Tentative : <span className="font-mono">{context.attemptRef}</span></>}
              {context.step && <> · Étape : {context.step.replace(/_/g, ' ')}</>}
            </p>
            <label className="flex flex-col gap-1" htmlFor="payment-issue-email">
              Votre adresse e-mail
              <input id="payment-issue-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-lg border border-gold/30 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1" htmlFor="payment-issue-reason">
              Que s’est-il passé ?
              <select id="payment-issue-reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-gold/30 px-3 py-2">
                <option value="">Choisir…</option>
                {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="payment-issue-comment">
              Précisions (facultatif)
              <textarea id="payment-issue-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} className="rounded-lg border border-gold/30 px-3 py-2" />
              <span className="text-xs text-mist">N’indiquez jamais de numéro de carte, de code ni de mot de passe.</span>
            </label>
            {/* Piège à robots : invisible et ignoré par les personnes. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="payment-issue-website">Site web</label>
              <input id="payment-issue-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-mist hover:bg-gold/10">Annuler</button>
              <button type="submit" disabled={sending} className="rounded-lg bg-deep px-4 py-2 text-white disabled:opacity-60">
                {sending ? 'Envoi…' : 'Envoyer le signalement'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
