import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/useAuth.js'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { fetchAccountProfile } from '../lib/accountProfile.js'
import { accountButtonLabel } from '../lib/accountView.js'

// Bouton « Mon espace » de l'en-tête, sur ordinateur et sur téléphone.
// Non connecté : lien vers /mon-espace. Connecté : prénom, puis menu avec les
// rendez-vous, le profil et la déconnexion.

const ACCOUNT_MENU_EVENT = 'mediumia:open-account'

const button = 'site-nav__account font-georgia text-xs md:text-sm tracking-wide px-3 py-2.5 md:px-4 rounded-lg border border-gold/60 text-deep font-bold whitespace-nowrap transition-colors hover:bg-gold/10 inline-flex items-center gap-1.5'
const item = 'block w-full px-4 py-3 text-left font-georgia text-sm text-deep hover:bg-gold/10'

export default function SiteNavAccount() {
  const { user, session, signOut } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const token = session?.access_token || null

  useEffect(() => {
    if (!token) return undefined
    let active = true
    fetchAccountProfile(token).then((data) => { if (active) setFirstName(data?.profile?.firstName || '') })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!isSupabaseConfigured()) return null

  if (!user) {
    return <a href="/mon-espace" data-site-nav-account className={button} aria-label="Mon espace MediumIA"><span aria-hidden="true" className="site-nav__account-icon text-gold">◈</span><span className="site-nav__account-label">Mon espace</span></a>
  }

  const label = accountButtonLabel({ user, firstName })
  return (
    <div ref={wrapRef} data-site-nav-account className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={`Mon espace MediumIA — ${label}`} className={button}>
        <span aria-hidden="true" className="site-nav__account-icon text-gold">◈</span>
        <span className="site-nav__account-label max-w-[5.5rem] truncate md:max-w-[9rem]">{label}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Mon espace" className="absolute right-0 top-full z-[60] mt-2 w-60 overflow-hidden rounded-2xl border border-gold/30 bg-cream shadow-xl">
          <p className="break-all border-b border-gold/20 px-4 py-3 font-georgia text-xs text-mist">{user.email}</p>
          <a role="menuitem" href="/mon-espace" className={item}>Mes rendez-vous</a>
          <a role="menuitem" href="/mon-espace#profil" className={item}>Mon profil</a>
          <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); window.dispatchEvent(new Event(ACCOUNT_MENU_EVENT)) }}>Mon profil de tirage</button>
          <button role="menuitem" type="button" className={`${item} border-t border-gold/20 font-bold`} onClick={async () => { setOpen(false); await signOut() }}>Déconnexion</button>
        </div>
      )}
    </div>
  )
}
