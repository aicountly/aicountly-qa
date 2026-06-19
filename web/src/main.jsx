import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PartnerCheckoutPage from './pages/PartnerCheckoutPage.jsx'
import './index.css'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isPartnerPayRoute = pathname === '/pay'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isPartnerPayRoute ? <PartnerCheckoutPage /> : <App />}
  </StrictMode>,
)
