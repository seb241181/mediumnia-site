// Lien reçu par e-mail : #confirmer=<jeton> ou #desinscription=<jeton>.
export function readEmailLinkFragment(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  for (const kind of ['confirmer', 'desinscription']) {
    const token = (params.get(kind) || '').trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(token)) return { kind, token }
  }
  return null
}
