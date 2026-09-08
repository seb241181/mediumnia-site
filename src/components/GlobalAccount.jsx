import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

const EMPTY_PROFILE = {
  full_name: '',
  birth_date: '',
  birth_time: '',
  birth_place: '',
}

function normalizeProfile(row) {
  return {
    full_name: row?.full_name || '',
    birth_date: row?.birth_date || '',
    birth_time: row?.birth_time ? String(row.birth_time).slice(0, 5) : '',
    birth_place: row?.birth_place || '',
  }
}

function setReactInputValue(input, value) {
  if (!input || !value || input.value) return false
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  if (!descriptor?.set) return false
  descriptor.set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

function readChronosphereForm() {
  const name = document.getElementById('chrono-name')
  if (!name) return null
  const form = name.closest('form')
  return {
    full_name: name.value || '',
    birth_date: document.getElementById('chrono-bdate')?.value || '',
    birth_time: document.getElementById('chrono-btime')?.value || '',
    birth_place: document.getElementById('chrono-bplace')?.value || '',
    email: form?.querySelector('input[type="email"]')?.value || '',
  }
}

function Recommendations({ user, profileComplete, onCreateAccount, onSaveProfile }) {
  return (
    <section className="rounded-3xl border-2 border-gold/25 bg-white/70 p-6 shadow-sm md:p-8">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Une idée peut en ouvrir une autre</p>
      <h2 className="mt-2 font-georgia text-2xl font-medium text-deep">Si ce tirage vous donne envie d’aller plus loin</h2>
      <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">
        Chronosphère reste un outil symbolique. Vous pouvez poursuivre seul, approfondir votre pratique ou choisir un accompagnement humain.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <a
          href="/rdv/sebastien-seguin"
          className="rounded-2xl border-2 border-gold/45 bg-gold/[.08] p-5 transition-colors hover:border-gold"
        >
          <span className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Guidance humaine</span>
          <strong className="mt-2 block font-georgia text-lg font-medium text-deep">Sébastien Seguin</strong>
          <span className="mt-2 block font-georgia text-sm leading-relaxed text-mist">Approfondir ce qui s’est ouvert dans le tirage avec un médium professionnel.</span>
          <span className="mt-4 block font-georgia text-sm font-bold text-deep">Voir les rendez-vous →</span>
        </a>

        <a
          href="/formation"
          className="rounded-2xl border-2 border-gold/25 bg-white p-5 transition-colors hover:border-gold/70"
        >
          <span className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Apprendre</span>
          <strong className="mt-2 block font-georgia text-lg font-medium text-deep">MediumIA</strong>
          <span className="mt-2 block font-georgia text-sm leading-relaxed text-mist">Développer votre propre pratique avec le parcours de médiumnité consciente.</span>
          <span className="mt-4 block font-georgia text-sm font-bold text-deep">Découvrir le parcours →</span>
        </a>

        <a
          href="/reseau"
          className="rounded-2xl border-2 border-gold/25 bg-white p-5 transition-colors hover:border-gold/70"
        >
          <span className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Rencontrer</span>
          <strong className="mt-2 block font-georgia text-lg font-medium text-deep">Réseau MediumIA</strong>
          <span className="mt-2 block font-georgia text-sm leading-relaxed text-mist">Explorer les praticiens du réseau et choisir l’accompagnement qui vous correspond.</span>
          <span className="mt-4 block font-georgia text-sm font-bold text-deep">Trouver un praticien →</span>
        </a>
      </div>

      {!user && (
        <div className="mt-5 rounded-2xl border border-gold/35 bg-deep/[.03] p-5 text-center">
          <p className="font-georgia text-sm leading-relaxed text-deep/80">
            Créez gratuitement votre compte MediumIA pour enregistrer vos informations de naissance et ne plus les saisir à chaque tirage.
          </p>
          <button type="button" onClick={onCreateAccount} className="mt-3 rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">
            Créer mon compte →
          </button>
        </div>
      )}

      {user && !profileComplete && (
        <div className="mt-5 rounded-2xl border border-gold/35 bg-deep/[.03] p-5 text-center">
          <p className="font-georgia text-sm leading-relaxed text-deep/80">
            Enregistrez les informations que vous venez de saisir pour préremplir vos prochains tirages.
          </p>
          <button type="button" onClick={onSaveProfile} className="mt-3 rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">
            Enregistrer dans mon profil →
          </button>
        </div>
      )}
    </section>
  )
}

export default function GlobalAccount() {
  const { user, loading: authLoading, signIn, signUp, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authInfo, setAuthInfo] = useState('')

  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [draft, setDraft] = useState(EMPTY_PROFILE)
  const [profileStatus, setProfileStatus] = useState('idle')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [recommendTarget, setRecommendTarget] = useState(null)

  const profileComplete = Boolean(profile.full_name && profile.birth_date && profile.birth_time && profile.birth_place)
  const accountLabel = useMemo(() => {
    if (!user) return 'Connexion'
    return profile.full_name?.trim().split(/\s+/)[0] || 'Mon compte'
  }, [user, profile.full_name])

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined
    const sync = () => setPathname(window.location.pathname)
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    window.addEventListener('popstate', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('popstate', sync)
    }
  }, [])

  useEffect(() => {
    if (!user || !supabase) {
      setProfile(EMPTY_PROFILE)
      setDraft(EMPTY_PROFILE)
      setProfileStatus('idle')
      return undefined
    }

    let active = true
    setProfileStatus('loading')
    supabase
      .from('mediumia_profiles')
      .select('full_name, birth_date, birth_time, birth_place')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setProfileStatus('error')
          setProfileError('Impossible de charger votre profil pour le moment.')
          return
        }
        const next = normalizeProfile(data)
        setProfile(next)
        setDraft(next)
        setProfileStatus('ready')
      })

    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!user || profileStatus !== 'ready' || !pathname.startsWith('/chronosphere')) return undefined

    const fill = () => {
      const name = document.getElementById('chrono-name')
      if (!name) return false
      const form = name.closest('form')
      setReactInputValue(name, profile.full_name)
      setReactInputValue(document.getElementById('chrono-bdate'), profile.birth_date)
      setReactInputValue(document.getElementById('chrono-btime'), profile.birth_time)
      setReactInputValue(document.getElementById('chrono-bplace'), profile.birth_place)
      setReactInputValue(form?.querySelector('input[type="email"]'), user.email || '')
      return true
    }

    if (fill()) return undefined
    const root = document.getElementById('root')
    if (!root) return undefined
    const observer = new MutationObserver(() => {
      if (fill()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname, profile, profileStatus, user])

  useEffect(() => {
    if (!pathname.startsWith('/chronosphere')) {
      setRecommendTarget(null)
      return undefined
    }

    const ensureTarget = () => {
      const act = Array.from(document.querySelectorAll('article')).find((node) =>
        node.textContent?.includes('Acte de réalignement'),
      )
      if (!act) {
        setRecommendTarget(null)
        return false
      }
      let host = document.getElementById('mediumia-chronosphere-recommendations')
      if (!host) {
        host = document.createElement('div')
        host.id = 'mediumia-chronosphere-recommendations'
        host.className = 'pt-1'
        act.insertAdjacentElement('afterend', host)
      }
      setRecommendTarget(host)
      return true
    }

    ensureTarget()
    const root = document.getElementById('root')
    if (!root) return undefined
    const observer = new MutationObserver(ensureTarget)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      const host = document.getElementById('mediumia-chronosphere-recommendations')
      host?.remove()
      setRecommendTarget(null)
    }
  }, [pathname])

  useEffect(() => {
    if (!user) return
    setMode('profile')
    setAuthError('')
    setAuthInfo('')
  }, [user])

  function openAuth(nextMode = 'signin') {
    setMode(user ? 'profile' : nextMode)
    setAuthError('')
    setAuthInfo('')
    setProfileError('')
    setProfileMessage('')
    if (user) {
      const chrono = readChronosphereForm()
      setDraft((current) => ({
        full_name: current.full_name || chrono?.full_name || '',
        birth_date: current.birth_date || chrono?.birth_date || '',
        birth_time: current.birth_time || chrono?.birth_time || '',
        birth_place: current.birth_place || chrono?.birth_place || '',
      }))
    }
    setOpen(true)
  }

  async function submitAuth(event) {
    event.preventDefault()
    if (authBusy) return
    setAuthBusy(true)
    setAuthError('')
    setAuthInfo('')
    const action = mode === 'signup' ? signUp : signIn
    const { data, error } = await action(email.trim(), password)
    setAuthBusy(false)
    if (error) {
      setAuthError(error.message || 'Une erreur est survenue.')
      return
    }
    if (mode === 'signup' && !data?.session) {
      setAuthInfo('Compte créé. Vérifiez votre e-mail pour confirmer votre adresse, puis connectez-vous.')
      setMode('signin')
      return
    }
    setPassword('')
  }

  async function saveProfile(event) {
    event?.preventDefault?.()
    if (!user || !supabase || profileStatus === 'saving') return
    setProfileStatus('saving')
    setProfileError('')
    setProfileMessage('')

    const payload = {
      user_id: user.id,
      full_name: draft.full_name.trim() || null,
      birth_date: draft.birth_date || null,
      birth_time: draft.birth_time || null,
      birth_place: draft.birth_place.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('mediumia_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select('full_name, birth_date, birth_time, birth_place')
      .single()

    if (error) {
      setProfileStatus('error')
      setProfileError('Impossible d’enregistrer votre profil. Réessayez.')
      return
    }
    const next = normalizeProfile(data)
    setProfile(next)
    setDraft(next)
    setProfileStatus('ready')
    setProfileMessage('Profil enregistré. Vos prochains tirages seront préremplis.')
  }

  async function clearProfile() {
    if (!user || !supabase) return
    setProfileStatus('saving')
    setProfileError('')
    const { error } = await supabase.from('mediumia_profiles').delete().eq('user_id', user.id)
    if (error) {
      setProfileStatus('error')
      setProfileError('Impossible d’effacer les informations enregistrées.')
      return
    }
    setProfile(EMPTY_PROFILE)
    setDraft(EMPTY_PROFILE)
    setProfileStatus('ready')
    setProfileMessage('Les informations de profil enregistrées ont été effacées.')
  }

  async function handleSignOut() {
    await signOut()
    setOpen(false)
    setPassword('')
    setProfileMessage('')
  }

  function openProfileFromChronosphere() {
    const chrono = readChronosphereForm()
    setDraft({
      full_name: chrono?.full_name || profile.full_name || '',
      birth_date: chrono?.birth_date || profile.birth_date || '',
      birth_time: chrono?.birth_time || profile.birth_time || '',
      birth_place: chrono?.birth_place || profile.birth_place || '',
    })
    setMode('profile')
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openAuth(user ? 'profile' : 'signin')}
        className="fixed bottom-5 left-5 z-[70] flex items-center gap-2 rounded-full border border-gold/45 bg-cream/95 px-4 py-3 font-georgia text-xs font-bold text-deep shadow-lg backdrop-blur-sm transition-colors hover:bg-white"
        aria-label={user ? 'Ouvrir mon compte MediumIA' : 'Se connecter à MediumIA'}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-deep text-gold">◈</span>
        <span>{authLoading ? 'Compte…' : accountLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-deep/65 backdrop-blur-sm" />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-cream p-6 text-deep shadow-2xl md:p-8" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 text-2xl leading-none text-mist hover:text-deep" aria-label="Fermer">×</button>

            {!user ? (
              <>
                <p className="text-center text-3xl text-gold">◈</p>
                <h2 className="mt-2 text-center font-georgia text-2xl font-medium">{mode === 'signup' ? 'Créer mon compte MediumIA' : 'Connexion MediumIA'}</h2>
                <p className="mt-2 text-center font-georgia text-sm leading-relaxed text-mist">
                  Un seul compte pour vos outils MediumIA, vos préférences et votre profil Chronosphère.
                </p>
                <form onSubmit={submitAuth} className="mt-6 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">E-mail</span>
                    <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Mot de passe</span>
                    <input type="password" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                  </label>
                  {authError && <p className="font-georgia text-sm text-red-600">{authError}</p>}
                  {authInfo && <p className="rounded-xl border border-gold/35 bg-gold/[.08] p-3 font-georgia text-sm text-deep">{authInfo}</p>}
                  <button type="submit" disabled={authBusy} className="w-full rounded-xl bg-deep px-6 py-3.5 font-georgia text-sm font-bold text-gold disabled:opacity-50">
                    {authBusy ? 'Un instant…' : (mode === 'signup' ? 'Créer mon compte' : 'Se connecter')}
                  </button>
                  <p className="text-center font-georgia text-sm text-mist">
                    {mode === 'signup' ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
                    <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setAuthError(''); setAuthInfo('') }} className="font-bold text-gold underline">
                      {mode === 'signup' ? 'Se connecter' : 'Créer un compte'}
                    </button>
                  </p>
                </form>
              </>
            ) : (
              <>
                <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Mon compte MediumIA</p>
                <h2 className="mt-2 font-georgia text-2xl font-medium">Mon profil</h2>
                <p className="mt-1 font-georgia text-xs text-mist">{user.email}</p>
                <p className="mt-4 rounded-xl border border-gold/25 bg-white/60 p-4 font-georgia text-xs leading-relaxed text-mist">
                  Les informations de naissance sont facultatives. Si vous choisissez de les enregistrer, elles servent à préremplir Chronosphère. Vous pouvez les modifier ou les effacer ici à tout moment.
                </p>

                <form onSubmit={saveProfile} className="mt-5 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Prénom et nom</span>
                    <input type="text" maxLength={120} autoComplete="name" value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Date de naissance</span>
                      <input type="date" value={draft.birth_date} onChange={(event) => setDraft({ ...draft, birth_date: event.target.value })} className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Heure de naissance</span>
                      <input type="time" value={draft.birth_time} onChange={(event) => setDraft({ ...draft, birth_time: event.target.value })} className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Lieu de naissance</span>
                    <input type="text" maxLength={180} value={draft.birth_place} onChange={(event) => setDraft({ ...draft, birth_place: event.target.value })} placeholder="Ville, pays" className="w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3 font-georgia outline-none focus:border-gold/70" />
                  </label>

                  {profileError && <p className="font-georgia text-sm text-red-600">{profileError}</p>}
                  {profileMessage && <p className="rounded-xl border border-gold/35 bg-gold/[.08] p-3 font-georgia text-sm text-deep">{profileMessage}</p>}

                  <button type="submit" disabled={profileStatus === 'saving'} className="w-full rounded-xl bg-gold px-6 py-3.5 font-georgia text-sm font-bold text-deep disabled:opacity-50">
                    {profileStatus === 'saving' ? 'Enregistrement…' : 'Enregistrer mon profil'}
                  </button>
                </form>

                <div className="mt-5 flex flex-col gap-2 border-t border-gold/20 pt-5 sm:flex-row sm:justify-between">
                  <button type="button" onClick={clearProfile} className="font-georgia text-xs text-mist underline hover:text-deep">Effacer mes informations enregistrées</button>
                  <button type="button" onClick={handleSignOut} className="rounded-lg border border-gold/45 px-4 py-2.5 font-georgia text-xs font-bold text-deep">Déconnexion</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {recommendTarget && createPortal(
        <Recommendations
          user={user}
          profileComplete={profileComplete}
          onCreateAccount={() => openAuth('signup')}
          onSaveProfile={openProfileFromChronosphere}
        />,
        recommendTarget,
      )}
    </>
  )
}
