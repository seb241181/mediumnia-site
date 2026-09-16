import { useEffect, useMemo, useRef, useState } from 'react'

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

  const depositCents = Number(service?.reservationPaymentCents || service?.reservation_payment_cents || 0)
  const priceCents = Number(service?.price_cents || 0)
  const balanceCents = Math.max(0, priceCents - depositCents)
  const consentsReady = termsAccepted && earlyPerformance

  const payload = useMemo(() => ({
    practitioner_slug: practitionerSlug,
    service_slug: service?.slug,
    date: dateStr,
    time,
    selected_modality: selectedModality,
    customer,
    client_checkout_id: checkoutId,
    terms_accepted: true,
    early_performance_requested: true,
  }), [practitionerSlug, service?.slug, dateStr, time, selectedModality, customer, checkoutId])

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
      const response = await fetch('/api/rdv-config?rdvDepositAction=create', {
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
        onComplete?.({ status: 'COMPLETED', bookingId: result.bookingId, amountCents: depositCents, servicePriceCents: priceCents, balanceCents })
        throw new Error('already_converted')
      }
      if (result.expiresAt) setHoldUntil(result.expiresAt)
      return result.id
    }

    async function pollStatus() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        const response = await fetch(`/api/rdv-config?rdvDepositAction=status&checkout_id=${encodeURIComponent(checkoutId)}`)
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
          onCancel: () => setNotice('Paiement annulé. Votre rendez-vous n’est pas confirmé tant que les arrhes ne sont pas réglées.'),
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
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=EUR&intent=capture&components=buttons`
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
  }, [config, consentsReady, payload, checkoutId, depositCents, priceCents, balanceCents, onComplete, onUnavailable])

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gold/30 bg-gold/5 p-5">
        <p className="font-georgia text-[11px] tracking-[.18em] uppercase text-gold mb-3">Réservation sécurisée</p>
        <div className="space-y-2 font-georgia text-sm">
          <div className="flex justify-between gap-4"><span className="text-mist">Prix de la prestation</span><strong>{money(priceCents)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-mist">Arrhes à régler maintenant</span><strong className="text-deep">{money(depositCents)}</strong></div>
          <div className="flex justify-between gap-4 border-t border-gold/15 pt-2"><span className="text-mist">Solde restant</span><strong>{money(balanceCents)}</strong></div>
        </div>
      </div>

      <div className="rounded-2xl border border-gold/20 bg-white/70 p-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4" />
          <span className="font-georgia text-xs leading-relaxed text-mist">
            J’accepte les conditions de réservation : les {money(depositCents)} versés constituent des arrhes. En cas d’annulation à moins de 48 heures, leur traitement suit les conditions acceptées et les droits légaux applicables.
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={earlyPerformance} onChange={event => setEarlyPerformance(event.target.checked)} className="mt-1 h-4 w-4" />
          <span className="font-georgia text-xs leading-relaxed text-mist">
            Je demande expressément que le service de réservation puisse commencer immédiatement, y compris lorsque le rendez-vous est fixé avant la fin du délai légal de rétractation. Mes droits légaux restent applicables dans les conditions prévues par la loi.
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-gold/30 bg-white/70 p-5">
        <p className="font-georgia text-sm text-mist leading-relaxed mb-4">Votre créneau est bloqué pendant 15 minutes à partir de la création du paiement.</p>
        {holdUntil && <p className="font-georgia text-xs text-mist mb-3">Créneau protégé jusqu’à {new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(holdUntil))}.</p>}
        {notice && <p className="font-georgia text-sm text-red-800 bg-red-50 rounded-xl px-3 py-2 mb-3">{notice}</p>}
        {!consentsReady ? (
          <p className="font-georgia text-sm text-mist text-center py-3">Cochez les deux cases ci-dessus pour afficher le paiement sécurisé.</p>
        ) : (
          <div ref={containerRef}>{!config && !notice && <p className="font-georgia text-sm text-mist">Chargement du paiement sécurisé…</p>}</div>
        )}
      </div>
    </div>
  )
}
