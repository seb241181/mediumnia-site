import { useEffect, useMemo, useState } from 'react'
import LegalFooter from './LegalFooter'
import {
  CARDS, CHANCE_RATE, ROUNDS, SHARE_URL,
  isNewPlayer, loadState, parisDay, recordDay, saveState, scoreMessage, secureIndex, shareText, stats,
} from '../lib/defiIntuition.js'
import { canvasToFile, drawScoreImage } from '../lib/defiShareImage.js'
import SiteNav from './SiteNav'

const storage = typeof window !== 'undefined' ? window.localStorage : null
const pct = (rate) => `${Math.round(rate * 100)} %`
const API = '/api/rdv-config?defiAction='

// Anonymous counters (plays, new players, shares): never blocks the game.
function track(event) {
  try {
    fetch(`${API}event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true, credentials: 'omit' }).catch(() => {})
  } catch { /* suivi indisponible */ }
}

function Card({ index, state, onPick, disabled }) {
  // state: 'hidden' | 'star' | 'empty' | 'picked-star' | 'picked-empty'
  const revealed = state !== 'hidden'
  const star = state === 'star' || state === 'picked-star'
  const picked = state.startsWith('picked')
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      disabled={disabled}
      aria-label={revealed ? `Carte ${index + 1} : ${star ? 'l’Étoile' : 'vide'}${picked ? ', votre choix' : ''}` : `Choisir la carte ${index + 1}`}
      className={`relative aspect-[2/3] w-full rounded-xl border-2 font-georgia transition duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 ${
        !revealed
          ? 'border-gold/60 bg-[radial-gradient(circle_at_50%_35%,#3a2f6b,#1a1535_70%)] shadow-lg motion-safe:hover:-translate-y-1 hover:border-gold'
          : star
            ? 'border-gold bg-[radial-gradient(circle_at_50%_40%,#fff6d8,#e4c77a_55%,#b8923f)] shadow-[0_0_28px_rgba(228,199,122,.65)]'
            : 'border-[#1a1535]/15 bg-[#1a1535]/[.05]'
      } ${picked ? 'ring-4 ring-deep/70 ring-offset-2 ring-offset-cream' : ''} ${revealed && !star && !picked ? 'opacity-60' : ''}`}
    >
      {!revealed && (
        <span aria-hidden="true" className="absolute inset-2 flex items-center justify-center rounded-lg border border-gold/25 text-2xl text-gold/80 sm:text-3xl">✦</span>
      )}
      {revealed && star && <span aria-hidden="true" className="text-3xl text-deep sm:text-4xl">★</span>}
      {revealed && !star && <span aria-hidden="true" className="text-xl text-mist">·</span>}
    </button>
  )
}

function Share({ day, hits }) {
  const [copied, setCopied] = useState(false)
  const [imageNote, setImageNote] = useState('')
  const [busy, setBusy] = useState(false)
  const text = shareText(day, hits)

  // Instagram, TikTok and Facebook stories take an image, not a text: the
  // phone's share menu receives the score picture when it accepts files,
  // otherwise the picture is downloaded to be added to a story by hand.
  async function shareImage() {
    setBusy(true)
    setImageNote('')
    try {
      const file = await canvasToFile(await drawScoreImage(document.createElement('canvas'), { day, hits }), `defi-intuition-${day}.png`)
      track('defi_share_image')
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], text }) } catch { /* partage annulé */ }
      } else {
        const url = URL.createObjectURL(file)
        const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        setImageNote('Image enregistrée : ajoutez-la à votre story Instagram, TikTok ou Facebook.')
      }
    } catch {
      setImageNote('L’image n’a pas pu être créée sur cet appareil. Utilisez « Copier le texte ».')
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); track('defi_share_copy'); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }
  const btn = 'rounded-xl px-4 py-3 font-georgia text-sm font-bold text-center'
  return (
    <div className="mt-6">
      <p className="font-georgia text-sm text-deep">Partagez votre score :</p>
      <button type="button" onClick={shareImage} disabled={busy} className={`${btn} mt-3 w-full bg-[linear-gradient(90deg,#7b3fe4,#d62f7f,#f0a23b)] text-white disabled:opacity-60`}>
        {busy ? 'Création de l’image…' : '📸 En story : Instagram, TikTok, Facebook'}
      </button>
      {imageNote && <p role="status" className="mt-2 font-georgia text-xs text-mist">{imageNote}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`} onClick={() => track('defi_share_facebook')} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#1b4fa0] text-white`}>Facebook</a>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} onClick={() => track('defi_share_whatsapp')} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#1f8f4e] text-white`}>WhatsApp</a>
        <button type="button" onClick={copy} className={`${btn} col-span-2 border border-gold/40 bg-white text-deep`}>{copied ? 'Copié ✓ — collez-le où vous voulez' : 'Copier le texte'}</button>
      </div>
    </div>
  )
}

function Reminder() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!consent) { setStatus('Cochez la case pour recevoir le rappel.'); return }
    setStatus('…')
    try {
      const res = await fetch(`${API}subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setStatus('done'); return }
      setStatus({ invalid_email: 'Cette adresse e-mail ne semble pas valide.', too_many_attempts: 'Trop d’essais : réessayez plus tard.' }[data.error] || 'Inscription impossible pour le moment.')
    } catch {
      setStatus('Inscription impossible pour le moment.')
    }
  }
  if (status === 'done') return <p role="status" className="mt-6 rounded-xl border border-gold/30 bg-white/75 p-4 font-georgia text-sm text-deep">C’est noté ✦ Un e-mail de confirmation vient de partir, puis un petit rappel chaque matin. Désinscription en un clic dans chaque e-mail.</p>
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-6 w-full rounded-xl border border-gold/40 bg-white/80 px-5 py-3 font-georgia text-sm text-deep">🔔 Me le rappeler chaque matin (facultatif)</button>
  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-gold/30 bg-white/80 p-4">
      <p className="font-georgia text-sm text-deep">🔔 Un petit e-mail chaque matin pour ne pas oublier votre défi.</p>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Votre e-mail" autoComplete="email" aria-label="Votre e-mail" className="mt-3 w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm text-deep" />
      <label className="mt-3 flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-gold" />
        <span className="font-georgia text-xs leading-relaxed text-deep/80">J’accepte de recevoir un e-mail de rappel par jour pour le Défi Intuition. Mon adresse ne sert qu’à ça ; je peux me désinscrire en un clic.</span>
      </label>
      <button type="submit" className="mt-3 w-full rounded-xl bg-[#1a1535] px-5 py-3 font-georgia text-sm font-bold text-gold">Activer le rappel</button>
      {status && status !== '…' && <p role="alert" className="mt-2 font-georgia text-xs text-red-700">{status}</p>}
    </form>
  )
}

export default function DefiIntuitionPage({ onBack, onNavigate }) {
  const today = useMemo(() => parisDay(), [])
  const [saved, setSaved] = useState(() => loadState(storage))
  const playedToday = saved.days[today]
  const [mode, setMode] = useState(playedToday ? 'done' : 'intro') // intro | play | done
  const [practice, setPractice] = useState(false)
  const [round, setRound] = useState(0)
  const [target, setTarget] = useState(null)
  const [picked, setPicked] = useState(null)
  const [hits, setHits] = useState([])

  const summary = stats(saved, today)
  const todayHits = playedToday?.hits || []

  const [notice, setNotice] = useState('')

  useEffect(() => { window.scrollTo(0, 0) }, [mode])

  // One-click unsubscribe from the reminder e-mail (?stop=<signed token>).
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('stop')
    if (!token) return
    window.history.replaceState(window.history.state, '', window.location.pathname)
    fetch(`${API}unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then((res) => setNotice(res.ok ? 'C’est fait : vous ne recevrez plus le rappel du Défi Intuition.' : 'Ce lien de désinscription n’est plus valide. Écrivez-nous à contact@mediumia.fr.'))
      .catch(() => setNotice('Désinscription impossible pour le moment. Réessayez plus tard.'))
  }, [])

  function start(isPractice) {
    setPractice(isPractice)
    setHits([])
    setRound(0)
    setPicked(null)
    // The Étoile is hidden before the player chooses.
    setTarget(secureIndex(CARDS))
    setMode('play')
  }

  function pick(index) {
    if (picked !== null) return
    setPicked(index)
    setHits((h) => [...h, index === target])
  }

  function next() {
    if (round + 1 < ROUNDS) {
      setRound(round + 1)
      setPicked(null)
      setTarget(secureIndex(CARDS))
      return
    }
    if (!practice) {
      if (isNewPlayer(saved)) track('defi_new_player')
      track('defi_played')
      const updated = { ...recordDay(saved, today, hits), counted: true }
      saveState(storage, updated)
      setSaved(updated)
    }
    setMode('done')
  }

  const cardState = (i) => {
    if (picked === null) return 'hidden'
    const star = i === target
    if (i === picked) return star ? 'picked-star' : 'picked-empty'
    return star ? 'star' : 'empty'
  }

  const lastHit = picked !== null && picked === target
  const practiceScore = hits.filter(Boolean).length

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <SiteNav current="decouvrir" onHome={onBack} />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-28 md:pt-32">
        <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Défi Intuition · exercice de perception</p>
        <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-5xl">Exercice d’intuition du jour</h1>
        {notice && <p role="status" className="mt-4 rounded-xl border border-gold/30 bg-white/80 p-4 font-georgia text-sm text-deep">{notice}</p>}

        {mode === 'intro' && (
          <section className="mt-4">
            <p className="max-w-xl font-georgia text-base leading-relaxed text-mist">
              Cinq cartes, une seule cache l’Étoile. Respirez, écoutez votre premier ressenti, et choisissez. Trois manches par jour : le hasard trouve l’Étoile une fois sur cinq… et vous ?
            </p>
            <ul className="mt-6 space-y-2 font-georgia text-sm text-deep/80">
              <li>✦ L’Étoile est placée avant votre choix, au hasard.</li>
              <li>✦ Un nouveau défi chaque jour à minuit.</li>
              <li>✦ Gardez votre série de jours et partagez votre score.</li>
            </ul>
            <button type="button" onClick={() => start(false)} className="mt-8 w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold sm:w-auto">
              Commencer l’exercice du jour →
            </button>
            {summary.streak > 0 && <p className="mt-4 font-georgia text-sm text-mist">Série en cours : {summary.streak} jour{summary.streak > 1 ? 's' : ''} ✦ gardez-la aujourd’hui.</p>}
          </section>
        )}

        {mode === 'play' && (
          <section className="mt-4" aria-live="polite">
            <div className="flex items-center justify-between font-georgia text-sm text-mist">
              <span>{practice ? 'Entraînement · ' : ''}Manche {round + 1} / {ROUNDS}</span>
              <span aria-label={`${hits.filter(Boolean).length} Étoile(s) trouvée(s)`}>{hits.map((h, i) => <span key={i}>{h ? '🌟' : '🌑'}</span>)}</span>
            </div>
            <p className="mt-4 text-center font-georgia text-lg text-deep">
              {picked === null ? 'Laissez venir… quelle carte cache l’Étoile ?' : lastHit ? 'Vous l’avez trouvée ✦' : 'Pas cette fois : l’Étoile était ailleurs.'}
            </p>
            <div className="mx-auto mt-6 grid max-w-xl grid-cols-5 gap-2 sm:gap-4">
              {Array.from({ length: CARDS }, (_, i) => (
                <Card key={`${round}-${i}`} index={i} state={cardState(i)} onPick={pick} disabled={picked !== null} />
              ))}
            </div>
            <div className="mt-8 text-center">
              {picked !== null && (
                <button type="button" onClick={next} className="rounded-xl bg-deep px-8 py-4 font-georgia text-base font-bold text-gold">
                  {round + 1 < ROUNDS ? 'Carte suivante →' : 'Voir mon résultat →'}
                </button>
              )}
            </div>
          </section>
        )}

        {mode === 'done' && (
          <section className="mt-4">
            {practice ? (
              <div className="rounded-3xl border border-gold/30 bg-white/75 p-6 text-center">
                <p className="font-georgia text-sm uppercase tracking-[0.18em] text-gold">Entraînement</p>
                <p className="mt-2 font-georgia text-4xl">{practiceScore} / {ROUNDS}</p>
                <p className="mt-2 font-georgia text-sm text-mist">Les entraînements ne comptent pas dans votre série.</p>
              </div>
            ) : (
              <div className="rounded-3xl bg-deep p-6 text-center text-cream md:p-8">
                <p className="font-georgia text-xs uppercase tracking-[0.2em] text-gold">Défi du jour</p>
                <p className="mt-3 text-3xl tracking-[0.2em]" aria-hidden="true">{todayHits.map((h) => (h ? '🌟' : '🌑')).join('')}</p>
                <p className="mt-2 font-georgia text-4xl">{todayHits.filter(Boolean).length} / {ROUNDS}</p>
                <p className="mx-auto mt-3 max-w-md font-georgia text-sm leading-relaxed text-cream/80">{scoreMessage(todayHits.filter(Boolean).length)}</p>
                <p className="mt-4 font-georgia text-xs text-cream/60">Revenez demain pour un nouveau défi.</p>
              </div>
            )}

            <div className="mt-5 grid grid-cols-3 gap-2 text-center font-georgia">
              <div className="rounded-2xl border border-gold/25 bg-white/70 p-3"><p className="text-2xl">{summary.streak}</p><p className="text-[11px] uppercase tracking-[0.12em] text-mist">jours de suite</p></div>
              <div className="rounded-2xl border border-gold/25 bg-white/70 p-3"><p className="text-2xl">{pct(summary.rate)}</p><p className="text-[11px] uppercase tracking-[0.12em] text-mist">votre réussite</p></div>
              <div className="rounded-2xl border border-gold/25 bg-white/70 p-3"><p className="text-2xl">{pct(CHANCE_RATE)}</p><p className="text-[11px] uppercase tracking-[0.12em] text-mist">le hasard</p></div>
            </div>

            {!practice && playedToday && <Share day={today} hits={todayHits} />}

            <button type="button" onClick={() => start(true)} className="mt-4 w-full rounded-xl border border-gold/40 bg-white px-5 py-3 font-georgia text-sm text-deep">
              S’entraîner encore (ne compte pas)
            </button>

            {!practice && playedToday && <Reminder />}
          </section>
        )}

        <p className="mt-12 font-georgia text-xs leading-relaxed text-mist/80">
          Exercice gratuit d’entraînement à l’écoute intuitive : il ne mesure pas un don et ne prédit rien. Aucune inscription, vos scores restent sur votre téléphone.
        </p>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
