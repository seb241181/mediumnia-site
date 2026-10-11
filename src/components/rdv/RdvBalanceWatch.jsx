import { useCallback, useEffect, useState } from 'react'

// Soldes des visios à surveiller (issue #147) : avant toute annulation
// automatique, le propriétaire voit l'état réel (paiement PayPal, rappel,
// alerte, échéance) et peut Maintenir, approuver l'annulation, ou rétablir une
// visio annulée avec un nouveau lien du solde exact. Visible uniquement par
// l'administration : pour tout autre compte, l'API répond 403 et rien n'est affiché.

const money = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
const dayTime = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '—')
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null)

const CANCEL_STATE = {
  owner_hold: ['Maintenu par vous : aucune annulation automatique', 'ok'],
  late_payment_window: ['Lien de solde tardif en cours', 'ok'],
  payment_uncertain: ['Paiement PayPal engagé non confirmé : à vérifier', 'warn'],
  external_payment_recorded: ['Paiement externe enregistré : aucune annulation', 'ok'],
  awaiting_owner_decision: ['En attente de votre décision', 'warn'],
  owner_not_alerted: ['Annulation suspendue : alerte pas encore partie', 'warn'],
}
const RESTORE_BLOCKERS = {
  too_close_to_start: 'trop proche de l’heure du rendez-vous',
  nothing_due: 'rien à régler',
  deposit_settled: 'arrhes déjà traitées (conservées, remboursées…)',
  deposit_transferred: 'arrhes transférées vers un autre rendez-vous',
  refund_exists: 'un remboursement existe',
  external_payment_recorded: 'un paiement externe est déjà enregistré',
  balance_payment_in_progress: 'un paiement du solde est en cours',
  slot_booked: 'créneau pris par un autre rendez-vous',
  slot_held: 'créneau en cours de réservation',
  slot_offered: 'créneau proposé par lien d’urgence',
  calendar_exception_on_date: 'exception d’agenda ce jour-là',
  no_paypal_deposit: 'pas d’arrhes PayPal',
}
const ERRORS = {
  forbidden: 'Action réservée à l’administration.',
  migration_pending: 'La mise à jour de la base n’est pas encore appliquée.',
  restore_disabled: 'La restauration n’est pas encore activée sur ce site.',
  balance_cancel_in_progress: 'Une annulation est en cours d’exécution : réessayez dans quelques minutes.',
  google_slot_busy: 'Le créneau est occupé dans Google Agenda : libérez-le d’abord (événement saisi à la main ?).',
  google_calendar_unavailable: 'Google Agenda est inaccessible : restauration refusée par prudence.',
  google_restore_failed: 'Google Agenda n’a pas accepté l’événement : le rendez-vous est resté annulé.',
  external_payment_confirmation_required: 'Confirmez qu’aucun paiement du solde n’a été reçu hors MediumIA.',
  paypal_env_mismatch: 'Les arrhes ont été payées sur un autre environnement PayPal.',
  invalid_late_window: 'Échéance impossible : trop proche du rendez-vous.',
  not_restored_or_window_closed: 'Ce rendez-vous n’a pas de lien tardif actif.',
}
const errorText = (code) => ERRORS[code] || RESTORE_BLOCKERS[code] || `Action impossible (${code}).`

