// Espace client MediumIA — textes et mises en forme (fonctions pures, testées).
//
// Règles : ne rien inventer (un mode ou un canal inconnu reste « non
// enregistré »), ne jamais présenter comme encaissé un paiement en attente,
// ne jamais proposer de lien de visioconférence.

export const ACCOUNT_PATH = '/mon-espace'

const TZ = 'Europe/Paris'
const pad2 = (n) => String(n).padStart(2, '0')

export function formatEuros(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return '—'
  const value = Number(cents) / 100
  return `${value.toFixed(2).replace('.', ',').replace(/,00$/, '')} €`
}

export function formatBookingDate(iso, timezone = TZ) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(date)
  return day.charAt(0).toUpperCase() + day.slice(1)
}

export function formatBookingTime(iso, timezone = TZ) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date).replace(':', ' h ')
}

export function formatShortDate(iso, timezone = TZ) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(date)
}

const CHANNEL_LABELS = { whatsapp: 'WhatsApp', facetime: 'FaceTime' }

// Mode de consultation : « En présence », « À distance », ou non enregistré.
export function describeMode(booking = {}) {
  const phone = booking.contact?.phone || null
  if (booking.mode === 'in-person') {
    return { label: 'En présence', note: null }
  }
  if (booking.mode === 'video') {
    const channel = CHANNEL_LABELS[booking.videoChannel]
    if (channel) {
      return {
        label: `À distance — ${channel}`,
        note: `Le jour de votre rendez-vous, Sébastien vous contactera directement via ${channel}${phone ? `, au ${phone}` : ''}.`,
      }
    }
    return {
      label: 'À distance',
      note: `Le jour de votre rendez-vous, Sébastien vous contactera directement via WhatsApp ou FaceTime${phone ? `, au ${phone}` : ''}.`,
    }
  }
  return { label: 'Mode de consultation non enregistré', note: null }
}

export function describeStatus(booking = {}, now = new Date()) {
  if (booking.status === 'cancelled') {
    const origin = booking.cancellation?.origin
    const at = booking.cancellation?.at ? ` le ${formatShortDate(booking.cancellation.at)}` : ''
    if (origin === 'client') return { label: 'Annulé', tone: 'muted', detail: `Annulé par vos soins${at}.` }
    if (origin === 'unpaid_balance') return { label: 'Annulé', tone: 'muted', detail: `Annulé${at} : le solde n’avait pas été réglé à temps.` }
    return { label: 'Annulé', tone: 'muted', detail: at ? `Annulé${at}.` : null }
  }
  if (booking.status === 'no_show') return { label: 'Absence', tone: 'muted', detail: null }
  if (booking.status === 'rescheduled') return { label: 'Déplacé', tone: 'muted', detail: null }
  const ended = new Date(booking.endsAt || booking.startsAt).getTime() <= now.getTime()
  return ended ? { label: 'Terminé', tone: 'muted', detail: null } : { label: 'Confirmé', tone: 'ok', detail: null }
}

const METHOD_LABELS = {
  paypal: 'PayPal',
  card: 'Carte bancaire',
  cash: 'Espèces',
  check: 'Chèque',
  transfer: 'Virement',
  gift_card: 'Carte cadeau',
  other: null,
}

const KIND_LABELS = {
  arrhes: 'Arrhes',
  balance: 'Solde',
  full_payment: 'Règlement intégral',
  refund: 'Remboursement',
  arrhes_retained: 'Arrhes conservées',
  adjustment: 'Ajustement',
}

// Une ligne de règlement réellement enregistrée.
export function describePayment(payment = {}) {
  const refund = payment.direction === 'refund'
  let label = KIND_LABELS[payment.kind] || 'Règlement'
  if (payment.kind === 'deposit_transfer') label = refund ? 'Arrhes reportées sur un autre rendez-vous' : 'Arrhes reportées depuis un autre rendez-vous'
  return {
    label,
    method: METHOD_LABELS[payment.method] || null,
    date: payment.occurredAt ? formatShortDate(payment.occurredAt) : null,
    amount: `${refund ? '− ' : ''}${formatEuros(payment.amountCents)}`,
    refund,
  }
}

// Lignes de montants d'un rendez-vous, dans l'ordre où le client les lit.
export function describeAmounts(booking = {}) {
  const a = booking.amounts || {}
  const lines = []
  lines.push({ key: 'price', label: 'Prix de la prestation', value: a.priceCents == null ? 'Non enregistré' : formatEuros(a.priceCents) })
  if (a.depositPaidCents > 0) lines.push({ key: 'deposit', label: 'Arrhes encaissées', value: formatEuros(a.depositPaidCents) })
  if (a.fullPaymentCents > 0) lines.push({ key: 'full', label: 'Règlement intégral encaissé', value: formatEuros(a.fullPaymentCents) })
  if (a.balancePaidCents > 0) lines.push({ key: 'balance', label: 'Solde réglé', value: formatEuros(a.balancePaidCents) })
  if (a.refundedCents > 0) lines.push({ key: 'refund', label: 'Remboursé', value: `− ${formatEuros(a.refundedCents)}` })
  if (a.dueCents != null) {
    lines.push({ key: 'due', label: 'Reste à régler', value: formatEuros(a.dueCents), strong: true })
  }

  let note = null
  if (a.paymentPending) {
    note = 'Un paiement est en cours de validation : il n’est pas encore encaissé et n’est donc pas compté ci-dessus.'
  } else if (a.dueCents > 0 && booking.mode === 'video') {
    note = 'Avant votre rendez-vous, vous recevez par e-mail un lien sécurisé pour régler ce solde.'
  } else if (a.dueCents > 0 && booking.mode === 'in-person') {
    note = 'Ce solde se règle le jour du rendez-vous.'
  } else if (a.dueCents === 0 && a.priceCents != null && a.priceCents > 0) {
    note = 'Cette prestation est entièrement réglée.'
  }
  return { lines, note }
}

