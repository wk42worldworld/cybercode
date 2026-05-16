import { EmptyState } from '../components/chat/EmptyState'

export function EmptySession() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-background)] text-[var(--color-text-primary)] transition-colors duration-150">
      <EmptyState variant="hero" />
    </div>
  )
}
