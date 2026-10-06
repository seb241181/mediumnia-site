import { useEffect, useState } from 'react'
import LegalFooter from './LegalFooter'
import SiteNav from './SiteNav'
import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'
import { CHANNELS, PROFILES, QUESTIONS, percentages, quizShareText, scoreQuiz } from '../lib/quizSensibilite.js'
import { canvasToQuizFile, drawQuizStoryImage } from '../lib/quizShareImage.js'

function openWith(onOpen) {
  return (event) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
}

function ChannelBars({ scores }) {
  const pct = percentages(scores)
  return (
    <ul className="mt-6 space-y-3" aria-label="Répartition de vos réponses par canal">
      {CHANNELS.map((channel) => (
        <li key={channel}>
          <div className="flex items-baseline justify-between font-georgia text-sm">
            <span className="text-deep">{PROFILES[channel].name}</span>
            <span className="text-mist">{pct[channel]} %</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-deep/10">
            <div className="h-full rounded-full bg-gold" style={{ width: `${pct[channel]}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ShareResult({ result }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = quizShareText(result?.dominant)

  async function shareImage() {
    if (!result || busy) return
    setBusy(true)
    setNote('')
    try {
      const file = await canvasToQuizFile(await drawQuizStoryImage(document.createElement('canvas'), result))
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text })
          trackMediumiaMetric('quiz_shared', 'quiz')
        } catch { /* partage annulé */ }
      } else {
        const url = URL.createObjectURL(file)
        const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        trackMediumiaMetric('quiz_shared', 'quiz')
        setNote('Image enregistrée : ajoutez-la à votre story Instagram, TikTok ou Facebook.')
      }
    } catch {
      setNote('L’image n’a pas pu être créée sur cet appareil.')
    } finally {
      setBusy(false)
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      trackMediumiaMetric('quiz_shared', 'quiz')
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setNote('La copie n’est pas disponible sur cet appareil.')
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-gold/25 bg-white/70 p-5 text-center">
      <p className="font-georgia text-sm font-medium text-deep">Partagez votre canal en story</p>
      <p className="mt-1 font-georgia text-xs text-mist">Votre résultat devient une image 1080 × 1920 prête pour Instagram, TikTok ou Facebook.</p>
      <button type="button" onClick={shareImage} disabled={busy} className="mt-4 w-full rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-60">
        {busy ? 'Création de l’image…' : 'Partager mon résultat en story →'}
      </button>
      <button type="button" onClick={copyText} className="mt-2 w-full rounded-xl border border-gold/35 bg-white px-5 py-3 font-georgia text-sm text-deep">
        {copied ? 'Texte copié ✓' : 'Copier aussi le texte'}
      </button>
      {note && <p role="status" className="mt-2 font-georgia text-xs text-mist">{note}</p>}
    </div>
  )
}

// Même séquence que la page Formation : 3 exercices réellement issus du parcours,
// 3 e-mails seulement, consentement explicite enregistré avec sa source « quiz ».
function ExerciseLead() {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!consent || loading || done) return
    setLoading(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await fetch('/api/oracle-interpret?mode=formation-email-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), consent: true, origin: 'quiz' }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setIsError(true)
        setMessage(body.message || 'Trop de demandes ont été effectuées. Merci de réessayer plus tard.')
        return
      }
      if (res.status === 409) {
        setMessage('Votre demande est déjà en cours. Vérifiez votre boîte e-mail dans quelques instants.')
        return
      }
      if (!res.ok) throw new Error(body.error || 'sequence_unavailable')
      setDone(true)
      if (body.status === 'already_subscribed') {
        setMessage('Cette adresse est déjà inscrite à la séquence des 3 exercices MediumIA.')
      } else {
        setMessage('C’est parti ✦ Le premier exercice arrivera dans quelques minutes, puis les deux suivants à J+2 et J+4.')
        trackMediumiaMetric('quiz_email_optin_completed', 'quiz')
      }
    } catch {
      setIsError(true)
      setMessage('La séquence n’a pas pu être programmée pour le moment. Merci de réessayer un peu plus tard.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-10 rounded-3xl border-2 border-gold/30 bg-white/75 p-6 md:p-8" aria-labelledby="quiz-exercices-title">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Passer de la lecture à la pratique</p>
      <h2 id="quiz-exercices-title" className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep">Recevez 3 exercices pour entraîner votre canal</h2>
      <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
        Trois exercices réellement issus de la Formation : L’Intention quotidienne, Le Souffle de vérité, Feu Rouge / Feu Vert. Le premier arrive tout de suite, les suivants à J+2 et J+4.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="quiz-exercise-email" className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.15em] text-mist">Votre e-mail</label>
          <input
            id="quiz-exercise-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={done}
            placeholder="votre@email.com"
            className="w-full rounded-lg border-2 border-gold/25 bg-white px-4 py-3 font-georgia text-sm text-deep transition-colors focus:border-gold/60 focus:outline-none disabled:opacity-60"
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 bg-cream/60 p-4">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={done} className="mt-1 h-4 w-4 accent-[#C9A84C]" />
          <span className="font-georgia text-sm leading-relaxed text-deep">
            Je souhaite recevoir gratuitement les 3 exercices MediumIA par e-mail et découvrir à la fin la Formation MediumIA. Je peux me désinscrire à tout moment.
          </span>
        </label>
        <p className="font-georgia text-xs leading-relaxed text-mist">
          3 e-mails seulement, aucune newsletter automatique. Consultez notre <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.
        </p>
        <button type="submit" disabled={!consent || loading || done} className="w-full rounded-lg bg-gold px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-45">
          {loading ? 'Programmation…' : done ? 'Mes 3 exercices sont programmés ✓' : 'Recevoir mes 3 exercices →'}
        </button>
        {message && <p role="status" className={`text-center font-georgia text-sm ${isError ? 'text-red-600' : 'text-deep'}`}>{message}</p>}
      </form>
    </section>
  )
}

export default function QuizSensibilitePage({ onBack, onNavigate, onOpenFormation }) {
  const [mode, setMode] = useState('intro')
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState([])

  useEffect(() => { trackMediumiaMetric('quiz_view', 'quiz') }, [])

  function start() {
    setChoices([])
    setStep(0)
    setMode('play')
    trackMediumiaMetric('quiz_started', 'quiz')
  }

  function answer(channel) {
    const next = [...choices.slice(0, step), channel]
    setChoices(next)
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1)
    } else {
      setMode('result')
      trackMediumiaMetric('quiz_completed', 'quiz')
      requestAnimationFrame(() => window.scrollTo(0, 0))
    }
  }

  const result = mode === 'result' ? scoreQuiz(choices) : null
  const profile = result ? PROFILES[result.dominant] : null
  const question = QUESTIONS[step]

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <SiteNav current="decouvrir" onHome={onBack} onOpenFormation={onOpenFormation} />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-28 md:pt-32">
        <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Quiz gratuit · 2 minutes · 8 questions</p>
        <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-5xl">Quel est votre canal de perception&nbsp;?</h1>

        {mode === 'intro' && (
          <section className="mt-4">
            <p className="max-w-xl font-georgia text-base leading-relaxed text-mist">
              La perception subtile ne prend pas la même forme pour tout le monde. Certains sentent, d’autres voient, entendent ou savent. Répondez spontanément : votre première réponse est souvent la plus juste.
            </p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {CHANNELS.map((channel) => (
                <li key={channel} className="rounded-2xl border border-gold/25 bg-white/70 px-4 py-3 font-georgia">
                  <p className="text-sm font-medium text-deep">{PROFILES[channel].name}</p>
                  <p className="text-xs italic text-mist">« {PROFILES[channel].motto} »</p>
                </li>
              ))}
            </ul>
            <button type="button" onClick={start} className="mt-8 w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold sm:w-auto">
              Découvrir mon canal →
            </button>
            <p className="mt-3 font-georgia text-xs text-mist">Sans inscription. Vos réponses restent sur votre appareil.</p>
          </section>
        )}

        {mode === 'play' && question && (
          <section className="mt-6" aria-live="polite">
            <div className="flex items-center justify-between font-georgia text-sm text-mist">
              <span>Question {step + 1} / {QUESTIONS.length}</span>
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className="underline decoration-gold/40 underline-offset-4 hover:text-deep">← Précédente</button>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-deep/10" aria-hidden="true">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(step / QUESTIONS.length) * 100}%` }} />
            </div>
            <h2 className="mt-6 font-georgia text-xl font-medium leading-snug text-deep md:text-2xl">{question.text}</h2>
            <div className="mt-5 grid gap-3">
              {question.answers.map(([channel, label]) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => answer(channel)}
                  className={`rounded-2xl border-2 bg-white/80 px-5 py-4 text-left font-georgia text-base leading-snug text-deep transition-colors hover:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${choices[step] === channel ? 'border-gold' : 'border-gold/25'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}

        {mode === 'result' && profile && (
          <section className="mt-6">
            <div className="rounded-3xl bg-deep p-6 text-cream md:p-8">
              <p className="font-georgia text-xs uppercase tracking-[0.2em] text-gold">Votre canal dominant</p>
              <p className="mt-3 font-georgia text-4xl font-medium md:text-5xl">{profile.name}</p>
              <p className="mt-1 font-georgia text-lg italic text-gold/90">« {profile.motto} »</p>
              <p className="mt-4 font-georgia leading-relaxed text-cream/85">{profile.portrait}</p>
              {result.secondary && !result.balanced && (
                <p className="mt-3 font-georgia text-sm text-cream/70">Canal d’appui : {PROFILES[result.secondary].name}.</p>
              )}
              {result.balanced && (
                <p className="mt-3 font-georgia text-sm text-cream/70">Vos réponses sont très équilibrées : aucun canal ne domine nettement. C’est fréquent au début, et c’est la pratique qui révélera le plus fluide.</p>
              )}
            </div>

            <ChannelBars scores={result.scores} />

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gold/25 bg-white/75 p-5">
                <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Signes qui vous parleront</p>
                <ul className="mt-3 space-y-2 font-georgia text-sm leading-relaxed text-deep">
                  {profile.signs.map((sign) => <li key={sign}>✦ {sign}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl border border-gold/25 bg-white/75 p-5">
                <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Le piège à connaître</p>
                <p className="mt-3 font-georgia text-sm leading-relaxed text-deep">{profile.pitfall}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gold/25 bg-gold/10 p-5">
              <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">À essayer dès aujourd’hui</p>
              <p className="mt-2 font-georgia text-sm leading-relaxed text-deep">{profile.practice}</p>
            </div>

            <ShareResult result={result} />

            <blockquote className="mt-10 border-l-2 border-gold pl-5 font-georgia text-base italic leading-relaxed text-deep/85">
              « Il est essentiel de ne pas vous enfermer dans une case prédéfinie. […] Dans la pratique, il y a toujours un canal qui est plus fluide que les autres, surtout au début. Et seule la pratique peut vous révéler lequel. »
              <footer className="mt-2 text-sm not-italic text-mist">Sébastien Seguin, Module 2 de la Formation MediumIA</footer>
            </blockquote>

            <ExerciseLead />

            <div className="mt-8 rounded-3xl border border-gold/30 bg-white/70 p-6 md:p-8">
              <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Aller plus loin</p>
              <h2 className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep">Les quatre canaux sont au cœur du Module 2</h2>
              <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
                La Formation MediumIA consacre un module entier à la perception pure : reconnaître chaque canal, distinguer la perception juste du parasitage, et des exercices pour explorer chacun d’eux. Vous pouvez commencer par la Découverte (Introduction et Module 1).
              </p>
              <a href="/formation" onClick={openWith(onOpenFormation)} className="mt-5 inline-flex min-h-[48px] items-center rounded-full bg-gold px-7 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90">
                Découvrir la Formation →
              </a>
            </div>

            <button type="button" onClick={start} className="mt-6 w-full rounded-xl border border-gold/40 bg-white px-5 py-3 font-georgia text-sm text-deep">
              Refaire le quiz
            </button>
          </section>
        )}

        <p className="mt-12 font-georgia text-xs leading-relaxed text-mist/80">
          Ce quiz est un miroir pour commencer à pratiquer, pas un diagnostic : il ne mesure pas un don et ne prédit rien. Chaque être humain peut développer les quatre canaux.
        </p>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