// Tous les règlements du compte, du plus récent au plus ancien.
export function listAllPayments(overview = {}) {
  const rows = []
  for (const booking of [...(overview.upcoming || []), ...(overview.past || [])]) {
    for (const payment of booking.payments || []) {
      rows.push({ ...describePayment(payment), bookingId: booking.id, serviceTitle: booking.serviceTitle, bookingDate: formatShortDate(booking.startsAt, booking.timezone), sortAt: payment.occurredAt || booking.startsAt })
    }
  }
  return rows.sort((x, y) => new Date(y.sortAt).getTime() - new Date(x.sortAt).getTime())
}

const utcStamp = (date) => `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}00Z`

// Ajout au calendrier (Google Agenda et fichier .ics), sans aucun lien de visio.
export function bookingCalendarLinks(booking = {}, now = new Date()) {
  const start = new Date(booking.startsAt)
  const end = new Date(booking.endsAt || start.getTime() + (booking.durationMin || 60) * 60_000)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null
  const title = `Rendez-vous MediumIA — ${booking.serviceTitle || 'Consultation'}`
  const mode = describeMode(booking)
  const details = [
    `${booking.serviceTitle || 'Consultation'}${booking.practitionerName ? ` avec ${booking.practitionerName}` : ''}.`,
    booking.mode ? mode.label + '.' : null,
    mode.note,
    'Retrouvez ce rendez-vous dans votre espace MediumIA : https://mediumia.fr/mon-espace',
  ].filter(Boolean).join(' ')
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${utcStamp(start)}/${utcStamp(end)}`, details,
  })
  const esc = (value) => String(value).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MediumIA//Rendez-vous//FR', 'BEGIN:VEVENT',
    `UID:${booking.id || utcStamp(start)}@mediumia.fr`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(details)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  return { google, ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` }
}

// Message compréhensible pour une erreur de connexion par code.
export function emailCodeErrorMessage(error) {
  const raw = String(error?.message || error || '').toLowerCase()
  if (/rate limit|too many|security purposes|seconds/.test(raw)) return 'Vous avez demandé plusieurs codes à la suite. Patientez une minute, puis réessayez.'
  if (/expired|invalid|otp|token/.test(raw)) return 'Ce code n’est pas valable ou a expiré. Vérifiez les chiffres ou demandez un nouveau code.'
  if (/fetch|network|failed to/.test(raw)) return 'Connexion impossible pour le moment. Vérifiez votre accès à Internet et réessayez.'
  return 'Une erreur est survenue. Réessayez dans un instant.'
}

// Supabase refuse d'envoyer un code à une adresse sans compte quand on ne
// demande pas la création : on ne le révèle pas à l'écran.
export function isUnknownAccountError(error) {
  return /signups not allowed|user not found/i.test(String(error?.message || ''))
}

// ── Mot de passe ─────────────────────────────────────────────────────────────
export const PASSWORD_MIN_LENGTH = 8

export function passwordProblem(password, confirmation) {
  if (String(password || '').length < PASSWORD_MIN_LENGTH) return `Choisissez un mot de passe d’au moins ${PASSWORD_MIN_LENGTH} caractères.`
  if (confirmation !== undefined && password !== confirmation) return 'Les deux mots de passe ne sont pas identiques.'
  return null
}

export function passwordErrorMessage(error) {
  const raw = String(error?.message || error || '').toLowerCase()
  // Même message que l'adresse existe ou non : on ne révèle pas qui a un compte.
  if (/invalid login credentials|invalid_credentials/.test(raw)) return 'Adresse e-mail ou mot de passe incorrect. Vous pouvez aussi recevoir un code par e-mail.'
  if (/email not confirmed/.test(raw)) return 'Votre adresse e-mail n’est pas encore confirmée. Connectez-vous avec un code reçu par e-mail.'
  if (/reauthentication|reauth/.test(raw)) return 'Pour votre sécurité, déconnectez-vous puis reconnectez-vous avec un code reçu par e-mail avant de changer le mot de passe.'
  if (/different from the old|same_password/.test(raw)) return 'Ce mot de passe est déjà le vôtre. Choisissez-en un autre.'
  if (/weak|at least|should contain|pwned|password/.test(raw)) return 'Ce mot de passe n’est pas assez sûr. Choisissez-en un plus long, avec des lettres et des chiffres.'
  if (/rate limit|too many|security purposes|seconds/.test(raw)) return 'Trop de tentatives. Patientez une minute, puis réessayez.'
  if (/fetch|network|failed to/.test(raw)) return 'Connexion impossible pour le moment. Vérifiez votre accès à Internet et réessayez.'
  return 'Une erreur est survenue. Réessayez dans un instant.'
}

// Retour depuis l'e-mail « mot de passe oublié ».
export function isPasswordRecoveryUrl(hash = '', search = '') {
  return /(^|[#&?])type=recovery(&|$)/.test(String(hash)) || /(^|[#&?])type=recovery(&|$)/.test(String(search))
}

// Prénom affiché sur le bouton « Mon espace ».
export function accountButtonLabel({ user, firstName, fullName } = {}) {
  if (!user) return 'Mon espace'
  const name = String(firstName || '').trim() || String(fullName || '').trim().split(/\s+/)[0]
  return name || 'Mon espace'
}
