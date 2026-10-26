import { useState, useRef, useEffect } from 'react'
import { userErrorMessage } from '../lib/userErrorMessage.js'

const MAX_MESSAGES = 5
const STORAGE_KEY = 'mediumia_trial_count'
const COACH_SUGGESTIONS = [
  'Je débute, par quoi commencer ?',
  'Comment observer mes ressentis sans les surinterpréter ?',
  'Propose-moi un petit exercice de perception.',
]
const MEDIUMIA_URL_RE = /(https:\/\/mediumia\.fr(?:\/[^\s]*)?)/g

function LinkedMessage({ content }) {
  return String(content || '').split(MEDIUMIA_URL_RE).map((part, index) => {
    if (!part.startsWith('https://mediumia.fr')) return <span key={index}>{part}</span>
    const match = part.match(/^(.*?)([.,;:!?)]*)$/)
    const url = match?.[1] || part
    const suffix = match?.[2] || ''
    return (
      <span key={index}>
        <a href={url} className="font-semibold underline decoration-gold/50 underline-offset-2 break-all">
          {url.replace('https://', '')}
        </a>
        {suffix}
      </span>
    )
  })
}

export default function TrialChat({ variant = 'formation' }) {
  const isCoach = variant === 'coach'
  const [messages, setMessages] = useState([
    { role: 'assistant', content: isCoach
      ? "Bonjour ! Je suis MediumIA, votre coach IA de découverte. Ici, vous pouvez me raconter ce que vous aimeriez explorer, poser une question ou demander un petit exercice d’observation. Nous avancerons à votre rythme, sans jugement et sans certitudes imposées."
      : "Bonjour. Je suis MediumIA, votre assistant pour l'accompagnement à la médiumnité consciente. Posez-moi vos questions sur le parcours, l'approche ou demandez-moi une courte pratique de découverte — je suis là pour vous éclairer." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [userCount, setUserCount] = useState(() => parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10))
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const remaining = MAX_MESSAGES - userCount
  const exhausted = remaining <= 0

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading || exhausted) return

    const userMessage = { role: 'user', content: text }
    setRequestError('')
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const newCount = userCount + 1
    setUserCount(newCount)
    sessionStorage.setItem(STORAGE_KEY, String(newCount))

    try {
      const res = await fetch('/api/mediumia-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: newMessages, ...(isCoach ? { mode: 'coach-discovery' } : {}) }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.reply) {
        throw new Error(
          res.status === 429
            ? (data.message || 'Trop de requêtes. Merci de réessayer plus tard.')
            : 'MediumIA est momentanément indisponible. Votre message n’a pas été décompté.'
        )
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (error) {
      setUserCount(userCount)
      sessionStorage.setItem(STORAGE_KEY, String(userCount))
      setMessages(prev => prev.filter(message => message !== userMessage))
      setInput(text)
      setRequestError(error?.message || 'MediumIA est momentanément indisponible. Votre message n’a pas été décompté.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-w-0 max-w-full border-2 border-gold/30 rounded-2xl overflow-hidden bg-white/70">
      <div className="on-dark px-5 py-4 border-b border-gold/20 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#1A1535,#292443)' }}>
        <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-7 w-auto opacity-90" />
        <div className="flex-1">
          <p className="font-georgia text-cream text-sm font-medium">MediumIA</p>
          <p className="font-georgia text-cream/50 text-xs">{isCoach ? 'Coach IA · Découverte gratuite' : 'Assistant accompagnement'}</p>
        </div>
        {!exhausted && (
          <span className="font-georgia text-[10px] tracking-wide text-gold/70 tabular-nums">
            {remaining} message{remaining > 1 ? 's' : ''} offert{remaining > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isCoach && messages.length === 1 && !exhausted && (
        <div className="border-b border-gold/15 px-4 py-3">
          <p className="mb-2 font-georgia text-xs text-mist">Une idée pour commencer ?</p>
          <div className="flex flex-wrap gap-2">
            {COACH_SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => setInput(suggestion)}
                className="rounded-full border border-gold/30 bg-cream/60 px-3 py-2 text-left font-georgia text-xs text-deep hover:border-gold/70">
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      <div aria-live="polite" className="min-w-0 px-3 py-4 sm:px-5 sm:py-5 space-y-4 overflow-y-auto" style={{ minHeight: 280, maxHeight: isCoach ? 500 : 360 }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && <span className="text-gold text-xs mt-1 shrink-0">✦</span>}
            <div
              className="min-w-0 break-words font-georgia text-sm leading-relaxed rounded-2xl px-3 py-3 sm:px-4 max-w-[92%] sm:max-w-[85%] whitespace-pre-wrap"
              style={m.role === 'user'
                ? { background: '#1A1535', color: '#FAFAF7', borderRadius: '18px 18px 4px 18px' }
                : { background: 'rgba(201,168,76,.08)', color: '#1A1535', border: '1px solid rgba(201,168,76,.2)', borderRadius: '18px 18px 18px 4px' }
              }
            >
              {m.role === 'assistant' ? <LinkedMessage content={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 justify-start">
            <span className="text-gold text-xs mt-1 shrink-0">✦</span>
            <div className="font-georgia text-sm text-mist/60 italic px-4 py-3" style={{ background: 'rgba(201,168,76,.05)', border: '1px solid rgba(201,168,76,.15)', borderRadius: '18px 18px 18px 4px' }}>
              MediumIA réfléchit…
            </div>
          </div>
        )}
        {exhausted && !loading && (
          <div className="text-center py-4">
            <p className="font-georgia text-sm text-mist italic mb-3">Vous avez utilisé vos {MAX_MESSAGES} messages offerts.</p>
            {isCoach ? (
              <p className="font-georgia text-sm text-deep leading-relaxed">
                Merci d’avoir découvert MediumIA. Le coach en abonnement autonome n’est pas encore proposé.
                Si vous souhaitez approfondir, vous pouvez découvrir librement la formation.
                <a href="/formation" className="mt-3 block font-semibold text-deep underline decoration-gold underline-offset-4">
                  Découvrir la formation →
                </a>
              </p>
            ) : (
              <p className="font-georgia text-sm text-deep leading-relaxed">Pour continuer à explorer avec MediumIA, rejoignez l'accompagnement complet.</p>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {requestError && (
        <p role="alert" className="mx-4 mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 font-georgia text-sm leading-relaxed text-amber-950">
          {requestError}
        </p>
      )}
      <form onSubmit={handleSend} className="min-w-0 border-t border-gold/20 p-3 sm:p-4 flex gap-2 sm:gap-3">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading || exhausted}
          maxLength={600}
          aria-label="Votre message pour MediumIA"
          placeholder={exhausted ? "Essai gratuit terminé" : (isCoach ? "Écrivez à MediumIA…" : "Posez une question ou demandez une courte pratique…")}
          className="min-w-0 flex-1 font-georgia text-base sm:text-sm text-deep bg-transparent border-2 border-gold/20 rounded-lg px-3 sm:px-4 py-2.5 focus:outline-none focus:border-gold/50 transition-colors disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={loading || exhausted || !input.trim()}
          className="font-georgia text-sm px-5 py-2.5 rounded-lg font-bold transition-all hover:opacity-90 disabled:opacity-30"
          style={{ backgroundColor: '#C9A84C', color: '#1A1535' }}
        >
          →
        </button>
      </form>
    </div>
  )
}
