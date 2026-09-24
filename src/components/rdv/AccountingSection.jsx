import { useEffect, useMemo, useState } from 'react'
import DailyPayments from './DailyPayments.jsx'

function authHeader(session) {
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthBounds(value) {
  const [year, month] = value.split('-').map(Number)
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const to = new Date(year, month, 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

function money(cents) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
}

function signedCents(entry, key) {
  const value = Number(entry?.[key] || 0)
  return entry?.direction === 'refund' ? -value : value
}

function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(value))
}

function dateOnly(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(new Date(value))
}

function paymentLabel(value) {
  const labels = { paypal: 'PayPal', cash: 'Espèces', check: 'Chèque', card: 'Carte', transfer: 'Virement', manual: 'Manuel' }
  return labels[value] || value || '—'
}

function entryLabel(value) {
  const labels = {
    deposit: 'Arrhes',
    balance: 'Solde',
    full_payment: 'Paiement intégral',
    manual: 'Saisie manuelle',
    gift_card_sale: 'Vente carte cadeau',
    sale: 'Encaissement',
  }
  return labels[value] || value || 'Encaissement'
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function decimalCsv(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',')
}

const ARTIST_AUTHOR_MICRO_BNC_ABATEMENT = 0.34
const ARTIST_AUTHOR_SOCIAL_BASE_MULTIPLIER = 1.15
const ARTIST_AUTHOR_URSSAF_RATE = 0.162
const ARTIST_AUTHOR_EFFECTIVE_RATE =
  (1 - ARTIST_AUTHOR_MICRO_BNC_ABATEMENT) *
  ARTIST_AUTHOR_SOCIAL_BASE_MULTIPLIER *
  ARTIST_AUTHOR_URSSAF_RATE

function SummaryCard({ label, value, note }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-white/55 px-4 py-4">
      <p className="font-georgia text-[10px] uppercase tracking-[0.15em] text-gold">{label}</p>
      <p className="mt-1 font-georgia text-2xl font-medium text-deep">{value}</p>
      {note && <p className="mt-1 font-georgia text-[11px] text-mist">{note}</p>}
    </div>
  )
}

