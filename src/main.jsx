import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.jsx'
import ConferenceLivePage from './components/ConferenceLivePage.jsx'
import ConferenceCockpitPage from './components/ConferenceCockpitPage.jsx'
import ConferenceRehearsalTokenPage from './components/ConferenceRehearsalTokenPage.jsx'
import GlobalAccount from './components/GlobalAccount.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { supabase } from './lib/supabase.js'
import { installProOnboardingRedirect } from './lib/proOnboarding.js'
import { countSiteVisitOnce } from './lib/siteVisit.js'
import { analyticsEnabled, makeBeforeSend } from './lib/siteAnalytics.js'

const pathname = window.location.pathname
const isConferenceLiveRoute = pathname.startsWith('/live/')
const isConferenceCockpitRoute = pathname.startsWith('/pro/conference/')
const isConferenceRehearsalRoute = pathname.startsWith('/pro/conference-rehearsal/')

// Confirmation d'e-mail pendant le parcours Pro : retour vers /agents.
installProOnboardingRedirect(supabase)

// Compteur de visites du site (une fois par visite, sans cookie).
countSiteVisitOnce()

// Mesure d'audience Vercel Web Analytics (pages vues uniquement, plan Hobby).
// Les actions importantes sont mesurées par les compteurs MediumIA existants.
const vercelAnalytics = analyticsEnabled()

let page = <App />
if (isConferenceLiveRoute) page = <ConferenceLivePage />
if (isConferenceCockpitRoute) page = <ConferenceCockpitPage />
if (isConferenceRehearsalRoute) page = <ConferenceRehearsalTokenPage />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>{page}</AppErrorBoundary>
    <AppErrorBoundary silent><GlobalAccount /></AppErrorBoundary>
    {vercelAnalytics && <Analytics mode="production" beforeSend={makeBeforeSend()} />}
  </StrictMode>,
)
