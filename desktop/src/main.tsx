import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ScreenshotOverlay } from './components/screenshot/ScreenshotOverlay'
import './theme/globals.css'
import { initializeTheme } from './stores/uiStore'

const isTauriRuntime = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window || '__TAURI__' in window
)

document.documentElement.setAttribute('data-runtime', isTauriRuntime ? 'tauri' : 'web')
initializeTheme()

const isScreenshotWindow = new URLSearchParams(window.location.search).get('window') === 'screenshot'
if (isScreenshotWindow) {
  document.getElementById('boot-splash')?.remove()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isScreenshotWindow ? <ScreenshotOverlay /> : <App />}
  </React.StrictMode>,
)
