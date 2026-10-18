import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import luxonPlugin from '@fullcalendar/luxon3'
import frLocale from '@fullcalendar/core/locales/fr'
import './UnifiedAgenda.css'

const money = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value / 100)
const statusLabel = { confirmed: 'Confirmé', cancelled: 'Annulé', completed: 'Terminé', pending: 'En attente', no_show: 'Absent' }
function paymentCategory(payment) {
  if (!payment) return 'unknown'
  if (payment.paid_cents > payment.total_cents || payment.paid_cents < 0) return 'review'
  return payment.paid_cents < payment.total_cents ? 'due' : 'settled'
}

function parisInputValue(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const value = type => parts.find(part => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

function cancellationDraft(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const value = type => parts.find(part => part.type === type)?.value || ''
  return `Annule le rendez-vous du ${value('day')}/${value('month')}/${value('year')} à ${value('hour')}h${value('minute') === '00' ? '' : value('minute')}`
}

export default function UnifiedAgenda({ practitionerId, session, onOpenLumia }) {
  const [range, setRange] = useState(null)
  const [snapshot, setSnapshot] = useState({ events: [], sources: {}, loading: true, error: '' })
  const [origin, setOrigin] = useState('all')
  const [status, setStatus] = useState('all')
  const [payment, setPayment] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [newStart, setNewStart] = useState('')
  const [moveIdempotencyKey, setMoveIdempotencyKey] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const selectedRef = useRef(null)
  const datesSet = useCallback(info => {
    const next = { from: info.start.toISOString(), to: info.end.toISOString() }
    setRange(previous => previous?.from === next.from && previous?.to === next.to ? previous : next)
    selectedRef.current = null
    setSelected(null)
  }, [])

  useEffect(() => {
    if (!range || !session?.access_token) return
    const controller = new AbortController()
    const params = new URLSearchParams({ action: 'agenda', practitioner_id: practitionerId, ...range })
    fetch(`/api/rdv-admin?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('agenda_unavailable')
      const data = await response.json()
      if (!Array.isArray(data.events)) throw new Error('invalid_agenda')
      if (!controller.signal.aborted) {
        setSnapshot({ ...data, loading: false, error: '' })
        const currentSelection = selectedRef.current
        const refreshed = currentSelection ? data.events.find(event => event.id === currentSelection.id) : null
        if (refreshed) {
          selectedRef.current = refreshed
          setSelected(refreshed)
          setNewStart(refreshed.source === 'mediumia' ? parisInputValue(refreshed.start) : '')
          setMoveIdempotencyKey('')
        }
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ events: [], sources: {}, loading: false, error: 'L’agenda est indisponible. Réessayez en changeant de période.' })
    })
    return () => controller.abort()
  }, [practitionerId, range, session?.access_token, refreshKey])

  useEffect(() => {
    if (!selected?.booking_id || !session?.access_token) return
    const controller = new AbortController()
    const params = new URLSearchParams({ action: 'agenda-history', booking_id: selected.booking_id })
    fetch(`/api/rdv-admin?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error('history_unavailable')
        if (!controller.signal.aborted) { setHistory(data.history || []); setHistoryError('') }
      })
      .catch(() => { if (!controller.signal.aborted) { setHistory([]); setHistoryError('Historique indisponible.') } })
    return () => controller.abort()
  }, [selected?.booking_id, session?.access_token, refreshKey])

  function selectAgendaEvent(record) {
    selectedRef.current = record
    setSelected(record)
    setNewStart(record?.source === 'mediumia' ? parisInputValue(record.start) : '')
    setMoveIdempotencyKey('')
    setActionMessage('')
    setHistory([])
    setHistoryError('')
  }

  async function moveBooking(event) {
    event.preventDefault()
    if (!selected?.booking_id || !session?.access_token || actionBusy) return
    if (!window.confirm('Confirmer le déplacement de ce rendez-vous ? Aucun message ne sera envoyé au client.')) return
    setActionBusy(true); setActionMessage('')
    const idempotencyKey = moveIdempotencyKey || `agenda.move:${crypto.randomUUID()}`
    setMoveIdempotencyKey(idempotencyKey)
    try {
      const response = await fetch('/api/rdv-admin?action=agenda', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ op: 'reschedule', booking_id: selected.booking_id, expected_updated_at: selected.updated_at, starts_at_local: newStart, idempotency_key: idempotencyKey }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'reschedule_unavailable')
      setMoveIdempotencyKey('')
      setActionMessage(data.google_sync === 'retry' ? 'Rendez-vous déplacé. La synchronisation Google est en attente ; aucune notification client n’a été envoyée.' : data.google_sync === 'review' ? 'Rendez-vous déplacé, mais Google demande une vérification manuelle.' : 'Rendez-vous déplacé et synchronisation enregistrée. Aucun message client n’a été envoyé.')
      setRefreshKey(value => value + 1)
    } catch (error) {
      setActionMessage(error.message === 'slot_unavailable' ? 'Ce créneau n’est plus disponible.' : 'Déplacement non effectué : vérifiez le créneau et réessayez.')
    } finally { setActionBusy(false) }
  }

  async function retryGoogleSync() {
    if (!selected?.booking_id || !session?.access_token || actionBusy) return
    setActionBusy(true); setActionMessage('')
    try {
      const response = await fetch('/api/rdv-admin?action=agenda-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ op: 'retry', booking_id: selected.booking_id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'sync_unavailable')
      setActionMessage(data.status === 'synced' ? 'Google Agenda est synchronisé.' : 'Synchronisation toujours en attente. Réessayez plus tard ou demandez une vérification.')
      setRefreshKey(value => value + 1)
    } catch { setActionMessage('Google Agenda n’a pas encore confirmé la synchronisation.') }
    finally { setActionBusy(false) }
  }

  const current = snapshot.start === range?.from && snapshot.end === range?.to
  const events = useMemo(() => (current ? snapshot.events : []).filter(event =>
    (origin === 'all' || event.source === origin) &&
    (status === 'all' || event.status === status) &&
    (payment === 'all' || paymentCategory(event.payment) === payment) &&
    event.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')),
  ).map(event => ({
    id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay,
    classNames: [event.source === 'google' ? 'agenda-google' : 'agenda-mediumia', event.status === 'cancelled' ? 'agenda-cancelled' : ''],
    extendedProps: { record: event },
  })), [snapshot.events, current, origin, status, payment, search])

  return <section className="unified-agenda" aria-label="Agenda unifié">
    <header className="agenda-heading"><h2>Agenda</h2><span>Heure de Paris</span></header>
    <div className="agenda-filters">
      <label>Origine<select value={origin} onChange={e => setOrigin(e.target.value)}><option value="all">Toutes</option><option value="mediumia">MediumIA</option><option value="google">Google uniquement</option></select></label>
      <label>Statut<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Tous</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Paiement<select value={payment} onChange={e => setPayment(e.target.value)}><option value="all">Tous</option><option value="due">Reste à régler</option><option value="settled">Réglé</option><option value="unknown">Inconnu</option><option value="review">À vérifier</option></select></label>
      <label>Client ou événement<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    {!current && !snapshot.error && <p role="status">Chargement de la période…</p>}
    {snapshot.sources.google && snapshot.sources.google !== 'ready' && <p role="status">{snapshot.sources.google === 'not_connected' ? 'Google Calendar non connecté.' : 'Google Calendar indisponible : événements Google incomplets.'}</p>}
    {snapshot.sources.finance === 'unavailable' && <p role="status">Paiements indisponibles : les montants restent inconnus.</p>}
    <div className="agenda-layout">
      <div className="agenda-calendar">
        <FullCalendar plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin]} locale={frLocale} timeZone="Europe/Paris"
          initialView="timeGridWeek" firstDay={1} height={720} slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="08:00:00"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
          buttonText={{ today: 'Aujourd’hui', day: 'Jour', week: 'Semaine', month: 'Mois' }}
          editable={false} selectable={false} events={events} datesSet={datesSet} dayMaxEvents={3}
          eventContent={info => <button className="agenda-event" title={info.event.title} onClick={() => selectAgendaEvent(info.event.extendedProps.record)} aria-label={`${info.timeText} ${info.event.title}`}>
            <span>{info.timeText}</span><strong>{info.event.title}</strong>
          </button>} />
        <p className="agenda-legend"><span>MediumIA</span><span>Google uniquement</span><span>{events.length} événement{events.length > 1 ? 's' : ''}</span></p>
      </div>
      {selected && <aside className="agenda-detail" aria-label="Détail du rendez-vous">
        <button className="agenda-close" aria-label="Fermer le détail" title="Fermer" onClick={() => setSelected(null)}>×</button>
        <p className="agenda-origin">{selected.source === 'mediumia' ? 'MediumIA' : 'Google uniquement'}</p>
        <h3>{selected.title}</h3>
        <p>{selected.allDay ? 'Journée entière' : new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' }).format(new Date(selected.start))}</p>
        <p>{statusLabel[selected.status] || selected.status}</p>
        <h4>Paiement</h4>
        {selected.payment ? <><dl><dt>Montant</dt><dd>{money(selected.payment.total_cents)}</dd><dt>Enregistré net</dt><dd>{money(selected.payment.paid_cents)}</dd><dt>Reste à régler</dt><dd>{money(selected.payment.remaining_cents)}</dd></dl><p>Registre MediumIA. Non vérifié auprès du prestataire dans cet agenda.</p></> : <p>{selected.source === 'google' ? 'Aucun paiement MediumIA associé.' : 'Montants inconnus.'}</p>}
        {selected.source === 'mediumia' && selected.status === 'confirmed' && <>
          <form className="agenda-move-form" onSubmit={moveBooking}>
            <label htmlFor="agenda-new-start">Déplacer vers (heure de Paris)</label>
            <input id="agenda-new-start" type="datetime-local" value={newStart} onChange={event => { setNewStart(event.target.value); setMoveIdempotencyKey('') }} required />
            <button type="submit" disabled={actionBusy || !selected.updated_at}>{actionBusy ? 'Traitement…' : 'Confirmer le déplacement'}</button>
          </form>
          <button className="agenda-secondary-action" type="button" disabled={actionBusy || !onOpenLumia} onClick={() => onOpenLumia?.(cancellationDraft(selected.start))}>
            Préparer l’annulation dans Lumia
          </button>
          <p className="agenda-action-status">Lumia présentera l’action et son code de confirmation. L’annulation ne part qu’après validation explicite dans cette conversation. Aucun remboursement automatique.</p>
          {selected.google_linked && <button className="agenda-secondary-action" type="button" disabled={actionBusy} onClick={retryGoogleSync}>Retenter la synchronisation Google</button>}
        </>}
        {actionMessage && <p className="agenda-action-status" role="status">{actionMessage}</p>}
        <h4>Historique</h4>
        {historyError ? <p role="status">{historyError}</p> : history.length ? <ol className="agenda-history">{history.map(item => <li key={`${item.source}:${item.id}`}>
          <strong>{item.kind === 'cancel' ? 'Annulation via Lumia' : 'Déplacement'}</strong>
          <time>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.occurred_at || item.created_at))}</time>
          {item.kind === 'reschedule' && <span>{new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.previous_starts_at))} → {new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.next_starts_at))}</span>}
          {item.kind === 'cancel' && <span>{item.status === 'succeeded' ? 'Exécutée' : `État : ${item.status}`}</span>}
        </li>)}</ol> : <p>Aucune modification enregistrée.</p>}
      </aside>}
    </div>
  </section>
}
