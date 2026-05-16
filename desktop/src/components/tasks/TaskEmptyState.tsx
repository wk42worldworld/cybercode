import { Button } from '../shared/Button'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type Props = {
  onCreateTask: () => void
}

export function TaskEmptyState({ onCreateTask }: Props) {
  const t = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6 py-20">
      <div className="relative mb-4">
        <div className="w-16 h-16 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center">
          <Icon name="schedule" size={32} className="text-[var(--color-brand)]" />
        </div>
      </div>

      <h3 className="text-[14px] font-bold text-[var(--color-text-primary)] mb-1">
        {t('tasks.emptyTitle')}
      </h3>
      <p className="text-[14px] text-[var(--color-text-secondary)] mb-4 text-center max-w-sm">
        {t('tasks.emptyDesc')}
      </p>

      <Button onClick={onCreateTask}>{t('tasks.newTask')}</Button>
    </div>
  )
}
