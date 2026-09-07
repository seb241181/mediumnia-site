import { useState, useRef, useEffect } from 'react'

const MAX_MESSAGES = 5
const STORAGE_KEY = 'mediumia_trial_count'
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

export default function TrialChat() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Bonjour. Je suis MediumIA, votre assistant pour l'accompagnement à la médiumnité consciente. Posez-moi vos questions sur le parcours, l'approche ou demandez-moi une courte pratique de découverte — je suis là pour vous éclairer." }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
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
        body: JSON.stringify({ history: newMessages }),
      })

      if (res.status === 429 || res.status === 503) {
        const rollback = newCount - 1
        setUserCount(rollback)
        sessionStorage.setItem(STORAGE_KEY, String(rollback))
        setMessages(prev => prev.filter(m => m !== userMessage))
        const body = await res.json().catch(() => ({}))
        const msg = res.status === 429
          ? (body.message || 'Trop de requêtes. Merci de réessayer plus tard.')
          : 'Assistant temporairement indisponible. Réessayez dans quelques instants.'
        setMessages(prev => [...prev, { role: 'assistant', content: msg }])
        return
      }

      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || data.error || 'Une erreur est survenue.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Je suis momentanément indisponible. Réessayez dans quelques instants.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-2 border-gold/30 rounded-2xl overflow-hidden bg-white/70">
      <div className="px-5 py-4 border-b border-gold/20 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#1A1535,#292443)' }}>
        <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-7 w-auto opacity-90" />
        <div className="flex-1">
          <p className="font-georgia text-cream text-sm font-medium">MediumIA</p>
          <p className="font-georgia text-cream/50 text-xs">Assistant accompagnement</p>
        </div>
        {!exhausted && (
          <span className="font-georgia text-[10px] tracking-wide text-gold/70 tabular-nums">
            {remaining} message{remaining > 1 ? 's' : ''} offert{remaining > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="px-5 py-5 space-y-4 overflow-y-auto" style={{ minHeight: 240, maxHeight: 360 }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && <span className="text-gold text-xs mt-1 shrink-0">✦</span>}
            <div
              className="font-georgia text-sm leading-relaxed rounded-2xl px-4 py-3 max-w-[85%] whitespace-pre-wrap"
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
            <p className="font-georgia text-sm text-deep leading-relaxed">Pour continuer à explorer avec MediumIA, rejoignez l'accompagnement complet.</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-gold/20 p-4 flex gap-3">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading || exhausted}
          placeholder={exhausted ? "Essai terminé — rejoignez l'accompagnement" : "Posez une question ou demandez une courte pratique…"}
          className="flex-1 font-georgia text-sm text-deep bg-transparent border-2 border-gold/20 rounded-lg px-4 py-2.5 focus:outline-none focus:border-gold/50 transition-colors disabled:opacity-40"
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
