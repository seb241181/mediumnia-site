import { useCallback, useEffect, useMemo, useState } from 'react'
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

export default function UnifiedAgenda({ practitionerId, session }) {
  const [range, setRange] = useState(null)
  const [snapshot, setSnapshot] = useState({ events: [], sources: {}, loading: true, error: '' })
  const [origin, setOrigin] = useState('all')
  const [status, setStatus] = useState('all')
  const [payment, setPayment] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const datesSet = useCallback(info => {
    const next = { from: info.start.toISOString(), to: info.end.toISOString() }
    setRange(previous => previous?.from === next.from && previous?.to === next.to ? previous : next)
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
      if (!controller.signal.aborted) setSnapshot({ ...data, loading: false, error: '' })
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ events: [], sources: {}, loading: false, error: 'L’agenda est indisponible. Réessayez en changeant de période.' })
    })
    return () => controller.abort()
  }, [practitionerId, range, session?.access_token])

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
          eventContent={info => <button className="agenda-event" title={info.event.title} onClick={() => setSelected(info.event.extendedProps.record)} aria-label={`${info.timeText} ${info.event.title}`}>
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
        <p className="agenda-action-status">Modification et annulation : validation du circuit sécurisé en cours.</p>
      </aside>}
    </div>
  </section>
}
