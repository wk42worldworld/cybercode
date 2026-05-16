import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type CurrentProject = {
  projectPath: string
  workDir: string
  title: string
}

type MenuPosition = {
  top: number
  left: number
}

type NewSessionMenuProps = {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  currentProject?: CurrentProject
  onClose: () => void
  onCreate: (workDir?: string) => Promise<boolean>
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

function projectTitle(project: RecentProject): string {
  return project.repoName || project.projectName || project.realPath.split('/').filter(Boolean).pop() || project.realPath
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `.../${parts.slice(-2).join('/')}`
}

async function chooseFolder(title: string): Promise<string | null> {
  if (!isTauriRuntime()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })
  return typeof selected === 'string' ? selected : null
}

export function NewSessionMenu({
  open,
  anchorRef,
  currentProject,
  onClose,
  onCreate,
}: NewSessionMenuProps) {
  const t = useTranslation()
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = 336
    const margin = 12
    setPosition({
      top: rect.bottom + 8,
      left: Math.min(
        Math.max(margin, rect.right - width),
        Math.max(margin, window.innerWidth - width - margin),
      ),
    })
  }, [anchorRef])

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if ((target as HTMLElement).closest('[data-new-session-menu="true"]')) return
      onClose()
    }
    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEsc)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEsc)
    }
  }, [anchorRef, onClose, open])

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    sessionsApi.getRecentProjects(8)
      .then(({ projects }) => setProjects(projects))
      .catch(() => setProjects([]))
      .finally(() => setIsLoading(false))
  }, [open])

  const recentProjects = useMemo(() => {
    if (!currentProject) return projects
    return projects.filter((project) => project.realPath !== currentProject.workDir)
  }, [currentProject, projects])

  const handleCreate = async (key: string, workDir?: string) => {
    if (creatingKey) return
    setCreatingKey(key)
    try {
      const ok = await onCreate(workDir)
      if (ok) onClose()
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
      if (ok) onClose()
    } finally {
      setCreatingKey(null)
    }
  }

  if (!open || !position) return null

  return createPortal(
    <div
      data-new-session-menu="true"
      role="menu"
      aria-label={t('newSession.title')}
      className="fixed z-50 w-[336px] overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="max-h-[360px] overflow-y-auto p-1.5">
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

        {isLoading ? (
          <div className="px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">
            {t('common.loading')}
          </div>
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

      <div className="border-t border-[var(--color-border-separator)] p-1.5">
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
          onClick={() => void handleCreate('temporary', undefined)}
        />
      </div>
    </div>,
    document.body,
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
      className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-60"
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
      className={`flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-60 ${
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
