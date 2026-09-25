import { supabase } from './supabase.js'

// Découverte déjà payée → Formation complète à 368 € au lieu de 397 €.
// Le prix est toujours décidé par le serveur, à partir du compte élève connecté.
// Le navigateur envoie seulement sa session et le prix qu'il affiche : une commande
// dont le montant ne correspond pas à ce prix affiché est refusée, jamais modifiée.

let shownFullAmount = null

export function setShownFullAmount(value) {
  shownFullAmount = value || null
}

export async function studentAccessToken() {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

export async function formationCheckoutHeaders() {
  const token = await studentAccessToken()
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(shownFullAmount ? { 'X-Mediumia-Expected-Full-Amount': shownFullAmount } : {}),
  }
}

export async function fetchFormationCredit(token) {
  const res = await fetch('/api/rdv-config?paypalAction=credit&product=full', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'credit_check_unavailable')
  return data
}

export async function sendFormationLoginLink(email) {
  if (!supabase) throw new Error('login_unavailable')
  const { error } = await supabase.auth.signInWithOtp({
    email: String(email || '').trim().toLowerCase(),
    options: { emailRedirectTo: `${window.location.origin}/formation#offre`, shouldCreateUser: false },
  })
  if (error) throw new Error('login_failed')
}

export function onStudentSessionChange(callback) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange(() => callback())
  return () => data?.subscription?.unsubscribe?.()
}
