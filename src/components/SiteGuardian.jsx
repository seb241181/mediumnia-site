import { useState, useRef, useEffect } from 'react'

const MAX_CHARS = 1200
const MAX_MESSAGES = 20
const WELCOME = 'Bienvenue. Je suis le Gardien de MediumIA.\nJe peux vous guider, répondre à vos questions et vous aider à trouver ce que vous cherchez.'
const AVATAR = '/images/guardian/guardian-mediumia.png'

export default function SiteGuardian() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: WELCOME },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  const userMsgCount = messages.filter(m => m.role === 'user').length

  useEffect(() => {
    if (open && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    if (text.length > MAX_CHARS) return

    if (userMsgCount >= MAX_MESSAGES / 2) {
      setError('Vous avez atteint la limite de messages pour cette conversation.')
      return
    }

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setError('')
    setLoading(true)

    const history = newMessages.filter((_, i) => i > 0).slice(-(MAX_MESSAGES)).map(m =>
      m.role === 'assistant' && m.content.length > 2000
        ? { ...m, content: m.content.slice(0, 2000) }
        : m
    )

    try {
      const res = await fetch('/api/mediumia-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guardian', history }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || data.error || 'Le Gardien est momentanément indisponible.')
        setLoading(false)
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch {
      setError('Impossible de contacter le Gardien. Réessayez.')
    }
    setLoading(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isFirstAssistant = (i) => {
    if (messages[i]?.role !== 'assistant') return false
    if (i === 0) return true
    return messages[i - 1]?.role !== 'assistant'
  }

  return (
    <>
      <style>{`
        @keyframes guardian-breathe {
          0%, 100% { box-shadow: 0 0 12px 2px rgba(201,168,76,0.25), 0 4px 16px rgba(26,21,53,0.3); transform: scale(1); }
          50% { box-shadow: 0 0 20px 5px rgba(201,168,76,0.4), 0 4px 20px rgba(26,21,53,0.35); transform: scale(1.02); }
        }
        @keyframes guardian-halo {
          0%, 100% { box-shadow: 0 0 4px 1px rgba(201,168,76,0.2); }
          50% { box-shadow: 0 0 8px 3px rgba(201,168,76,0.45); }
        }
        .guardian-fab {
          animation: guardian-breathe 4s ease-in-out infinite;
        }
        .guardian-fab:hover {
          animation: none;
          transform: scale(1.05);
          box-shadow: 0 0 22px 6px rgba(201,168,76,0.45), 0 4px 20px rgba(26,21,53,0.4);
        }
        .guardian-mini-halo {
          animation: guardian-halo 4s ease-in-out infinite;
        }
      `}</style>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="guardian-fab fixed bottom-6 right-6 z-[60] w-16 h-16 md:w-[72px] md:h-[72px] rounded-full flex items-center justify-center transition-all overflow-hidden"
          style={{ border: '2px solid rgba(201,168,76,0.6)' }}
          aria-label="Ouvrir le Gardien de MediumIA"
          title="Le Gardien de MediumIA"
        >
          <img
            src={AVATAR}
            alt="Le Gardien de MediumIA"
            className="w-full h-full object-cover rounded-full"
          />
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] sm:w-96 max-h-[80vh] flex flex-col rounded-2xl shadow-2xl border border-gold/25 overflow-hidden"
          style={{ background: '#FAFAF7' }}
        >
          <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-gold/20"
            style={{ background: 'linear-gradient(135deg, #1A1535, #2A2050)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={AVATAR}
                alt="Le Gardien de MediumIA"
                className="w-11 h-11 rounded-full object-cover shrink-0"
                style={{ border: '1.5px solid rgba(201,168,76,0.5)' }}
              />
              <div className="min-w-0">
                <h3 className="font-georgia text-cream text-sm font-semibold tracking-wide">Le Gardien de MediumIA</h3>
                <p className="font-georgia text-cream/50 text-[11px] mt-0.5">Je peux vous guider dans cet univers.</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-cream/50 hover:text-cream transition-colors text-xl leading-none p-1 shrink-0"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-[200px] max-h-[50vh]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && isFirstAssistant(i) && (
                  <img
                    src={AVATAR}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover shrink-0 mt-1 mr-2"
                    style={{ border: '1px solid rgba(201,168,76,0.3)' }}
                  />
                )}
                {msg.role === 'assistant' && !isFirstAssistant(i) && (
                  <div className="w-6 shrink-0 mr-2" />
                )}
                <div
                  className={`font-georgia text-sm leading-relaxed rounded-2xl px-4 py-3 max-w-[80%] whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-deep text-cream rounded-br-md'
                      : 'bg-gold/10 text-deep border border-gold/15 rounded-bl-md'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <img
                  src={AVATAR}
                  alt=""
                  className="guardian-mini-halo w-6 h-6 rounded-full object-cover shrink-0 mt-1 mr-2"
                  style={{ border: '1px solid rgba(201,168,76,0.3)' }}
                />
                <div className="bg-gold/10 border border-gold/15 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-gold/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gold/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gold/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            {error && (
              <p className="font-georgia text-xs text-red-500 text-center px-2">{error}</p>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-gold/20 px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question…"
                rows={1}
                className="flex-1 font-georgia text-sm text-deep bg-white border border-gold/25 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-gold/60 transition-colors placeholder:text-mist/40"
                disabled={loading}
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="shrink-0 w-10 h-10 rounded-xl bg-deep text-gold flex items-center justify-center disabled:opacity-40 transition-opacity"
                aria-label="Envoyer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <p className="font-georgia text-[9px] text-mist/40 text-center mt-2">Assistant IA · {input.length}/{MAX_CHARS}</p>
          </div>
        </div>
      )}
    </>
  )
}
