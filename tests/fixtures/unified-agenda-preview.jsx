import React from 'react'
import { createRoot } from 'react-dom/client'
import UnifiedAgenda from '../../src/components/rdv/UnifiedAgenda.jsx'
createRoot(document.getElementById('root')).render(<UnifiedAgenda practitionerId="00000000-0000-4000-8000-000000000001" session={{ access_token: 'fictional-local-only' }} />)
