import type { TaskSummaryItem } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

const statusIcon: Record<TaskSummaryItem['status'], string> = {
  pending: 'radio_button_unchecked',
  in_progress: 'pending',
  completed: 'check_circle',
}

export function InlineTaskSummary({ tasks }: { tasks: TaskSummaryItem[] }) {
  const t = useTranslation()
  const completed = tasks.filter((tk) => tk.status === 'completed').length
  const total = tasks.length

  return (
    <div className="mb-3 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-container)]">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border-separator)]">
        <div className="flex items-center justify-center w-5 h-5 rounded-[var(--radius-md)] bg-[var(--color-success)]/10">
          <Icon name="task_alt" size={13} className="text-[var(--color-success)]" />
        </div>
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
          {t('tasks.completed')}
        </span>
        <span className="font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
          {completed}/{total}
        </span>
      </div>
      <div className="px-4 py-2 flex flex-col gap-0.5">
        {tasks.map((task) => {
          const isRunning = task.status === 'in_progress'
          const iconColor = task.status === 'completed'
            ? 'text-[var(--color-success)]'
            : isRunning
              ? 'text-[var(--color-brand)] animate-accent-pulse-line'
              : 'text-[var(--color-text-tertiary)]'

          return (
            <div key={task.id} className="flex items-center gap-2 py-1 px-1">
              <Icon
                name={statusIcon[task.status]}
                size={14}
                className={`shrink-0 ${iconColor}`}
              />
              <span className="label-micro text-[var(--color-text-tertiary)]">
                #{task.id}
              </span>
              <span className={`font-[var(--font-mono)] text-[12px] ${
                task.status === 'completed'
                  ? 'text-[var(--color-text-tertiary)] line-through'
                  : 'text-[var(--color-text-primary)]'
              }`}>
                {task.subject}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
