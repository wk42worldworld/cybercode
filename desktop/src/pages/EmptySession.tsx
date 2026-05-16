import { EmptyState } from '../components/chat/EmptyState'

export function EmptySession() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-white text-neutral-900 transition-colors duration-300">
      <EmptyState variant="hero" />
    </div>
  )
}
