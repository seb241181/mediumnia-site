import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/useAuth.js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.js'
import { setRememberMe } from '../../lib/authStorage.js'
import { NewPasswordForm } from './PasswordForms.jsx'
import EmailPreferences from './EmailPreferences.jsx'
import ProfileForm from './ProfileForm.jsx'
import {
  ACCOUNT_PATH,
  bookingCalendarLinks,
  canPayBalanceFromAccount,
  openBalancePayment,
  formatEuros,
  describeAmounts,
  describeMode,
  describeStatus,
  emailCodeErrorMessage,
  formatBookingDate,
  formatBookingTime,
  isPasswordRecoveryUrl,
  isUnknownAccountError,
  listAllPayments,
  passwordErrorMessage,
} from '../../lib/accountView.js'

// Mon espace client MediumIA : rendez-vous à venir, historique et règlements.
// Lecture seule. Les données viennent du serveur, pour le compte connecté.

const input = 'w-full rounded-xl border-2 border-gold/25 bg-white px-4 py-3.5 font-georgia text-base text-deep outline-none focus:border-gold/70'
const label = 'mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist'
const primary = 'w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50'
const secondary = 'w-full rounded-xl border-2 border-gold/45 px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/10 disabled:opacity-50'

function Shell({ children, right }) {
  return (
    <div className="cosmic-page cosmic-page--rdv min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <a href="/" className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</a>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">{children}</main>
    </div>
  )
}

// ── Connexion par code reçu par e-mail ───────────────────────────────────────

