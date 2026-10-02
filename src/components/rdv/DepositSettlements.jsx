import { useCallback, useEffect, useState } from 'react'
import { parseAmount } from './dailyPaymentsHelpers.js'

// Arrhes des rendez-vous annulés : chaque paiement PayPal d'un RDV annulé
// reste « à traiter » tant qu'une décision n'est pas prise (rembourser,
// transférer vers un autre RDV du même client, ou conserver). Annuler un RDV
// ne rend jamais l'argent tout seul. Visible uniquement par l'administration :
// pour tout autre compte, l'API répond 403 et rien n'est affiché.

const money = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
const day = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '—')
const dayTime = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '—')

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null)

const CANCEL_REASONS = {
  client_self_service: 'annulé par le client',
  balance_unpaid_48h: 'annulé automatiquement (solde non réglé)',
}

const ERRORS = {
  refunds_disabled: 'Les remboursements ne sont pas encore activés sur ce site.',
  paypal_unavailable: 'PayPal est indisponible pour le moment. Réessayez plus tard.',
  migration_pending: 'La mise à jour de la base n’est pas encore appliquée.',
  forbidden: 'Action réservée à l’administration.',
  no_paypal_deposit: 'Ce rendez-vous n’a pas d’arrhes payées en ligne.',
  booking_not_cancelled: 'Le rendez-vous n’est pas annulé : annulation et remboursement restent deux opérations distinctes.',
  already_refunded: 'Ces arrhes sont déjà remboursées.',
  already_transferred: 'Ces arrhes sont déjà transférées.',
  settlement_not_open: 'Ces arrhes ont déjà été traitées : action impossible.',
  refund_amount_invalid: 'Montant invalide : il dépasse ce qui reste à rembourser.',
  paypal_environment_mismatch: 'Paiement réel : il ne peut être remboursé que depuis mediumia.fr (jamais depuis un site de test).',
  target_other_customer: 'Le rendez-vous choisi appartient à un autre client.',
  target_not_upcoming: 'Le rendez-vous choisi n’est plus à venir ou n’est plus confirmé.',
  transfer_exceeds_due: 'Les arrhes dépassent le reste à payer du rendez-vous choisi.',
  target_balance_payment_in_progress: 'Un règlement du solde est déjà engagé sur ce rendez-vous : transfert impossible.',
  target_without_price: 'Le rendez-vous choisi n’a pas de tarif enregistré.',
  paypal_capture_not_found: 'PayPal ne retrouve pas ce paiement : vérifiez dans votre compte PayPal.',
  paypal_capture_amount_mismatch: 'Le montant chez PayPal ne correspond pas : vérifiez dans votre compte PayPal.',
  paypal_external_refund_mismatch: 'Un remboursement différent existe déjà chez PayPal : vérifiez dans votre compte PayPal avant toute action.',
  paypal_capture_already_refunded: 'PayPal indique ce paiement déjà remboursé : vérifiez dans votre compte PayPal.',
  paypal_lookup_failed: 'PayPal n’a pas pu être consulté. Aucun argent n’a été rendu ; réessayez plus tard.',
}

const RESULTS = {
  completed: 'Remboursement confirmé par PayPal.',
  pending: 'PayPal a accepté le remboursement ; il sera finalisé sous peu. Revenez vérifier.',
  check_later: 'Réponse de PayPal en attente. Ne relancez pas : revenez dans 2 minutes et cliquez « Vérifier le remboursement ».',
  unknown: 'PayPal n’a pas répondu clairement. Ne relancez pas : revenez dans 2 minutes et cliquez « Vérifier le remboursement ».',
}

function statusOf(item) {
  const active = item.refunds.find((r) => ['pending', 'unknown'].includes(r.status))
  const last = item.refunds.at(-1)
  switch (item.settlement_status) {
    case 'refunded': {
      const done = [...item.refunds].reverse().find((r) => r.status === 'completed')
      return { tone: 'done', label: `Remboursées le ${day(done?.completed_at)}` }
    }
    case 'partially_refunded':
      return { tone: 'warn', label: `Remboursées en partie (${money(item.refunded_cents)} sur ${money(item.amount_cents)})` }
    case 'transferred':
      return { tone: 'done', label: `Transférées vers le rendez-vous du ${day(item.transfer?.target_starts_at)}` }
    case 'retained':
      return { tone: 'done', label: 'Conservées' }
    case 'refund_pending':
      return active?.status === 'unknown'
        ? { tone: 'alert', label: 'Remboursement à vérifier chez PayPal' }
        : { tone: 'warn', label: 'Remboursement en cours' }
    default:
      return last?.status === 'failed'
        ? { tone: 'alert', label: 'À traiter (dernier remboursement : échec)' }
        : { tone: 'todo', label: 'À traiter' }
  }
}

const TONES = {
  todo: 'border-amber-300 bg-amber-50 text-amber-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  alert: 'border-red-200 bg-red-50 text-red-800',
  done: 'border-gold/30 bg-gold/10 text-deep',
}

