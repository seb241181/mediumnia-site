import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConferencesPage from './components/ConferencesPage.jsx'
import GlobalAccount from './components/GlobalAccount.jsx'

const pathname = window.location.pathname
const isConferenceRoute = pathname === '/conferences' || pathname.startsWith('/conferences/')

const navigateDocument = (path) => {
  window.location.assign(path)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConferenceRoute ? (
      <ConferencesPage onBack={() => navigateDocument('/')} onNavigate={navigateDocument} />
    ) : (
      <App />
    )}
    <GlobalAccount />
  </StrictMode>,
)
