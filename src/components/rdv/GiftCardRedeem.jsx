import { useState } from 'react'

const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`

// "Vous avez une carte cadeau ?" at the booking payment step: checks the code,
// shows what it covers, then books through /api/rdv-book without PayPal.
export default function GiftCardRedeem({ practitionerSlug, service, dateStr, time, customer, selectedModality, consentsReady, depositCents, priceCents, onComplete, onUnavailable }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [card, setCard] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const appliedCents = card ? Math.min(card.balanceCents, priceCents) : 0
  const remainingCents = Math.max(0, priceCents - appliedCents)
  const coversDeposit = card && appliedCents >= depositCents

  async function check(event) {
    event.preventDefault()
    setError(''); setCard(null); setBusy(true)
    try {
      const res = await fetch('/api/rdv-config?giftCardAction=check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setCard(data)
      else setError({
        gift_code_expired: 'Cette carte cadeau a expiré.',
        gift_code_used: 'Cette carte cadeau a déjà été entièrement utilisée.',
        gift_code_chronosphere_only: 'Cette carte offre ChronoSphère : elle s’utilise sur la page ChronoSphère.',
        too_many_attempts: 'Trop d’essais. Réessayez dans une heure.',
      }[data.error] || 'Ce code n’est pas reconnu. Vérifiez-le (format MDIA-XXXX-XXXX).')
    } catch {
      setError('Vérification impossible pour le moment.')
    } finally {
      setBusy(false)
    }
  }

  async function book() {
    setError(''); setBusy(true)
    try {
      const res = await fetch('/api/rdv-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practitioner_slug: practitionerSlug,
          service_slug: service.slug,
          date: dateStr,
          time,
          gift_code: code,
          customer: { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone || null, message: customer.message || null },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && !data.code) onUnavailable?.()
        setError(data.error || 'La réservation n’a pas abouti. Réessayez.')
        return
      }
      onComplete?.({
        status: 'COMPLETED',
        bookingId: data.booking_id,
        amountCents: data.gift_applied_cents,
        servicePriceCents: data.service_price_cents,
        balanceCents: data.balance_due_cents,
        paidWithGift: true,
      })
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-2xl border border-dashed border-gold/40 bg-white/60 px-5 py-4 text-left font-georgia text-sm text-deep hover:bg-gold/5">
        🎁 Vous avez une carte cadeau ? <span className="text-gold underline">Utiliser mon code</span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-gold/30 bg-white/70 p-5 space-y-3">
      <p className="font-georgia text-[11px] uppercase tracking-[.18em] text-gold">Carte cadeau</p>
      <form onSubmit={check} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="gift-code" className="sr-only">Code de la carte cadeau</label>
        <input id="gift-code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCard(null) }} placeholder="MDIA-XXXX-XXXX" autoComplete="off" className="flex-1 rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm tracking-widest text-deep" />
        <button type="submit" disabled={busy || code.replace(/[^0-9A-Z]/gi, '').length < 12} className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-40">Vérifier</button>
      </form>
      {card && (
        <div className="rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 font-georgia text-sm text-deep" role="status">
          <p><strong>{card.label}</strong> · solde {money(card.balanceCents)}</p>
          <p className="mt-1 text-mist">Votre carte règle {money(appliedCents)}{remainingCents > 0 ? `. Il restera ${money(remainingCents)} à régler${selectedModality === 'in-person' ? ' sur place, par carte bancaire, espèces ou chèque' : ' en ligne avant le rendez-vous'}.` : ' : la séance est entièrement réglée.'}</p>
          {!coversDeposit && <p className="mt-1 text-red-700">Le solde ne couvre pas les arrhes ({money(depositCents)}) : utilisez le paiement en ligne ci-dessous.</p>}
        </div>
      )}
      {card && coversDeposit && (
        consentsReady
          ? <button type="button" onClick={book} disabled={busy} className="w-full rounded-xl bg-gold px-5 py-3 font-georgia text-sm font-bold text-deep disabled:opacity-50">{busy ? 'Réservation…' : 'Réserver avec ma carte cadeau'}</button>
          : <p className="font-georgia text-xs text-mist">Cochez les deux cases ci-dessus pour réserver avec votre carte.</p>
      )}
      {error && <p role="alert" className="font-georgia text-xs text-red-700">{error}</p>}
    </div>
  )
}
