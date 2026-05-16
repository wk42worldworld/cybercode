import { EmptyState } from '../components/chat/EmptyState'

export function EmptySession() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden transition-colors duration-300 bg-background text-on-surface">
      <div className="h-8 shrink-0" data-tauri-drag-region />
      <EmptyState variant="hero" />
    </div>
  )
}
