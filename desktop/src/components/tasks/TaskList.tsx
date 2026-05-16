import { useState } from 'react'
import type { CronTask } from '../../types/task'
import { TaskRow } from './TaskRow'
import { useTranslation } from '../../i18n'

type Props = {
  tasks: CronTask[]
}

export function TaskList({ tasks }: Props) {
  const t = useTranslation()
  const enabledCount = tasks.filter((task) => task.enabled).length
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null)

  return (
    <div>
      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label={t('tasks.totalTasks')} value={String(tasks.length)} />
        <StatCard label={t('tasks.active')} value={String(enabledCount)} />
        <StatCard label={t('tasks.disabled')} value={String(tasks.length - enabledCount)} />
      </div>

      {/* Task rows — accordion: only one logs panel open at a time */}
      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showLogs={expandedLogsId === task.id}
            onToggleLogs={() => setExpandedLogsId(expandedLogsId === task.id ? null : task.id)}
          />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-4 py-3">
      <div className="text-[28px] font-bold leading-tight text-[var(--color-text-primary)]">{value}</div>
      <div className="text-[12px] text-[var(--color-text-secondary)]">{label}</div>
    </div>
  )
}
