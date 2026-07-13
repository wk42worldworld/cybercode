import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Folder } from 'lucide-react'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type DropdownPos = {
  top: number
  left: number
  direction: 'up' | 'down'
}

type ProjectOption = {
  projectPath: string
  title: string
  subtitle: string | null
  isGit: boolean
  branch: string | null
  modifiedAt?: string
}

let cachedProjects: RecentProject[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000

export function ProjectFilter({ variant = 'default' }: { variant?: 'default' | 'embedded' }) {
  const t = useTranslation()
  const {
    availableProjects,
    selectedProjects,
    selectedSessionScope,
    setSessionFilterScope,
    projectDisplayNames,
  } = useSessionStore()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [loading, _setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Preload projects on mount, not just when opening
  useEffect(() => {
    if (cachedProjects && Date.now() - cacheTimestamp < CACHE_TTL) {
      setProjects(cachedProjects)
      return
    }
    sessionsApi.getRecentProjects(200)
      .then(({ projects: nextProjects }) => {
        cachedProjects = nextProjects
        cacheTimestamp = Date.now()
        setProjects(nextProjects)
      })
      .catch(() => setProjects([]))
  }, [])

  const updateDropdownPos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = 420
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const direction = spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove ? 'down' : 'up'

    setDropdownPos({
      top: direction === 'down' ? rect.bottom + 8 : rect.top - 8,
      left: rect.left,
      direction,
    })
  }, [])

  useEffect(() => {
    if (!open) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }

    // Capture phase so ancestor stopPropagation (e.g. TabBar drag region)
    // does not prevent the dropdown from closing on outside clicks.
    document.addEventListener('mousedown', handleClick, true)
    return () => document.removeEventListener('mousedown', handleClick, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    updateDropdownPos()
    window.addEventListener('scroll', updateDropdownPos, true)
    window.addEventListener('resize', updateDropdownPos)
    return () => {
      window.removeEventListener('scroll', updateDropdownPos, true)
      window.removeEventListener('resize', updateDropdownPos)
    }
  }, [open, updateDropdownPos])

  // Refresh cache when opening if expired, but don't show loading if we have cached data
  useEffect(() => {
    if (!open) return
    if (cachedProjects && Date.now() - cacheTimestamp < CACHE_TTL) {
      if (projects.length === 0) setProjects(cachedProjects)
      return
    }
    if (cachedProjects && projects.length === 0) {
      setProjects(cachedProjects)
    }
    // Refresh in background without loading state
    sessionsApi.getRecentProjects(200)
      .then(({ projects: nextProjects }) => {
        cachedProjects = nextProjects
        cacheTimestamp = Date.now()
        setProjects(nextProjects)
      })
      .catch(() => {})
  }, [open, projects.length])

  const selectedProjectPath = selectedSessionScope === 'project' ? selectedProjects[0] : undefined
  const isTemporarySelected = selectedSessionScope === 'temporary'
  const isAllSelected = !isTemporarySelected && !selectedProjectPath

  const options = useMemo(() => {
    const availableSet = new Set(availableProjects)
    const optionsByPath = new Map<string, ProjectOption>()

    for (const project of projects) {
      if (!availableSet.has(project.projectPath)) continue
      optionsByPath.set(project.projectPath, {
        projectPath: project.projectPath,
        title: projectDisplayNames[project.projectPath] || project.repoName || project.projectName,
        subtitle: project.realPath,
        isGit: project.isGit,
        branch: project.branch,
        modifiedAt: project.modifiedAt,
      })
    }

    for (const projectPath of availableProjects) {
      if (optionsByPath.has(projectPath)) continue
      optionsByPath.set(projectPath, {
        projectPath,
        title: projectDisplayNames[projectPath] || fallbackProjectTitle(projectPath, t('sidebar.other')),
        subtitle: null,
        isGit: false,
        branch: null,
      })
    }

    return [...optionsByPath.values()].sort(compareProjectOptions)
  }, [availableProjects, projectDisplayNames, projects, t])

  const optionByPath = useMemo(
    () => new Map(options.map((option) => [option.projectPath, option])),
    [options],
  )

  const label = isAllSelected
    ? t('sidebar.allProjects')
    : isTemporarySelected
      ? t('sidebar.temporarySessions')
      : selectedProjectPath
        ? optionByPath.get(selectedProjectPath)?.title || fallbackProjectTitle(selectedProjectPath, t('sidebar.other'))
        : t('sidebar.allProjects')
  const triggerLabel = isAllSelected ? t('sidebar.allProjects') : label

  const selectAllProjects = () => {
    setSessionFilterScope('all')
    setOpen(false)
  }

  const selectTemporarySessions = () => {
    setSessionFilterScope('temporary')
    setOpen(false)
  }

  const selectProject = (projectPath: string) => {
    setSessionFilterScope('project', projectPath)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        className={
          variant === 'embedded'
            ? `inline-flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors duration-100 ${
              isAllSelected
                ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                : 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
            }`
            : 'inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-2 text-left text-[14px] text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)]'
        }
      >
        {variant === 'embedded' ? (
          <span className="relative flex items-center justify-center">
            <Folder size={14} strokeWidth={1.75} />
            {!isAllSelected && (
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-text-secondary)]" />
            )}
          </span>
        ) : (
          <>
            <Icon name="folder" size={14} className="text-[var(--color-text-secondary)]" />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold">{label}</span>
            </span>
            <span className="flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center text-[var(--color-text-tertiary)] transition-colors">
              <Icon name="expand_more" size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
          </>
        )}
      </button>

      {/* Keep dropdown in DOM but hidden when closed - avoids re-mounting lag */}
      {createPortal(
        <div
          ref={dropdownRef}
          className="w-[280px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
          style={{
            position: 'fixed',
            left: dropdownPos ? Math.min(dropdownPos.left, window.innerWidth - Math.min(280, window.innerWidth - 32) - 16) : -9999,
            ...(dropdownPos?.direction === 'down'
              ? { top: dropdownPos.top }
              : dropdownPos ? { bottom: window.innerHeight - dropdownPos.top } : { top: -9999 }),
            zIndex: 9999,
            visibility: open ? 'visible' : 'hidden',
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
          <div className="max-h-[380px] overflow-y-auto py-2 px-1.5">
            <button
              type="button"
              onClick={selectAllProjects}
              title={t('sidebar.allProjects')}
              aria-label={t('sidebar.allProjects')}
              className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                isAllSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <Icon name="workspaces" size={14} className="opacity-50" />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13px] ${isAllSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                  {t('sidebar.allProjects')}
                </div>
              </div>
              {isAllSelected && (
                <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
            </button>
            <button
              type="button"
              onClick={selectTemporarySessions}
              title={t('sidebar.temporarySessions')}
              aria-label={t('sidebar.temporarySessions')}
              className={`group mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                isTemporarySelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <Icon name="bolt" size={14} className="opacity-50" />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13px] ${isTemporarySelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                  {t('sidebar.temporarySessions')}
                </div>
              </div>
              {isTemporarySelected && (
                <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
            </button>

            {loading && projects.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
            ) : options.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('sidebar.noSessions')}</div>
            ) : (
              <>
                <div className="my-1 h-px bg-[var(--color-border-separator)]" />
                <div className="flex flex-col gap-1">
                  {options.map((option) => {
                    const checked = selectedProjectPath === option.projectPath
                    return (
                      <button
                        key={option.projectPath}
                        type="button"
                        title={option.subtitle ?? option.title}
                        onClick={() => selectProject(option.projectPath)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors group ${
                          checked
                            ? 'bg-[var(--color-surface-selected)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        <Icon name={option.isGit ? 'account_tree' : 'folder'} size={14} className="opacity-50" />
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[13px] ${checked ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                            {option.title}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          {option.branch && (
                            <span className="max-w-[80px] truncate text-[9px] text-[var(--color-text-tertiary)]">
                              {option.branch}
                            </span>
                          )}
                          {checked && (
                            <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function compareProjectOptions(a: ProjectOption, b: ProjectOption) {
  if (a.modifiedAt && b.modifiedAt && a.modifiedAt !== b.modifiedAt) {
    return b.modifiedAt.localeCompare(a.modifiedAt)
  }
  if (a.modifiedAt && !b.modifiedAt) return -1
  if (!a.modifiedAt && b.modifiedAt) return 1
  return a.title.localeCompare(b.title)
}

function fallbackProjectTitle(projectPath: string, fallback: string) {
  if (!projectPath || projectPath === '_unknown') return fallback
  if (projectPath.includes('/')) {
    return projectPath.split('/').filter(Boolean).pop() || fallback
  }

  const segments = projectPath.split('-').filter(Boolean)
  return segments[segments.length - 1] || projectPath || fallback
}
