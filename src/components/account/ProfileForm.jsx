import { useEffect, useState } from 'react'
import { fetchAccountProfile, profileErrorMessage, saveAccountProfile } from '../../lib/accountProfile.js'
import { ACCOUNT_PATH, emailCodeErrorMessage } from '../../lib/accountView.js'
import { PasswordSection } from './PasswordForms.jsx'

// Mon profil : coordonnées préremplies lors des prochaines réservations,
// et changement de l'adresse e-mail de connexion.

const input = 'w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/70'
const label = 'mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist'
const primary = 'w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50'
const CHANNELS = [['', 'Pas de préférence'], ['whatsapp', 'WhatsApp'], ['facetime', 'FaceTime']]

function Coordinates({ token }) {
  const [form, setForm] = useState(null)
  const [suggested, setSuggested] = useState(false)
  const [state, setState] = useState({ busy: false, message: '', error: '' })

  useEffect(() => {
    let active = true
    fetchAccountProfile(token).then((data) => {
      if (!active) return
      const profile = data?.profile || {}
      setSuggested(Boolean(data?.profile) && !profile.saved && Boolean(profile.firstName || profile.lastName || profile.phone))
      setForm({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        phone: profile.phone || '',
        preferredVideoChannel: profile.preferredVideoChannel || '',
      })
      if (!data) setState({ busy: false, message: '', error: 'Votre profil n’a pas pu être chargé. Vous pouvez tout de même le compléter.' })
    })
    return () => { active = false }
  }, [token])

  if (!form) return <p className="mt-4 font-georgia text-sm text-mist" role="status">Chargement…</p>
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))

  async function submit(event) {
    event.preventDefault()
    setState({ busy: true, message: '', error: '' })
    const result = await saveAccountProfile(token, form)
    if (result.error) { setState({ busy: false, message: '', error: profileErrorMessage(result.error) }); return }
    setSuggested(false)
    setForm({
      firstName: result.profile.firstName || '',
      lastName: result.profile.lastName || '',
      phone: result.profile.phone || '',
      preferredVideoChannel: result.profile.preferredVideoChannel || '',
    })
    setState({ busy: false, message: 'Vos coordonnées sont enregistrées.', error: '' })
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4 rounded-2xl border border-gold/30 bg-white/70 p-5">
      {suggested && (
        <p className="rounded-xl bg-gold/[.08] px-4 py-3 font-georgia text-sm leading-relaxed text-deep">
          Nous avons repris les coordonnées de votre dernier rendez-vous. Vérifiez-les puis enregistrez.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-first-name" className={label}>Prénom</label>
          <input id="profile-first-name" type="text" autoComplete="given-name" maxLength={80} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="profile-last-name" className={label}>Nom</label>
          <input id="profile-last-name" type="text" autoComplete="family-name" maxLength={80} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="profile-phone" className={label}>Téléphone</label>
        <input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={input} placeholder="06 12 34 56 78" />
        <p className="mt-1 font-georgia text-[11px] text-mist/80">Pour un numéro étranger, commencez par l’indicatif (ex. +32…).</p>
      </div>
      <div>
        <label htmlFor="profile-channel" className={label}>Consultation à distance : votre préférence</label>
        <select id="profile-channel" value={form.preferredVideoChannel} onChange={(e) => set('preferredVideoChannel', e.target.value)} className={input}>
          {CHANNELS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
        </select>
      </div>
      {state.error && <p role="alert" className="font-georgia text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="font-georgia text-sm text-deep">{state.message}</p>}
      <button type="submit" disabled={state.busy} className={primary}>{state.busy ? 'Un instant…' : 'Enregistrer mes coordonnées'}</button>
      <p className="font-georgia text-xs leading-relaxed text-mist">Ces coordonnées préremplissent vos prochaines réservations. Elles ne modifient pas les rendez-vous déjà pris.</p>
    </form>
  )
}

function EmailChange({ email, requestEmailChange }) {
  const [next, setNext] = useState('')
  const [state, setState] = useState({ busy: false, sentTo: '', error: '' })

  async function submit(event) {
    event.preventDefault()
    const address = next.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) { setState({ busy: false, sentTo: '', error: 'Adresse e-mail à vérifier (ex. vous@exemple.fr).' }); return }
    if (address === String(email || '').toLowerCase()) { setState({ busy: false, sentTo: '', error: 'C’est déjà l’adresse de votre espace.' }); return }
    setState({ busy: true, sentTo: '', error: '' })
    const { error } = await requestEmailChange(address, { redirectTo: `${window.location.origin}${ACCOUNT_PATH}` })
    if (error) { setState({ busy: false, sentTo: '', error: emailCodeErrorMessage(error) }); return }
    setNext('')
    setState({ busy: false, sentTo: address, error: '' })
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4 rounded-2xl border border-gold/30 bg-white/70 p-5">
      <p className="font-georgia text-sm leading-relaxed text-mist">Adresse actuelle : <strong className="break-all text-deep">{email}</strong></p>
      <div>
        <label htmlFor="profile-new-email" className={label}>Nouvelle adresse e-mail</label>
        <input id="profile-new-email" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} className={input} placeholder="vous@exemple.fr" />
      </div>
      {state.error && <p role="alert" className="font-georgia text-sm text-red-700">{state.error}</p>}
      {state.sentTo && (
        <p role="status" className="rounded-xl bg-gold/[.08] px-4 py-3 font-georgia text-sm leading-relaxed text-deep">
          Un e-mail de confirmation vient d’être envoyé à <strong className="break-all">{state.sentTo}</strong>. Le changement ne sera effectif qu’après votre clic sur le lien qu’il contient.
        </p>
      )}
      <button type="submit" disabled={state.busy} className="w-full rounded-xl border-2 border-gold/45 px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/10 disabled:opacity-50">
        {state.busy ? 'Un instant…' : 'Changer mon adresse e-mail'}
      </button>
      <p className="font-georgia text-xs leading-relaxed text-mist">
        Tant que la nouvelle adresse n’est pas confirmée, rien ne change. Vos rendez-vous pris avec l’adresse actuelle restent visibles dans votre espace.
      </p>
    </form>
  )
}

export default function ProfileForm({ token, email, requestEmailChange, setPassword }) {
  return (
    <>
      <section aria-labelledby="profile-title">
        <h2 id="profile-title" className="font-georgia text-xl font-medium">Mes coordonnées</h2>
        <Coordinates token={token} />
      </section>
      <section aria-labelledby="profile-email-title" className="mt-10">
        <h2 id="profile-email-title" className="font-georgia text-xl font-medium">Mon adresse e-mail</h2>
        <EmailChange email={email} requestEmailChange={requestEmailChange} />
      </section>
      <PasswordSection setPassword={setPassword} />
    </>
  )
}