function SettlementCard({ item, practitionerId, session, refundsEnabled, onChanged }) {
  // action : null | 'refund' | 'transfer' | 'retain'
  const [action, setAction] = useState(null)
  const [key, setKey] = useState(null)
  const [amount, setAmount] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const remaining = item.amount_cents - item.refunded_cents
  const status = statusOf(item)
  const lastFailed = item.settlement_status !== 'refunded' && item.refunds.at(-1)?.status === 'failed' ? item.refunds.at(-1) : null

  function open(next) {
    setAction(next)
    // Une clé par décision : un double clic ou un renvoi rejoue la même demande.
    setKey(newKey())
    setAmount((remaining / 100).toFixed(2).replace('.', ','))
    setTarget(item.targets[0]?.booking_id || '')
    setMessage(null)
  }

  async function send(body) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/rdv-admin?action=deposit-settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ practitioner_id: practitionerId, booking_id: item.booking_id, ...body }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.status && RESULTS[data.status]) {
        setMessage({ ok: data.status === 'completed', text: RESULTS[data.status] })
      } else if (data.status === 'failed') {
        setMessage({ ok: false, text: ERRORS[data.error] || `Remboursement refusé par PayPal (${data.error || 'erreur'}). Aucun argent n’a été rendu.` })
      } else if (data.status === 'manual_review') {
        setMessage({ ok: false, text: ERRORS[data.error] || 'L’état chez PayPal ne correspond pas : vérifiez dans votre compte PayPal.' })
      } else if (response.ok) {
        setMessage({ ok: true, text: data.status === 'transferred' ? 'Arrhes transférées.' : 'Arrhes conservées.' })
      } else {
        setMessage({ ok: false, text: ERRORS[data.error] || 'Action impossible pour le moment.' })
      }
      setAction(null)
      onChanged()
    } catch {
      // Réponse perdue : la même clé sera rejouée, sans double remboursement.
      setMessage({ ok: false, text: 'Connexion interrompue. Réessayez : la même demande sera rejouée, sans double remboursement.' })
    } finally {
      setBusy(false)
    }
  }

  function confirm() {
    if (!key) return setMessage({ ok: false, text: 'Navigateur trop ancien pour cette action.' })
    if (action === 'refund') {
      const cents = parseAmount(amount)
      if (!cents || cents > remaining) return setMessage({ ok: false, text: `Indiquez un montant entre 0,01 € et ${money(remaining)}.` })
      return send({ op: 'refund', idempotency_key: key, amount_cents: cents })
    }
    if (action === 'transfer') {
      if (!target) return setMessage({ ok: false, text: 'Choisissez le rendez-vous qui reçoit les arrhes.' })
      return send({ op: 'transfer', idempotency_key: key, target_booking_id: target })
    }
    return send({ op: 'retain' })
  }

  const chosen = item.targets.find((t) => t.booking_id === target)
  const confirmText = action === 'refund'
    ? `Rembourser ${money(parseAmount(amount) || 0)} à ${item.customer_name} sur son compte PayPal ?`
    : action === 'transfer'
      ? `Transférer ${money(item.amount_cents)} d’arrhes de ${item.customer_name} vers le rendez-vous du ${day(chosen?.starts_at)} ? Aucun argent ne bouge chez PayPal.`
      : `Conserver définitivement les ${money(item.amount_cents)} d’arrhes de ${item.customer_name} ? Plus aucun remboursement ni transfert ne sera possible.`

  return (
    <li className="rounded-xl border border-gold/20 bg-white/70 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-georgia text-sm font-semibold text-deep">{item.customer_name || 'Client'}</p>
          <p className="font-georgia text-xs text-mist">
            {item.service_title || 'Rendez-vous'} · {dayTime(item.starts_at)}
            {item.cancel_reason && CANCEL_REASONS[item.cancel_reason] ? ` · ${CANCEL_REASONS[item.cancel_reason]}` : ' · annulé'}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-georgia text-[11px] ${TONES[status.tone]}`}>{status.label}</span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 font-georgia text-xs text-deep sm:grid-cols-3">
        <div><dt className="inline text-mist">Arrhes : </dt><dd className="inline font-semibold">{money(item.amount_cents)}</dd></div>
        <div><dt className="inline text-mist">Paiement : </dt><dd className="inline">encaissé le {day(item.captured_at)}{item.paypal_env === 'sandbox' ? ' (test sandbox)' : ''}</dd></div>
        <div className="min-w-0"><dt className="inline text-mist">Réf. PayPal : </dt><dd className="inline break-all">{item.paypal_capture_id}</dd></div>
      </dl>

      {lastFailed && (
        <p className="mt-2 font-georgia text-xs text-red-800">
          Dernier essai de remboursement refusé{lastFailed.error_code ? ` (${lastFailed.error_code})` : ''}. Aucun argent n’a été rendu.
        </p>
      )}
      {item.refunds.filter((r) => r.status === 'completed').map((r) => (
        <p key={r.id} className="mt-1 font-georgia text-xs text-mist">
          Remboursé {money(r.amount_cents)} le {dayTime(r.completed_at)} · réf. {r.paypal_refund_id}{r.adopted_external ? ' (fait directement dans PayPal)' : ''}
        </p>
      ))}

      {!item.allowed.refund && ['open', 'partially_refunded'].includes(item.settlement_status) && (
        <p className="mt-2 font-georgia text-xs text-mist">
          {!refundsEnabled
            ? 'Remboursements PayPal non activés sur ce site.'
            : 'Paiement réel : remboursable uniquement depuis mediumia.fr.'}
        </p>
      )}

      {!action && (item.allowed.refund || item.allowed.transfer || item.allowed.retain || item.allowed.reconcile) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.allowed.reconcile && (
            <button type="button" disabled={busy} onClick={() => { const k = newKey(); setKey(k); send({ op: 'refund', idempotency_key: k }) }} className="rounded-lg bg-deep px-3 py-2 font-georgia text-xs text-gold disabled:opacity-50">
              {busy ? 'Vérification…' : 'Vérifier le remboursement'}
            </button>
          )}
          {item.allowed.refund && (
            <button type="button" onClick={() => open('refund')} className="rounded-lg bg-deep px-3 py-2 font-georgia text-xs text-gold">
              Rembourser {money(remaining)}
            </button>
          )}
          {item.allowed.transfer && (
            <button type="button" onClick={() => open('transfer')} className="rounded-lg border border-gold/40 px-3 py-2 font-georgia text-xs text-deep hover:bg-gold/10">
              Transférer vers un autre rendez-vous
            </button>
          )}
          {item.allowed.retain && (
            <button type="button" onClick={() => open('retain')} className="rounded-lg border border-gold/25 px-3 py-2 font-georgia text-xs text-mist hover:text-deep">
              Conserver les arrhes
            </button>
          )}
        </div>
      )}

      {action && (
        <div className="mt-3 rounded-xl border border-gold/30 bg-cream/70 px-4 py-3">
          {action === 'refund' && (
            <label className="block font-georgia text-xs text-deep">
              Montant à rembourser (au plus {money(remaining)})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-32 rounded-lg border border-gold/30 bg-white px-3 py-2 text-base sm:text-sm"
              />
            </label>
          )}
          {action === 'transfer' && (
            <label className="block font-georgia text-xs text-deep">
              Rendez-vous qui reçoit les arrhes
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block w-full rounded-lg border border-gold/30 bg-white px-3 py-2 text-base sm:text-sm">
                {item.targets.map((t) => (
                  <option key={t.booking_id} value={t.booking_id}>
                    {dayTime(t.starts_at)} · {t.service_title || 'Rendez-vous'} · reste à payer {money(t.due_cents)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="mt-3 font-georgia text-sm font-semibold text-deep">{confirmText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={confirm} className="rounded-lg bg-deep px-4 py-2 font-georgia text-xs text-gold disabled:opacity-50">
              {busy ? 'En cours…' : 'Confirmer'}
            </button>
            <button type="button" disabled={busy} onClick={() => setAction(null)} className="rounded-lg border border-gold/25 px-4 py-2 font-georgia text-xs text-mist hover:text-deep">
              Annuler
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-3 font-georgia text-xs ${message.ok ? 'text-deep' : 'text-red-800'}`}>{message.text}</p>
      )}
    </li>
  )
}

