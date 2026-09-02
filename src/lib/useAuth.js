import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/**
 * Authentification MediumIA Agents (Supabase email + mot de passe).
 * - restaure la session au chargement (getSession) ;
 * - suit les changements de session (onAuthStateChange) ;
 * - expose signUp / signIn / signOut.
 * Si Supabase n'est pas configuré (pas de variables Vite), reste inerte
 * sans jamais casser l'application.
 */
export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data?.session ?? null)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => {
      active = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  const signUp = useCallback(async (email, password) => {
    if (!supabase) return { data: null, error: new Error('Supabase non configuré') }
    return supabase.auth.signUp({ email, password })
  }, [])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) return { data: null, error: new Error('Supabase non configuré') }
    return supabase.auth.signInWithPassword({ email, password })
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return { error: null }
    return supabase.auth.signOut()
  }, [])

  return { session, user: session?.user ?? null, loading, signUp, signIn, signOut }
}
