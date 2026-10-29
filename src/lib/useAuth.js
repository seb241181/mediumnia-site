import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { clearChronosphereMaxOtherUserState, clearChronosphereMaxUserState } from './chronosphereMaxSession.js'

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
    let authEventSeen = false
    let currentUserId = null
    const applySession = (nextSession) => {
      const nextUserId = nextSession?.user?.id || null
      if (currentUserId && currentUserId !== nextUserId) clearChronosphereMaxUserState(currentUserId)
      clearChronosphereMaxOtherUserState(nextUserId)
      currentUserId = nextUserId
      setSession(nextSession ?? null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!active || authEventSeen) return
      applySession(data?.session)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      authEventSeen = true
      applySession(nextSession)
    })
    return () => {
      active = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  const signUp = useCallback(async (email, password, options) => {
    if (!supabase) return { data: null, error: new Error('Supabase non configuré') }
    return supabase.auth.signUp(options ? { email, password, options } : { email, password })
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
