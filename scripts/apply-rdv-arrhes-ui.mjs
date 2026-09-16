import fs from 'node:fs'

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 marker, found ${count}`)
  return text.replace(before, after)
}

const rdvPath = new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url)
let rdv = fs.readFileSync(rdvPath, 'utf8')

rdv = replaceOnce(
  rdv,
  "import LegalFooter from '../LegalFooter'\n",
  "import LegalFooter from '../LegalFooter'\nimport RdvDepositCheckout from './RdvDepositCheckout'\n",
  'import checkout',
)

rdv = replaceOnce(
  rdv,
  `    modalityLabel:  (svc.modality || []).map(m => MODALITY_LABELS[m] || m).join(' · ') || '—',\n    bookingMode:    svc.booking_mode || 'instant',\n`,
  `    modalityLabel:  (svc.modality || []).map(m => MODALITY_LABELS[m] || m).join(' · ') || '—',\n    bookingMode:    svc.booking_mode || 'instant',\n    reservationPaymentKind: svc.reservation_payment_kind || 'none',\n    reservationPaymentCents: Number(svc.reservation_payment_cents || 0),\n    reservationPaymentLabel: Number(svc.reservation_payment_cents || 0) > 0\n      ? \`${'${(Number(svc.reservation_payment_cents) / 100).toFixed(2).replace(\'.\', \',\')}'} €\`\n      : null,\n`,
  'service payment fields',
)

rdv = replaceOnce(
  rdv,
  "  const labels = ['Prestation', 'Date & Heure', 'Coordonnées']\n",
  "  const labels = ['Prestation', 'Date & Heure', 'Coordonnées', 'Paiement']\n",
  'step labels',
)

rdv = replaceOnce(
  rdv,
  `        {service.bookingMode === 'request' && (\n          <span className="text-gold/70 italic">→ Réservation sur demande</span>\n        )}\n`,
  `        {service.bookingMode === 'request' && (\n          <span className="text-gold/70 italic">→ Réservation sur demande</span>\n        )}\n        {service.bookingMode === 'instant' && service.reservationPaymentCents > 0 && (\n          <span className="text-gold font-semibold">→ {service.reservationPaymentLabel} d’arrhes à la réservation</span>\n        )}\n`,
  'service card arrhes badge',
)

rdv = replaceOnce(
  rdv,
  'function ContactForm({ onSubmit, loading, error }) {',
  "function ContactForm({ onSubmit, loading, error, submitLabel = 'Confirmer la réservation →' }) {",
  'contact signature',
)

rdv = replaceOnce(
  rdv,
  "        {loading ? 'Confirmation en cours…' : 'Confirmer la réservation →'}\n",
  "        {loading ? 'Confirmation en cours…' : submitLabel}\n",
  'contact submit label',
)

rdv = replaceOnce(
  rdv,
  `          <p className="font-georgia text-xs text-mist mt-0.5">{service.durationLabel} · {service.priceLabel}</p>\n          <p className="font-georgia text-xs text-mist">{service.modalityLabel}</p>\n`,
  `          <p className="font-georgia text-xs text-mist mt-0.5">{service.durationLabel} · {service.priceLabel}</p>\n          <p className="font-georgia text-xs text-mist">{service.modalityLabel}</p>\n          {service.bookingMode === 'instant' && service.reservationPaymentCents > 0 && (\n            <p className="font-georgia text-xs text-gold mt-1">{service.reservationPaymentLabel} d’arrhes à la réservation</p>\n          )}\n`,
  'summary arrhes',
)

rdv = replaceOnce(
  rdv,
  `  const [bookingResult, setBookingResult] = useState(null)\n  const [bookingLoading, setBookingLoading] = useState(false)\n  const [bookingError, setBookingError]     = useState(null)\n`,
  `  const [bookingResult, setBookingResult] = useState(null)\n  const [paymentCustomer, setPaymentCustomer] = useState(null)\n  const [checkoutId, setCheckoutId] = useState(null)\n  const [bookingLoading, setBookingLoading] = useState(false)\n  const [bookingError, setBookingError]     = useState(null)\n`,
  'payment state',
)

rdv = replaceOnce(
  rdv,
  `  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null\n\n  function selectService(svc) {\n`,
  `  const fmt = (d) => d ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : null\n  const requiresDeposit = service?.bookingMode === 'instant'\n    && service?.reservationPaymentKind === 'arrhes'\n    && service?.reservationPaymentCents > 0\n  const selectedModality = service?.modality?.includes('video') ? 'video' : 'in-person'\n  const checkoutStorageKey = service && date && time\n    ? \`mediumia:rdv-arrhes:${'${slug}'}:${'${service.id}'}:${'${toDateStr(date)}'}:${'${time}'}\`\n    : null\n\n  function selectService(svc) {\n`,
  'deposit derived state',
)

rdv = replaceOnce(
  rdv,
  `  async function handleConfirm(contactForm) {\n    setBookingLoading(true)\n    setBookingError(null)\n\n    try {\n`,
  `  async function handleConfirm(contactForm) {\n    if (requiresDeposit) {\n      const persisted = checkoutStorageKey ? sessionStorage.getItem(checkoutStorageKey) : null\n      const id = persisted || crypto.randomUUID()\n      if (!persisted && checkoutStorageKey) sessionStorage.setItem(checkoutStorageKey, id)\n      setCheckoutId(id)\n      setPaymentCustomer(contactForm)\n      setBookingError(null)\n      setStep(3)\n      return\n    }\n\n    setBookingLoading(true)\n    setBookingError(null)\n\n    try {\n`,
  'handle confirm deposit branch',
)

