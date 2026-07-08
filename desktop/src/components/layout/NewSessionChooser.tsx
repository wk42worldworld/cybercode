import { useEffect, useMemo, useState } from 'react'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import type { CreateSessionInput, SessionListItem } from '../../types/session'
import { Icon } from '../shared/Icon'

export type CurrentProject = {
  projectPath: string
  workDir: string
  title: string
}

type NewSessionChooserProps = {
  currentProject?: CurrentProject
  onClose?: () => void
  onCreate: (input?: CreateSessionInput) => Promise<boolean>
  onCreateProject: () => void
}

let cachedRecentProjects: RecentProject[] | null = null

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function projectTitle(project: RecentProject): string {
  return project.repoName || project.projectName || basename(project.realPath)
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `.../${parts.slice(-2).join('/')}`
}

async function chooseFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })
  return typeof selected === 'string' ? selected : null
}

export function resolveCurrentProject(
  selectedProjects: string[],
  sessions: SessionListItem[],
): CurrentProject | undefined {
  if (selectedProjects.length !== 1) return undefined

  const projectPath = selectedProjects[0]!
  const latestSession = sessions
    .filter((session) =>
      !session.isTemporary &&
      session.projectPath === projectPath &&
      session.workDir &&
      session.workDirExists,
    )
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())[0]

  if (!latestSession?.workDir) return undefined
  return {
    projectPath,
    workDir: latestSession.workDir,
    title: basename(latestSession.workDir),
  }
}

export function NewSessionChooser({
  currentProject,
  onClose,
  onCreate,
  onCreateProject,
}: NewSessionChooserProps) {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const [projects, setProjects] = useState<RecentProject[]>(() => cachedRecentProjects ?? [])
  const [isLoading, setIsLoading] = useState(() => cachedRecentProjects === null)
  const [creatingKey, setCreatingKey] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    if (cachedRecentProjects) {
      setProjects(cachedRecentProjects)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    sessionsApi.getRecentProjects(8)
      .then(({ projects: nextProjects }) => {
        cachedRecentProjects = nextProjects
        if (alive) setProjects(nextProjects)
      })
      .catch(() => {
        if (alive) setProjects([])
      })
      .finally(() => {
        if (alive) setIsLoading(false)
      })

    return () => {
      alive = false
    }
  }, [])

  const recentProjects = useMemo(() => {
    if (!currentProject) return projects
    return projects.filter((project) => project.realPath !== currentProject.workDir)
  }, [currentProject, projects])

  const handleCreate = async (key: string, input?: CreateSessionInput) => {
    if (creatingKey) return
    setCreatingKey(key)
    try {
      const ok = await onCreate(input)
      if (ok) onClose?.()
    } finally {
      setCreatingKey(null)
    }
  }

  const handleChooseFolder = async () => {
    if (creatingKey) return
    setCreatingKey('choose-folder')
    try {
      const selected = await chooseFolder(t('dirPicker.chooseProjectFolder'))
      if (!selected) return
      const ok = await onCreate(selected)
      if (ok) onClose?.()
    } catch (error) {
      console.error('[NewSessionChooser] Failed to open folder dialog:', error)
      addToast({
        type: 'error',
        message: t('newSession.folderPickerUnavailable'),
      })
    } finally {
      setCreatingKey(null)
    }
  }

  const handleCreateProject = () => {
    if (creatingKey) return
    onClose?.()
    window.setTimeout(onCreateProject, 0)
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {currentProject && (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
              {t('newSession.currentProject')}
            </div>
            <ProjectMenuItem
              title={currentProject.title}
              subtitle={compactPath(currentProject.workDir)}
              icon="folder_open"
              loading={creatingKey === `current:${currentProject.projectPath}`}
              disabled={!!creatingKey}
              onClick={() => void handleCreate(`current:${currentProject.projectPath}`, currentProject.workDir)}
            />
            <div className="my-1 border-t border-[var(--color-border-separator)]" />
          </>
        )}

        {isLoading && projects.length === 0 ? (
          <RecentProjectsSkeleton />
        ) : recentProjects.length > 0 ? (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
              {t('newSession.recentProjects')}
            </div>
            {recentProjects.map((project) => (
              <ProjectMenuItem
                key={`${project.projectPath}:${project.realPath}`}
                title={projectTitle(project)}
                subtitle={`${compactPath(project.realPath)}${project.branch ? ` · ${project.branch}` : ''}`}
                meta={t('newSession.sessionCount', { count: project.sessionCount })}
                icon={project.isGit ? 'source' : 'folder'}
                loading={creatingKey === project.realPath}
                disabled={!!creatingKey}
                onClick={() => void handleCreate(project.realPath, project.realPath)}
              />
            ))}
          </>
        ) : (
          <div className="px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">
            {t('newSession.noRecentProjects')}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--color-border-separator)] p-1.5">
        <ActionMenuItem
          icon="create_new_folder"
          title={t('newSession.createProject')}
          loading={false}
          disabled={!!creatingKey}
          onClick={handleCreateProject}
        />
        <ActionMenuItem
          icon="folder_open"
          title={t('newSession.chooseFolder')}
          loading={creatingKey === 'choose-folder'}
          disabled={!!creatingKey}
          onClick={() => void handleChooseFolder()}
        />
        <ActionMenuItem
          icon="bolt"
          title={t('newSession.temporary')}
          subtle
          loading={creatingKey === 'temporary'}
          disabled={!!creatingKey}
          onClick={() => void handleCreate('temporary', { temporary: true })}
        />
      </div>
    </>
  )
}

function RecentProjectsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="px-2.5 pb-1 pt-1.5">
        <div className="h-[10px] w-[82px] animate-pulse rounded-full bg-[var(--color-surface-container-high)]" />
      </div>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2"
        >
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-[6px] bg-[var(--color-surface-container)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-[12px] w-[62%] animate-pulse rounded-full bg-[var(--color-surface-container-high)]" />
            <span className="block h-[10px] w-[86%] animate-pulse rounded-full bg-[var(--color-surface-container)]" />
          </span>
        </div>
      ))}
    </div>
  )
}

function ProjectMenuItem({
  title,
  subtitle,
  meta,
  icon,
  loading,
  disabled,
  onClick,
}: {
  title: string
  subtitle: string
  meta?: string
  icon: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container)]">
        {loading ? <Icon name="loading" size={16} className="animate-spin" /> : <Icon name={icon} size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-tertiary)]">{subtitle}</span>
      </span>
      {meta && <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{meta}</span>}
    </button>
  )
}

function ActionMenuItem({
  icon,
  title,
  subtle,
  loading,
  disabled,
  onClick,
}: {
  icon: string
  title: string
  subtle?: boolean
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-60 ${
        subtle ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container)]">
        {loading ? <Icon name="loading" size={16} className="animate-spin" /> : <Icon name={icon} size={16} />}
      </span>
      <span className="text-[13px] font-semibold">{title}</span>
    </button>
  )
}
