import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react'
import { ApiError } from '../../api/client'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Icon } from '../shared/Icon'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type FileSearchMenuHandle = {
  handleKeyDown: (e: KeyboardEvent) => void
}

type Props = {
  cwd: string
  filter?: string
  onSelect: (path: string, relativePath: string) => void
}

export const FileSearchMenu = forwardRef<FileSearchMenuHandle, Props>(({ cwd, filter = '', onSelect }, ref) => {
  const t = useTranslation()
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [currentPath, setCurrentPath] = useState(cwd)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const currentPathRef = useRef(cwd)

  const getErrorState = (error: unknown): { errorKey: TranslationKey | null; errorMessage: string | null } => {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return { errorKey: 'fileSearch.accessDenied', errorMessage: null }
      }

      const apiMessage =
        typeof error.body === 'string'
          ? error.body
          : typeof error.body === 'object' &&
              error.body !== null &&
              'error' in error.body &&
              typeof error.body.error === 'string'
            ? error.body.error
            : null

      if (apiMessage) {
        return { errorKey: null, errorMessage: apiMessage }
      }
    }

    return { errorKey: 'fileSearch.loadFailed', errorMessage: null }
  }

  // Parse filter: if it contains '/', navigate to that subdir and search the rest
  // Uses currentPathRef as base so nested paths navigate from current depth
  const parseFilter = (rawFilter: string): { navigateTo: string; searchQuery: string } => {
    const base = currentPathRef.current
    if (!rawFilter || !rawFilter.includes('/')) {
      return { navigateTo: base, searchQuery: rawFilter }
    }
    const lastSlash = rawFilter.lastIndexOf('/')
    const dirPart = rawFilter.slice(0, lastSlash + 1)
    const searchPart = rawFilter.slice(lastSlash + 1)
    const navigateTo = dirPart === '' ? base : `${base}/${dirPart}`
    return { navigateTo, searchQuery: searchPart }
  }

  // Load directory entries
  const loadDir = useCallback(async (dirPath: string, searchQuery: string) => {
    setLoading(true)
    setErrorMessage(null)
    setErrorKey(null)
    // Only update currentPath if actually navigating to a different directory
    if (dirPath !== currentPathRef.current) {
      setCurrentPath(dirPath)
      currentPathRef.current = dirPath
    }
    try {
      if (searchQuery) {
        const result = await filesystemApi.search(searchQuery, dirPath)
        setEntries(result.entries)
      } else {
        const result = await filesystemApi.browse(dirPath, { includeFiles: true })
        setEntries(result.entries)
      }
      setSelectedIndex(0)
    } catch (error) {
      setEntries([])
      const nextError = getErrorState(error)
      setErrorKey(nextError.errorKey)
      setErrorMessage(nextError.errorMessage)
    }
    setLoading(false)
  }, [])

  // Initial load: parse filter path and navigate accordingly
  useEffect(() => {
    currentPathRef.current = cwd
    const { navigateTo, searchQuery } = parseFilter(filter)
    void loadDir(navigateTo, searchQuery)
  }, [cwd, filter, loadDir])

  // Keyboard navigation handler exposed via ref
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, entries.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (entries[selectedIndex]) {
        onSelect(entries[selectedIndex]!.path, entries[selectedIndex]!.name)
      }
      return
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selectedIndex])

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLButtonElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Build breadcrumb segments from current path relative to cwd
  const breadcrumbs: string[] = []
  if (currentPath !== cwd && currentPath.startsWith(cwd)) {
    const rel = currentPath.slice(cwd.length).replace(/^\//, '')
    if (rel) breadcrumbs.push(...rel.split('/'))
  }

  const dirs = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  return (
    <div
      id="file-search-menu"
      className="absolute bottom-full left-0 z-50 mb-[10px] w-full min-w-[380px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header with path */}
      <div className="flex items-center gap-[8px] rounded-[16px] bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[11px]">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)]">
          <Icon name="folder_open" size={14} className="text-[var(--color-text-secondary)]" />
        </span>
        <span className="min-w-0 truncate font-mono font-medium text-[var(--color-text-tertiary)]">{cwd.split('/').pop() || cwd}</span>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1">
            <span className="text-[var(--color-text-tertiary)] opacity-60">/</span>
            <span className="truncate font-mono font-medium text-[var(--color-text-secondary)]">{seg}</span>
          </span>
        ))}
        {loading && (
          <Icon name="progress_activity" size={11} className="text-[var(--color-text-tertiary)] animate-spin ml-1" />
        )}
      </div>

      {/* File list */}
      <div ref={listRef} className="max-h-[300px] overflow-y-auto py-[6px]">
        {loading && entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('fileSearch.searching')}</div>
        ) : (errorKey || errorMessage) ? (
          <div className="px-4 py-6 text-center text-[12px] text-red-500/80">
            {errorKey ? t(errorKey) : errorMessage}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">
            {filter ? t('fileSearch.noMatch') : t('fileSearch.noFiles')}
          </div>
        ) : (
          <>
            {/* Directories */}
            {dirs.map((entry, i) => (
              <button
                key={entry.path}
                data-index={i}
                onClick={() => {
                  void loadDir(entry.path, filter)
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`group flex min-h-[44px] w-full items-center gap-[10px] rounded-[14px] px-[10px] py-[8px] text-left transition-colors duration-100 ${
                  selectedIndex === i ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)]">
                  <Icon name="folder" size={14} className="text-[var(--color-text-secondary)]" />
                </span>
                <span className={`truncate text-[13px] font-medium ${selectedIndex === i ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>{entry.name}</span>
              </button>
            ))}

            {/* Files */}
            {files.map((entry, i) => {
              const idx = dirs.length + i
              return (
                <button
                  key={entry.path}
                  data-index={idx}
                  onClick={() => onSelect(entry.path, entry.name)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`group flex min-h-[44px] w-full items-center gap-[10px] rounded-[14px] px-[10px] py-[8px] text-left transition-colors duration-100 ${
                    selectedIndex === idx ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)]">
                    <Icon name="description" size={14} className="text-[var(--color-text-secondary)]" />
                  </span>
                  <span className={`truncate text-[13px] font-medium ${selectedIndex === idx ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>{entry.name}</span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-2 rounded-[16px] bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[10px] font-medium text-[var(--color-text-tertiary)]">
        <kbd className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">↑↓</kbd>
        <span>{t('fileSearch.navigate')}</span>
        <kbd className="ml-1 rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">Enter</kbd>
        <span>{t('fileSearch.attach')}</span>
        <kbd className="ml-1 rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">Esc</kbd>
        <span>{t('fileSearch.close')}</span>
      </div>
    </div>
  )
})

FileSearchMenu.displayName = 'FileSearchMenu'
