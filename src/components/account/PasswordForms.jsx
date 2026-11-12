import { useState } from 'react'
import { passwordErrorMessage, passwordProblem, PASSWORD_MIN_LENGTH } from '../../lib/accountView.js'

// Choisir un mot de passe : depuis le profil (compte créé par code e-mail) ou
// au retour de l'e-mail « mot de passe oublié ». Le compte reste le même :
// profil et rendez-vous sont conservés.

const input = 'w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/70'
const label = 'mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist'

export function NewPasswordForm({ setPassword, onDone, submitLabel = 'Enregistrer mon mot de passe', idPrefix = 'password' }) {
  const [password, setValue] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState({ busy: false, error: '', done: false })

  async function submit(event) {
    event.preventDefault()
    const problem = passwordProblem(password, confirmation)
    if (problem) { setState({ busy: false, error: problem, done: false }); return }
    setState({ busy: true, error: '', done: false })
    const { error } = await setPassword(password)
    if (error) { setState({ busy: false, error: passwordErrorMessage(error), done: false }); return }
    setValue('')
    setConfirmation('')
    setState({ busy: false, error: '', done: true })
    onDone?.()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-new`} className={label}>Nouveau mot de passe</label>
        <input id={`${idPrefix}-new`} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setValue(e.target.value)} className={input} />
        <p className="mt-1 font-georgia text-[11px] text-mist/80">Au moins {PASSWORD_MIN_LENGTH} caractères.</p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-confirm`} className={label}>Confirmez le mot de passe</label>
        <input id={`${idPrefix}-confirm`} type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={input} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 font-georgia text-sm text-deep">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="h-4 w-4 accent-[#C9A84C]" />
        Afficher le mot de passe
      </label>
      {state.error && <p role="alert" className="font-georgia text-sm text-red-700">{state.error}</p>}
      {state.done && <p role="status" className="font-georgia text-sm text-deep">Votre mot de passe est enregistré. Vous pouvez l’utiliser dès votre prochaine connexion.</p>}
      <button type="submit" disabled={state.busy} className="w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50">
        {state.busy ? 'Un instant…' : submitLabel}
      </button>
    </form>
  )
}

export function PasswordSection({ setPassword }) {
  return (
    <section aria-labelledby="profile-password-title" className="mt-10">
      <h2 id="profile-password-title" className="font-georgia text-xl font-medium">Mon mot de passe</h2>
      <div className="mt-4 rounded-2xl border border-gold/30 bg-white/70 p-5">
        <p className="mb-4 font-georgia text-sm leading-relaxed text-mist">
          Définissez ou changez votre mot de passe pour vous connecter sans attendre de code. La connexion par code e-mail reste toujours possible. Votre profil et vos rendez-vous ne changent pas.
        </p>
        <NewPasswordForm setPassword={setPassword} idPrefix="profile-password" />
      </div>
    </section>
  )
}
