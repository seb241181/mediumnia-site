import { useEffect, useMemo, useState } from 'react'
import LegalFooter from './LegalFooter'
import {
  CARDS, CHANCE_RATE, ROUNDS, SHARE_URL,
  loadState, parisDay, recordDay, saveState, scoreMessage, secureIndex, shareText, stats,
} from '../lib/defiIntuition.js'

const storage = typeof window !== 'undefined' ? window.localStorage : null
const pct = (rate) => `${Math.round(rate * 100)} %`

const NEXT_STEPS = [
  { href: '/chronosphere', title: 'Votre tirage ChronoSphère', text: 'Une lecture personnalisée de vos cycles, dès 5 €.' },
  { href: '/formation', title: 'Développer votre intuition', text: 'La formation MediumIA, pas à pas.' },
  { href: '/rdv/sebastien-seguin', title: 'Une séance avec Sébastien', text: 'En visio ou au cabinet.' },
]

function Header({ onBack }) {
  return (
    <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
        <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep">← Accueil</button>
      </div>
    </header>
  )
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
  const text = shareText(day, hits)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  async function nativeShare() {
    try { await navigator.share({ text }) } catch { /* partage annulé */ }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }
  const btn = 'rounded-xl px-4 py-3 font-georgia text-sm font-bold text-center'
  return (
    <div className="mt-6">
      <pre className="whitespace-pre-wrap rounded-xl border border-gold/25 bg-white/70 p-4 text-left font-georgia text-sm leading-relaxed text-deep">{text}</pre>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {canShare && <button type="button" onClick={nativeShare} className={`${btn} bg-deep text-gold sm:col-span-2`}>Partager mon score</button>}
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#1f8f4e] text-white`}>WhatsApp</a>
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#1b4fa0] text-white`}>Facebook</a>
        <button type="button" onClick={copy} className={`${btn} border border-gold/40 bg-white text-deep sm:col-span-2`}>{copied ? 'Copié ✓ — collez-le où vous voulez' : 'Copier le texte'}</button>
      </div>
    </div>
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

  useEffect(() => { window.scrollTo(0, 0) }, [mode])

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
      const updated = recordDay(saved, today, hits)
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
      <Header onBack={onBack} />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-8">
        <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Récréation · un défi par jour</p>
        <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-5xl">Défi Intuition</h1>

        {mode === 'intro' && (
          <section className="mt-4">
            <p className="max-w-xl font-georgia text-base leading-relaxed text-mist">
              Cinq cartes, une seule cache l’Étoile. Respirez, écoutez votre premier ressenti, et choisissez. Cinq manches par jour : le hasard en trouve une sur cinq… et vous ?
            </p>
            <ul className="mt-6 space-y-2 font-georgia text-sm text-deep/80">
              <li>✦ L’Étoile est placée avant votre choix, au hasard.</li>
              <li>✦ Un nouveau défi chaque jour à minuit.</li>
              <li>✦ Gardez votre série de jours et partagez votre score.</li>
            </ul>
            <button type="button" onClick={() => start(false)} className="mt-8 w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold sm:w-auto">
              Commencer le défi du jour →
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

            <h2 className="mt-10 font-georgia text-xl">Envie d’aller plus loin ?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {NEXT_STEPS.map((step) => (
                <a key={step.href} href={step.href} className="rounded-2xl border border-gold/30 bg-white/75 p-4 font-georgia transition hover:border-gold">
                  <p className="text-base text-deep">{step.title} →</p>
                  <p className="mt-1 text-xs leading-relaxed text-mist">{step.text}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 font-georgia text-xs leading-relaxed text-mist/80">
          Jeu gratuit d’entraînement, pour le plaisir : il ne mesure pas un don et ne prédit rien. Aucune inscription, vos scores restent sur votre téléphone.
        </p>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
