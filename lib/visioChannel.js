/**
 * Visio de Sébastien = WhatsApp ou FaceTime, JAMAIS Google Meet.
 *
 * - WhatsApp dit explicitement → « Visio — WhatsApp »
 * - FaceTime dit explicitement → « Visio — FaceTime »
 * - « visio » seulement / canal inconnu → « Visio — canal à confirmer »
 *
 * Aucun module ne crée de visioconférence Google, et aucun ancien lien Meet
 * (colonne historique bookings.google_meet_link) n'est jamais renvoyé.
 */

export const VIDEO_CHANNELS = ['whatsapp', 'facetime', 'a_preciser']
export const VIDEO_CHANNEL_LABELS = { whatsapp: 'WhatsApp', facetime: 'FaceTime', a_preciser: 'canal à confirmer' }

export function visioLabel(channel = 'a_preciser') {
  const value = VIDEO_CHANNELS.includes(channel) ? channel : 'a_preciser'
  return `Visio — ${VIDEO_CHANNEL_LABELS[value]}`
}

// Une prestation dont la seule modalité est la visio.
export const isVideoOnly = (modality) => Array.isArray(modality) && modality.length > 0 && modality.every((m) => m === 'video')

// Texte d'accompagnement quand le canal n'est pas encore connu.
export const VISIO_PENDING_NOTE = 'Sébastien vous précisera le canal de la séance : WhatsApp ou FaceTime.'
