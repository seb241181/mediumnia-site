import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import AgentDocuments from './AgentDocuments.jsx'

export default function AgentChat({ agentId, onBack }) {
  const [agent, setAgent] = useState(null)
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('loading')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [workspaceTab, setWorkspaceTab] = useState('chat')
  const endRef = useRef(null)

  useEffect(() => {
    let active = true

    async function load() {
      if (!supabase || !agentId) return
      setStatus('loading'); setError('')

      const { data: agentData, error: agentError } = await supabase
        .from('agents')
        .select('id, name, status, mission, audience, tone, knowledge_summary, limits')
        .eq('id', agentId)
        .single()

      if (!active) return
      if (agentError || !agentData) {
        setError(agentError?.message || 'Agent introuvable.')
        setStatus('error')
        return
      }
      setAgent(agentData)

      const { data: conversations, error: conversationError } = await supabase
        .from('agent_conversations')
        .select('id, title, updated_at')
        .eq('agent_id', agentId)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (!active) return
      if (conversationError) {
        setError(conversationError.message)
        setStatus('error')
        return
      }

      const latest = conversations?.[0]
      if (latest) {
        setConversationId(latest.id)
        const { data: history, error: historyError } = await supabase
          .from('agent_messages')
          .select('id, role, content, created_at, sources')
          .eq('conversation_id', latest.id)
          .order('created_at', { ascending: true })
          .limit(100)

        if (!active) return
        if (historyError) {
          setError(historyError.message)
          setStatus('error')
          return
        }
        setMessages(history || [])
      }

      setStatus('ready')
    }

    load()
    return () => { active = false }
  }, [agentId])

  useEffect(() => {
    if (workspaceTab === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending, workspaceTab])

  async function sendMessage(e) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || sending || !agent) return

    setSending(true); setError(''); setInput('')
    const optimistic = { id: `local-${Date.now()}`, role: 'user', content: text, sources: [] }
    setMessages((prev) => [...prev, optimistic])

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      setSending(false)
      setError('Votre session a expiré. Reconnectez-vous.')
      return
    }

    try {
      const response = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agentId: agent.id, conversationId, message: text }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Impossible de joindre votre agent.')

      if (!conversationId && data.conversationId) setConversationId(data.conversationId)
      setMessages((prev) => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        sources: data.sources || [],
      }])
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.')
    } finally {
      setSending(false)
    }
  }

  if (status === 'loading') {
    return <section className="px-6 pb-24 max-w-4xl mx-auto"><p className="font-georgia text-mist text-center py-16">Ouverture de votre agent…</p></section>
  }

  if (status === 'error' || !agent) {
    return <section className="px-6 pb-24 max-w-4xl mx-auto"><button onClick={onBack} className="font-georgia text-sm text-mist mb-6">← Mes agents</button><div className="rounded-2xl border border-red-300/40 bg-red-50 p-6 text-center"><p className="font-georgia text-red-500">{error || 'Agent introuvable.'}</p></div></section>
  }

  return (
    <section className="px-4 md:px-6 pb-24 max-w-5xl mx-auto">
      <div className="mb-5 flex items-center justify-between gap-4">
        <button onClick={onBack} className="font-georgia text-sm text-mist">← Mes agents</button>
        <span className="font-georgia text-[11px] uppercase tracking-wider text-gold bg-deep/5 rounded-full px-3 py-1">{agent.status}</span>
      </div>

      <div className="rounded-3xl overflow-hidden border border-gold/25 shadow-xl bg-white/55 min-h-[650px] flex flex-col">
        <div className="bg-deep text-cream px-6 py-5 md:px-8 flex items-start justify-between gap-5">
          <div>
            <p className="font-georgia text-gold text-xs tracking-[0.2em] uppercase mb-2">Agent MediumIA</p>
            <h2 className="font-georgia text-2xl md:text-3xl">{agent.name}</h2>
            <p className="font-georgia text-cream/55 text-sm mt-2 line-clamp-2">{agent.mission}</p>
          </div>
          <span className="text-gold text-3xl">✦</span>
        </div>

        <div className="border-b border-gold/15 bg-cream/80 px-4 md:px-8 py-3 flex gap-2 overflow-x-auto">
          <button onClick={() => setWorkspaceTab('chat')} className={`font-georgia text-sm px-4 py-2 rounded-lg ${workspaceTab === 'chat' ? 'bg-deep text-gold' : 'text-mist'}`}>Conversation</button>
          <button onClick={() => setWorkspaceTab('documents')} className={`font-georgia text-sm px-4 py-2 rounded-lg ${workspaceTab === 'documents' ? 'bg-deep text-gold' : 'text-mist'}`}>Documents & mémoire</button>
        </div>

        {workspaceTab === 'documents' ? (
          <AgentDocuments agentId={agent.id} />
        ) : (
          <>
            <div className="flex-1 px-4 md:px-8 py-7 space-y-4 overflow-y-auto max-h-[520px]">
              {messages.length === 0 && (
                <div className="max-w-xl mx-auto text-center py-16">
                  <p className="text-gold text-4xl mb-4">✦</p>
                  <p className="font-georgia text-2xl text-deep mb-3">Votre agent est prêt à vous écouter.</p>
                  <p className="font-georgia text-mist leading-relaxed">Commencez naturellement. Il connaît déjà sa mission et peut utiliser uniquement les sources métier que vous avez explicitement autorisées.</p>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] md:max-w-[72%] rounded-2xl px-5 py-4 ${message.role === 'user' ? 'bg-deep text-cream rounded-br-md' : 'bg-gold/10 border border-gold/20 text-deep rounded-bl-md'}`}>
                    <p className="font-georgia text-xs mb-2 opacity-50">{message.role === 'user' ? 'Vous' : agent.name}</p>
                    <p className="font-georgia text-sm md:text-base whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    {message.role === 'assistant' && Array.isArray(message.sources) && message.sources.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-gold/20">
                        <p className="font-georgia text-[10px] uppercase tracking-wider text-mist mb-2">Sources MediumIA utilisées</p>
                        <div className="flex flex-wrap gap-2">
                          {[...new Map(message.sources.map((source) => [source.document_id || source.document_name, source])).values()].map((source) => (
                            <span key={`${source.document_id || source.document_name}-${source.chunk_index ?? 0}`} className="font-georgia text-[11px] rounded-full bg-white/70 border border-gold/25 px-2.5 py-1 text-mist">{source.document_name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md bg-gold/10 border border-gold/20 px-5 py-4"><p className="font-georgia text-sm text-mist">{agent.name} réfléchit…</p></div></div>
              )}
              <div ref={endRef} />
            </div>

            <form onSubmit={sendMessage} className="border-t border-gold/15 p-4 md:p-6 bg-cream/80">
              {error && <p className="font-georgia text-sm text-red-500 mb-3">{error}</p>}
              <div className="flex items-end gap-3">
                <textarea
                  rows="2"
                  maxLength={4000}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Parlez à votre agent…"
                  className="flex-1 resize-none rounded-xl bg-white border border-gold/25 px-4 py-3 text-deep placeholder:text-mist/50 outline-none focus:border-gold/60 font-georgia leading-relaxed"
                />
                <button type="submit" disabled={!input.trim() || sending} className="font-georgia px-5 py-3.5 rounded-xl bg-gold text-deep font-bold disabled:opacity-30">Envoyer</button>
              </div>
              <p className="font-georgia text-[11px] text-mist/55 mt-3">Conversation enregistrée dans MediumIA. Les documents ne sont utilisés qu’après validation et les actions externes restent désactivées.</p>
            </form>
          </>
        )}
      </div>
    </section>
  )
}
