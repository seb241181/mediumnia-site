import { useEffect, useMemo, useRef, useState } from 'react'

// PayPal « Paiement en 4X » (France) is offered from 30 € of purchase.
const PAY_LATER_MIN_CENTS = 3000

function money(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`
}

function paymentMessage(code) {
  const messages = {
    rate_limit_exceeded: 'Trop de tentatives ont été effectuées. Réessayez un peu plus tard.',
    slot_unavailable: 'Ce créneau vient d’être réservé. Choisissez un autre horaire.',
    daily_limit_reached: 'La capacité de rendez-vous de cette journée est atteinte.',
    google_calendar_unavailable: 'Impossible de confirmer le créneau avec Google Agenda pour le moment.',
    paypal_not_configured: 'Le paiement sécurisé est momentanément indisponible.',
    paypal_auth_failed: 'Le paiement sécurisé est momentanément indisponible.',
    paypal_create_order_failed: 'PayPal n’a pas pu préparer le paiement. Réessayez.',
    paypal_create_order_in_progress: 'Le paiement est déjà en cours de préparation. Réessayez dans quelques instants.',
    paypal_capture_failed: 'La confirmation PayPal n’a pas pu être finalisée. Ne repayez pas : réessayez la confirmation.',
    paid_slot_reconciliation_required: 'Le paiement a été reçu mais le créneau nécessite une vérification. Ne repayez pas. Sébastien sera prévenu.',
    full_payment_video_only: 'Le règlement de la totalité en ligne n’est pas encore disponible pour ce rendez-vous : vous pouvez réserver avec les arrhes.',
    invalid_modality: 'Le règlement de la totalité en ligne n’est pas encore disponible pour ce rendez-vous : vous pouvez réserver avec les arrhes.',
    payment_choice_locked: 'Ce paiement a déjà été préparé. Rechargez la page pour changer de mode de règlement.',
    balance_requires_full_payment: 'À moins de 48 heures du rendez-vous, le règlement intégral est requis pour une visioconférence.',
  }
  return messages[code] || 'Le paiement ne peut pas être préparé pour le moment. Réessayez dans quelques instants.'
}

export default function RdvDepositCheckout({
  practitionerSlug,
  service,
  dateStr,
  time,
  selectedModality,
  customer,
  checkoutId,
  onComplete,
  onUnavailable,
}) {
  const containerRef = useRef(null)
  const [config, setConfig] = useState(null)
  const [notice, setNotice] = useState('')
  const [holdUntil, setHoldUntil] = useState(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [earlyPerformance, setEarlyPerformance] = useState(false)
  const [paymentChoice, setPaymentChoice] = useState('arrhes')
  const [effectiveCheckoutId, setEffectiveCheckoutId] = useState(checkoutId)

  const depositCents = Number(service?.reservationPaymentCents || service?.reservation_payment_cents || 0)
  const priceCents = Number(service?.price_cents || 0)
  // canPayInFull keeps its historical meaning (video) because it drives the H-48 rule:
  // a video appointment inside 48 h must be paid in full. Paying the whole price
  // online is now open to every modality (and makes PayPal 4X possible).
  const canPayInFull = selectedModality === 'video' && Array.isArray(service?.modality) && service.modality.includes('video')
  const fullOnlineAllowed = Array.isArray(service?.modality) && service.modality.includes(selectedModality) && priceCents > depositCents
  const appointmentAt = dateStr && time ? new Date(`${dateStr}T${time}:00`) : null
  const fullPaymentRequired = canPayInFull
    && appointmentAt
    && Number.isFinite(appointmentAt.getTime())
    && appointmentAt.getTime() <= Date.now() + 48 * 3_600_000
  const paymentCents = (paymentChoice === 'full_payment' && fullOnlineAllowed) || fullPaymentRequired ? priceCents : depositCents
  const balanceCents = Math.max(0, priceCents - paymentCents)
  const consentsReady = termsAccepted && earlyPerformance

  useEffect(() => {
    if (fullPaymentRequired && paymentChoice !== 'full_payment') setPaymentChoice('full_payment')
    else if (!fullOnlineAllowed && paymentChoice !== 'arrhes') setPaymentChoice('arrhes')
  }, [fullOnlineAllowed, fullPaymentRequired, paymentChoice])

  function choosePayment(nextChoice) {
    const normalized = fullPaymentRequired
      ? 'full_payment'
      : nextChoice === 'full_payment' && fullOnlineAllowed ? 'full_payment' : 'arrhes'
    if (normalized === paymentChoice) return
    setPaymentChoice(normalized)
    setEffectiveCheckoutId(globalThis.crypto?.randomUUID?.() || checkoutId)
    setHoldUntil(null)
    setNotice('')
  }

  const payload = useMemo(() => ({
    practitioner_slug: practitionerSlug,
    service_slug: service?.slug,
    date: dateStr,
    time,
    selected_modality: selectedModality,
    customer,
    client_checkout_id: effectiveCheckoutId,
    terms_accepted: true,
    early_performance_requested: true,
  }), [practitionerSlug, service?.slug, dateStr, time, selectedModality, customer, effectiveCheckoutId])

  useEffect(() => {
    let active = true
    fetch('/api/rdv-config?rdvDepositAction=config')
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'paypal_unavailable')
        if (active) setConfig(data)
      })
      .catch(error => {
        if (active) setNotice(paymentMessage(error.message))
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!config?.clientId || !consentsReady || !containerRef.current) return undefined
    let disposed = false
    const container = containerRef.current

    async function createOrder() {
      setNotice('')
      const action = paymentChoice === 'full_payment' ? 'createFull' : 'create'
      const response = await fetch(`/api/rdv-config?rdvDepositAction=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (['slot_unavailable', 'daily_limit_reached'].includes(result.error)) onUnavailable?.()
        throw new Error(result.error || 'paypal_create_order_failed')
      }
      if (result.status === 'converted' && result.bookingId) {
        onComplete?.({ status: 'COMPLETED', bookingId: result.bookingId, amountCents: paymentCents, servicePriceCents: priceCents, balanceCents })
        throw new Error('already_converted')
      }
      if (result.expiresAt) setHoldUntil(result.expiresAt)
      return result.id
    }

    async function pollStatus() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        const response = await fetch(`/api/rdv-config?rdvDepositAction=status&checkout_id=${encodeURIComponent(effectiveCheckoutId)}`)
        const status = await response.json().catch(() => ({}))
        if (status.bookingId) {
          onComplete?.({
            status: 'COMPLETED',
            bookingId: status.bookingId,
            amountCents: status.amountCents,
            servicePriceCents: status.servicePriceCents,
            balanceCents: status.balanceCents,
          })
          return true
        }
      }
      return false
    }

    async function mountButtons() {
      if (disposed || !window.paypal || !container) return
      container.innerHTML = ''
      try {
        const buttons = window.paypal.Buttons({
          style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
          createOrder,
          onApprove: async data => {
            setNotice('')
            const response = await fetch('/api/rdv-config?rdvDepositAction=capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderID }),
            })
            const result = await response.json().catch(() => ({}))
            if (result.status === 'COMPLETED') {
              onComplete?.(result)
              return
            }
            if (['CAPTURE_IN_PROGRESS', 'CAPTURED_PENDING_RECONCILIATION'].includes(result.status)) {
              if (await pollStatus()) return
            }
            setNotice(paymentMessage(result.error || 'paypal_capture_failed'))
          },
          onCancel: () => setNotice(paymentChoice === 'full_payment'
            ? 'Paiement annulé. Votre rendez-vous n’est pas confirmé tant que le règlement intégral n’est pas effectué.'
            : 'Paiement annulé. Votre rendez-vous n’est pas confirmé tant que les arrhes ne sont pas réglées.'),
          onError: error => {
            if (error?.message === 'already_converted') return
            setNotice(paymentMessage(error?.message || 'paypal_capture_failed'))
          },
        })
        await buttons.render(container)
      } catch (error) {
        if (!disposed && error?.message !== 'already_converted') setNotice(paymentMessage(error?.message))
      }
    }

    const existing = document.querySelector('script[data-mediumia-paypal-sdk="1"]')
    if (window.paypal) {
      void mountButtons()
      return () => { disposed = true; if (container) container.innerHTML = '' }
    }

    const script = existing || document.createElement('script')
    if (!existing) {
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
      script.async = true
      script.dataset.mediumiaPaypalSdk = '1'
      document.head.appendChild(script)
    }
    const onLoad = () => { void mountButtons() }
    const onError = () => { if (!disposed) setNotice('Le paiement sécurisé est indisponible pour le moment.') }
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    return () => {
      disposed = true
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (container) container.innerHTML = ''
    }
  }, [config, consentsReady, payload, effectiveCheckoutId, paymentChoice, paymentCents, priceCents, balanceCents, onComplete, onUnavailable])

  return (
    <div className="space-y-5">
      {fullOnlineAllowed && (
        <div className="rounded-2xl border border-gold/30 bg-white/70 p-5 space-y-3">
          <p className="font-georgia text-[11px] tracking-[.18em] uppercase text-gold">Choisissez votre règlement</p>
          {fullPaymentRequired && (
            <p className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 font-georgia text-xs leading-relaxed text-deep">
              Ce rendez-vous est prévu dans moins de 48 heures : le règlement intégral est requis pour confirmer la visioconférence.
            </p>
          )}
          <label className={`flex items-start gap-3 rounded-xl border border-gold/15 p-3 ${fullPaymentRequired ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'arrhes'} disabled={fullPaymentRequired} onChange={() => choosePayment('arrhes')} className="mt-1 h-4 w-4" />
            <span className="font-georgia text-sm leading-relaxed"><strong>Réserver avec {money(depositCents)} d’arrhes</strong><br /><span className="text-mist">Il restera {money(Math.max(0, priceCents - depositCents))} à régler{selectedModality === 'in-person' ? ' sur place, par carte bancaire, espèces ou chèque' : ''}.</span></span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gold/15 p-3">
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'full_payment'} onChange={() => choosePayment('full_payment')} className="mt-1 h-4 w-4" />
            <span className="font-georgia text-sm leading-relaxed"><strong>Régler la totalité maintenant : {money(priceCents)}</strong><br /><span className="text-mist">Votre rendez-vous sera entièrement réglé. Par carte bancaire ou PayPal, en 1 fois{priceCents >= PAY_LATER_MIN_CENTS ? ` — ou en 4 fois sans frais avec PayPal (4 × ${money(Math.ceil(priceCents / 4))} environ)` : ''}.</span></span>
          </label>
        </div>
      )}

      <div className="rounded-2xl border border-gold/30 bg-gold/5 p-5">
        <p className="font-georgia text-[11px] tracking-[.18em] uppercase text-gold mb-3">Réservation sécurisée</p>
        <div className="space-y-2 font-georgia text-sm">
          <div className="flex justify-between gap-4"><span className="text-mist">Prix de la prestation</span><strong>{money(priceCents)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-mist">À régler maintenant</span><strong className="text-deep">{money(paymentCents)}</strong></div>
          <div className="flex justify-between gap-4 border-t border-gold/15 pt-2"><span className="text-mist">Solde restant</span><strong>{money(balanceCents)}</strong></div>
        </div>
      </div>

      <div className="rounded-2xl border border-gold/20 bg-white/70 p-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gold/20 bg-gold/5 p-3">
          <input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-0.5 h-6 w-6 min-h-6 min-w-6 shrink-0 cursor-pointer accent-gold" />
          <span className="font-georgia text-sm leading-relaxed text-mist">
            {paymentChoice === 'full_payment'
              ? `J’accepte les conditions de réservation et je règle la totalité de la prestation, soit ${money(priceCents)}${priceCents >= PAY_LATER_MIN_CENTS ? ', en une fois ou en 4 fois sans frais avec PayPal' : ''}. Les conditions d’annulation et mes droits légaux restent applicables.`
              : `J’accepte les conditions de réservation : les ${money(depositCents)} versés constituent des arrhes. En cas d’annulation à moins de 48 heures, leur traitement suit les conditions acceptées et les droits légaux applicables.`}
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gold/20 bg-gold/5 p-3">
          <input type="checkbox" checked={earlyPerformance} onChange={event => setEarlyPerformance(event.target.checked)} className="mt-0.5 h-6 w-6 min-h-6 min-w-6 shrink-0 cursor-pointer accent-gold" />
          <span className="font-georgia text-sm leading-relaxed text-mist">
            Je souhaite que mon rendez-vous ait lieu à la date choisie, même si elle tombe pendant le délai légal de rétractation de 14 jours. Mes droits légaux restent applicables.
            <span className="mt-1 block text-xs text-mist/80">Pourquoi cette case ? Après une réservation en ligne, la loi vous donne 14 jours pour changer d’avis. Sans votre accord, une séance ne pourrait pas avoir lieu avant la fin de ce délai.</span>
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-gold/30 bg-white/70 p-5">
        <p className="font-georgia text-sm text-mist leading-relaxed mb-4">Votre créneau est bloqué pendant 15 minutes à partir de la création du paiement.</p>
        <div className="mb-4 rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 font-georgia text-xs leading-relaxed text-deep">
          <p className="font-semibold">Comment payer ?</p>
          <ul className="mt-1.5 space-y-1 text-mist">
            <li>• <strong className="text-deep">Pas de compte PayPal ?</strong> Payez directement par carte bancaire avec le bouton « Carte de débit ou de crédit » : aucun compte n’est nécessaire (paiement en 1 fois).</li>
            <li>• <strong className="text-deep">PayPal</strong> : en 1 fois{paymentCents >= PAY_LATER_MIN_CENTS ? ', ou en 4 fois sans frais avec le bouton « Payer en 4X » (compte PayPal requis, il peut être créé pendant le paiement)' : ''}.</li>
          </ul>
          {paymentCents < PAY_LATER_MIN_CENTS && priceCents >= PAY_LATER_MIN_CENTS && fullOnlineAllowed && (
            <p className="mt-1.5 text-mist">Le paiement en 4 fois est proposé par PayPal à partir de 30 € : choisissez « Régler la totalité » pour en profiter.</p>
          )}
          {priceCents >= PAY_LATER_MIN_CENTS && fullOnlineAllowed && (
            <p className="mt-2 text-[10px] text-mist/80">Paiement en 4X proposé par PayPal, sous réserve d’acceptation par PayPal. Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de vous engager.</p>
          )}
        </div>
        {holdUntil && <p className="font-georgia text-xs text-mist mb-3">Créneau protégé jusqu’à {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(holdUntil))}.</p>}
        {notice && <p className="font-georgia text-sm text-red-800 bg-red-50 rounded-xl px-3 py-2 mb-3">{notice}</p>}
        {!consentsReady ? (
          <p className="font-georgia text-sm text-mist text-center py-3">Cochez les deux cases ci-dessus pour afficher les boutons de paiement : <strong className="text-deep">carte bancaire</strong> (sans compte PayPal) ou <strong className="text-deep">PayPal</strong>{paymentCents >= PAY_LATER_MIN_CENTS ? ', en une fois ou en 4 fois' : ''}.</p>
        ) : (
          <div ref={containerRef}>{!config && !notice && <p className="font-georgia text-sm text-mist">Chargement du paiement sécurisé…</p>}</div>
        )}
      </div>
    </div>
  )
}
