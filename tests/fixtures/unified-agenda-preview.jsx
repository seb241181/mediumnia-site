import { createRoot } from 'react-dom/client'
import UnifiedAgenda from '../../src/components/rdv/UnifiedAgenda.jsx'
if (location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('demo')) {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, options) => {
    const url = new URL(String(input), location.origin)
    if (url.origin !== location.origin) return Promise.reject(new Error('External access blocked in fixture'))
    if (url.pathname !== '/api/rdv-admin') return originalFetch(input, options)
    const start = new Date(); start.setUTCHours(9, 0, 0, 0)
    return Promise.resolve(Response.json({ start: url.searchParams.get('from'), end: url.searchParams.get('to'), sources: { google: 'not_connected', finance: 'ready' }, events: [{ id: 'booking:fictional', source: 'mediumia', title: 'Camille TEST', start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), status: 'confirmed', payment: { total_cents: 5000, paid_cents: 2000, remaining_cents: 3000 } }] }))
  }
}
createRoot(document.getElementById('root')).render(<UnifiedAgenda practitionerId="00000000-0000-4000-8000-000000000001" session={{ access_token: 'fictional-local-only' }} onOpenLumia={draft => { window.__agendaLumiaDraft = draft }} />)
