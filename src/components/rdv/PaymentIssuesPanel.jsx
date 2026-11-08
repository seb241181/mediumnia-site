import { useEffect, useState } from 'react'

// Les Coulisses → Incidents de paiement : signalements des clients, à traiter.
// Lecture et traitement réservés à l'administration (l'API répond 403 sinon).
// Aucun bouton ne relance un paiement : vérifier d'abord dans l'activité PayPal.

const JOURNEYS = {
  chronosphere: 'ChronoSphère', chronosphere_max: 'ChronoSphère MAX', rdv_deposit: 'Réservation',
  rdv_balance: 'Solde RDV', formation: 'Formation', parcours: 'Mensualités', email_question: 'Guidance e-mail',
  gift_card: 'Carte cadeau', conference_pass: 'Pass conférence', oracle: 'Oracle', other: 'Autre',
}
const REASONS = {
  payment_failed: 'Paiement non abouti', charged_no_service: 'Débité sans service', double_charge: 'Débité deux fois',
  page_error: 'Erreur de page', session_expired: 'Session expirée', other: 'Autre',
}
const STATUS = {
  new: ['À traiter', 'bg-amber-100 text-amber-900'],
  in_progress: ['En cours', 'bg-sky-100 text-sky-900'],
  resolved: ['Résolu', 'bg-emerald-100 text-emerald-800'],
  dismissed: ['Sans suite', 'bg-gray-100 text-gray-700'],
}
const FILTERS = [['open', 'À traiter et en cours'], ['resolved', 'Résolus'], ['dismissed', 'Sans suite'], ['all', 'Tous']]
const dateTime = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '—')

export default function PaymentIssuesPanel({ session }) {
  const [filter, setFilter] = useState('open')
  const [issues, setIssues] = useState(null)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!session?.access_token) return undefined
    let active = true
    fetch(`/api/rdv-admin?action=payment-issues&status=${encodeURIComponent(filter)}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error === 'migration_pending' ? 'La mise à jour de la base n’est pas encore appliquée.' : body.error === 'forbidden' ? 'Réservé à l’administration.' : 'Incidents indisponibles pour le moment.')
        if (active) { setError(null); setIssues(body.issues || []) }
      })
      .catch((err) => { if (active) { setError(err.message); setIssues([]) } })
    return () => { active = false }
  }, [filter, session?.access_token, reloadKey])

  async function update(issue, changes) {
    setBusy(issue.id)
    setError(null)
    try {
      const response = await fetch('/api/rdv-admin?action=payment-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ op: 'update', id: issue.id, ...changes }),
      })
      if (!response.ok) throw new Error('Mise à jour impossible pour le moment.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gold/25 bg-white/60 p-6 font-georgia text-deep">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gold">Paiements</p>
          <h3 className="mt-1 text-lg font-medium">Incidents signalés par les clients</h3>
          <p className="mt-1 text-xs text-mist">Vérifiez chaque commande dans votre activité PayPal : aucun paiement n’est relancé depuis cet écran.</p>
        </div>
        <label className="flex items-center gap-2 text-xs" htmlFor="payment-issues-filter">
          Afficher
          <select id="payment-issues-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-gold/30 px-2 py-1.5">
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {issues === null && <p className="mt-4 text-sm text-mist">Chargement…</p>}
      {issues?.length === 0 && !error && <p className="mt-4 text-sm text-mist">Aucun incident dans cette liste.</p>}

      <ul className="mt-4 space-y-3">
        {(issues || []).map((issue) => {
          const [statusLabel, statusClass] = STATUS[issue.status] || STATUS.new
          const note = notes[issue.id] ?? issue.owner_note ?? ''
          return (
            <li key={issue.id} className="rounded-xl border border-gold/20 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusClass}`}>{statusLabel}</span>
                <span className="text-sm font-semibold">{JOURNEYS[issue.journey] || 'Autre'}</span>
                <span className="text-xs text-mist">· {REASONS[issue.reason] || issue.reason}</span>
                <span className="ml-auto font-mono text-xs text-mist">{issue.reference}</span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div><dt className="inline text-mist">Signalé le </dt><dd className="inline">{dateTime(issue.created_at)}</dd></div>
                <div className="min-w-0"><dt className="inline text-mist">Contact : </dt><dd className="inline break-all"><a className="underline" href={`mailto:${issue.contact_email}?subject=${encodeURIComponent(`Votre signalement ${issue.reference}`)}`}>{issue.contact_email}</a></dd></div>
                <div><dt className="inline text-mist">Étape : </dt><dd className="inline">{issue.step ? issue.step.replace(/_/g, ' ') : 'inconnue'}</dd></div>
                <div className="min-w-0"><dt className="inline text-mist">Tentative : </dt><dd className="inline break-all font-mono">{issue.attempt_ref || '—'}{issue.attempt_at ? ` (${dateTime(issue.attempt_at)})` : ''}</dd></div>
                <div className="min-w-0"><dt className="inline text-mist">Page : </dt><dd className="inline break-all">{issue.page_path || '—'}</dd></div>
                <div><dt className="inline text-mist">E-mails : </dt><dd className="inline">{issue.owner_notified_at ? 'alerte envoyée' : 'alerte non envoyée'} · {issue.ack_sent_at ? 'accusé envoyé' : 'pas d’accusé'}</dd></div>
              </dl>
              {issue.comment && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gold/5 px-3 py-2 text-sm">{issue.comment}</p>}
              <label className="mt-3 flex flex-col gap-1 text-xs text-mist" htmlFor={`issue-note-${issue.id}`}>
                Note interne
                <textarea id={`issue-note-${issue.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNotes((n) => ({ ...n, [issue.id]: e.target.value }))} className="rounded-lg border border-gold/30 px-2 py-1.5 text-sm text-deep" />
              </label>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" disabled={busy === issue.id} onClick={() => update(issue, { owner_note: note })} className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-60">Enregistrer la note</button>
                {issue.status === 'new' && <button type="button" disabled={busy === issue.id} onClick={() => update(issue, { status: 'in_progress' })} className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-60">Prendre en charge</button>}
                {['new', 'in_progress'].includes(issue.status) && (
                  <>
                    <button type="button" disabled={busy === issue.id} onClick={() => update(issue, { status: 'resolved', owner_note: note })} className="rounded-lg bg-deep px-3 py-1.5 text-xs text-white disabled:opacity-60">Marquer résolu</button>
                    <button type="button" disabled={busy === issue.id} onClick={() => update(issue, { status: 'dismissed', owner_note: note })} className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-60">Classer sans suite</button>
                  </>
                )}
                {['resolved', 'dismissed'].includes(issue.status) && <button type="button" disabled={busy === issue.id} onClick={() => update(issue, { status: 'in_progress' })} className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-60">Rouvrir</button>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
