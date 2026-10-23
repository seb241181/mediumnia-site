import { useCallback, useEffect, useState } from 'react'
import LegalFooter from './LegalFooter'
import '../styles/formation-page.css'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

// /formation/rencontres : « Mes rencontres » — réserver les visios incluses dans la
// formation complète. Le propriétaire voit en plus le suivi des inscriptions.

const API = '/api/rdv-config?rencontresAction='
const PARIS = 'Europe/Paris'
const dayLabel = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
const hourLabel = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':00', ' h').replace(':', ' h ')
const shortDate = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const ERRORS = {
  not_eligible: 'Les rencontres sont réservées aux élèves ayant acquis la formation complète.',
  full: 'Cette rencontre est complète.',
  theme_used: 'Vous avez déjà une participation pour ce thème.',
  bookings_closed: 'Les réservations de cette rencontre ne sont pas encore ouvertes.',
  started: 'Cette rencontre a déjà commencé.',
  outside_rights: 'Cette rencontre est en dehors de votre période de droits.',
  too_late: 'L’annulation en ligne est possible jusqu’à 24 heures avant la rencontre.',
  below_booked: 'Impossible : il y a déjà plus d’inscrits que ce nombre de places.',
  auth_required: 'Votre session a expiré : reconnectez-vous.',
}
const errorText = (code) => ERRORS[code] || 'Une erreur est survenue. Réessayez dans un instant.'
const loginErrorText = (error) => {
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code)) {
    return 'Trop de liens de connexion ont été demandés. L’envoi d’e-mails est temporairement limité : réessayez plus tard.'
  }
  return 'Impossible d’envoyer le lien de connexion pour le moment. Vérifiez l’adresse de votre compte élève et réessayez plus tard.'
}

const PARTICIPANT_STATUS = { booked: 'Inscrit', attended: 'Présent', absent: 'Absent', released: 'Rattrapage accordé' }

function Header({ onBack }) {
  return (
    <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
        <a href="/formation" className="font-georgia text-xs text-mist hover:text-deep">La formation</a>
      </div>
    </header>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!supabase) { setStatus('Connexion indisponible pour le moment.'); return }
    setStatus('…')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: `${window.location.origin}/formation/rencontres`, shouldCreateUser: false } })
    setStatus(error ? loginErrorText(error) : 'sent')
  }
  if (status === 'sent') return <p role="status" className="rounded-2xl border border-gold/30 bg-white/80 p-5 font-georgia text-sm text-deep">Un lien de connexion vient de vous être envoyé à {email}. Ouvrez-le sur cet appareil pour revenir ici.</p>
  return (
    <form onSubmit={submit} className="rounded-3xl border border-gold/30 bg-white/80 p-6">
      <h2 className="font-georgia text-xl text-deep">Connexion</h2>
      <p className="mt-1 font-georgia text-sm text-mist">Indiquez l’adresse e-mail de votre espace élève : vous recevez un lien de connexion, sans mot de passe.</p>
      <label htmlFor="rencontres-email" className="sr-only">Adresse e-mail</label>
      <input id="rencontres-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Votre e-mail" className="mt-4 w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm text-deep" />
      <button type="submit" className="mt-3 w-full rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold">Recevoir mon lien de connexion</button>
      {status && status !== '…' && <p role="alert" className="mt-3 font-georgia text-xs text-red-700">{status}</p>}
    </form>
  )
}

function Chip({ tone = 'neutral', children }) {
  const tones = {
    ok: 'border-emerald-700/30 bg-emerald-50 text-emerald-900',
    gold: 'border-gold/40 bg-gold/10 text-deep',
    neutral: 'border-deep/15 bg-white text-deep/70',
  }
  return <span className={`inline-flex rounded-full border px-3 py-1 font-georgia text-[11px] uppercase tracking-[0.12em] ${tones[tone]}`}>{children}</span>
}

