import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import GlobalAccount from './components/GlobalAccount.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <GlobalAccount />
  </StrictMode>,
)
