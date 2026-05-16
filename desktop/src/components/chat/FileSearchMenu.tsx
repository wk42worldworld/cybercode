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
      className="absolute left-0 bottom-full mb-1.5 z-50 w-full min-w-[380px] overflow-hidden rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-dropdown)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header with path */}
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border-separator)] px-3 py-2 text-[11px]">
        <Icon name="folder_open" size={13} className="text-[var(--color-text-tertiary)]" />
        <span className="text-[var(--color-text-tertiary)] font-mono">{cwd.split('/').pop() || cwd}</span>
        {breadcrumbs.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-[var(--color-text-tertiary)] opacity-60">/</span>
            <span className="text-[var(--color-text-secondary)] font-mono">{seg}</span>
          </span>
        ))}
        {loading && (
          <Icon name="progress_activity" size={11} className="text-[var(--color-text-tertiary)] animate-spin ml-1" />
        )}
      </div>

      {/* File list */}
      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1 px-1">
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
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 ${
                  selectedIndex === i ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <Icon name="folder" size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
                <span className={`truncate text-[13px] font-mono ${selectedIndex === i ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{entry.name}</span>
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
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 ${
                    selectedIndex === idx ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <Icon name="description" size={14} className="text-[var(--color-text-tertiary)] shrink-0" />
                  <span className={`truncate text-[13px] font-mono ${selectedIndex === idx ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{entry.name}</span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border-separator)] px-3 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
        <kbd className="rounded bg-[var(--color-surface-container-low)] px-1 py-px font-mono text-[9px]">↑↓</kbd>
        <span>{t('fileSearch.navigate')}</span>
        <kbd className="ml-1 rounded bg-[var(--color-surface-container-low)] px-1 py-px font-mono text-[9px]">Enter</kbd>
        <span>{t('fileSearch.attach')}</span>
        <kbd className="ml-1 rounded bg-[var(--color-surface-container-low)] px-1 py-px font-mono text-[9px]">Esc</kbd>
        <span>{t('fileSearch.close')}</span>
      </div>
    </div>
  )
})

FileSearchMenu.displayName = 'FileSearchMenu'
