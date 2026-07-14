import { useCLITaskStore } from '../../stores/cliTaskStore'
import { useTranslation } from '../../i18n'
import type { CLITask } from '../../types/cliTask'
import { Icon } from '../shared/Icon'

const statusConfig = {
  pending: {
    icon: 'radio_button_unchecked',
    color: 'var(--color-text-tertiary)',
    label: 'pending',
  },
  in_progress: {
    icon: 'pending',
    color: 'var(--color-warning)',
    label: 'active',
  },
  completed: {
    icon: 'check_circle',
    color: 'var(--color-success)',
    label: 'done',
  },
} as const

export function SessionTaskBar({ sessionId }: { sessionId?: string } = {}) {
  const {
    tasks,
    expanded,
    toggleExpanded,
    completedAndDismissed,
    resetCompletedTasks,
    sessionId: trackedSessionId,
  } = useCLITaskStore()
  const t = useTranslation()

  // Only render for the panel whose session the cli-task store is currently
  // tracking. Without this gate, every cached panel would show the foreground
  // session's tasks (the store only holds one session at a time).
  if (sessionId && trackedSessionId && sessionId !== trackedSessionId) return null

  if (tasks.length === 0) return null

  // Don't show sticky bar if tasks were completed and the user already continued chatting
  const allCompleted = tasks.every((tk) => tk.status === 'completed')
  if (allCompleted && completedAndDismissed) return null

  const completedCount = tasks.filter((tk) => tk.status === 'completed').length
  const totalCount = tasks.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // Find the first in-progress task for the compact label
  const activeTask = tasks.find((tk) => tk.status === 'in_progress')
  const taskLabel = activeTask
    ? activeTask.subject
    : allCompleted
      ? t('tasks.completed')
      : t('tasks.title')

  return (
    <div className="shrink-0 px-[24px]">
      <div
        data-chat-content-column
        className="mx-auto w-full max-w-[878px] overflow-hidden mb-1 rounded-[var(--radius-md)]"
        style={{ backgroundColor: 'var(--color-surface-container-low)' }}
      >
        <div className="flex items-stretch">
          {/* Left accent vertical line */}
          <div
            className="w-0.5 shrink-0"
            style={{
              backgroundColor: allCompleted
                ? 'var(--color-success)'
                : 'var(--color-brand)',
            }}
          />

          {/* Compact status bar — 28px tall */}
          <div className="flex-1 flex items-center gap-2 px-2" style={{ height: 28 }}>
            <button
              type="button"
              onClick={toggleExpanded}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {/* Task status icon */}
              <Icon
                name={allCompleted ? 'check_circle' : activeTask ? 'pending' : 'checklist'}
                size={14}
                className={allCompleted ? 'text-[var(--color-success)]' : activeTask ? 'text-[var(--color-warning)]' : 'text-[var(--color-brand)]'}
              />

              {/* Task name — truncated */}
              <span className="text-[11px] font-medium tracking-[-0.01em] text-[var(--color-text-primary)] truncate">
                {taskLabel}
              </span>

              {/* Progress percentage */}
              <span className="text-[10px] font-mono text-[var(--color-text-tertiary)] tabular-nums shrink-0">
                {progressPercent}%
              </span>

              {/* Expand arrow */}
              <Icon
                name="expand_less"
                size={12}
                className="text-[var(--color-text-tertiary)] shrink-0 transition-transform duration-200"
                style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {allCompleted && (
              <button
                type="button"
                aria-label={t('tasks.dismissCompleted')}
                onClick={() => { void resetCompletedTasks() }}
                className="flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Expanded task list */}
        {expanded && (
          <div className="flex items-stretch">
            {/* Left accent line continues into expanded area */}
            <div className="w-0.5 shrink-0 bg-[var(--color-border-separator)]" />

            <div className="flex-1 px-3 pb-2 pt-1 flex flex-col gap-0.5 max-h-[240px] overflow-y-auto border-t border-[var(--color-border-separator)]">
              {tasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TaskItem({ task }: { task: CLITask }) {
  const config = statusConfig[task.status]

  return (
    <div className="flex items-start gap-2 py-1 px-1 rounded-md">
      <Icon name={config.icon} size={14} className="mt-px shrink-0" style={{ color: config.color }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-[var(--color-text-tertiary)]">
            #{task.id}
          </span>
          <span className={`text-[11px] tracking-[-0.005em] ${
            task.status === 'completed'
              ? 'text-[var(--color-text-tertiary)] line-through'
              : 'text-[var(--color-text-primary)]'
          }`}>
            {task.subject}
          </span>
        </div>

        {task.status === 'in_progress' && task.activeForm && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)] animate-pulse-glow" />
            <span className="text-[10px] font-mono text-[var(--color-brand)]">
              {task.activeForm}
            </span>
          </div>
        )}

        {task.owner && (
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 inline-flex items-center gap-0.5">
            <Icon name="person" size={10} />
            {task.owner}
          </span>
        )}
      </div>
    </div>
  )
}
