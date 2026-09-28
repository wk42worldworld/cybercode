import { Component, type ReactNode } from 'react'
import { AppShell } from './components/layout/AppShell'

type EBState = { caught: boolean; msg: string }

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { caught: false, msg: '' }
  }
  static getDerivedStateFromError(e: unknown) {
    return { caught: true, msg: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) }
  }
  render() {
    if (this.state.caught) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', color: 'red', fontFamily: 'monospace', fontSize: 13, padding: 24, overflow: 'auto', zIndex: 999999 }}>
          <b>⚠️ RENDER ERROR</b>
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{this.state.msg}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}
