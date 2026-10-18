import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

import './design-system.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ModalProvider } from './context/ModalContext.jsx'
import { installGlobalHandlers } from './utils/errorReporter'

installGlobalHandlers();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ModalProvider>
          <App />
        </ModalProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
