import { useCallback, useEffect, useState } from 'react'
import { defaultPaymentDate, parseAmount } from './dailyPaymentsHelpers.js'

// Caisse du jour : pour chaque rendez-vous, ce qui a déjà été payé en ligne
// (pré-rempli) et une saisie en deux gestes du règlement sur place.

const ON_SITE_METHODS = [
  ['card', 'Carte bancaire'],
  ['cash', 'Espèces'],
  ['check', 'Chèque'],
  ['transfer', 'Virement'],
]

const METHOD_LABELS = { card: 'Carte bancaire', cash: 'Espèces', check: 'Chèque', transfer: 'Virement', paypal: 'PayPal (en ligne)', other: 'Autre' }
const KIND_LABELS = { arrhes: 'arrhes', balance: 'solde', full_payment: 'paiement intégral', refund: 'remboursement', arrhes_retained: 'arrhes conservées', adjustment: 'règlement' }

const pad = (n) => String(n).padStart(2, '0')
const todayValue = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const localInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
const money = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
const time = (iso) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso))
const shortDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso))

function shiftDay(value, delta) {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function BookingRow({ booking, practitionerId, session, onSaved }) {
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState(() => (booking.remaining_cents / 100).toFixed(2).replace('.', ','))
  const [paidAt, setPaidAt] = useState(() => localInput(defaultPaymentDate(booking)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const settled = booking.status === 'confirmed' && booking.total_cents > 0 && booking.remaining_cents === 0
  const canCollect = booking.status === 'confirmed' && booking.remaining_cents > 0
    && new Date(booking.starts_at).getTime() <= Date.now() + 24 * 3600_000

  useEffect(() => {
    setAmount((booking.remaining_cents / 100).toFixed(2).replace('.', ','))
  }, [booking.remaining_cents])

  async function collect() {
    setError(null)
    const grossCents = parseAmount(amount)
    if (!method) return setError('Choisissez le moyen de paiement.')
    if (!grossCents) return setError('Indiquez un montant valide.')
    if (grossCents > booking.remaining_cents) return setError(`Le montant dépasse le reste à payer (${money(booking.remaining_cents)}).`)
    const occurred = new Date(paidAt)
    if (!Number.isFinite(occurred.getTime())) return setError('Indiquez la date du règlement.')
    setSaving(true)
    try {
      const response = await fetch('/api/rdv-admin?action=finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          practitioner_id: practitionerId,
          booking_id: booking.id,
          gross_cents: grossCents,
          payment_method: method,
          occurred_at: occurred.toISOString(),
          note: 'Caisse du jour',
          client_request_id: crypto.randomUUID(),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const labels = {
          preview_manual_write_disabled: 'La Preview est en lecture seule pour ne pas écrire dans la vraie comptabilité.',
          montant_superieur_au_solde: 'Le montant dépasse le reste à payer.',
          booking_deja_regle: 'Ce rendez-vous est déjà réglé.',
          booking_non_confirmed: 'Ce rendez-vous n’est plus confirmé.',
        }
        throw new Error(labels[body.error] || 'L’enregistrement n’a pas abouti.')
      }
      setMethod('')
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`rounded-xl border px-4 py-4 ${settled ? 'border-emerald-200 bg-emerald-50/50' : 'border-gold/20 bg-white/60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-georgia text-sm font-semibold text-deep">
            {time(booking.starts_at)} · {booking.customer_name || 'Client'}
            {booking.status !== 'confirmed' && <span className="ml-2 text-xs font-normal text-mist">({booking.status})</span>}
          </p>
          <p className="font-georgia text-xs text-mist">{booking.service_title || 'Prestation'} · {money(booking.total_cents)}</p>
        </div>
        {settled
          ? <span className="rounded-full bg-emerald-100 px-3 py-1 font-georgia text-xs font-semibold text-emerald-800">Réglé ✓</span>
          : booking.remaining_cents > 0 && <span className="rounded-full bg-gold/15 px-3 py-1 font-georgia text-xs font-semibold text-deep">Reste {money(booking.remaining_cents)}</span>}
      </div>

      {booking.payments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {booking.payments.map(p => (
            <li key={p.id} className={`rounded-lg px-2.5 py-1 font-georgia text-[11px] ${p.online ? 'bg-deep/[.06] text-deep' : 'bg-gold/10 text-deep'}`}>
              {money(p.gross_cents)} · {METHOD_LABELS[p.payment_method] || p.payment_method} · {KIND_LABELS[p.entry_kind] || p.entry_kind} · {shortDate(p.occurred_at)}
            </li>
          ))}
        </ul>
      )}

      {canCollect && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Moyen de paiement">
            {ON_SITE_METHODS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => setMethod(value)}
                className={`min-h-11 rounded-lg border px-3 py-2 font-georgia text-xs font-semibold transition-colors ${method === value ? 'border-deep bg-deep text-gold' : 'border-gold/30 bg-white text-deep hover:bg-gold/10'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 font-georgia text-xs text-mist">
              Montant
              <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Montant encaissé en euros" className="w-24 rounded-lg border border-gold/30 bg-white px-2 py-2 text-right font-georgia text-sm text-deep" />
              €
            </label>
            <label className="flex items-center gap-2 font-georgia text-xs text-mist">
              le
              <input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} aria-label="Date du règlement" className="rounded-lg border border-gold/30 bg-white px-2 py-2 font-georgia text-xs text-deep" />
            </label>
            <button type="button" onClick={collect} disabled={saving || !method} className="min-h-11 rounded-lg bg-deep px-4 py-2 font-georgia text-xs font-bold text-gold disabled:opacity-40 sm:ml-auto">
              {saving ? 'Enregistrement…' : 'Encaisser'}
            </button>
          </div>
          <p className="font-georgia text-[10px] text-mist/70">Pour un règlement en deux fois (ex. carte + espèces), encaissez la première partie : le reste se met à jour.</p>
          {error && <p role="alert" className="font-georgia text-xs text-red-700">{error}</p>}
        </div>
      )}
    </li>
  )
}

export default function DailyPayments({ practitionerId, session, onSaved }) {
  const [day, setDay] = useState(todayValue)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const load = useCallback(() => setNonce(n => n + 1), [])

  // Payments recorded elsewhere (agenda button, "Ajouter un encaissement") refresh the day.
  useEffect(() => {
    window.addEventListener('mediumia:finance-saved', load)
    return () => window.removeEventListener('mediumia:finance-saved', load)
  }, [load])

  useEffect(() => {
    if (!practitionerId || !session) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ action: 'day-payments', practitioner_id: practitionerId, day })
    fetch(`/api/rdv-admin?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async r => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || 'caisse_indisponible'); return body })
      .then(body => { if (!cancelled) { setData(body); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [practitionerId, session, day, nonce])

  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00`))
  const collected = data?.collected
  const methodRows = collected ? Object.entries(collected.by_method).filter(([, v]) => v.count > 0) : []

  return (
    <div className="mt-6 rounded-2xl border border-gold/25 bg-gold/[.04] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Caisse du jour</p>
          <h3 className="font-georgia text-lg font-medium capitalize text-deep">{dayLabel}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDay(d => shiftDay(d, -1))} aria-label="Jour précédent" className="h-10 w-10 rounded-lg border border-gold/25 bg-white/70 text-deep">‹</button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="rounded-lg border border-gold/25 bg-white/80 px-2 py-2 font-georgia text-xs text-deep" />
          <button type="button" onClick={() => setDay(d => shiftDay(d, 1))} aria-label="Jour suivant" className="h-10 w-10 rounded-lg border border-gold/25 bg-white/70 text-deep">›</button>
          {day !== todayValue() && <button type="button" onClick={() => setDay(todayValue())} className="rounded-lg px-2 py-2 font-georgia text-xs text-gold">Aujourd’hui</button>}
        </div>
      </div>

      {loading && !data && <p className="mt-4 font-georgia text-xs text-mist">Chargement des rendez-vous du jour…</p>}
      {error && <p role="alert" className="mt-4 font-georgia text-xs text-red-700">Caisse indisponible pour le moment ({error}).</p>}

      {data && (
        <>
          {data.bookings.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-gold/25 px-4 py-6 text-center font-georgia text-sm text-mist">Aucun rendez-vous ce jour-là.</p>
            : (
              <ul className="mt-4 space-y-3">
                {data.bookings.map(b => (
                  <BookingRow key={`${b.id}-${b.remaining_cents}`} booking={b} practitionerId={practitionerId} session={session} onSaved={() => { window.dispatchEvent(new CustomEvent('mediumia:finance-saved')); onSaved?.() }} />
                ))}
              </ul>
            )}

          <div className="mt-5 rounded-xl border border-gold/20 bg-white/70 p-4">
            <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-mist">Encaissé ce jour</p>
            {methodRows.length === 0
              ? <p className="mt-2 font-georgia text-sm text-mist">Aucun encaissement enregistré à cette date.</p>
              : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full border-collapse text-left font-georgia text-[11px] sm:text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr className="text-mist">
                        <th className="py-1.5 font-normal">Moyen</th>
                        <th className="py-1.5 text-right font-normal">TTC</th>
                        <th className="py-1.5 text-right font-normal">HT</th>
                        <th className="py-1.5 text-right font-normal">TVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {methodRows.map(([m, v]) => (
                        <tr key={m} className="border-t border-gold/10 text-deep">
                          <td className="py-1.5">{METHOD_LABELS[m] || m} <span className="text-mist">({v.count})</span></td>
                          <td className="py-1.5 text-right">{money(v.gross_cents)}</td>
                          <td className="py-1.5 text-right">{money(v.net_cents)}</td>
                          <td className="py-1.5 text-right">{money(v.vat_cents)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gold/30 font-semibold text-deep">
                        <td className="py-1.5">Total</td>
                        <td className="py-1.5 text-right">{money(collected.totals.gross_cents)}</td>
                        <td className="py-1.5 text-right">{money(collected.totals.net_cents)}</td>
                        <td className="py-1.5 text-right">{money(collected.totals.vat_cents)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            {data.remaining_cents > 0 && (
              <p className="mt-3 font-georgia text-xs text-deep">Reste à encaisser sur les RDV du jour : <strong>{money(data.remaining_cents)}</strong></p>
            )}
            <p className="mt-2 font-georgia text-[10px] leading-relaxed text-mist/75">
              Chaque règlement est enregistré dans la comptabilité du mois avec son HT et sa TVA (taux de la prestation) et figure dans l’export CSV.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
