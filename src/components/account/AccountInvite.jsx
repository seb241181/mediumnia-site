import { useState } from 'react'
import { useAuth } from '../../lib/useAuth.js'
import { isSupabaseConfigured } from '../../lib/supabase.js'
import { ACCOUNT_PATH, emailCodeErrorMessage } from '../../lib/accountView.js'

// Après la confirmation d'un rendez-vous : rappel de l'espace personnel.
// - déjà connecté : simple lien ;
// - a choisi « Créer mon espace » : envoi du code sur un clic, puis saisie ;
// - sinon : rappel discret. Aucun compte n'est créé sans action de la personne.

const box = 'mb-8 rounded-2xl border border-gold/30 bg-white/70 px-5 py-5 text-left'
const button = 'w-full rounded-xl bg-deep px-5 py-3.5 font-georgia text-sm font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50'

export default function AccountInvite({ email, wanted = false }) {
  const { user, sendEmailCode, verifyEmailCode } = useAuth()
  const [stage, setStage] = useState('offer') // offer | code
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const address = String(email || '').trim().toLowerCase()

  if (!isSupabaseConfigured()) return null

  if (user) {
    return (
      <div className={box}>
        <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre espace personnel MediumIA</p>
        <p className="mt-2 font-georgia text-sm leading-relaxed text-deep">
          Votre espace est ouvert. Vous y retrouvez ce rendez-vous, vos règlements et les informations pratiques.
        </p>
        <a href={ACCOUNT_PATH} className={`${button} mt-3 block text-center`}>Voir mes rendez-vous</a>
      </div>
    )
  }

  if (!wanted || !address) {
    return (
      <div className={box}>
        <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre espace personnel MediumIA</p>
        <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
          Vous pourrez retrouver ce rendez-vous, vos règlements et les informations pratiques à tout moment, sans rechercher vos e-mails. C’est gratuit : vous vous connectez avec un mot de passe ou avec un code reçu par e-mail.
        </p>
        <a href={ACCOUNT_PATH} className="mt-3 inline-block font-georgia text-sm font-bold text-deep underline decoration-gold underline-offset-4">Ouvrir ou créer mon espace MediumIA</a>
      </div>
    )
  }

  async function send() {
    setBusy(true)
    setError('')
    const { error: sendError } = await sendEmailCode(address, { createAccount: true, redirectTo: `${window.location.origin}${ACCOUNT_PATH}` })
    setBusy(false)
    if (sendError) { setError(emailCodeErrorMessage(sendError)); return }
    setStage('code')
  }

  async function verify(event) {
    event.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length < 6) { setError('Saisissez le code reçu par e-mail.'); return }
    setBusy(true)
    setError('')
    const { error: verifyError } = await verifyEmailCode(address, digits)
    setBusy(false)
    if (verifyError) setError(emailCodeErrorMessage(verifyError))
  }

  return (
    <div className={box}>
      <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre espace personnel MediumIA</p>
      {stage === 'offer' ? (
        <>
          <p className="mt-2 font-georgia text-sm leading-relaxed text-deep">
            Vous avez choisi de créer votre espace. Dernière étape : recevez un code à l’adresse <strong className="break-all">{address}</strong>. Votre rendez-vous est déjà confirmé, rien ne presse.
          </p>
          {error && <p role="alert" className="mt-2 font-georgia text-sm text-red-700">{error}</p>}
          <button type="button" disabled={busy} onClick={send} className={`${button} mt-3`}>{busy ? 'Un instant…' : 'Recevoir mon code par e-mail'}</button>
        </>
      ) : (
        <form onSubmit={verify} noValidate>
          <p className="mt-2 font-georgia text-sm leading-relaxed text-deep">
            Un code vient d’être envoyé à <strong className="break-all">{address}</strong>. Saisissez-le ici, ou cliquez plus tard sur le lien contenu dans l’e-mail.
          </p>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} aria-label="Code reçu par e-mail"
            value={code} onChange={(event) => setCode(event.target.value)}
            className="mt-3 w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 text-center font-georgia text-2xl tracking-[0.3em] text-deep outline-none focus:border-gold/70" placeholder="• • • • • •"
          />
          {error && <p role="alert" className="mt-2 font-georgia text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className={`${button} mt-3`}>{busy ? 'Un instant…' : 'Ouvrir mon espace'}</button>
          <button type="button" disabled={busy} onClick={send} className="mt-2 w-full py-2 font-georgia text-xs text-mist underline hover:text-deep">Renvoyer un code</button>
        </form>
      )}
    </div>
  )
}
