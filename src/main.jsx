import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConferenceLivePage from './components/ConferenceLivePage.jsx'
import ConferenceCockpitPage from './components/ConferenceCockpitPage.jsx'
import ConferenceRehearsalTokenPage from './components/ConferenceRehearsalTokenPage.jsx'
import GlobalAccount from './components/GlobalAccount.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'

const pathname = window.location.pathname
const isConferenceLiveRoute = pathname.startsWith('/live/')
const isConferenceCockpitRoute = pathname.startsWith('/pro/conference/')
const isConferenceRehearsalRoute = pathname.startsWith('/pro/conference-rehearsal/')

let page = <App />
if (isConferenceLiveRoute) page = <ConferenceLivePage />
if (isConferenceCockpitRoute) page = <ConferenceCockpitPage />
if (isConferenceRehearsalRoute) page = <ConferenceRehearsalTokenPage />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>{page}</AppErrorBoundary>
    <AppErrorBoundary silent><GlobalAccount /></AppErrorBoundary>
  </StrictMode>,
)
