import { useEffect, useRef, useState } from 'react'

// Demande de Pass par l'inscrit : son accord explicite est requis avant tout envoi de l'offre.
function eventSlugFromPath() {
  const match = window.location.pathname.match(/^\/pass\/mediumia\/([a-z0-9-]+)\/?$/)
  return match ? match[1] : ''
}

const euros = (cents) => (Number.isInteger(cents) ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100) : '')
const longDate = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '')

const PAYPAL_INSTALMENTS_NOTICE = 'Paiement en plusieurs fois possible avec PayPal, sous réserve d’éligibilité et selon les conditions proposées lors du règlement.'

export default function ConferencePassRequest({ api }) {
  const [offer, setOffer] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${api}offer&slug=${encodeURIComponent(eventSlugFromPath())}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setOffer(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState('idle')
  const resultRef = useRef(null)

  // After the form is replaced by its receipt, bring the message into view,
  // below the sticky navigation instead of leaving it off-screen.
  useEffect(() => {
    if (status !== 'sent') return
    const result = resultRef.current
    if (!result) return
    result.scrollIntoView({ behavior: 'auto', block: 'start' })
    result.focus({ preventScroll: true })
  }, [status])

  async function submit(event) {
    event.preventDefault()
    if (!consent) { setStatus('consent'); return }
    setStatus('sending')
    try {
      const res = await fetch(`${api}request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: eventSlugFromPath(), email: email.trim(), consent: true, website }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 202) setStatus('sent')
      else setStatus(data.error === 'offer_closed' ? 'closed' : data.error === 'invalid_email' ? 'invalid' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <p ref={resultRef} role="status" tabIndex={-1} className="scroll-mt-32 rounded-xl border border-gold/30 bg-white/90 p-5 font-georgia text-sm leading-relaxed text-deep">
        Merci. Si cette adresse correspond à une inscription à la conférence, votre Pass personnel vous est envoyé dans quelques minutes. Pensez à vérifier vos courriers indésirables. Sinon, réessayez avec l’adresse utilisée pour votre inscription.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="font-georgia">
      {offer && (
        <div className="mb-6 rounded-2xl bg-deep p-5 text-cream">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold">Offre réservée aux inscrits de la conférence</p>
          <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p><span className="block text-xs text-cream/60">Prix habituel</span><span className="text-xl line-through decoration-gold/60">{euros(offer.normalAmountCents)}</span></p>
            <p><span className="block text-xs text-cream/60">Offre spéciale conférence</span><span className="text-3xl text-gold">{euros(offer.amountCents)}</span></p>
            <p className="rounded-full border border-gold/50 px-3 py-1 text-sm text-gold">Économie : {euros(offer.savingsCents)}</p>
          </div>
          <p className="mt-3 text-sm text-cream/75">Formation complète : 25 modules, PDF complet personnel et 365 jours d’accès. {PAYPAL_INSTALMENTS_NOTICE}</p>
          <p className="mt-2 text-xs text-cream/60">Tarif conférence non cumulable avec la Découverte à 29 € ni avec le parcours au mois.</p>
          {offer.requestDeadline && <p className="mt-2 text-xs text-cream/60">Demandes ouvertes jusqu’au {longDate(offer.requestDeadline)}. Chaque Pass est valable {offer.passValidityDays} jours à compter de son envoi.</p>}
        </div>
      )}
      <h2 className="text-xl text-deep">Recevoir mon Pass personnel</h2>
      <p className="mt-2 text-sm leading-relaxed text-mist">Indiquez l’adresse e-mail utilisée lors de votre inscription à la conférence. Si vous avez déjà reçu un Pass, un nouveau lien remplace l’ancien.</p>
      <label htmlFor="pass-email" className="sr-only">Adresse e-mail d’inscription</label>
      <input id="pass-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Votre e-mail d’inscription" className="mt-4 w-full rounded-xl border border-gold/30 bg-white px-4 py-3 text-sm text-deep" />
      <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
      <label className="consent-row mt-4">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="consent-check" />
        <span className="text-sm leading-relaxed text-mist">J’accepte de recevoir par e-mail mon Pass personnel et l’offre réservée aux participants de la conférence. Je peux retirer cet accord à tout moment en répondant « STOP ».</span>
      </label>
      <button type="submit" disabled={status === 'sending'} className="mt-4 w-full rounded-xl bg-deep px-5 py-3 text-sm font-bold text-gold disabled:opacity-60">{status === 'sending' ? 'Envoi…' : 'Recevoir mon Pass'}</button>
      {status === 'consent' && <p role="alert" className="mt-3 text-xs text-red-700">Cochez la case pour recevoir votre Pass par e-mail.</p>}
      {status === 'invalid' && <p role="alert" className="mt-3 text-xs text-red-700">Cette adresse e-mail n’est pas valide.</p>}
      {status === 'closed' && <p role="alert" className="mt-3 text-xs text-red-700">L’offre réservée aux participants est terminée.</p>}
      {status === 'error' && <p role="alert" className="mt-3 text-xs text-red-700">La demande n’a pas pu être envoyée. Réessayez dans un instant.</p>}
    </form>
  )
}
