export function getRdvEmailConfirmation(emailStatus) {
  const status = String(emailStatus || '').trim().toLowerCase()

  if (status === 'sent' || status === 'already_sent') {
    return {
      sent: true,
      message: status === 'already_sent'
        ? 'Le service d’envoi avait déjà accepté l’e-mail de confirmation.'
        : 'Le service d’envoi a accepté l’e-mail de confirmation.',
    }
  }

  if (status === 'not_configured' || status === 'not_sent_token_error') {
    return {
      sent: false,
      message: 'Aucun e-mail de confirmation n’a été envoyé automatiquement. Votre rendez-vous reste confirmé; conservez les détails affichés ci-dessous.',
    }
  }

  return {
    sent: null,
    message: 'Votre rendez-vous est confirmé. L’envoi de l’e-mail n’a pas pu être vérifié; conservez les détails affichés ci-dessous.',
  }
}