export default function DepositSettlements({ practitionerId, session, onChanged }) {
  const [data, setData] = useState(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!practitionerId || !session?.access_token) return
    let cancelled = false
    fetch(`/api/rdv-admin?action=deposit-settlements&practitioner_id=${encodeURIComponent(practitionerId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setData(body) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [practitionerId, session?.access_token, nonce])

  const changed = useCallback(() => {
    setNonce((n) => n + 1)
    onChanged?.()
  }, [onChanged])

  const items = data?.items || []
  if (!items.length) return null
  const todo = items.filter((i) => ['open', 'refund_pending', 'partially_refunded'].includes(i.settlement_status)).length

  return (
    <div className="mt-6 rounded-2xl border border-gold/25 bg-white/55 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-georgia text-base font-medium text-deep">Arrhes des rendez-vous annulés</h3>
        <p className="font-georgia text-xs text-mist">{todo ? `${todo} à traiter` : 'Tout est traité'}</p>
      </div>
      <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">
        Annuler un rendez-vous ne rembourse jamais automatiquement. Choisissez ici : rembourser, transférer vers un autre rendez-vous du même client, ou conserver.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <SettlementCard
            key={item.booking_id}
            item={item}
            practitionerId={practitionerId}
            session={session}
            refundsEnabled={data.refunds_enabled}
            onChanged={changed}
          />
        ))}
      </ul>
    </div>
  )
}