function Badge({ tone, children }) {
  const cls = tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900'
    : tone === 'bad' ? 'border-rose-300 bg-rose-50 text-rose-900'
      : 'border-emerald-300 bg-emerald-50 text-emerald-900'
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

function confirmedState(item, now) {
  if (item.owner_decision === 'cancel') return ['Annulation approuvée par vous', 'bad']
  if (item.cancel_blocker && CANCEL_STATE[item.cancel_blocker]) return CANCEL_STATE[item.cancel_blocker]
  const deadline = new Date(item.cancel_deadline_at).getTime()
  if (now >= deadline) return ['Annulation automatique au prochain passage (vers 9 h)', 'bad']
  if (now >= deadline - 30 * 3_600_000) return ['Alerte : annulation possible au passage suivant l’échéance', 'warn']
  return ['Solde dû, échéance à venir', 'ok']
}

export default function RdvBalanceWatch({ practitionerId, session }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [restoreFor, setRestoreFor] = useState(null)
  const [form, setForm] = useState({ hours: 1, confirm: false, email: false, key: null })
  const [link, setLink] = useState(null)

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }), [session])
  const fetchWatch = useCallback(async () => {
    if (!practitionerId || !session?.access_token) return { hidden: true }
    const res = await fetch(`/api/rdv-admin?action=balance-watch&practitioner_id=${encodeURIComponent(practitionerId)}`, { headers: headers(), cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (res.status === 403) return { hidden: true }
    if (!res.ok) return { error: errorText(body.error || 'watch_failed') }
    return { body: { ...body, loadedAt: Date.now() } }
  }, [practitionerId, session, headers])
  const apply = useCallback((result) => {
    if (result.hidden) { setData(null); return }
    if (result.error) { setError(result.error); return }
    setError(''); setData(result.body)
  }, [])
  const load = useCallback(async () => apply(await fetchWatch()), [apply, fetchWatch])
  useEffect(() => {
    let active = true
    fetchWatch().then(result => { if (active) apply(result) }).catch(() => {})
    return () => { active = false }
  }, [fetchWatch, apply])

  async function post(payload, label) {
    setBusy(label); setError('')
    try {
      const res = await fetch('/api/rdv-admin?action=balance-watch', { method: 'POST', headers: headers(), body: JSON.stringify({ practitioner_id: practitionerId, ...payload }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(errorText(body.error || 'action_failed')); return null }
      await load()
      return body
    } finally { setBusy('') }
  }

  if (!data) return error ? <p className="mt-6 text-sm text-rose-800">{error}</p> : null
  const now = data.loadedAt
  const items = data.items || []

  return (
    <section className="mt-8 rounded-2xl border border-gold/30 bg-white/80 p-4" aria-labelledby="balance-watch-title">
      <h3 id="balance-watch-title" className="font-georgia text-lg text-deep">Soldes visio à surveiller</h3>
      <p className="mt-1 text-xs text-[#4A3F6B]">Visios des 10 prochains jours avec un solde dû, ou annulées pour solde. Rien n’est envoyé au client sans votre action.</p>
      {!data.owner_alert_configured && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Adresse d’alerte non configurée : aucune annulation automatique ne peut avoir lieu tant que vous n’avez pas été prévenu (sécurité).</p>}
      {data.settings?.auto_cancel_mode === 'owner_review' && <p className="mt-2 text-xs text-[#4A3F6B]">Mode actuel : aucune annulation sans votre décision.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-900">{error}</p>}
      {link && <div role="status" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="font-semibold">Lien du solde exact ({money(link.due_cents)}) — valable jusqu’au {dayTime(link.late_until)}</p>
        <p className="mt-1 break-all font-mono text-xs">{link.payment_url}</p>
        <div className="mt-2 flex gap-2"><button type="button" className="min-h-11 rounded-full border border-emerald-400 px-3 text-xs font-semibold" onClick={() => navigator.clipboard?.writeText(link.payment_url)}>Copier le lien</button><button type="button" className="min-h-11 px-3 text-xs underline" onClick={() => setLink(null)}>Masquer</button></div>
        <p className="mt-1 text-xs">E-mail au client : {link.email_status === 'sent' ? 'envoyé' : link.email_status === 'not_requested' ? 'non envoyé (à vous de transmettre le lien)' : 'à vérifier'}. Ce lien n’est affiché qu’une fois.</p>
      </div>}
      {items.length === 0 ? <p className="mt-3 text-sm text-[#4A3F6B]">Aucune visio à surveiller.</p> : <ul className="mt-3 space-y-3">
        {items.map(item => {
          const cancelled = item.status === 'cancelled'
          const [label, tone] = cancelled ? ['Annulé pour solde le ' + dayTime(item.auto_cancelled_at), 'bad'] : confirmedState(item, now)
          return <li key={item.booking_id} className="rounded-xl border border-gold/20 bg-cream/60 p-3 text-sm text-deep">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p><strong>{item.customer_name}</strong> · {item.service_title} · {dayTime(item.starts_at)}</p>
              <Badge tone={tone}>{label}</Badge>
            </div>
            <p className="mt-1 text-xs text-[#4A3F6B]">
              Réglé {money(item.paid_cents)} · solde dû <strong>{money(item.due_cents)}</strong> · échéance H-48 {dayTime(item.cancel_deadline_at)}
              {' · '}rappel client {item.balance_reminder_sent_at ? 'envoyé' : 'non envoyé'}
              {item.balance_link_valid ? ` · lien valable jusqu’au ${dayTime(item.balance_link_expires_at)}` : ''}
              {item.balance_payment ? ` · PayPal : ${item.balance_payment.status}${item.balance_payment.has_order ? ' (commande créée)' : ''}` : ''}
              {item.pre_cancel_alert ? ` · alerte ${item.pre_cancel_alert.status === 'sent' ? 'envoyée' : item.pre_cancel_alert.status}` : ''}
              {item.external_payment_cents ? ` · paiement externe ${money(item.external_payment_cents)}` : ''}
            </p>
            {!cancelled && <div className="mt-2 flex flex-wrap gap-2">
              {item.owner_decision !== 'hold' && <button type="button" disabled={!!busy} className="min-h-11 rounded-full bg-deep px-4 text-xs font-semibold text-gold disabled:opacity-50" onClick={() => post({ op: 'decision', booking_id: item.booking_id, decision: 'hold' }, 'hold')}>Maintenir (pas d’annulation auto)</button>}
              {item.owner_decision !== 'cancel' && <button type="button" disabled={!!busy} className="min-h-11 rounded-full border border-rose-300 px-4 text-xs font-semibold text-rose-900 disabled:opacity-50" onClick={() => { if (window.confirm('Approuver l’annulation automatique de ce rendez-vous au prochain passage du cron ?')) post({ op: 'decision', booking_id: item.booking_id, decision: 'cancel' }, 'cancel') }}>Approuver l’annulation</button>}
              {item.owner_decision && <button type="button" disabled={!!busy} className="min-h-11 px-3 text-xs underline disabled:opacity-50" onClick={() => post({ op: 'decision', booking_id: item.booking_id, decision: null }, 'clear')}>Revenir à la règle habituelle</button>}
              {data.restore_enabled && item.restored_at && item.due_cents > 0 && <button type="button" disabled={!!busy} className="min-h-11 rounded-full border border-gold/40 px-4 text-xs font-semibold disabled:opacity-50" onClick={async () => { const body = await post({ op: 'rotate', booking_id: item.booking_id, send_email: false }, 'rotate'); if (body) setLink(body) }}>Nouveau lien de solde</button>}
            </div>}
            {cancelled && <div className="mt-2">
              {item.restore_blocker ? <p className="text-xs text-[#4A3F6B]">Rétablissement impossible : {RESTORE_BLOCKERS[item.restore_blocker] || item.restore_blocker}.</p>
                : !data.restore_enabled ? <p className="text-xs text-[#4A3F6B]">Rétablissement possible, fonction pas encore activée.</p>
                  : restoreFor !== item.booking_id ? <button type="button" className="min-h-11 rounded-full bg-deep px-4 text-xs font-semibold text-gold" onClick={() => { setRestoreFor(item.booking_id); setForm({ hours: 1, confirm: false, email: false, key: newKey() }) }}>Rétablir et générer le lien du solde ({money(item.due_cents)})</button>
                    : <form className="mt-2 space-y-2 rounded-lg bg-white p-3" onSubmit={async (event) => { event.preventDefault(); const body = await post({ op: 'restore', booking_id: item.booking_id, idempotency_key: form.key, hours_before: form.hours, confirm_no_external_payment: form.confirm, send_email: form.email }, 'restore'); if (body?.payment_url) { setLink(body); setRestoreFor(null) } }}>
                      <label className="block text-xs font-semibold">Lien valable jusqu’à
                        <select className="ml-2 min-h-11 rounded border border-gold/30 px-2" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: Number(e.target.value) }))}>{(data.late_window_hours || [1]).map(h => <option key={h} value={h}>{h} h avant le rendez-vous</option>)}</select>
                      </label>
                      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.checked }))} /><span>Je confirme qu’aucun paiement du solde n’a été reçu hors MediumIA (facture PayPal, virement, espèces).</span></label>
                      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.checked }))} /><span>Envoyer le lien au client par e-mail (sinon, je le transmets moi-même).</span></label>
                      <p className="text-xs text-[#4A3F6B]">Le créneau est revérifié dans MediumIA et Google Agenda. Les arrhes restent sur ce rendez-vous ; seul le solde exact est demandé.</p>
                      <div className="flex gap-2"><button type="submit" disabled={!form.confirm || !!busy || !form.key} className="min-h-11 rounded-full bg-deep px-4 text-xs font-semibold text-gold disabled:opacity-50">Rétablir le rendez-vous</button><button type="button" className="min-h-11 px-3 text-xs underline" onClick={() => setRestoreFor(null)}>Annuler</button></div>
                    </form>}
            </div>}
          </li>
        })}
      </ul>}
    </section>
  )
}
