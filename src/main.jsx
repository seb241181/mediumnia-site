import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConferencesPage from './components/ConferencesPage.jsx'
import ConferenceLivePage from './components/ConferenceLivePage.jsx'
import ConferenceCockpitPage from './components/ConferenceCockpitPage.jsx'
import GlobalAccount from './components/GlobalAccount.jsx'

const pathname = window.location.pathname
const isConferenceRoute = pathname === '/conferences' || pathname.startsWith('/conferences/')
const isConferenceLiveRoute = pathname.startsWith('/live/')
const isConferenceCockpitRoute = pathname.startsWith('/pro/conference/')

const navigateDocument = (path) => {
  window.location.assign(path)
}

let page = <App />
if (isConferenceRoute) page = <ConferencesPage onBack={() => navigateDocument('/')} onNavigate={navigateDocument} />
if (isConferenceLiveRoute) page = <ConferenceLivePage />
if (isConferenceCockpitRoute) page = <ConferenceCockpitPage />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
    <GlobalAccount />
  </StrictMode>,
)
