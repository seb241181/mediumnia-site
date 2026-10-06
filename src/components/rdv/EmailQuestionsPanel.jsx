import { useCallback, useEffect, useMemo, useState } from 'react'

const money = (cents) => `${(Number(cents || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function fmtDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value))
}

function statusLabel(status) {
  return ({
    paid: 'À répondre',
    in_progress: 'En cours',
    answered: 'Répondu',
    refund_pending: 'Remboursement en cours',
    refunded: 'Remboursé',
    manual_review: 'À vérifier',
  })[status] || status
}

export default function EmailQuestionsPanel({ session }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(null)
  const [answers, setAnswers] = useState({})
  const [notice, setNotice] = useState('')

  const api = useCallback(async (method = 'GET', body = null) => {
    const res = await fetch('/api/rdv-admin?action=email-questions', {
      method,
      headers: {
        Authorization: `Bearer ${session?.access_token || ''}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'question_admin_failed')
    return data
  }, [session?.access_token])

  const load = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    try {
      const data = await api()
      setRows(data.questions || [])
    } catch {
      setNotice('Impossible de charger les questions e-mail.')
    } finally {
      setLoading(false)
    }
  }, [api, session?.access_token])

  useEffect(() => { load() }, [load])

  const pending = useMemo(() => rows.filter((r) => ['paid', 'in_progress', 'manual_review', 'refund_pending'].includes(r.status)), [rows])
  const history = useMemo(() => rows.filter((r) => ['answered', 'refunded'].includes(r.status)).slice(0, 20), [rows])

  async function mutate(id, op, extra = {}) {
    setWorking(id)
    setNotice('')
    try {
      await api('POST', { id, op, ...extra })
      await load()
      if (op === 'answer') setAnswers((prev) => ({ ...prev, [id]: '' }))
      setNotice(op === 'answer' ? 'Réponse envoyée.' : op === 'refund' ? 'Remboursement traité.' : 'Demande mise en cours.')
    } catch (error) {
      const code = error?.message || 'action_failed'
      setNotice(code === 'answer_delivery_uncertain'
        ? 'Envoi incertain : la demande a été mise « À vérifier » pour éviter un double e-mail.'
        : code === 'refund_uncertain'
          ? 'Remboursement incertain : vérification manuelle nécessaire avant toute nouvelle tentative.'
          : 'Action impossible pour le moment. Aucune double action ne sera lancée.')
    } finally {
      setWorking(null)
    }
  }

  if (!session?.access_token) return null

  return (
    <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Sans rendez-vous</p>
          <h2 className="mt-1 font-georgia text-lg font-medium text-deep">Questions par e-mail</h2>
          <p className="mt-1 font-georgia text-xs text-mist">19,90 € la question · 29,90 € les deux · réponse personnelle par Sébastien.</p>
        </div>
        <span className="rounded-full border border-gold/25 bg-cream px-3 py-1 font-georgia text-xs text-deep">
          {pending.length} à traiter
        </span>
      </div>

      {notice && <p role="status" className="mb-4 rounded-xl border border-gold/20 bg-cream/70 px-4 py-3 font-georgia text-xs text-deep">{notice}</p>}
      {loading ? (
        <p className="font-georgia text-sm text-mist">Chargement…</p>
      ) : pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gold/25 px-5 py-8 text-center font-georgia text-sm text-mist">Aucune question en attente.</p>
      ) : (
        <div className="space-y-4">
          {pending.map((row) => (
            <article key={row.id} className="rounded-2xl border border-gold/20 bg-white/70 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-georgia text-sm font-semibold text-deep">{row.first_name}</p>
                  <p className="font-georgia text-xs text-mist">{row.email} · {money(row.amount_cents)} · {statusLabel(row.status)}</p>
                  <p className="mt-1 font-georgia text-[11px] text-mist">Payé : {fmtDate(row.paid_at)} · échéance : {fmtDate(row.due_at)}</p>
                </div>
                {row.status === 'paid' && (
                  <button
                    type="button"
                    disabled={working === row.id}
                    onClick={() => mutate(row.id, 'start')}
                    className="rounded-lg border border-gold/30 px-3 py-2 font-georgia text-xs text-gold disabled:opacity-50"
                  >
                    Commencer
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {(Array.isArray(row.questions) ? row.questions : []).map((item, i) => (
                  <div key={i} className="rounded-xl border border-gold/15 bg-cream/50 p-4">
                    <p className="font-georgia text-[10px] uppercase tracking-[0.15em] text-gold">Question {i + 1}</p>
                    <p className="mt-1 whitespace-pre-wrap font-georgia text-sm leading-relaxed text-deep">{item.q}</p>
                    {item.context && <p className="mt-2 whitespace-pre-wrap font-georgia text-xs leading-relaxed text-mist">Contexte : {item.context}</p>}
                  </div>
                ))}
              </div>

              {!['refund_pending', 'manual_review'].includes(row.status) && (
                <>
                  <label className="mt-4 block font-georgia text-xs uppercase tracking-[0.12em] text-mist">Votre réponse</label>
                  <textarea
                    rows={7}
                    value={answers[row.id] ?? row.answer_text ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="Écrivez ou dictez votre réponse ici…"
                    className="mt-2 w-full resize-y rounded-xl border-2 border-gold/20 bg-white px-4 py-3 font-georgia text-sm leading-relaxed text-deep focus:border-gold/60 focus:outline-none"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={working === row.id || String(answers[row.id] ?? row.answer_text ?? '').trim().length < 20}
                      onClick={() => {
                        const answer = String(answers[row.id] ?? row.answer_text ?? '').trim()
                        if (!window.confirm('Envoyer cette réponse au client ?')) return
                        mutate(row.id, 'answer', { answer })
                      }}
                      className="rounded-xl bg-deep px-5 py-2.5 font-georgia text-xs font-bold text-gold disabled:opacity-40"
                    >
                      Envoyer la réponse
                    </button>
                    <button
                      type="button"
                      disabled={working === row.id}
                      onClick={() => {
                        const reason = window.prompt('Motif interne du refus / remboursement :', 'Demande hors cadre')
                        if (reason == null) return
                        if (!window.confirm('Confirmer le remboursement intégral de cette demande ?')) return
                        mutate(row.id, 'refund', { reason })
                      }}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-georgia text-xs text-red-700 disabled:opacity-40"
                    >
                      Refuser et rembourser
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer font-georgia text-xs text-mist">Historique récent ({history.length})</summary>
          <div className="mt-3 space-y-2">
            {history.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/15 bg-white/40 px-4 py-3">
                <span className="font-georgia text-xs text-deep">{row.first_name} · {row.question_count} question{row.question_count > 1 ? 's' : ''}</span>
                <span className="font-georgia text-[11px] text-mist">{statusLabel(row.status)} · {fmtDate(row.answered_at || row.refunded_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
