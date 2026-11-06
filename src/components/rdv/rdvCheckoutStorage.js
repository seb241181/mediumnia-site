// Identifiant de paiement d'un créneau, partagé entre les onglets du même navigateur
// (localStorage) : rouvrir la page ou revenir de l'application PayPal reprend le même
// paiement au lieu d'en créer un second. sessionStorage reste lu pour les paiements
// commencés avant cette version. Stockage indisponible : la page fonctionne sans.

export function rdvCheckoutKey(practitionerSlug, serviceId, dateStr, time) {
  return `mediumia:rdv-arrhes:${practitionerSlug}:${serviceId}:${dateStr}:${time}`
}

function storages() {
  const list = []
  try { if (globalThis.localStorage) list.push(globalThis.localStorage) } catch { /* bloqué */ }
  try { if (globalThis.sessionStorage) list.push(globalThis.sessionStorage) } catch { /* bloqué */ }
  return list
}

export function readCheckoutId(key) {
  if (!key) return null
  for (const store of storages()) {
    try {
      const value = store.getItem(key)
      if (value) return value
    } catch { /* bloqué */ }
  }
  return null
}

export function writeCheckoutId(key, id) {
  if (!key || !id) return
  for (const store of storages()) {
    try { store.setItem(key, id); return } catch { /* essai suivant */ }
  }
}

export function clearCheckoutId(key) {
  if (!key) return
  for (const store of storages()) {
    try { store.removeItem(key) } catch { /* bloqué */ }
  }
}
