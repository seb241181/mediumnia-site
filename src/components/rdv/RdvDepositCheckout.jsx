import { useEffect, useMemo, useRef, useState } from 'react'
import GiftCardRedeem from './GiftCardRedeem.jsx'
import PayPalGuestNotice from '../PayPalGuestNotice.jsx'
import BankTransferOption from './BankTransferOption.jsx'
import RdvBookingHelp from './RdvBookingHelp.jsx'
import { assertCurrentCheckout, createCheckoutOrderGate } from '../../lib/rdvCheckoutRetry.js'

// PayPal « Paiement en 4X » (France) is offered from 30 € of purchase.
const PAY_LATER_MIN_CENTS = 3000

function money(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`
}

function paymentMessage(code) {
  const messages = {
    rate_limit_exceeded: 'La limite de tentatives est atteinte. Pour réserver plus tôt, contactez MediumIA ci-dessous.',
    slot_unavailable: 'Ce créneau vient d’être réservé. Choisissez un autre horaire.',
    daily_limit_reached: 'La capacité de rendez-vous de cette journée est atteinte.',
    google_calendar_unavailable: 'Impossible de confirmer le créneau avec Google Agenda pour le moment.',
    paypal_not_configured: 'Le paiement sécurisé est momentanément indisponible.',
    paypal_auth_failed: 'Le paiement sécurisé est momentanément indisponible.',
    paypal_create_order_failed: 'PayPal n’a pas pu préparer le paiement. Patientez au moins 15 secondes, puis réessayez une fois. Si le problème persiste, contactez MediumIA ci-dessous.',
    paypal_create_order_in_progress: 'Le paiement est déjà en cours de préparation. Réessayez dans quelques instants.',
    paypal_capture_failed: 'Nous vérifions votre paiement auprès de PayPal. Ne repayez pas : vous recevrez un e-mail de confirmation dès qu’il est validé.',
    paypal_capture_uncertain: 'L’issue de votre paiement nécessite une vérification. Ne repayez pas : votre créneau reste protégé. Contactez l’assistance si vous ne recevez pas de confirmation.',
    paypal_instrument_declined: 'PayPal a refusé ce moyen de paiement : rien n’a été prélevé. Choisissez une autre carte ou un autre moyen de paiement dans la fenêtre PayPal.',
    paypal_transaction_refused: 'Le paiement n’a pas abouti et rien n’a été prélevé. Vous pouvez réessayer, avec un autre moyen de paiement si besoin.',
    paypal_capture_declined: 'Le paiement n’a pas abouti et rien n’a été prélevé. Vous pouvez réessayer, avec un autre moyen de paiement si besoin.',
    paypal_order_voided: 'Le paiement n’a pas abouti et rien n’a été prélevé. Vous pouvez réessayer.',
    payment_received_pending: 'Votre paiement est bien reçu. La confirmation de votre rendez-vous est en cours : ne repayez pas, vous la recevrez par e-mail.',
    checkout_expired: 'Votre précédente tentative a expiré et rien n’a été prélevé. Cliquez de nouveau sur le bouton PayPal.',
    slot_held: 'Ce créneau est en cours de réservation par une autre personne. Choisissez un autre horaire ou réessayez dans quelques minutes.',
    paid_slot_reconciliation_required: 'Le paiement a été reçu mais le créneau nécessite une vérification. Ne repayez pas. Sébastien sera prévenu.',
    full_payment_video_only: 'Le règlement de la totalité en ligne n’est pas encore disponible pour ce rendez-vous : vous pouvez réserver avec les arrhes.',
    invalid_modality: 'Le règlement de la totalité en ligne n’est pas encore disponible pour ce rendez-vous : vous pouvez réserver avec les arrhes.',
    payment_choice_locked: 'Ce paiement a déjà été préparé. Rechargez la page pour changer de mode de règlement.',
    balance_requires_full_payment: 'À moins de 48 heures du rendez-vous, le règlement intégral est requis pour une visioconférence.',
    offer_expired: 'Ce lien personnel a expiré. Demandez un nouveau lien à Sébastien.',
    offer_used: 'Ce créneau a déjà été réservé avec ce lien.',
    offer_cancelled: 'Ce lien personnel a été annulé : aucun paiement n’a été pris.',
    offer_invalid: 'Ce lien personnel n’est pas valable.',
  }
  return messages[code] || 'Le paiement ne peut pas être préparé pour le moment. Réessayez dans quelques instants.'
}

// Codes renvoyés par le serveur (déjà journalisés là-bas).
const SERVER_CODES = new Set([
  'rate_limit_exceeded', 'slot_unavailable', 'slot_held', 'daily_limit_reached', 'google_calendar_unavailable',
  'paypal_not_configured', 'paypal_auth_failed', 'paypal_create_order_failed', 'paypal_create_order_in_progress',
  'checkout_expired', 'hold_creation_failed', 'hold_not_available', 'payment_choice_locked', 'invalid_customer',
  'offer_expired', 'offer_used', 'offer_cancelled', 'offer_invalid', 'balance_requires_full_payment',
])

export default function RdvDepositCheckout({
  practitionerSlug,
  service,
  dateStr,
  time,
  selectedModality,
  customer,
  checkoutId,
  onMetric,
  onComplete,
  onUnavailable,
  onCheckoutIdChange,
  onBankPending,
  offerToken = null,
}) {
  const containerRef = useRef(null)
  const payLaterContainerRef = useRef(null)
  const cardContainerRef = useRef(null)
  const [config, setConfig] = useState(null)
  const [notice, setNotice] = useState('')
  const [holdUntil, setHoldUntil] = useState(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [earlyPerformance, setEarlyPerformance] = useState(false)
  const [paymentChoice, setPaymentChoice] = useState('arrhes')
  // Only event names are sent; repeated SDK callbacks do not inflate a page visit.
  const checkoutFunnelSent = useRef(new Set())
  const emitOnce = (event) => {
    if (checkoutFunnelSent.current.has(event)) return
    checkoutFunnelSent.current.add(event)
    onMetric?.(event)
  }
  // Référence (et non état) : changer d'identifiant pendant qu'une fenêtre PayPal est
  // ouverte ne doit pas redessiner les boutons.
  const checkoutIdRef = useRef(checkoutId)
  const choiceRef = useRef(paymentChoice)
  const orderGate = useRef(null)
  if (!orderGate.current) orderGate.current = createCheckoutOrderGate()
  function renewCheckoutId() {
    const id = globalThis.crypto?.randomUUID?.() || checkoutIdRef.current
    checkoutIdRef.current = id
    onCheckoutIdChange?.(id)
    return id
  }
  // Signale une erreur vue par le navigateur (code seulement, aucune donnée personnelle).
  function reportClientEvent(code) {
    try {
      void fetch('/api/rdv-config?rdvDepositAction=clientEvent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutId: checkoutIdRef.current, code }),
        keepalive: true,
      }).catch(() => {})
    } catch { /* jamais bloquant */ }
  }

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
    const next = fullPaymentRequired ? 'full_payment' : !fullOnlineAllowed ? 'arrhes' : paymentChoice
    if (next !== paymentChoice) choosePayment(next)
    // The same transition is used for a click and a change in eligibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullOnlineAllowed, fullPaymentRequired, paymentChoice])

  function choosePayment(nextChoice) {
    const normalized = fullPaymentRequired
      ? 'full_payment'
      : nextChoice === 'full_payment' && fullOnlineAllowed ? 'full_payment' : 'arrhes'
    if (normalized === paymentChoice) return
    choiceRef.current = normalized
    setPaymentChoice(normalized)
    renewCheckoutId()
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
    terms_accepted: true,
    early_performance_requested: true,
    ...(offerToken ? { offer_token: offerToken } : {}),
  }), [practitionerSlug, service?.slug, dateStr, time, selectedModality, customer, offerToken])

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
    const payLaterContainer = payLaterContainerRef.current
    const cardContainer = cardContainerRef.current
    const paypalContainers = [container, payLaterContainer, cardContainer].filter(Boolean)

    let approvedContext
    const createOrder = async () => {
      const id = checkoutIdRef.current
      const active = () => !disposed && choiceRef.current === paymentChoice && checkoutIdRef.current === id
      assertCurrentCheckout(active)
      const orderId = await orderGate.current(id, paymentChoice, () => submitOrder(id, active))
      assertCurrentCheckout(active)
      approvedContext = { orderId, active, id }
      return orderId
    }

    async function submitOrder(id, active) {
      assertCurrentCheckout(active)
      setNotice('')
      const action = paymentChoice === 'full_payment' ? 'createFull' : 'create'
      const requestOrder = async () => {
        const response = await fetch(`/api/rdv-config?rdvDepositAction=${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, client_checkout_id: id }),
        })
        return { response, result: await response.json().catch(() => ({})) }
      }
      const { response, result } = await requestOrder().catch(() => {
        assertCurrentCheckout(active)
        reportClientEvent('create_network_error')
        throw new Error('paypal_create_order_failed')
      })
      assertCurrentCheckout(active)
      // Un nouveau clic explicite est nécessaire après expiration.
      if (!response.ok && result.error === 'checkout_expired') {
        renewCheckoutId()
      }
      if (!response.ok) {
        if (['slot_unavailable', 'slot_held', 'daily_limit_reached'].includes(result.error)) onUnavailable?.({ code: result.error, retryAt: result.retryAt || null })
        const error = new Error(result.error || 'paypal_create_order_failed')
        if (response.status === 429) {
          error.retryAfterSeconds = Number(response.headers.get('Retry-After')) || 3600
        }
        throw error
      }
      if (result.status === 'converted' && result.bookingId) {
        onComplete?.({ status: 'COMPLETED', bookingId: result.bookingId, amountCents: paymentCents, servicePriceCents: priceCents, balanceCents })
        throw new Error('already_converted')
      }
      if (result.expiresAt) setHoldUntil(result.expiresAt)
      if (result.id) emitOnce(paymentChoice === 'full_payment' ? 'rdv_funnel_full_order' : 'rdv_funnel_arrhes_order')
      if (!result.id) throw new Error('paypal_create_order_failed')
      return result.id
    }

    async function pollStatus(id, attempts = 8, delayMs = 2000) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (disposed) return false
        await new Promise(resolve => setTimeout(resolve, delayMs))
        const response = await fetch(`/api/rdv-config?rdvDepositAction=status&checkout_id=${encodeURIComponent(id)}`).catch(() => null)
        const status = await response?.json().catch(() => ({})) || {}
        if (status.bookingId) {
          onComplete?.({
            status: 'COMPLETED',
            bookingId: status.bookingId,
            amountCents: status.amountCents,
            servicePriceCents: status.servicePriceCents,
            balanceCents: status.balanceCents,
            email_confirmation: status.email_confirmation,
          })
          return true
        }
      }
      return false
    }

    async function mountButtons() {
      if (disposed || !window.paypal || !container) return
      paypalContainers.forEach(element => { element.innerHTML = '' })
      try {
        const buttonCallbacks = {
          createOrder,
          onApprove: async (data, actions) => {
            if (approvedContext?.orderId !== data.orderID || !approvedContext.active()) return
            const context = approvedContext
            setNotice('')
            let result
            try {
              const response = await fetch('/api/rdv-config?rdvDepositAction=capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: data.orderID }),
              })
              result = await response.json().catch(() => ({}))
            } catch {
              // Réponse perdue : le paiement a peut-être abouti, on vérifie sans repayer.
              reportClientEvent('capture_network_error')
              result = { status: 'CAPTURE_UNCERTAIN', error: 'paypal_capture_uncertain' }
            }
            if (result.status === 'COMPLETED') {
              onComplete?.(result)
              return
            }
            // Carte refusée : PayPal rouvre sa fenêtre pour choisir un autre moyen.
            if (context.active() && result.restartable && typeof actions?.restart === 'function') {
              reportClientEvent('paypal_restart')
              setNotice(paymentMessage(result.error))
              return actions.restart()
            }
            if (['CAPTURE_IN_PROGRESS', 'CAPTURED_PENDING_RECONCILIATION', 'CAPTURE_UNCERTAIN'].includes(result.status)) {
              if (await pollStatus(context.id)) return
              // Issue inconnue : le statut ne modifie jamais le paiement. On attend
              // une éventuelle finalisation par l'opérateur sans relancer la capture.
              setNotice(paymentMessage(result.error || 'paypal_capture_uncertain'))
              void pollStatus(context.id, 24, 30_000)
              return
            }
            // Refus définitif sans prélèvement : la prochaine tentative repart à zéro.
            if (!context.active()) return
            if (['checkout_expired', 'paypal_order_voided', 'paypal_capture_declined', 'paypal_transaction_refused', 'paypal_instrument_declined', 'paypal_auth_failed'].includes(result.error)) renewCheckoutId()
            setNotice(paymentMessage(result.error || 'paypal_capture_uncertain'))
          },
          onCancel: () => {
            emitOnce('rdv_funnel_paypal_cancel')
            reportClientEvent('paypal_cancelled')
            setNotice(paymentChoice === 'full_payment'
              ? 'Paiement annulé. Votre rendez-vous n’est pas confirmé tant que le règlement intégral n’est pas effectué.'
              : 'Paiement annulé. Votre rendez-vous n’est pas confirmé tant que les arrhes ne sont pas réglées.')
          },
          onError: error => {
            if (disposed || choiceRef.current !== paymentChoice || ['already_converted', 'checkout_context_changed'].includes(error?.message)) return
            emitOnce('rdv_funnel_paypal_error')
            // Les refus du serveur sont déjà journalisés côté serveur.
            if (!SERVER_CODES.has(error?.message)) reportClientEvent('paypal_onerror')
            if (error?.message === 'rate_limit_exceeded') {
              const wait = error.retryAfterSeconds >= 86400 ? '24 heures' : 'une heure'
              setNotice(`La limite de tentatives est atteinte. Réessayez dans ${wait}. Pour réserver plus tôt, contactez MediumIA ci-dessous.`)
            } else {
              setNotice(paymentMessage(error?.message || 'paypal_capture_uncertain'))
            }
          },
        }
        // PayPal fournit les vrais boutons sécurisés : on les installe séparément
        // pour insérer le virement entre « payer en plusieurs fois » et « carte ».
        const sources = [
          [window.paypal.FUNDING?.PAYPAL, container],
          [paymentCents >= PAY_LATER_MIN_CENTS ? window.paypal.FUNDING?.PAYLATER : null, payLaterContainer],
          [window.paypal.FUNDING?.CARD, cardContainer],
        ]
        let rendered = 0
        for (const [fundingSource, target] of sources) {
          if (disposed || !fundingSource || !target) continue
          const buttons = window.paypal.Buttons({
            ...buttonCallbacks,
            fundingSource,
            style: { layout: 'vertical', shape: 'rect' },
          })
          if (typeof buttons.isEligible === 'function' && !buttons.isEligible()) continue
          try {
            await buttons.render(target)
            rendered += 1
          } catch (error) {
            // Un moyen non disponible ne doit pas masquer les autres.
            if (fundingSource === window.paypal.FUNDING?.PAYPAL) throw error
            target.innerHTML = ''
          }
        }
        if (!rendered && !disposed) {
          const fallback = window.paypal.Buttons({
            ...buttonCallbacks,
            style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
          })
          await fallback.render(container)
          rendered = 1
        }
        if (!disposed && consentsReady && rendered > 0) emitOnce('rdv_funnel_paypal_buttons')
      } catch (error) {
        if (!disposed && error?.message !== 'already_converted') {
          emitOnce('rdv_funnel_paypal_error')
          reportClientEvent('paypal_render_failed')
          setNotice(paymentMessage(error?.message))
        }
      }
    }

    const existing = document.querySelector('script[data-mediumia-paypal-sdk="1"]')
    if (window.paypal) {
      void mountButtons()
      return () => { disposed = true; paypalContainers.forEach(element => { element.innerHTML = '' }) }
    }

    const script = existing || document.createElement('script')
    if (!existing) {
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
      script.async = true
      script.dataset.mediumiaPaypalSdk = '1'
      document.head.appendChild(script)
    }
    const onLoad = () => { void mountButtons() }
    const onError = () => { if (!disposed) { emitOnce('rdv_funnel_paypal_error'); reportClientEvent('paypal_sdk_load_failed'); setNotice('Le paiement sécurisé est indisponible pour le moment.') } }
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    return () => {
      disposed = true
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      paypalContainers.forEach(element => { element.innerHTML = '' })
    }
  }, [config, consentsReady, payload, paymentChoice, paymentCents, priceCents, balanceCents, onComplete, onUnavailable, onMetric])

  return (
    <div className="space-y-5">
      {fullOnlineAllowed && (
        <fieldset className="min-w-0 space-y-3 rounded-2xl border border-gold/30 bg-white/70 p-3 sm:p-5">
          <legend className="px-2 font-georgia text-base font-semibold text-deep">Choisissez le montant à régler</legend>
          {fullPaymentRequired && (
            <p className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 font-georgia text-xs leading-relaxed text-deep">
              Ce rendez-vous est prévu dans moins de 48 heures : le règlement intégral est requis pour confirmer la visioconférence.
            </p>
          )}
          <label className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 font-georgia text-deep ${paymentChoice === 'arrhes' && !fullPaymentRequired ? 'border-gold bg-gold/10' : 'border-gold/20'} ${fullPaymentRequired ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}>
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'arrhes'} disabled={fullPaymentRequired} onChange={() => choosePayment('arrhes')} className="mt-1 h-5 w-5 shrink-0 accent-deep" />
            <span className="min-w-0 flex-1">
              <strong className="block text-base">Verser les arrhes · {money(depositCents)}</strong>
              <span className="block text-sm leading-relaxed text-mist">Il restera {money(Math.max(0, priceCents - depositCents))} à régler{selectedModality === 'in-person' ? ' sur place, par carte bancaire, espèces ou chèque' : ''}.</span>
            </span>
          </label>
          <label className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 font-georgia text-deep ${paymentChoice === 'full_payment' ? 'border-gold bg-gold/10' : 'border-gold/20'}`}>
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'full_payment'} onChange={() => choosePayment('full_payment')} className="mt-1 h-5 w-5 shrink-0 accent-deep" />
            <span className="min-w-0 flex-1">
              <strong className="block text-base">Régler la totalité · {money(priceCents)}</strong>
              <span className="block text-sm leading-relaxed text-mist">Votre rendez-vous sera entièrement réglé. Par carte bancaire ou PayPal, en 1 fois{priceCents >= PAY_LATER_MIN_CENTS ? ` — ou en 4 fois sans frais avec PayPal (4 × ${money(Math.ceil(priceCents / 4))} environ)` : ''}.</span>
            </span>
          </label>
        </fieldset>
      )}
      <div className="flex justify-end">
        <GiftCardRedeem
          compact
          practitionerSlug={practitionerSlug}
          service={service}
          dateStr={dateStr}
          time={time}
          customer={customer}
          selectedModality={selectedModality}
          consentsReady={consentsReady}
          depositCents={fullPaymentRequired ? priceCents : depositCents}
          priceCents={priceCents}
          onComplete={onComplete}
          onUnavailable={onUnavailable}
        />
      </div>

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
            J’ai lu et j’accepte les{' '}
            <a href="/conditions-rdv" target="_blank" rel="noopener noreferrer"
              className="font-semibold text-deep underline decoration-gold underline-offset-2 hover:text-gold"
              onClick={(e) => e.stopPropagation()}>
              conditions de réservation et d’annulation
            </a>.
            <span className="mt-1 block text-xs">
              Annulation au moins 48 h avant : remboursement intégral.
              Moins de 48 h : {money(depositCents)} d’arrhes conservés et solde éventuel remboursé,
              sous réserve des droits légaux, notamment de rétractation.
            </span>
            <span className="mt-1 block text-xs">
              {paymentChoice === 'full_payment'
                ? `Montant choisi : ${money(priceCents)} (totalité de la consultation).`
                : `Montant choisi : ${money(depositCents)} d’arrhes, déduites du prix total.`}
            </span>
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
        <p className="mb-3 font-georgia text-sm leading-relaxed text-mist">
          Réglez votre réservation avec PayPal ou, si PayPal le propose, directement par carte bancaire.
        </p>
        <details className="group mb-3 rounded-xl border border-gold/25 bg-gold/5">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-georgia text-sm font-semibold text-deep focus-visible:outline-gold">
            <span>Comment payer ? Carte, PayPal et 4X</span>
            <span aria-hidden="true" className="text-gold transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="space-y-3 border-t border-gold/20 px-4 py-4">
            <p className="font-georgia text-sm text-mist">Votre créneau est bloqué pendant 15 minutes à partir de la création du paiement.</p>
            <PayPalGuestNotice />
            {paymentChoice === 'full_payment' && (
              <p className="font-georgia text-sm leading-relaxed text-mist">
                Une autre personne peut régler ce rendez-vous : conservez les coordonnées du bénéficiaire
                dans la réservation et choisissez le moyen de paiement du payeur dans PayPal.
              </p>
            )}
            <p className="font-georgia text-xs leading-relaxed text-mist">
              PayPal : règlement en 1 fois
              {paymentCents >= PAY_LATER_MIN_CENTS
                ? ', ou en 4 fois avec le bouton « Payer en 4X » (compte PayPal requis).'
                : '.'}
            </p>
            {paymentCents < PAY_LATER_MIN_CENTS && priceCents >= PAY_LATER_MIN_CENTS && fullOnlineAllowed && (
              <p className="font-georgia text-xs text-mist">
                Le paiement en 4 fois est proposé par PayPal à partir de 30 € :
                choisissez « Régler la totalité » pour en profiter.
              </p>
            )}
          </div>
        </details>
        {priceCents >= PAY_LATER_MIN_CENTS && fullOnlineAllowed && (
          <p className="mb-3 font-georgia text-[11px] leading-relaxed text-mist">
            Le paiement en 4X est proposé par PayPal sous réserve d’acceptation.
            Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de vous engager.
          </p>
        )}
        {holdUntil && <p className="font-georgia text-xs text-mist mb-3">Créneau protégé jusqu’à {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(holdUntil))}.</p>}
        {notice && <p className="font-georgia text-sm text-red-800 bg-red-50 rounded-xl px-3 py-2 mb-3">{notice}</p>}
        <details className="group mb-4 rounded-xl border border-gold/20 bg-white/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-georgia text-sm font-semibold text-deep">
            <span>Une difficulté pour réserver ?</span>
            <span aria-hidden="true" className="text-gold transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-gold/15 p-3">
            <RdvBookingHelp />
          </div>
        </details>
        {!consentsReady && (
          <p className="font-georgia text-sm text-mist text-center py-3">
            Cochez les deux cases ci-dessus pour activer le paiement sécurisé et le virement bancaire.
          </p>
        )}
        <div className="space-y-3">
          <div ref={containerRef}>{consentsReady && !config && !notice && <p className="font-georgia text-sm text-mist">Chargement du paiement sécurisé…</p>}</div>
          <div ref={payLaterContainerRef} />
          <BankTransferOption
            practitionerSlug={practitionerSlug}
            service={service}
            dateStr={dateStr}
            time={time}
            customer={customer}
            selectedModality={selectedModality}
            checkoutId={checkoutId}
            paymentChoice={paymentChoice}
            consentsReady={consentsReady}
            offerToken={offerToken}
            onBankPending={onBankPending}
            onUnavailable={onUnavailable}
          />
          <div ref={cardContainerRef} />
        </div>
      </div>
    </div>
  )
}