rdv = replaceOnce(
  rdv,
  `      setBookingResult(data)\n      setStep(3)\n`,
  `      setBookingResult(data)\n      setStep(4)\n`,
  'unpaid confirmation step',
)

rdv = replaceOnce(
  rdv,
  `  // ── Demande envoyée (step request-sent) ────────────────────────────────────\n`,
  `  function handlePaidComplete(result) {\n    if (checkoutStorageKey) sessionStorage.removeItem(checkoutStorageKey)\n    setBookingResult({\n      ...result,\n      amountCents: result.amountCents ?? service.reservationPaymentCents,\n      servicePriceCents: result.servicePriceCents ?? service.price_cents,\n      balanceCents: result.balanceCents ?? Math.max(0, service.price_cents - service.reservationPaymentCents),\n    })\n    setStep(4)\n  }\n\n  // ── Demande envoyée (step request-sent) ────────────────────────────────────\n`,
  'paid complete handler',
)

rdv = replaceOnce(
  rdv,
  `  // ── Confirmation (step 3) — UNIQUEMENT après INSERT réussi ─────────────────\n\n  if (step === 3 && bookingResult) {\n`,
  `  // ── Confirmation (step 4) — UNIQUEMENT après paiement/INSERT réussi ─────────\n\n  if (step === 4 && bookingResult) {\n`,
  'confirmation step',
)

rdv = replaceOnce(
  rdv,
  `            <h1 className="font-georgia font-medium text-3xl text-deep leading-tight mb-2">Votre rendez-vous est enregistré.</h1>\n            <p className="font-georgia text-mist text-base mb-8">Un email de confirmation vous sera envoyé prochainement.</p>\n`,
  `            <h1 className="font-georgia font-medium text-3xl text-deep leading-tight mb-2">Votre rendez-vous est confirmé.</h1>\n            <p className="font-georgia text-mist text-base mb-8">Vos arrhes ont été réglées et un e-mail de confirmation vous est envoyé.</p>\n`,
  'confirmation copy',
)

rdv = replaceOnce(
  rdv,
  `              <p className="font-georgia text-sm"><span className="text-mist">Modalité :</span> <strong>{service.modalityLabel}</strong></p>\n            </div>\n`,
  `              <p className="font-georgia text-sm"><span className="text-mist">Modalité :</span> <strong>{service.modalityLabel}</strong></p>\n              {bookingResult.amountCents != null && <p className="font-georgia text-sm"><span className="text-mist">Arrhes réglées :</span> <strong>{(bookingResult.amountCents / 100).toFixed(2).replace('.', ',')} €</strong></p>}\n              {bookingResult.balanceCents != null && <p className="font-georgia text-sm"><span className="text-mist">Solde restant :</span> <strong>{(bookingResult.balanceCents / 100).toFixed(2).replace('.', ',')} €</strong></p>}\n            </div>\n`,
  'confirmation payment summary',
)

rdv = replaceOnce(
  rdv,
  `                <ContactForm onSubmit={handleConfirm} loading={bookingLoading} error={bookingError} />\n              </div>\n            )}\n\n            {/* Step request-form — Demande de déplacement */}\n`,
  `                <ContactForm\n                  onSubmit={handleConfirm}\n                  loading={bookingLoading}\n                  error={bookingError}\n                  submitLabel={requiresDeposit ? \`Continuer vers le paiement des ${'${service.reservationPaymentLabel}'} d’arrhes →\` : 'Confirmer la réservation →'}\n                />\n              </div>\n            )}\n\n            {/* Step 3 — Paiement des arrhes */}\n            {step === 3 && requiresDeposit && paymentCustomer && checkoutId && (\n              <div>\n                <div className="flex items-center gap-3 mb-5">\n                  <button onClick={() => setStep(2)} className="font-georgia text-xs text-mist hover:text-deep">← Coordonnées</button>\n                  <h2 className="font-georgia font-medium text-xl">Paiement des arrhes</h2>\n                </div>\n                <RdvDepositCheckout\n                  practitionerSlug={slug}\n                  service={service}\n                  dateStr={toDateStr(date)}\n                  time={time}\n                  selectedModality={selectedModality}\n                  customer={paymentCustomer}\n                  checkoutId={checkoutId}\n                  onComplete={handlePaidComplete}\n                  onUnavailable={() => { setBookingError('Ce créneau n’est plus disponible.'); setTime(null); setStep(1) }}\n                />\n              </div>\n            )}\n\n            {/* Step request-form — Demande de déplacement */}\n`,
  'payment step render',
)

fs.writeFileSync(rdvPath, rdv)

const cancellationPath = new URL('../src/components/rdv/RdvCancellation.jsx', import.meta.url)
let cancellation = fs.readFileSync(cancellationPath, 'utf8')
const count24 = (cancellation.match(/24 heures/g) || []).length
if (count24 !== 1) throw new Error(`RdvCancellation: expected 1 visible 24 heures marker, found ${count24}`)
cancellation = cancellation.replace('24 heures', '48 heures')
fs.writeFileSync(cancellationPath, cancellation)

const bookPath = new URL('../api/rdv-book.js', import.meta.url)
let book = fs.readFileSync(bookPath, 'utf8')
book = book.replaceAll('24 heures', '48 heures')
book = book.replaceAll('24 h', '48 h')
fs.writeFileSync(bookPath, book)

console.log('✅ Interface arrhes RDV appliquée')
console.log('   - 20 € affichés selon la configuration serveur')
console.log('   - PayPal avant confirmation du rendez-vous')
console.log('   - visio + présentiel instantanés')
console.log('   - annulation automatique H-48')
