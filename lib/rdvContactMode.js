/* global process */
/**
 * Mode de consultation choisi à la réservation : en présence, ou à distance
 * par WhatsApp ou FaceTime (jamais de lien de visioconférence).
 *
 * Tout est « au mieux » : une erreur ici (colonne absente tant que la
 * migration 20261111101000 n'est pas appliquée, base indisponible…) ne doit
 * JAMAIS bloquer un paiement, une confirmation ou un e-mail. Dans ce cas le
 * canal reste simplement « à confirmer », comme avant.
 */

const CHANNELS = new Set(['whatsapp', 'facetime'])
const MODALITIES = new Set(['video', 'in-person'])

// Seul un choix explicite est retenu ; tout le reste vaut « non précisé ».
export function normalizeVideoChannel(value) {
  const channel = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return CHANNELS.has(channel) ? channel : null
}

// Modalité d'une prestation qui n'en propose qu'une (sinon inconnue).
export function singleModality(modality) {
  return Array.isArray(modality) && modality.length === 1 && MODALITIES.has(modality[0]) ? modality[0] : null
}

// Blocage (paiement en cours) : mémorise le canal choisi.
export async function saveHoldVideoChannel(supabase, holdId, { selectedModality, videoChannel } = {}) {
  const channel = normalizeVideoChannel(videoChannel)
  if (!holdId || selectedModality !== 'video' || !channel) return false
  try {
    const { error } = await supabase.from('rdv_booking_holds').update({ video_channel: channel }).eq('id', holdId)
    return !error
  } catch {
    return false
  }
}

// Rendez-vous confirmé : écrit la modalité et le canal (sans jamais écraser
// une valeur déjà enregistrée).
export async function saveBookingContactMode(supabase, bookingId, { modality, videoChannel } = {}) {
  if (!bookingId || !MODALITIES.has(modality)) return false
  const channel = modality === 'video' ? normalizeVideoChannel(videoChannel) : null
  try {
    const { error } = await supabase.from('bookings')
      .update({ modality, video_channel: channel })
      .eq('id', bookingId)
      .is('modality', null)
    return !error
  } catch {
    return false
  }
}

// Après paiement : recopie le choix du blocage vers le rendez-vous et le renvoie.
export async function applyHoldContactModeToBooking(supabase, bookingId) {
  if (!bookingId) return { modality: null, videoChannel: null }
  try {
    const { data, error } = await supabase.from('rdv_booking_holds')
      .select('selected_modality, video_channel')
      .eq('converted_booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return { modality: null, videoChannel: null }
    const modality = MODALITIES.has(data.selected_modality) ? data.selected_modality : null
    const videoChannel = modality === 'video' ? normalizeVideoChannel(data.video_channel) : null
    if (modality) await saveBookingContactMode(supabase, bookingId, { modality, videoChannel })
    return { modality, videoChannel }
  } catch {
    return { modality: null, videoChannel: null }
  }
}

// Canaux enregistrés pour une liste de rendez-vous (rappels) : Map id → canal.
export async function loadBookingVideoChannels(supabase, bookingIds = []) {
  const channels = new Map()
  if (!bookingIds.length) return channels
  try {
    const { data, error } = await supabase.from('bookings').select('id, video_channel').in('id', bookingIds)
    if (error) return channels
    for (const row of data || []) {
      const channel = normalizeVideoChannel(row.video_channel)
      if (channel) channels.set(row.id, channel)
    }
  } catch { /* canal inconnu : « à confirmer » */ }
  return channels
}

// Adresse de l'espace client, rappelée dans les e-mails de rendez-vous.
export function accountSpaceUrl() {
  // En Preview, le lien reste sur le déploiement Preview (comme le lien d'annulation).
  const previewHost = process.env.VERCEL_ENV === 'preview' ? (process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL) : null
  const base = previewHost ? `https://${previewHost}` : (process.env.BOOKING_PUBLIC_URL?.trim() || 'https://mediumia.fr')
  return `${base.replace(/\/+$/, '')}/mon-espace`
}

export const ACCOUNT_SPACE_NOTE = 'Retrouvez à tout moment ce rendez-vous, vos règlements et les informations pratiques dans votre espace personnel MediumIA. C’est gratuit : connectez-vous avec votre mot de passe ou avec un code reçu par e-mail.'

// Rappel de l'espace client dans un e-mail de rendez-vous (HTML et texte).
export function accountSpaceEmailBlock(url) {
  if (!url) return { html: '', text: [] }
  const safe = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return {
    html: `<div style="margin:22px 0;padding:15px 17px;border:1px solid #E5D9B6;border-radius:10px;font-size:13px;line-height:1.65;color:#4A3F6B;"><strong>Votre espace personnel MediumIA</strong><br>${ACCOUNT_SPACE_NOTE}<br><a href="${safe}" style="color:#1A1535;font-weight:bold;">Ouvrir mon espace MediumIA</a></div>`,
    text: ['Votre espace personnel MediumIA', ACCOUNT_SPACE_NOTE, url, ''],
  }
}
