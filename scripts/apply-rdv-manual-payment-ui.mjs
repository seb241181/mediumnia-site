import fs from 'node:fs'

const accountingPath = 'src/components/rdv/AccountingSection.jsx'

let source = fs.readFileSync(accountingPath, 'utf8')
let changed = false

if (!source.includes("import ManualPaymentModal from './ManualPaymentModal.jsx'")) {
  const marker = "import { useEffect, useMemo, useState } from 'react'\n"
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_import_marker_missing')
  source = source.replace(marker, `${marker}import ManualPaymentModal from './ManualPaymentModal.jsx'\n`)
  changed = true
}

if (source.includes('export default function AccountingSection({ practitionerId, session })')) {
  source = source.replace(
    'export default function AccountingSection({ practitionerId, session })',
    'export default function AccountingSection({ practitionerId, session, services = [], upcomingBookings = [] })'
  )
  changed = true
}

if (!source.includes('const [manualPayment, setManualPayment]')) {
  const marker = "  const [error, setError] = useState(null)\n"
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_state_marker_missing')
  source = source.replace(marker, `${marker}  const [manualPayment, setManualPayment] = useState(null)\n  const [refreshNonce, setRefreshNonce] = useState(0)\n`)
  changed = true
}

if (source.includes('  }, [practitionerId, session, month])')) {
  source = source.replace('  }, [practitionerId, session, month])', '  }, [practitionerId, session, month, refreshNonce])')
  changed = true
}
if (source.includes('  }, [practitionerId, session, month, dayNonce])')) {
  source = source.replace('  }, [practitionerId, session, month, dayNonce])', '  }, [practitionerId, session, month, dayNonce, refreshNonce])')
  changed = true
}

if (!source.includes("window.addEventListener('mediumia:manual-payment'")) {
  const marker = "  const entries = data?.entries || []\n"
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_listener_marker_missing')
  const listener = `  useEffect(() => {\n    const openFromBooking = event => {\n      const bookingId = event?.detail?.bookingId || null\n      setManualPayment({ bookingId })\n    }\n    window.addEventListener('mediumia:manual-payment', openFromBooking)\n    return () => window.removeEventListener('mediumia:manual-payment', openFromBooking)\n  }, [])\n\n`
  source = source.replace(marker, `${listener}${marker}`)
  changed = true
}

if (source.includes('<section className="rounded-2xl border border-gold/25 bg-white/60 p-6">')) {
  source = source.replace(
    '<section className="rounded-2xl border border-gold/25 bg-white/60 p-6">',
    '<section id="mediumia-accounting" className="rounded-2xl border border-gold/25 bg-white/60 p-6">'
  )
  changed = true
}

if (!source.includes('Ajouter un encaissement')) {
  const marker = `        <div className="flex flex-wrap gap-2 sm:justify-end">\n          <input`
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_button_marker_missing')
  source = source.replace(marker, `        <div className="flex flex-wrap gap-2 sm:justify-end">\n          <button\n            type="button"\n            onClick={() => setManualPayment({ bookingId: null })}\n            className="rounded-xl border border-gold/35 bg-gold/10 px-4 py-2 font-georgia text-xs font-semibold text-deep transition-colors hover:bg-gold/20"\n          >\n            + Ajouter un encaissement\n          </button>\n          <input`)
  changed = true
}

if (!source.includes("sourceLabel(entry.source)")) {
  const paymentMarker = `function paymentLabel(value) {\n  const labels = { paypal: 'PayPal', cash: 'Espèces', check: 'Chèque', card: 'Carte', transfer: 'Virement', manual: 'Manuel' }\n  return labels[value] || value || '—'\n}\n`
  if (!source.includes(paymentMarker)) throw new Error('rdv_manual_ui_source_label_marker_missing')
  const addition = `${paymentMarker}\nfunction sourceLabel(value) {\n  const labels = { mediumia: 'MediumIA', reservio: 'Reservio', manual: 'Manuel' }\n  return labels[value] || value || '—'\n}\n`
  source = source.replace(paymentMarker, addition)
  changed = true
}

if (source.includes("['Date encaissement', 'Client', 'Prestation', 'Type', 'Moyen de paiement', 'TTC', 'HT', 'TVA', 'Date rendez-vous', 'Référence paiement']")) {
  source = source.replace(
    "['Date encaissement', 'Client', 'Prestation', 'Type', 'Moyen de paiement', 'TTC', 'HT', 'TVA', 'Date rendez-vous', 'Référence paiement']",
    "['Date encaissement', 'Client', 'Prestation', 'Source', 'Type', 'Moyen de paiement', 'TTC', 'HT', 'TVA', 'Date rendez-vous', 'Référence paiement']"
  )
  const marker = `        entry.service_title || '',\n        entryLabel(entry.entry_kind),`
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_csv_source_marker_missing')
  source = source.replace(marker, `        entry.service_title || '',\n        sourceLabel(entry.source),\n        entryLabel(entry.entry_kind),`)
  changed = true
}

if (source.includes("['Encaissement', 'Client', 'Prestation', 'Type', 'TTC', 'HT', 'TVA', 'Paiement', 'RDV']")) {
  source = source.replace(
    "['Encaissement', 'Client', 'Prestation', 'Type', 'TTC', 'HT', 'TVA', 'Paiement', 'RDV']",
    "['Encaissement', 'Client', 'Prestation', 'Source', 'Type', 'TTC', 'HT', 'TVA', 'Paiement', 'RDV']"
  )
  const marker = `                      <td className="max-w-[220px] px-3 py-3 font-georgia text-xs text-mist">{entry.service_title || '—'}</td>\n                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{entryLabel(entry.entry_kind)}</td>`
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_table_source_marker_missing')
  source = source.replace(marker, `                      <td className="max-w-[220px] px-3 py-3 font-georgia text-xs text-mist">{entry.service_title || '—'}</td>\n                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{sourceLabel(entry.source)}</td>\n                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{entryLabel(entry.entry_kind)}</td>`)
  changed = true
}

if (!source.includes('<ManualPaymentModal')) {
  const marker = `    </section>\n  )\n}`
  if (!source.includes(marker)) throw new Error('rdv_manual_ui_modal_marker_missing')
  const modal = `      {manualPayment && (\n        <ManualPaymentModal\n          practitionerId={practitionerId}\n          session={session}\n          services={services}\n          upcomingBookings={upcomingBookings}\n          initialBookingId={manualPayment.bookingId}\n          onClose={() => setManualPayment(null)}\n          onSaved={() => setRefreshNonce(value => value + 1)}\n        />\n      )}\n    </section>\n  )\n}`
  source = source.replace(marker, modal)
  changed = true
}

if (changed) fs.writeFileSync(accountingPath, source)
console.log('MediumIA RDV: manual payment accounting UI applied')
