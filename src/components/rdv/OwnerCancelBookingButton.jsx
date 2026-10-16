import { useState } from 'react'

const ERRORS = {
  preview_booking_cancel_disabled: 'La prévisualisation reste en lecture seule.',
  invalid_cancellation_request: 'Demande d’annulation invalide.',
  booking_not_found: 'Ce rendez-vous est introuvable.',
  booking_not_confirmed: 'Ce rendez-vous n’est plus confirmé.',
  past_booking_cannot_cancel: 'Un rendez-vous passé ne peut pas être annulé ici.',
  gift_card_requires_manual_review: 'Carte cadeau détectée : cette annulation nécessite une vérification manuelle.',
  payment_review_unavailable: 'Le système de vérification financière est indisponible : annulation bloquée par sécurité.',
  payment_in_progress_requires_review: 'Un paiement PayPal est en cours ou incertain. Vérifiez son état avant d’annuler ce rendez-vous.',
  payment_reconciliation_required: 'Un paiement existe chez le prestataire ou des arrhes sont attendues, mais la caisse ne permet pas de le confirmer. Vérification nécessaire avant annulation.',
  google_delete_unconfirmed: 'Google Agenda n’a pas confirmé la suppression : annulation bloquée.',
  booking_update_unconfirmed: 'Google et MediumIA doivent être vérifiés avant une nouvelle tentative.',
  booking_status_changed: 'Le rendez-vous a changé entre-temps. Rechargez la page.',
  forbidden: 'Accès non autorisé.',
}

export default function OwnerCancelBookingButton({ booking, practitionerId, session, onChanged, enabled = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (booking.status !== 'confirmed' || Date.parse(booking.starts_at) <= Date.now()) return null
  if (!enabled) return (
    <span className="font-georgia text-[11px] text-mist" title="L'annulation manuelle sera disponible après validation des tests.">
      Annulation en préparation
    </span>
  )

  async function cancel() {
    const time = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(booking.starts_at))
    if (!window.confirm(
      `Annuler le rendez-vous du ${time} ?\n\nIl disparaîtra de l'agenda actif et l'événement Google sera supprimé si synchronisé.\n\nAUCUN remboursement n'est lancé automatiquement. Les arrhes, soldes et autres écritures restent conservés. Confirmer ?`
    )) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/rdv-admin?action=bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: booking.id,
          practitioner_id: practitionerId,
          operation: 'cancel_owner',
          confirm: true,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.ok) throw new Error(ERRORS[body.error] || 'Annulation indisponible pour le moment.')
      const warnings = []
      if (body.email_status !== 'sent') warnings.push('L’e-mail au client n’est pas confirmé : prévenez-le directement.')
      if (body.financial_review_required) warnings.push('Un règlement existe : traitez séparément les arrhes ou remboursements depuis la caisse.')
      if (warnings.length) window.alert(`Rendez-vous annulé dans MediumIA.\n\n${warnings.join('\n')}`)
      window.dispatchEvent(new CustomEvent('mediumia:booking-cancelled'))
      onChanged?.(body)
    } catch (err) {
      setError(err.message || 'Erreur réseau.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={cancel}
        className="rounded-lg border border-red-200 bg-white/70 px-3 py-2 font-georgia text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? 'Annulation…' : 'Annuler le RDV'}
      </button>
      {error && <span role="alert" className="max-w-xs font-georgia text-xs text-red-700">{error}</span>}
    </span>
  )
}
