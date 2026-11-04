import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initFontSize } from './lib/fontSize'

// Apply this device's Text size before the first paint (see lib/fontSize.ts).
initFontSize()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