export default function AccountingSection({ practitionerId, session }) {
  const [month, setMonth] = useState(() => monthValue())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dayNonce, setDayNonce] = useState(0)

  useEffect(() => {
    if (!practitionerId || !session || !month) return
    let cancelled = false
    const { from, to } = monthBounds(month)
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      action: 'finance',
      practitioner_id: practitionerId,
      from,
      to,
    })

    fetch(`/api/rdv-admin?${params.toString()}`, { headers: authHeader(session) })
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'comptabilite_indisponible')
        return body
      })
      .then(body => {
        if (!cancelled) {
          setData(body)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'comptabilite_indisponible')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [practitionerId, session, month, dayNonce])

  const entries = data?.entries || []
  const totals = data?.totals || {}
  const kdp = data?.kdp || {}
  const activityGeneratedCents = Number(data?.activity_generated_cents || 0)
  const kdpRoyaltyCents = Number(kdp.royalty_cents || 0)
  const kdpEstimatedSocialCents = Math.round(kdpRoyaltyCents * ARTIST_AUTHOR_EFFECTIVE_RATE)
  const kdpEstimatedAfterSocialCents = Math.max(0, kdpRoyaltyCents - kdpEstimatedSocialCents)

  const monthLabel = useMemo(() => {
    const [year, m] = month.split('-').map(Number)
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(year, m - 1, 1))
  }, [month])

  function exportCsv() {
    if (!entries.length) return
    const rows = [
      ['Date encaissement', 'Client', 'Prestation', 'Type', 'Moyen de paiement', 'TTC', 'HT', 'TVA', 'Date rendez-vous', 'Référence paiement'],
      ...entries.map(entry => [
        dateTime(entry.occurred_at),
        entry.customer_name || '',
        entry.service_title || '',
        entryLabel(entry.entry_kind),
        paymentLabel(entry.payment_method),
        decimalCsv(signedCents(entry, 'gross_cents')),
        decimalCsv(signedCents(entry, 'net_cents')),
        decimalCsv(signedCents(entry, 'vat_cents')),
        dateOnly(entry.appointment_starts_at),
        entry.external_payment_ref || '',
      ]),
    ]
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mediumia-comptabilite-${month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="rounded-2xl border border-gold/25 bg-white/60 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-georgia text-[11px] tracking-[0.18em] uppercase text-gold mb-1">Comptabilité</p>
          <h2 className="font-georgia text-lg font-medium">Encaissements MediumIA</h2>
          <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">
            Arrhes, soldes et paiements intégraux enregistrés à la date réelle d’encaissement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="rounded-xl border border-gold/25 bg-white/80 px-3 py-2 font-georgia text-xs text-deep focus:outline-none focus:border-gold/60"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!entries.length || loading}
            className="rounded-xl bg-deep px-4 py-2 font-georgia text-xs text-gold transition-colors hover:bg-deep/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Télécharger CSV (Excel)
          </button>
        </div>
      </div>

      <DailyPayments practitionerId={practitionerId} session={session} onSaved={() => setDayNonce(value => value + 1)} />

      <p className="mt-6 font-georgia text-xs font-semibold capitalize text-deep">{monthLabel}</p>

      {loading && (
        <div className="flex items-center justify-center gap-3 py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold/25 border-t-gold" />
          <p className="font-georgia text-xs text-mist">Chargement de la comptabilité…</p>
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="font-georgia text-xs text-red-800">Impossible de charger la comptabilité pour le moment. ({error})</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="TTC encaissé" value={money(totals.gross_cents)} note={`${totals.income_count || 0} encaissement(s) RDV`} />
            <SummaryCard label="HT" value={money(totals.net_cents)} />
            <SummaryCard label="TVA" value={money(totals.vat_cents)} note="TVA calculée sur les écritures RDV" />
            <SummaryCard label="KDP généré" value={money(kdp.royalty_cents)} note={`${kdp.total_units || 0} livre(s) / ebook(s)`} />
            <SummaryCard label="Activité générée" value={money(activityGeneratedCents)} note="RDV encaissés + redevances KDP du mois" />
          </div>

          {(kdp.total_units || kdp.royalty_cents) ? (
            <div className="mt-5 rounded-2xl border border-gold/25 bg-gold/[.06] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Livres · Amazon KDP</p>
                  <h3 className="mt-1 font-georgia text-lg font-medium text-deep">CODEX — {kdp.total_units || 0} exemplaire(s) vendu(s)</h3>
                  <p className="mt-2 font-georgia text-xs text-mist">
                    {kdp.paperback_units || 0} broché(s) · {kdp.ebook_units || 0} ebook(s){kdp.hardcover_units ? ` · ${kdp.hardcover_units} relié(s)` : ''}
                  </p>
                </div>
                <div className="grid min-w-[300px] grid-cols-2 gap-2">
                  <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
                    <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">Redevances générées</p>
                    <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(kdpRoyaltyCents)}</p>
                  </div>
                  <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
                    <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">Cotisations Urssaf AA</p>
                    <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(kdpEstimatedSocialCents)}</p>
                    <p className="mt-1 font-georgia text-[9px] text-mist">estimation ≈ 12,30 %</p>
                  </div>
                  <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
                    <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">Net après cotisations</p>
                    <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(kdpEstimatedAfterSocialCents)}</p>
                  </div>
                  <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
                    <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">À recevoir Amazon</p>
                    <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(kdp.pending_royalty_cents)}</p>
                  </div>
                </div>
              </div>
              <p className="mt-4 font-georgia text-[10px] leading-relaxed text-mist/75">
                Estimation 2026 si CODEX est déclaré en micro-BNC artiste-auteur : abattement de 34 %, assiette sociale majorée de 15 %, puis taux Urssaf artistes-auteurs de 16,20 %, soit environ 12,30 % des redevances. Hors retraite complémentaire IRCEC-RAAP et impôt sur le revenu. Les redevances KDP sont comptées dans « activité générée », mais ne sont pas ajoutées au « TTC encaissé » tant qu’Amazon ne les a pas effectivement versées.
              </p>
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-gold/25 px-6 py-8 text-center">
              <p className="font-georgia text-sm text-mist">Aucune écriture comptable pour ce mois.</p>
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-xl border border-gold/15">
              <table className="min-w-[920px] w-full border-collapse bg-white/35 text-left">
                <thead className="bg-deep/[.04]">
                  <tr>
                    {['Encaissement', 'Client', 'Prestation', 'Type', 'TTC', 'HT', 'TVA', 'Paiement', 'RDV'].map(label => (
                      <th key={label} className="border-b border-gold/15 px-3 py-2.5 font-georgia text-[10px] uppercase tracking-wide text-mist">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.id} className="border-b border-gold/10 last:border-0 hover:bg-white/50">
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-deep">{dateTime(entry.occurred_at)}</td>
                      <td className="px-3 py-3 font-georgia text-xs text-deep">{entry.customer_name || '—'}</td>
                      <td className="max-w-[220px] px-3 py-3 font-georgia text-xs text-mist">{entry.service_title || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{entryLabel(entry.entry_kind)}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs font-semibold text-deep">{money(signedCents(entry, 'gross_cents'))}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{money(signedCents(entry, 'net_cents'))}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{money(signedCents(entry, 'vat_cents'))}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{paymentLabel(entry.payment_method)}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-georgia text-xs text-mist">{dateOnly(entry.appointment_starts_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 font-georgia text-[10px] leading-relaxed text-mist/70">
            Le CSV est séparé par des points-virgules et s’ouvre directement dans Excel, Numbers ou LibreOffice. Les montants sont exprimés en euros avec TTC, HT et TVA séparés.
          </p>
        </>
      )}
    </section>
  )
}