function SessionCard({ session, busy, onBook, onCancel }) {
  const states = {
    open: <Chip tone="gold">{session.placesLeft} place{session.placesLeft > 1 ? 's' : ''} disponible{session.placesLeft > 1 ? 's' : ''}</Chip>,
    booked: <Chip tone="ok">Place réservée</Chip>,
    closed: <Chip>Réservations bientôt ouvertes</Chip>,
    full: <Chip>Complet</Chip>,
    theme_used: <Chip>Thème déjà suivi ou réservé</Chip>,
    outside_rights: <Chip>Hors de votre période de droits</Chip>,
    not_eligible: <Chip>Formation complète requise</Chip>,
  }
  return (
    <li className={`rounded-2xl border-2 bg-white/85 p-5 md:p-6 ${session.state === 'booked' ? 'border-emerald-700/30' : 'border-gold/25'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">{capitalize(dayLabel(session.startsAt))}</p>
          <h3 className="mt-1 font-georgia text-xl text-deep">{session.title}</h3>
          <p className="mt-1 font-georgia text-sm text-mist">{hourLabel(session.startsAt)} – {hourLabel(session.endsAt)} (heure de Paris) · en visio</p>
        </div>
        {states[session.state]}
      </div>
      {session.state === 'open' && (
        <button type="button" disabled={busy} onClick={() => onBook(session)} className="mt-4 rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-60">Réserver ma place</button>
      )}
      {session.state === 'booked' && (
        session.canCancel
          ? <button type="button" disabled={busy} onClick={() => onCancel(session)} className="mt-4 rounded-xl border-2 border-deep/20 px-5 py-2.5 font-georgia text-sm text-deep hover:border-deep/40 disabled:opacity-60">Annuler ma réservation</button>
          : <p className="mt-4 font-georgia text-xs text-mist">L’annulation en ligne est close (moins de 24 heures avant la rencontre).</p>
      )}
    </li>
  )
}

function AdminSession({ session, busy, onUpdate, onMark, onVerify, verifications }) {
  const past = new Date(session.startsAt) <= new Date()
  return (
    <li className={`rounded-2xl border border-gold/25 bg-white/85 p-5 ${session.status === 'cancelled' ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-georgia text-sm font-bold text-deep">{session.title}</p>
          <p className="font-georgia text-xs text-mist">{capitalize(dayLabel(session.startsAt))} · {hourLabel(session.startsAt)}{session.status === 'cancelled' ? ' · annulée' : ''}</p>
        </div>
        <p className="font-georgia text-sm tabular-nums text-deep"><strong>{session.booked}</strong> / {session.capacity} inscrits</p>
      </div>
      {session.status !== 'cancelled' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || past} onClick={() => onUpdate(session, { bookingsOpen: !session.bookingsOpen })} className={`rounded-lg px-3 py-2 font-georgia text-xs font-bold disabled:opacity-50 ${session.bookingsOpen ? 'bg-emerald-700 text-white' : 'border border-deep/20 text-deep'}`}>
            {session.bookingsOpen ? 'Réservations ouvertes · fermer' : 'Réservations fermées · ouvrir'}
          </button>
          <span className="ml-2 font-georgia text-xs text-mist">Places</span>
          <button type="button" aria-label="Retirer une place" disabled={busy || session.capacity <= Math.max(1, session.booked)} onClick={() => onUpdate(session, { capacity: session.capacity - 1 })} className="h-8 w-8 rounded-lg border border-deep/20 font-georgia text-deep disabled:opacity-40">−</button>
          <span className="w-6 text-center font-georgia text-sm tabular-nums text-deep">{session.capacity}</span>
          <button type="button" aria-label="Ajouter une place" disabled={busy || session.capacity >= 100} onClick={() => onUpdate(session, { capacity: session.capacity + 1 })} className="h-8 w-8 rounded-lg border border-deep/20 font-georgia text-deep disabled:opacity-40">+</button>
        </div>
      )}
      {session.participants.length > 0 && (
        <ul className="mt-4 divide-y divide-gold/15 border-t border-gold/15">
          {session.participants.map((p) => (
            <li key={p.bookingId} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate font-georgia text-sm text-deep">{p.email || 'Élève'}</span>
              <span className="font-georgia text-xs text-mist">{PARTICIPANT_STATUS[p.status] || p.status}</span>
              {p.status === 'booked' && (
                <>
                  <button type="button" disabled={busy} onClick={() => onVerify(p)} className="rounded-md border border-gold/50 px-2 py-1 font-georgia text-[11px] text-deep">
                    Vérifier accès visio
                  </button>
                  {verifications[p.bookingId] && <span role="status" className={`font-georgia text-[11px] ${verifications[p.bookingId].eligible ? 'text-emerald-800' : 'text-red-800'}`}>
                    {verifications[p.bookingId].eligible ? 'Droits vérifiés à cet instant' : 'Accès non validé — ne pas transmettre le lien'}
                  </span>}
                </>
              )}
              {['booked', 'attended', 'absent'].includes(p.status) && p.status !== 'attended' && <button type="button" disabled={busy} onClick={() => onMark(p, 'attended')} className="rounded-md border border-deep/20 px-2 py-1 font-georgia text-[11px] text-deep">Présent</button>}
              {['booked', 'attended'].includes(p.status) && <button type="button" disabled={busy} onClick={() => onMark(p, 'absent')} className="rounded-md border border-deep/20 px-2 py-1 font-georgia text-[11px] text-deep">Absent</button>}
              {p.status === 'absent' && <button type="button" disabled={busy} onClick={() => onMark(p, 'released')} className="rounded-md border border-gold/50 px-2 py-1 font-georgia text-[11px] text-deep">Accorder un rattrapage</button>}
              {p.status === 'booked' && <button type="button" disabled={busy} onClick={() => onMark(p, 'cancelled')} className="rounded-md border border-red-700/30 px-2 py-1 font-georgia text-[11px] text-red-800">Annuler</button>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function FormationRencontresPage({ onBack, onNavigate }) {
  const { session, loading } = useAuth()
  const token = session?.access_token
  const [data, setData] = useState(null)
  const [adminData, setAdminData] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [verifications, setVerifications] = useState({})

  const call = useCallback(async (action, body) => {
    const res = await fetch(`${API}${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, json }
  }, [token])

  const refresh = useCallback(async () => {
    if (!token) return
    const mine = await call('mine')
    if (mine.ok) setData(mine.json)
    else setMessage({ tone: 'error', text: errorText(mine.json.error) })
    const adminRes = await call('admin')
    setAdminData(adminRes.ok ? adminRes.json : null)
  }, [token, call])

  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }, [])
  useEffect(() => { refresh() }, [refresh])

  async function act(action, body, success) {
    setBusy(true)
    setMessage(null)
    const result = await call(action, body)
    setMessage(result.ok ? { tone: 'ok', text: success } : { tone: 'error', text: errorText(result.json.error) })
    await refresh()
    setBusy(false)
  }

  const book = (s) => act('book', { rencontreId: s.id }, `Votre place est réservée pour le ${shortDate(s.startsAt)}.`)
  const cancel = (s) => { if (window.confirm(`Annuler votre réservation du ${shortDate(s.startsAt)} ?`)) act('cancel', { bookingId: s.bookingId }, 'Votre réservation est annulée. Votre participation pour ce thème reste disponible.') }
  const update = (s, change) => act('admin-update', { rencontreId: s.id, ...change }, 'Rencontre mise à jour.')
  const mark = (p, status) => act('admin-mark', { bookingId: p.bookingId, status }, 'Inscription mise à jour.')
  async function verify(p) {
    setBusy(true)
    setVerifications({}) // A previous result must never be mistaken for current consent.
    const result = await call('admin-verify', { bookingId: p.bookingId })
    setVerifications({ [p.bookingId]: { eligible: result.ok && result.json.eligible === true } })
    setBusy(false)
  }

  return (
    <div className="cosmic-page bg-cream min-h-screen text-deep">
      <Header onBack={onBack} />
      <main className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Formation MediumIA · en visio avec Sébastien</p>
        <h1 className="mt-3 font-georgia text-4xl font-medium leading-tight md:text-5xl">Mes rencontres</h1>
        <p className="mt-4 font-georgia text-base leading-relaxed text-mist">Cinq rencontres pédagogiques en petit groupe, le samedi de 10 h à 12 h (heure de Paris), incluses dans la formation complète. Choisissez celles qui correspondent à vos acquis : un thème pour lequel vous n’êtes pas encore prêt pourra être suivi lors d’une prochaine programmation.</p>

        <div className="mt-8 space-y-6">
          {loading ? <p className="font-georgia text-sm text-mist">Chargement…</p>
            : !token ? <Login />
            : !data ? <p className="font-georgia text-sm text-mist">{message?.text || 'Chargement de vos rencontres…'}</p>
            : (
              <>
                {data.rights.eligible
                  ? data.rights.provisional
                    ? <p className="rounded-2xl border border-gold/30 bg-gold/10 px-5 py-4 font-georgia text-sm text-deep">
                        Offre conférence en cinq mensualités · accès aux rencontres <strong>provisoire et sous condition de paiement à jour</strong>. La date indicative de fin de droits est le <strong>{shortDate(data.rights.until)}</strong> ; les paiements sont revérifiés à chaque réservation et avant la communication du lien de visio. Une participation par thème est incluse, annulable jusqu’à {data.cancelHours} heures avant.
                      </p>
                    : <p className="rounded-2xl border border-gold/30 bg-gold/10 px-5 py-4 font-georgia text-sm text-deep">Vos droits aux rencontres courent jusqu’au <strong>{shortDate(data.rights.until)}</strong>. Une participation est incluse pour chacun des cinq thèmes ; vous pouvez annuler jusqu’à {data.cancelHours} heures avant une rencontre.</p>
                  : <div className="rounded-2xl border border-gold/30 bg-white/85 px-5 py-4 font-georgia text-sm text-deep"><p>Les rencontres sont incluses dans la formation complète (597 €). La Découverte seule n’y donne pas accès. Si vous suivez le parcours progressif, elles s’ouvriront dès que votre parcours sera complet.</p><a href="/formation/parcours" className="mt-2 inline-block font-bold text-gold underline">Voir mon parcours</a></div>}

                {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 font-georgia text-sm ${message.tone === 'error' ? 'border border-red-700/30 bg-red-50 text-red-900' : 'border border-emerald-700/30 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}

                {data.sessions.length
                  ? <ol className="space-y-3">{data.sessions.map((s) => <SessionCard key={s.id} session={s} busy={busy} onBook={book} onCancel={cancel} />)}</ol>
                  : <p className="font-georgia text-sm text-mist">Aucune rencontre programmée pour le moment.</p>}

                <p className="font-georgia text-xs leading-relaxed text-mist">Le lien privé de la visio est communiqué aux seuls participants inscrits. Il est personnel : merci de ne pas le transmettre.</p>
              </>
            )}

          {adminData && (
            <section aria-labelledby="rencontres-admin" className="rounded-3xl bg-deep/[0.04] p-5 md:p-6">
              <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Administration · visible par vous seul</p>
              <h2 id="rencontres-admin" className="mt-1 font-georgia text-2xl text-deep">Suivi des rencontres</h2>
              <p className="mt-3 font-georgia text-xs text-red-800">Avant d'envoyer un lien Zoom personnel, vérifiez les droits de chaque participant. Un contrôle positif est ponctuel : recommencez juste avant la visio. Aucun lien n'est envoyé automatiquement.</p>
              <ol className="mt-4 space-y-3">{adminData.sessions.map((s) => <AdminSession key={s.id} session={s} busy={busy} onUpdate={update} onMark={mark} onVerify={verify} verifications={verifications} />)}</ol>
            </section>
          )}
        </div>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
