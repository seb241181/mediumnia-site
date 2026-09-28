import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Fiche du Réseau : l'assistant du praticien répond aux questions des
// visiteurs. N'apparaît que s'il a été mis en ligne par MediumIA (ou en aperçu
// pour son praticien et l'administrateur). Aucun message n'est conservé par
// MediumIA : la conversation ne vit que dans cette page.

const API = '/api/agent-chat'
const MAX_CHARS = 800

const ERROR_LABELS = {
  monthly_limit_reached: (first) => `L’assistant a répondu à beaucoup de questions ce mois-ci. Pour aller plus loin, contactez directement ${first}.`,
  visitor_limit_reached: () => 'Vous avez posé beaucoup de questions d’affilée. Réessayez un peu plus tard.',
  message_too_long: () => `Votre message est un peu long : ${MAX_CHARS} caractères au maximum.`,
}

async function authHeaders() {
  if (!supabase) return {}
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export default function FicheAssistant({ practitioner }) {
  const firstName = String(practitioner?.name || '').split(' ')[0]
  const [info, setInfo] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}?action=fiche-assistant&slug=${encodeURIComponent(practitioner.id)}`, { headers: await authHeaders(), cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        if (!cancelled && res.ok && body.available) setInfo(body)
      } catch {
        // Pas d'assistant : la fiche reste telle quelle.
      }
    })()
    return () => { cancelled = true }
  }, [practitioner.id])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  if (!info) return null

  async function send(text) {
    const question = String(text || '').trim()
    if (!question || busy) return
    if (question.length > MAX_CHARS) { setError(ERROR_LABELS.message_too_long()); return }
    const history = messages.slice(-8)
    setMessages((list) => [...list, { role: 'user', content: question }])
    setDraft('')
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`${API}?action=fiche-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ slug: practitioner.id, message: question, history }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.reply) throw new Error(body.error || 'assistant_unavailable')
      setMessages((list) => [...list, { role: 'assistant', content: body.reply }])
    } catch (e) {
      const label = ERROR_LABELS[e.message]
      setError(label ? label(firstName) : 'L’assistant ne peut pas répondre pour le moment. Réessayez dans un instant.')
    } finally {
      setBusy(false)
    }
  }

  const suggestions = [
    'Comment se passe une séance ?',
    'Quels sont les tarifs ?',
    'Comment prendre rendez-vous ?',
  ]

  return (
    <section className="mx-auto max-w-5xl px-6 pb-14 md:pb-20" aria-labelledby="fiche-assistant-title">
      <div className="rounded-3xl border border-gold/30 bg-white/75 p-5 shadow-[0_18px_45px_rgba(26,21,53,.08)] md:p-8">
        {info.preview && (
          <p className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5 font-georgia text-xs text-deep">
            Aperçu : seuls {firstName} et MediumIA voient cet assistant tant qu’il n’est pas mis en ligne.
          </p>
        )}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Une question ? Posez-la ici</p>
            <h2 id="fiche-assistant-title" className="mt-2 font-georgia text-2xl font-medium">{info.name}</h2>
          </div>
          <p className="font-georgia text-xs text-mist">Assistant IA · répond à partir des informations de {firstName}</p>
        </div>

        <div ref={listRef} className="mt-5 max-h-[420px] space-y-3 overflow-y-auto" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-gold/35 bg-white px-4 py-2 font-georgia text-sm text-deep transition-colors hover:bg-gold/10">
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <p className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 font-georgia text-sm leading-relaxed ${m.role === 'user' ? 'bg-deep text-cream' : 'border border-gold/20 bg-cream text-deep'}`}>
                {m.content}
              </p>
            </div>
          ))}
          {busy && <p className="font-georgia text-xs text-mist">{info.name} écrit…</p>}
        </div>

        {error && <p role="alert" className="mt-3 font-georgia text-xs text-red-700">{error}</p>}

        <form onSubmit={(e) => { e.preventDefault(); send(draft) }} className="mt-4 flex gap-2">
          <label className="sr-only" htmlFor="fiche-assistant-input">Votre question</label>
          <input
            id="fiche-assistant-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_CHARS}
            placeholder="Votre question…"
            className="min-w-0 flex-1 rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-base text-deep outline-none focus:border-gold/70 sm:text-sm"
          />
          <button type="submit" disabled={busy || !draft.trim()} className="shrink-0 rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-50">
            Envoyer
          </button>
        </form>

        <p className="mt-4 font-georgia text-[11px] leading-relaxed text-mist/80">
          Réponses générées par une intelligence artificielle à partir des informations de {firstName} : elles peuvent comporter des erreurs et ne remplacent ni une séance ni un avis médical. MediumIA ne conserve pas cette conversation ; vos messages sont transmis à son prestataire d’IA le temps de répondre. N’y indiquez pas d’informations personnelles ou de santé.
        </p>
      </div>
    </section>
  )
}
