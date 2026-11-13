// Profil du compte connecté : lecture et enregistrement via le serveur.

const ENDPOINT = '/api/rdv-config?accountAction=profile'

export async function fetchAccountProfile(token, fetcher = fetch) {
  if (!token) return null
  try {
    const response = await fetcher(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function saveAccountProfile(token, form, fetcher = fetch) {
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        preferredVideoChannel: form.preferredVideoChannel || null,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { error: data.error || 'account_unavailable' }
    return { profile: data.profile }
  } catch {
    return { error: 'account_unavailable' }
  }
}

export function profileErrorMessage(code) {
  if (code === 'invalid_phone') return 'Numéro de téléphone à vérifier. Pour un numéro étranger, commencez par l’indicatif (ex. +32…).'
  if (code === 'invalid_name') return 'Le prénom et le nom ne doivent pas dépasser 80 caractères.'
  if (code === 'too_many_requests') return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.'
  return 'Vos coordonnées n’ont pas pu être enregistrées. Réessayez dans un instant.'
}

// Valeurs de départ du formulaire de réservation pour une personne connectée.
// Seuls les champs vides sont proposés ; rien n'est imposé.
export function bookingPrefill(profile, isVideo = false) {
  if (!profile) return {}
  return {
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    phone: profile.phone || '',
    videoChannel: isVideo && profile.preferredVideoChannel ? profile.preferredVideoChannel : '',
  }
}
