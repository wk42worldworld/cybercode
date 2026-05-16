import { Button } from '../shared/Button'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type Props = {
  onCreateTask: () => void
}

export function TaskEmptyState({ onCreateTask }: Props) {
  const t = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center py-20">
      {/* Large icon with accent glow */}
      <div className="relative mb-4">
        <div className="w-16 h-16 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center">
          <Icon name="schedule" size={32} className="text-[var(--color-brand)]" />
        </div>
        <div
          className="absolute -inset-2 rounded-full pointer-events-none"
          style={{ boxShadow: '0 0 20px 4px var(--color-accent-glow)' }}
          aria-hidden="true"
        />
      </div>

      <h3 className="text-[14px] font-medium text-[var(--color-text-primary)] mb-1">
        {t('tasks.emptyTitle')}
      </h3>
      <p className="text-[14px] text-[var(--color-text-secondary)] mb-4 text-center max-w-sm">
        {t('tasks.emptyDesc')}
      </p>

      <Button onClick={onCreateTask}>{t('tasks.newTask')}</Button>
    </div>
  )
}