function SignIn({ sendEmailCode, verifyEmailCode, signIn, requestPasswordReset }) {
  const [email, setEmail] = useState('')
  const [mode, setMode] = useState('password') // password | code | forgot
  const [password, setPasswordValue] = useState('')
  const [remember, setRemember] = useState(true)
  const [resetSentTo, setResetSentTo] = useState('')

  const validAddress = () => {
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Indiquez une adresse e-mail valide.'); return null }
    return address
  }
  const switchMode = (next) => { setMode(next); setError(''); setResetSentTo('') }

  async function submitPassword(event) {
    event.preventDefault()
    const address = validAddress()
    if (!address) return
    if (!password) { setError('Saisissez votre mot de passe.'); return }
    setBusy(true)
    setError('')
    setRememberMe(remember)
    const { error: signInError } = await signIn(address, password)
    setBusy(false)
    if (signInError) { setError(passwordErrorMessage(signInError)); return }
    setPasswordValue('')
  }

  async function submitForgot(event) {
    event.preventDefault()
    const address = validAddress()
    if (!address) return
    setBusy(true)
    setError('')
    const { error: resetError } = await requestPasswordReset(address, { redirectTo: `${window.location.origin}${ACCOUNT_PATH}` })
    setBusy(false)
    // Même message que l'adresse ait un espace ou non.
    if (resetError && /rate limit|too many|security purposes|seconds|fetch|network|failed to/i.test(String(resetError.message || ''))) { setError(passwordErrorMessage(resetError)); return }
    setResetSentTo(address)
  }
  const [code, setCode] = useState('')
  const [stage, setStage] = useState('email') // email | code
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestCode(createAccount) {
    const address = validAddress()
    if (!address) return
    setBusy(true)
    setError('')
    setRememberMe(remember)
    const { error: sendError } = await sendEmailCode(address, {
      createAccount,
      redirectTo: `${window.location.origin}${ACCOUNT_PATH}`,
    })
    setBusy(false)
    // Adresse sans espace : même écran, pour ne pas révéler qui a un compte.
    if (sendError && !isUnknownAccountError(sendError)) { setError(emailCodeErrorMessage(sendError)); return }
    setEmail(address)
    setCode('')
    setStage('code')
  }

  async function submitCode(event) {
    event.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length < 6) { setError('Saisissez le code reçu par e-mail.'); return }
    setBusy(true)
    setError('')
    const { error: verifyError } = await verifyEmailCode(email, digits)
    setBusy(false)
    if (verifyError) setError(emailCodeErrorMessage(verifyError))
  }

  if (stage === 'code') {
    return (
      <section className="mx-auto max-w-md rounded-3xl border-2 border-gold/25 bg-white/70 p-6 shadow-sm sm:p-8">
        <p className="text-center text-3xl text-gold">◈</p>
        <h1 className="mt-2 text-center font-georgia text-2xl font-medium">Consultez vos e-mails</h1>
        <p className="mt-3 text-center font-georgia text-sm leading-relaxed text-mist">
          Si un espace MediumIA correspond à <strong className="text-deep">{email}</strong>, nous venons d’y envoyer un code.
          Saisissez-le ci-dessous, ou cliquez sur le lien contenu dans l’e-mail.
        </p>
        <form onSubmit={submitCode} className="mt-6 space-y-4" noValidate>
          <label className="block">
            <span className={label}>Code reçu par e-mail</span>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus
              value={code} onChange={(event) => setCode(event.target.value)}
              className={`${input} text-center text-2xl tracking-[0.3em]`} placeholder="• • • • • •"
            />
          </label>
          {error && <p role="alert" className="font-georgia text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className={primary}>{busy ? 'Un instant…' : 'Ouvrir mon espace'}</button>
        </form>
        <div className="mt-6 space-y-3 border-t border-gold/20 pt-5">
          <p className="font-georgia text-sm leading-relaxed text-mist">
            Rien reçu au bout de quelques minutes ? Vérifiez vos courriers indésirables. Si vous n’avez pas encore d’espace MediumIA, créez-le gratuitement :
          </p>
          <button type="button" disabled={busy} onClick={() => requestCode(true)} className={secondary}>Créer mon espace MediumIA gratuitement</button>
          <button type="button" disabled={busy} onClick={() => { setStage('email'); setError('') }} className="w-full py-2 font-georgia text-sm text-mist underline hover:text-deep">
            Utiliser une autre adresse
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md rounded-3xl border-2 border-gold/25 bg-white/70 p-6 shadow-sm sm:p-8">
      <p className="text-center font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Votre espace personnel MediumIA</p>
      <h1 className="mt-2 text-center font-georgia text-2xl font-medium leading-snug">Retrouvez vos rendez-vous et vos règlements</h1>
      <p className="mt-3 text-center font-georgia text-sm leading-relaxed text-mist">
        {mode === 'forgot'
          ? 'Indiquez votre adresse e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.'
          : 'Indiquez l’adresse e-mail utilisée pour vos réservations.'}
      </p>
      {mode !== 'forgot' && (
        <div className="mt-5 flex gap-2" role="tablist" aria-label="Moyen de connexion">
          {[['password', 'Mot de passe'], ['code', 'Code par e-mail']].map(([id, text]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => switchMode(id)}
              className={`flex-1 rounded-xl px-3 py-2.5 font-georgia text-sm font-bold transition-colors ${mode === id ? 'bg-deep text-gold' : 'border border-gold/35 bg-white/60 text-deep hover:bg-gold/10'}`}>
              {text}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={mode === 'password' ? submitPassword : mode === 'forgot' ? submitForgot : (event) => { event.preventDefault(); requestCode(false) }}
        className="mt-5 space-y-4" noValidate
      >
        <label className="block">
          <span className={label}>Votre adresse e-mail</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} className={input} placeholder="vous@exemple.fr" />
        </label>
        {mode === 'password' && (
          <label className="block">
            <span className={label}>Votre mot de passe</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPasswordValue(event.target.value)} className={input} />
          </label>
        )}
        {mode !== 'forgot' && (
          <label className="flex cursor-pointer items-center gap-2 font-georgia text-sm text-deep">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 accent-[#C9A84C]" />
            Rester connecté sur cet appareil
          </label>
        )}
        {error && <p role="alert" className="font-georgia text-sm text-red-700">{error}</p>}
        {resetSentTo && (
          <p role="status" className="rounded-xl bg-gold/[.08] px-4 py-3 font-georgia text-sm leading-relaxed text-deep">
            Si un espace MediumIA correspond à <strong className="break-all">{resetSentTo}</strong>, un e-mail vient d’y être envoyé. Ouvrez le lien qu’il contient pour choisir votre nouveau mot de passe.
          </p>
        )}
        {mode === 'password' && (
          <>
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Un instant…' : 'Me connecter'}</button>
            <button type="button" disabled={busy} onClick={() => switchMode('forgot')} className="w-full py-1 font-georgia text-sm text-mist underline hover:text-deep">Mot de passe oublié ?</button>
            <p className="font-georgia text-xs leading-relaxed text-mist">Pas encore de mot de passe ? Connectez-vous avec un code par e-mail, puis définissez-le dans « Mon profil ».</p>
          </>
        )}
        {mode === 'code' && (
          <>
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Un instant…' : 'Recevoir mon code de connexion'}</button>
            <button type="button" disabled={busy} onClick={() => requestCode(true)} className={secondary}>Créer mon espace MediumIA gratuitement</button>
          </>
        )}
        {mode === 'forgot' && (
          <>
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Un instant…' : 'Recevoir le lien de réinitialisation'}</button>
            <button type="button" disabled={busy} onClick={() => switchMode('password')} className="w-full py-1 font-georgia text-sm text-mist underline hover:text-deep">Retour à la connexion</button>
          </>
        )}
      </form>
      <p className="mt-5 text-center font-georgia text-xs leading-relaxed text-mist">
        Gratuit et facultatif : vous pouvez toujours réserver sans compte. Vos données sont traitées selon notre{' '}
        <a href="/confidentialite" className="text-gold underline">politique de confidentialité</a>.
      </p>
    </section>
  )
}

// ── Rendez-vous ──────────────────────────────────────────────────────────────

function BookingCard({ booking, upcoming, token }) {
  const status = describeStatus(booking)
  const mode = describeMode(booking)
  const amounts = describeAmounts(booking)
  const links = upcoming ? bookingCalendarLinks(booking) : null
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/70 p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-georgia text-lg font-semibold leading-snug text-deep">{formatBookingDate(booking.startsAt, booking.timezone)}</p>
          <p className="font-georgia text-2xl font-bold text-deep">{formatBookingTime(booking.startsAt, booking.timezone)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 font-georgia text-xs font-bold ${status.tone === 'ok' ? 'bg-gold/20 text-deep' : 'bg-deep/10 text-mist'}`}>{status.label}</span>
      </div>

      <dl className="mt-4 space-y-2 font-georgia text-sm">
        <div><dt className="inline text-mist">Prestation : </dt><dd className="inline font-semibold">{booking.serviceTitle || '—'}{booking.durationMin ? ` · ${booking.durationMin} min` : ''}</dd></div>
        {booking.practitionerName && <div><dt className="inline text-mist">Avec : </dt><dd className="inline font-semibold">{booking.practitionerName}</dd></div>}
        <div><dt className="inline text-mist">Consultation : </dt><dd className="inline font-semibold">{mode.label}</dd></div>
      </dl>
      {status.detail && <p className="mt-3 font-georgia text-sm text-mist">{status.detail}</p>}
      {upcoming && mode.note && <p className="mt-3 rounded-xl border border-gold/20 bg-gold/[.06] p-3 font-georgia text-sm leading-relaxed text-deep">{mode.note}</p>}

      <div className="mt-4 border-t border-gold/15 pt-4">
        <dl className="space-y-1.5 font-georgia text-sm">
          {amounts.lines.map((line) => (
            <div key={line.key} className={`flex items-baseline justify-between gap-4 ${line.strong ? 'pt-1 text-base font-bold text-deep' : ''}`}>
              <dt className={line.strong ? '' : 'text-mist'}>{line.label}</dt>
              <dd className="shrink-0 font-semibold">{line.value}</dd>
            </div>
          ))}
        </dl>
        {amounts.note && <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">{amounts.note}</p>}
        {upcoming && token && canPayBalanceFromAccount(booking) && (
          <>
            <button type="button" onClick={() => openBalancePayment(booking, token)} className={`${primary} mt-3`}>
              Régler mon solde ({formatEuros(booking.amounts.dueCents)})
            </button>
            <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">Paiement sécurisé par PayPal. Le montant est revérifié avant tout encaissement.</p>
          </>
        )}
      </div>

      {links && (
        <div className="mt-4 border-t border-gold/15 pt-4">
          <p className="mb-2 font-georgia text-[11px] uppercase tracking-[0.16em] text-mist">Ajouter à mon agenda</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={links.google} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-gold/40 px-4 py-3 text-center font-georgia text-sm font-semibold text-deep hover:bg-gold/10">Google Agenda</a>
            <a href={links.ics} download="rendez-vous-mediumia.ics" className="rounded-xl border border-gold/40 px-4 py-3 text-center font-georgia text-sm font-semibold text-deep hover:bg-gold/10">Apple / Outlook (.ics)</a>
          </div>
        </div>
      )}
    </article>
  )
}

function Bookings({ overview, token }) {
  const { upcoming, past } = overview
  return (
    <div className="space-y-10">
      <section aria-labelledby="rdv-a-venir">
        <h2 id="rdv-a-venir" className="font-georgia text-xl font-medium">Mes rendez-vous à venir</h2>
        {upcoming.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-gold/25 bg-white/60 p-6 text-center">
            <p className="font-georgia text-sm text-mist">Vous n’avez pas de rendez-vous à venir.</p>
            <a href="/rdv/sebastien-seguin" className="mt-4 inline-block rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">Prendre rendez-vous</a>
          </div>
        ) : (
          <div className="mt-4 space-y-4">{upcoming.map((booking) => <BookingCard key={booking.id} booking={booking} upcoming token={token} />)}</div>
        )}
      </section>
      <section aria-labelledby="rdv-passes">
        <h2 id="rdv-passes" className="font-georgia text-xl font-medium">Mes rendez-vous passés</h2>
        {past.length === 0
          ? <p className="mt-4 font-georgia text-sm text-mist">Aucun rendez-vous passé pour le moment.</p>
          : <div className="mt-4 space-y-4">{past.map((booking) => <BookingCard key={booking.id} booking={booking} />)}</div>}
      </section>
    </div>
  )
}

// ── Règlements ───────────────────────────────────────────────────────────────

function Payments({ overview, token }) {
  const payments = useMemo(() => listAllPayments(overview), [overview])
  const due = overview.upcoming.filter((booking) => booking.amounts.dueCents > 0)
  return (
    <div className="space-y-8">
      {due.length > 0 && (
        <section aria-labelledby="reste-a-regler">
          <h2 id="reste-a-regler" className="font-georgia text-xl font-medium">Reste à régler</h2>
          <ul className="mt-4 space-y-3">
            {due.map((booking) => {
              const amounts = describeAmounts(booking)
              return (
                <li key={booking.id} className="rounded-2xl border border-gold/25 bg-white/70 p-5">
                  <div className="flex items-baseline justify-between gap-4 font-georgia">
                    <span className="text-sm"><strong>{booking.serviceTitle}</strong><br /><span className="text-mist">{formatBookingDate(booking.startsAt, booking.timezone)}</span></span>
                    <strong className="shrink-0 text-lg">{amounts.lines.find((line) => line.key === 'due')?.value}</strong>
                  </div>
                  {amounts.note && <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">{amounts.note}</p>}
                  {token && canPayBalanceFromAccount(booking) && (
                    <button type="button" onClick={() => openBalancePayment(booking, token)} className={`${primary} mt-3`}>
                      Régler mon solde ({formatEuros(booking.amounts.dueCents)})
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="reglements">
        <h2 id="reglements" className="font-georgia text-xl font-medium">Mes règlements</h2>
        {payments.length === 0 ? (
          <p className="mt-4 font-georgia text-sm text-mist">Aucun règlement enregistré pour le moment.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gold/15 rounded-2xl border border-gold/25 bg-white/70">
            {payments.map((payment, index) => (
              <li key={`${payment.bookingId}-${index}`} className="flex items-baseline justify-between gap-4 p-4 font-georgia text-sm">
                <span>
                  <strong>{payment.label}</strong>{payment.method ? ` · ${payment.method}` : ''}
                  <br /><span className="text-mist">{payment.date ? `${payment.date} · ` : ''}{payment.serviceTitle} du {payment.bookingDate}</span>
                </span>
                <strong className={`shrink-0 ${payment.refund ? 'text-mist' : 'text-deep'}`}>{payment.amount}</strong>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-georgia text-xs leading-relaxed text-mist">Seuls les règlements réellement encaissés apparaissent ici.</p>
      </section>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

async function fetchOverview(token) {
  try {
    const response = await fetch('/api/rdv-config?accountAction=overview', { headers: { Authorization: `Bearer ${token}` } })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body) return { status: body?.error === 'email_not_verified' ? 'unverified' : 'error', overview: null }
    return { status: 'ready', overview: body }
  } catch {
    return { status: 'error', overview: null }
  }
}

const TABS = [['rdv', 'Mes rendez-vous'], ['paiements', 'Mes paiements'], ['profil', 'Mon profil']]

export default function AccountPage() {
  const { session, user, loading, signOut, signIn, sendEmailCode, verifyEmailCode, requestEmailChange, setPassword, requestPasswordReset } = useAuth()
  // Retour depuis l'e-mail « mot de passe oublié » : choisir le nouveau mot de passe.
  const [recovery, setRecovery] = useState(() => isPasswordRecoveryUrl(window.location.hash, window.location.search))
  const [tab, setTab] = useState(() => (window.location.hash === '#profil' ? 'profil' : 'rdv'))
  const [state, setState] = useState({ status: 'idle', overview: null })
  const [attempt, setAttempt] = useState(0)
  const token = session?.access_token || null

  useEffect(() => {
    if (!token) return undefined
    let active = true
    fetchOverview(token).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [token, attempt])

  useEffect(() => {
    document.title = 'Mon espace client — MediumIA'
    if (!supabase) return undefined
    const { data: listener } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setRecovery(true) })
    return () => listener?.subscription?.unsubscribe?.()
  }, [])

  if (!isSupabaseConfigured()) {
    return <Shell><p className="text-center font-georgia text-sm text-mist">L’espace client est momentanément indisponible.</p></Shell>
  }
  if (loading) {
    return <Shell><p className="text-center font-georgia text-sm text-mist" role="status">Chargement…</p></Shell>
  }
  if (!user) {
    return <Shell><SignIn sendEmailCode={sendEmailCode} verifyEmailCode={verifyEmailCode} signIn={signIn} requestPasswordReset={requestPasswordReset} /></Shell>
  }
  if (recovery) {
    return (
      <Shell>
        <section className="mx-auto max-w-md rounded-3xl border-2 border-gold/25 bg-white/70 p-6 shadow-sm sm:p-8">
          <h1 className="text-center font-georgia text-2xl font-medium">Choisissez votre nouveau mot de passe</h1>
          <p className="mb-5 mt-2 break-all text-center font-georgia text-sm text-mist">{user.email}</p>
          <NewPasswordForm setPassword={setPassword} onDone={() => setRecovery(false)} idPrefix="recovery-password" />
          <button type="button" onClick={() => setRecovery(false)} className="mt-3 w-full py-2 font-georgia text-sm text-mist underline hover:text-deep">Plus tard, ouvrir mon espace</button>
        </section>
      </Shell>
    )
  }

  const overview = state.overview
  return (
    <Shell right={<button type="button" onClick={() => signOut()} className="rounded-lg border border-gold/45 px-3 py-2 font-georgia text-xs font-bold text-deep">Déconnexion</button>}>
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Mon espace client MediumIA</p>
      <h1 className="mt-1 font-georgia text-2xl font-medium sm:text-3xl">Bonjour{overview?.upcoming?.[0]?.contact?.firstName ? ` ${overview.upcoming[0].contact.firstName}` : ''}</h1>
      <p className="mt-1 break-all font-georgia text-sm text-mist">{user.email}</p>

      <nav className="mt-6 flex gap-2" aria-label="Sections de mon espace">
        {TABS.map(([id, text]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
            className={`flex-1 rounded-xl px-2 py-3 font-georgia text-xs font-bold sm:px-4 sm:text-sm transition-colors ${tab === id ? 'bg-deep text-gold' : 'border border-gold/35 bg-white/60 text-deep hover:bg-gold/10'}`}>
            {text}
          </button>
        ))}
      </nav>

      {tab === 'profil' && (
        <div className="mt-8">
          <ProfileForm token={token} email={user.email} requestEmailChange={requestEmailChange} setPassword={setPassword} />
          <div className="mt-10"><EmailPreferences token={token} email={user.email} /></div>
        </div>
      )}
      <div className="mt-8" hidden={tab === 'profil'}>
        {(state.status === 'loading' || state.status === 'idle') && <p className="font-georgia text-sm text-mist" role="status">Chargement de vos rendez-vous…</p>}
        {state.status === 'unverified' && (
          <p className="rounded-2xl border border-gold/35 bg-gold/[.08] p-5 font-georgia text-sm leading-relaxed">
            Votre adresse e-mail n’est pas encore confirmée. Ouvrez l’e-mail de confirmation que nous vous avons envoyé, puis revenez ici.
          </p>
        )}
        {state.status === 'error' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-georgia text-sm text-red-800">Vos informations n’ont pas pu être chargées. Vos rendez-vous ne sont pas affectés.</p>
            <button type="button" onClick={() => { setState({ status: 'loading', overview: null }); setAttempt((n) => n + 1) }} className="mt-3 rounded-lg border border-red-300 px-4 py-2 font-georgia text-sm font-bold text-red-800">Réessayer</button>
          </div>
        )}
        {state.status === 'ready' && overview && (
          <>
            {overview.account?.emailLinkedElsewhere && (
              <p className="mb-6 rounded-2xl border border-gold/35 bg-gold/[.08] p-5 font-georgia text-sm leading-relaxed">
                Cette adresse est déjà rattachée à un autre espace MediumIA. Écrivez-nous pour que nous regardions cela ensemble.
              </p>
            )}
            {tab === 'rdv' ? <Bookings overview={overview} token={token} /> : <Payments overview={overview} token={token} />}
            <p className="mt-10 rounded-2xl border border-gold/20 bg-white/50 p-5 font-georgia text-sm leading-relaxed text-mist">
              Un rendez-vous manque ? Il a peut-être été réservé avec une autre adresse e-mail. Seuls les rendez-vous pris avec <strong className="break-all text-deep">{user.email}</strong> apparaissent ici.
            </p>
          </>
        )}
      </div>
    </Shell>
  )
}
