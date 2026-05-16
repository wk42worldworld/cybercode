import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { sessionsApi, type RecentProject } from '../../api/sessions'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import { Icon } from './Icon'

type Props = {
  value: string
  onChange: (path: string) => void
}

type DirEntry = { name: string; path: string; isDirectory: boolean }

// Module-level cache for recent projects (shared across instances, survives re-renders)
let cachedProjects: RecentProject[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000 // 30s

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

export function DirectoryPicker({ value, onChange }: Props) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'recent' | 'browse'>('recent')
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState('')
  const [loading, setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; direction: 'up' | 'down' } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)

  const updateDropdownPos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const DROPDOWN_HEIGHT = 380 // approximate max height
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    const direction = spaceBelow >= DROPDOWN_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up'
    setDropdownPos({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      direction,
    })
  }, [])

  // Close on outside click (checks both trigger and portal dropdown)
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return
    updateDropdownPos()
    window.addEventListener('scroll', updateDropdownPos, true)
    window.addEventListener('resize', updateDropdownPos)
    return () => {
      window.removeEventListener('scroll', updateDropdownPos, true)
      window.removeEventListener('resize', updateDropdownPos)
    }
  }, [isOpen, updateDropdownPos])

  // Load recent projects when opened (with client-side cache)
  useEffect(() => {
    if (!isOpen || mode !== 'recent') return
    // Use cache if fresh
    if (cachedProjects && Date.now() - cacheTimestamp < CACHE_TTL) {
      setProjects(cachedProjects)
      return
    }
    setLoading(true)
    sessionsApi.getRecentProjects()
      .then(({ projects: p }) => {
        cachedProjects = p
        cacheTimestamp = Date.now()
        setProjects(p)
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [isOpen, mode])

  const loadBrowseDir = async (path?: string) => {
    setLoading(true)
    try {
      const result = await filesystemApi.browse(path)
      setBrowsePath(result.currentPath)
      setBrowseParent(result.parentPath)
      setBrowseEntries(result.entries)
    } catch { /* API not available */ }
    setLoading(false)
  }

  const handleSelect = (path: string) => {
    onChange(path)
    setIsOpen(false)
    setMode('recent')
    // Invalidate cache so next open reflects the new selection
    cachedProjects = null
  }

  const handleChooseFolder = async () => {
    if (isTauriRuntime()) {
      // Desktop: native OS folder dialog
      setIsOpen(false)
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          directory: true,
          multiple: false,
          title: t('dirPicker.chooseProjectFolder'),
        })
        if (selected) onChange(selected)
      } catch (err) {
        console.error('[DirectoryPicker] Failed to open folder dialog:', err)
      }
    } else {
      // Web browser: directory tree via backend API
      setMode('browse')
      loadBrowseDir(value || undefined)
    }
  }

  // Find selected project info
  const selectedProject = projects.find((p) => p.realPath === value)

  return (
    <div ref={ref} className="relative">
      {/* Trigger — shows selected project chip or placeholder */}
      {value ? (
        <button
          ref={triggerRef}
          onClick={() => { setIsOpen(!isOpen); setMode('recent') }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-hover)] rounded-md text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors"
        >
          {selectedProject?.isGit ? (
            <Icon name="account_tree" size={14} className="shrink-0 text-[var(--color-text-secondary)]" />
          ) : (
            <Icon name="folder" size={14} className="shrink-0" />
          )}
          <span className="truncate max-w-[120px] text-[var(--color-text-primary)]">
            {selectedProject?.repoName || selectedProject?.projectName || value.split('/').pop()}
          </span>
          {selectedProject?.branch && (
            <span className="text-[var(--color-text-tertiary)] truncate max-w-[72px]">{selectedProject.branch}</span>
          )}
          <Icon name="expand_more" size={12} className="shrink-0" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => { setIsOpen(!isOpen); setMode('recent') }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-hover)] rounded-md text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors"
        >
          <Icon name="folder_open" size={14} />
          <span>{t('dirPicker.selectProject')}</span>
          <Icon name="expand_more" size={12} />
        </button>
      )}

      {/* Dropdown — rendered via portal to escape overflow clipping */}
      {isOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="w-[320px] overflow-hidden rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
          style={{
            position: 'fixed',
            left: dropdownPos.left,
            ...(dropdownPos.direction === 'down'
              ? { top: dropdownPos.top }
              : { bottom: window.innerHeight - dropdownPos.top }),
            zIndex: 9999,
          }}
        >
          {mode === 'recent' ? (
            <>
              <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                {t('dirPicker.recent')}
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1 px-1.5">
                {loading ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
                ) : projects.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('dirPicker.noRecent')}</div>
                ) : (
                  projects.map((project) => {
                    const isSelected = project.realPath === value
                    return (
                      <button
                        key={project.projectPath}
                        onClick={() => handleSelect(project.realPath)}
                        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 group ${
                          isSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        {project.isGit ? (
                          <Icon name="account_tree" size={14} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
                        ) : (
                          <Icon name="folder" size={14} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className={`truncate text-[13px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                            {project.repoName || project.projectName}
                          </div>
                          <div className="truncate text-[10px] font-mono text-[var(--color-text-tertiary)]">
                            {project.realPath}
                          </div>
                        </div>
                        {isSelected && (
                          <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-secondary)]" />
                        )}
                      </button>
                    )
                  })
                )}
              </div>

              {/* Divider + Choose different folder */}
              <div className="border-t border-[var(--color-border-separator)]">
                <button
                  onClick={handleChooseFolder}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Icon name="create_new_folder" size={14} className="text-[var(--color-text-tertiary)]" />
                  <span className="text-[13px] text-[var(--color-text-secondary)]">{t('dirPicker.chooseFolder')}</span>
                </button>
              </div>
            </>
          ) : (
            /* Directory tree browser (web only) */
            <>
              <div className="px-3 py-2 border-b border-[var(--color-border-separator)] flex items-center gap-1 flex-wrap">
                <button onClick={() => setMode('recent')} className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] mr-2 transition-colors">
                  {'← ' + t('dirPicker.recent')}
                </button>
                <button onClick={() => loadBrowseDir('/')} className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors">/</button>
                {browsePath.split('/').filter(Boolean).map((seg, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="text-[10px] text-[var(--color-border)]">/</span>
                    <button
                      onClick={() => loadBrowseDir('/' + arr.slice(0, i + 1).join('/'))}
                      className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >{seg}</button>
                  </span>
                ))}
              </div>

              <div className="max-h-[240px] overflow-y-auto py-1 px-1">
                {loading ? (
                  <div className="px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
                ) : (
                  <>
                    {browseParent && browseParent !== browsePath && (
                      <button onClick={() => loadBrowseDir(browseParent)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[var(--color-surface-hover)] transition-colors">
                        <Icon name="arrow_upward" size={14} className="text-[var(--color-text-tertiary)]" />
                        <span className="text-[12px] text-[var(--color-text-secondary)]">..</span>
                      </button>
                    )}
                    {browseEntries.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('dirPicker.noSubdirs')}</div>
                    ) : browseEntries.map((entry) => (
                      <button
                        key={entry.path}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                      >
                        <span onClick={() => loadBrowseDir(entry.path)}>
                          <Icon name="folder" size={14} className="text-[var(--color-text-tertiary)]" />
                        </span>
                        <span className="text-[12px] text-[var(--color-text-secondary)] flex-1" onClick={() => loadBrowseDir(entry.path)}>{entry.name}</span>
                        <button onClick={() => handleSelect(entry.path)} className="px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded transition-colors">
                          {t('common.select')}
                        </button>
                      </button>
                    ))}
                  </>
                )}
              </div>

              {/* Use current folder */}
              <div className="px-3 py-2 border-t border-[var(--color-border-separator)] flex justify-between items-center">
                <span className="text-[10px] text-[var(--color-text-tertiary)] font-mono truncate">{browsePath}</span>
                <button onClick={() => handleSelect(browsePath)} className="px-3 py-1.5 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] text-[12px] font-semibold rounded-lg hover:bg-[var(--color-btn-primary-bg-hover)] transition-colors">
                  {t('dirPicker.useThisFolder')}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
