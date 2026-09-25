import { useEffect, useState } from 'react'
import { consumeReturnToOffer, fetchFormationCredit, onStudentSessionChange, sendFormationLoginLink, setShownFullAmount, studentAccessToken } from '../lib/formationCredit.js'

const euros = (value) => `${String(value || '').replace('.00', '').replace('.', ',')} €`

// Au-dessus du paiement de la Formation complète : un élève qui a déjà payé la
// Découverte se connecte avec l'e-mail de cet achat et voit 568 € au lieu de 597 €.
export default function FormationCreditNotice() {
  const [state, setState] = useState({ status: 'loading' })
  const [email, setEmail] = useState('')
  const [login, setLogin] = useState('')

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const token = await studentAccessToken()
      if (cancelled) return
      if (!token) {
        setShownFullAmount(null)
        setState({ status: 'anonymous' })
        return
      }
      try {
        const credit = await fetchFormationCredit(token)
        if (cancelled) return
        setShownFullAmount(credit.displayAmount)
        setState({ status: credit.credited ? 'credited' : 'none', credit })
        // Back from the login link: bring the buyer to the offer and its price.
        if (consumeReturnToOffer()) document.getElementById('offre')?.scrollIntoView({ behavior: 'smooth' })
      } catch (error) {
        if (cancelled) return
        setShownFullAmount(null)
        setState({ status: error.message === 'session_expired' ? 'anonymous' : error.message === 'parcours_in_progress' ? 'parcours' : 'unavailable' })
      }
    }
    refresh()
    const stop = onStudentSessionChange(refresh)
    return () => { cancelled = true; stop() }
  }, [])

  async function submit(event) {
    event.preventDefault()
    setLogin('sending')
    try {
      await sendFormationLoginLink(email)
      setLogin('sent')
    } catch {
      setLogin('error')
    }
  }

  if (state.status === 'loading') return null

  if (state.status === 'credited') {
    return (
      <p role="status" className="mb-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-center font-georgia text-sm leading-relaxed text-deep">
        Votre Découverte est reconnue : vos 29 € sont déduits.<br />
        <strong>Vous réglez {euros(state.credit.displayAmount)}</strong> au lieu de 597 €.
      </p>
    )
  }

  if (state.status === 'parcours') {
    return (
      <p role="status" className="mb-6 rounded-xl border border-gold/40 bg-white/80 px-4 py-3 text-center font-georgia text-sm leading-relaxed text-deep">
        Vous suivez déjà le parcours au mois : terminez-le depuis <a href="/formation/parcours" className="text-gold underline">Mon parcours</a> pour la suite de votre formation.
      </p>
    )
  }

  if (state.status === 'unavailable') {
    return <p role="status" className="mb-6 text-center font-georgia text-xs text-mist">La vérification de votre Découverte est momentanément indisponible. Rechargez la page dans quelques instants avant de payer.</p>
  }

  if (state.status === 'none') return null

  if (login === 'sent') {
    return <p role="status" className="mb-6 rounded-xl border border-gold/30 bg-white/80 px-4 py-3 text-center font-georgia text-sm text-deep">Un lien de connexion vient d’être envoyé à {email}. Ouvrez-le sur cet appareil : vous reviendrez ici avec le prix déduit.</p>
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-gold/25 bg-white/70 px-4 py-4 text-left">
      <p className="font-georgia text-sm text-deep">Vous avez déjà la Découverte ? Connectez-vous avec l’e-mail de cet achat : vos 29 € sont déduits (568 €).</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="formation-credit-email" className="sr-only">Adresse e-mail de votre achat Découverte</label>
        <input id="formation-credit-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail de votre achat Découverte" className="min-w-0 flex-1 rounded-lg border border-gold/30 bg-white px-3 py-2 font-georgia text-sm text-deep" />
        <button type="submit" disabled={login === 'sending'} className="rounded-lg bg-deep px-4 py-2 font-georgia text-sm font-bold text-gold disabled:opacity-50">Recevoir mon lien</button>
      </div>
      {login === 'error' && <p role="alert" className="mt-2 font-georgia text-xs text-red-700">Aucun compte élève trouvé pour cette adresse. Utilisez l’e-mail de votre achat Découverte.</p>}
    </form>
  )
}
