// Journal des échecs du parcours de paiement des rendez-vous.
// Aucune donnée personnelle : ni nom, ni e-mail, ni adresse IP, ni identifiant PayPal
// complet. Seulement un code, l'étape, le créneau et le type d'appareil.

// Codes qu'un navigateur peut signaler (tout autre code est refusé).
export const CLIENT_EVENT_CODES = new Set([
  'paypal_sdk_load_failed',
  'paypal_render_failed',
  'paypal_onerror',
  'paypal_cancelled',
  'paypal_restart',
  'capture_network_error',
])

export function clientKind(userAgent) {
  const ua = String(userAgent || '')
  if (!ua) return 'unknown'
  // Navigateurs intégrés (Facebook, Instagram, TikTok, Snapchat, WebView Android…).
  if (/FBAN|FBAV|Instagram|TikTok|musical_ly|Snapchat|Line\/|GSA\/|; wv\)/i.test(ua)) return 'in_app'
  if (/Mobi|iPhone|iPad|Android/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function checkoutRef(checkoutId) {
  const ref = String(checkoutId || '').slice(0, 8).toLowerCase()
  return /^[0-9a-f]{8}$/.test(ref) ? ref : null
}

export function buildCheckoutEvent({ source = 'server', action, code, status = null, checkoutId = null, practitionerId = null, startsAt = null, req = null }) {
  return {
    source,
    action: String(action || 'unknown').slice(0, 40),
    error_code: String(code || 'unknown').slice(0, 80),
    http_status: Number.isInteger(status) ? status : null,
    checkout_ref: checkoutRef(checkoutId),
    practitioner_id: practitionerId || null,
    slot_starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    client_kind: clientKind(req?.headers?.['user-agent']),
  }
}

// Ne fait jamais échouer le paiement : un journal indisponible est seulement signalé.
export async function recordCheckoutEvent(supabase, event) {
  const row = buildCheckoutEvent(event)
  console.warn(`[rdv-checkout] ${row.source} ${row.action} ${row.error_code} ${row.http_status ?? '-'} ${row.client_kind} ${row.checkout_ref ?? '-'}`)
  try {
    const { error } = await supabase.from('rdv_checkout_events').insert(row)
    // 23505 : erreur client déjà signalée pour ce paiement.
    if (error && error.code !== '23505') console.error(`[rdv-checkout] journal indisponible : ${error.code || 'unknown'}`)
  } catch {
    console.error('[rdv-checkout] journal indisponible')
  }
}
