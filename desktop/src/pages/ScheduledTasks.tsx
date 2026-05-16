import { useEffect, useState } from 'react'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'
import { useTranslation } from '../i18n'
import { Button } from '../components/shared/Button'
import { TaskList } from '../components/tasks/TaskList'
import { TaskEmptyState } from '../components/tasks/TaskEmptyState'
import { NewTaskModal } from '../components/tasks/NewTaskModal'
import { Icon } from '../components/shared/Icon'

export function ScheduledTasks() {
  const { tasks, fetchTasks, isLoading } = useTaskStore()
  const { activeModal, openModal, closeModal } = useUIStore()
  const t = useTranslation()
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    fetchTasks().then(() => setInitialized(true))
  }, [fetchTasks])

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--color-background)]">
      <div className="mx-auto w-full max-w-[896px] px-[24px] py-[24px] md:px-[32px]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[22px] font-bold text-[var(--color-text-primary)]">{t('scheduledPage.title')}</h1>
            <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
              {(() => {
                const parts = t('scheduledPage.subtitle').split('{code}')
                return <>{parts[0]}<code className="rounded-[6px] bg-[var(--color-surface-container)] px-1 py-0.5 font-mono text-[12px]">/schedule</code>{parts[1]}</>
              })()}
            </p>
          </div>
          <Button onClick={() => openModal('new-task')}>{t('tasks.newTask')}</Button>
        </div>

        <div className="mb-6 flex items-center gap-2.5 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-3.5 py-2.5">
          <Icon name="schedule" size={18} className="text-[var(--color-brand)]" />
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {t('scheduledPage.desktopNotice')}
          </span>
        </div>

        {!initialized && isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
          </div>
        ) : tasks.length === 0 ? (
          <TaskEmptyState onCreateTask={() => openModal('new-task')} />
        ) : (
          <TaskList tasks={tasks} />
        )}
      </div>

      {/* New Task Modal */}
      {activeModal === 'new-task' && (
        <NewTaskModal
          open
          onClose={closeModal}
        />
      )}
    </div>
  )
}
