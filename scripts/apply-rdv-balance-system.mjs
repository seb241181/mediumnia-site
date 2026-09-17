import fs from 'node:fs'

function replaceOnce(path, before, after, sentinel) {
  let text = fs.readFileSync(path, 'utf8')
  if (sentinel && text.includes(sentinel)) return
  if (!text.includes(before)) throw new Error(`Expected balance patch anchor not found in ${path}`)
  text = text.replace(before, after)
  fs.writeFileSync(path, text)
}

// 1) Server: a video appointment inside the H-48 deadline cannot be booked with only a deposit.
replaceOnce(
  'lib/rdvDepositApiHandler.js',
  `  } catch (error) {
    return publicError(res, error.message || 'slot_unavailable', error.message === 'google_calendar_unavailable' ? 503 : 409)
  }

  const cfg = runtimeRdvDepositPayPalConfig()`,
  `  } catch (error) {
    return publicError(res, error.message || 'slot_unavailable', error.message === 'google_calendar_unavailable' ? 503 : 409)
  }

  if (selected_modality === 'video' && slot.startsAt.getTime() <= Date.now() + 48 * 3_600_000) {
    return publicError(res, 'balance_requires_full_payment', 409)
  }

  const cfg = runtimeRdvDepositPayPalConfig()`,
  "balance_requires_full_payment', 409",
)

// 2) Confirmation email: tell deposit-paying video clients about H-72 reminder/H-48 deadline.
replaceOnce(
  'lib/rdvDepositApiHandler.js',
  `        meetLink: googleSync.google_meet_link || booking.google_meet_link || null,
        cancelUrl: bookingCancellationUrl(cancellation.token),
      })`,
  `        meetLink: googleSync.google_meet_link || booking.google_meet_link || null,
        cancelUrl: bookingCancellationUrl(cancellation.token),
        balanceReminderEnabled: Array.isArray(service.modality)
          && service.modality.includes('video')
          && booking.reservation_payment_cents < booking.booked_price_cents,
      })`,
  'balanceReminderEnabled: Array.isArray(service.modality)',
)

// 3) Google Calendar wording: full payments are not called deposits.
replaceOnce(
  'lib/rdvDepositApiHandler.js',
  "          `Arrhes réglées : ${(booking.reservation_payment_cents / 100).toFixed(2)} EUR`,",
  "          `${booking.reservation_payment_cents >= booking.booked_price_cents ? 'Réglé intégralement' : 'Arrhes réglées'} : ${(booking.reservation_payment_cents / 100).toFixed(2)} EUR`,",
  "? 'Réglé intégralement' : 'Arrhes réglées'",
)

// 4) Frontend: force full payment for video appointments that are already inside H-48.
replaceOnce(
  'src/components/rdv/RdvDepositCheckout.jsx',
  `  const canPayInFull = selectedModality === 'video' && Array.isArray(service?.modality) && service.modality.includes('video')
  const paymentCents = paymentChoice === 'full_payment' && canPayInFull ? priceCents : depositCents
  const balanceCents = Math.max(0, priceCents - paymentCents)
  const consentsReady = termsAccepted && earlyPerformance

  useEffect(() => {
    if (!canPayInFull && paymentChoice !== 'arrhes') setPaymentChoice('arrhes')
  }, [canPayInFull, paymentChoice])

  function choosePayment(nextChoice) {
    const normalized = nextChoice === 'full_payment' && canPayInFull ? 'full_payment' : 'arrhes'`,
  `  const canPayInFull = selectedModality === 'video' && Array.isArray(service?.modality) && service.modality.includes('video')
  const appointmentAt = dateStr && time ? new Date(\`${'${dateStr}'}T${'${time}'}:00\`) : null
  const fullPaymentRequired = canPayInFull
    && appointmentAt
    && Number.isFinite(appointmentAt.getTime())
    && appointmentAt.getTime() <= Date.now() + 48 * 3_600_000
  const paymentCents = (paymentChoice === 'full_payment' && canPayInFull) || fullPaymentRequired ? priceCents : depositCents
  const balanceCents = Math.max(0, priceCents - paymentCents)
  const consentsReady = termsAccepted && earlyPerformance

  useEffect(() => {
    if (fullPaymentRequired && paymentChoice !== 'full_payment') setPaymentChoice('full_payment')
    else if (!canPayInFull && paymentChoice !== 'arrhes') setPaymentChoice('arrhes')
  }, [canPayInFull, fullPaymentRequired, paymentChoice])

  function choosePayment(nextChoice) {
    const normalized = fullPaymentRequired
      ? 'full_payment'
      : nextChoice === 'full_payment' && canPayInFull ? 'full_payment' : 'arrhes'`,
  'const fullPaymentRequired = canPayInFull',
)

replaceOnce(
  'src/components/rdv/RdvDepositCheckout.jsx',
  `    payment_choice_locked: 'Ce paiement a déjà été préparé. Rechargez la page pour changer de mode de règlement.',`,
  `    payment_choice_locked: 'Ce paiement a déjà été préparé. Rechargez la page pour changer de mode de règlement.',
    balance_requires_full_payment: 'À moins de 48 heures du rendez-vous, le règlement intégral est requis pour une visioconférence.',`,
  'balance_requires_full_payment:',
)

replaceOnce(
  'src/components/rdv/RdvDepositCheckout.jsx',
  `          <p className="font-georgia text-[11px] tracking-[.18em] uppercase text-gold">Choisissez votre règlement</p>
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gold/15 p-3">
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'arrhes'} onChange={() => choosePayment('arrhes')} className="mt-1 h-4 w-4" />`,
  `          <p className="font-georgia text-[11px] tracking-[.18em] uppercase text-gold">Choisissez votre règlement</p>
          {fullPaymentRequired && (
            <p className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 font-georgia text-xs leading-relaxed text-deep">
              Ce rendez-vous est prévu dans moins de 48 heures : le règlement intégral est requis pour confirmer la visioconférence.
            </p>
          )}
          <label className={\`flex items-start gap-3 rounded-xl border border-gold/15 p-3 ${'${fullPaymentRequired ? \'opacity-45 cursor-not-allowed\' : \'cursor-pointer\'}'}\`}>
            <input type="radio" name="rdv-payment-choice" checked={paymentChoice === 'arrhes'} disabled={fullPaymentRequired} onChange={() => choosePayment('arrhes')} className="mt-1 h-4 w-4" />`,
  'Ce rendez-vous est prévu dans moins de 48 heures',
)

console.log('MediumIA RDV: balance deadline and reminder UX applied')
