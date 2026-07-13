import { useMemo, useState } from 'react'
import { NewProjectDialog } from '../components/layout/NewProjectDialog'
import { NewSessionChooser, resolveCurrentProject } from '../components/layout/NewSessionChooser'
import { useCreateAndOpenSession } from '../hooks/useCreateAndOpenSession'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'

export function EmptySession() {
  const t = useTranslation()
  const sessions = useSessionStore((state) => state.sessions)
  const selectedProjects = useSessionStore((state) => state.selectedProjects)
  const projectDisplayNames = useSessionStore((state) => state.projectDisplayNames)
  const createAndOpenSession = useCreateAndOpenSession()
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false)
  const currentProject = useMemo(
    () => {
      const resolved = resolveCurrentProject(selectedProjects, sessions)
      if (!resolved) return undefined
      return {
        ...resolved,
        title: projectDisplayNames[resolved.projectPath] || resolved.title,
      }
    },
    [projectDisplayNames, selectedProjects, sessions],
  )

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-background)] text-[var(--color-text-primary)] transition-colors duration-150">
      <div className="flex min-h-0 flex-1 items-center justify-center px-[24px] py-[48px]">
        <div
          role="menu"
          aria-label={t('newSession.title')}
          className="flex max-h-[460px] min-h-[220px] w-full max-w-[336px] flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
        >
          <NewSessionChooser
            currentProject={currentProject}
            onCreate={createAndOpenSession}
            onCreateProject={() => setNewProjectDialogOpen(true)}
          />
        </div>
      </div>
      <NewProjectDialog
        open={newProjectDialogOpen}
        onClose={() => setNewProjectDialogOpen(false)}
        onCreate={createAndOpenSession}
      />
    </div>
  )
}
