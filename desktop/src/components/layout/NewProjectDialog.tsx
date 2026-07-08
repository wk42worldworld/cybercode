import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { sessionsApi } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import type { CreateSessionInput } from '../../types/session'
import { Icon } from '../shared/Icon'

type NewProjectDialogProps = {
  open: boolean
  onClose: () => void
  onCreate: (input?: CreateSessionInput) => Promise<boolean>
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

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const [projectName, setProjectName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isChoosingParent, setIsChoosingParent] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => nameInputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCreating) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isCreating, onClose, open])

  const resetAndClose = () => {
    if (isCreating) return
    setProjectName('')
    setParentDir('')
    onClose()
  }

  const handleChooseParent = async () => {
    if (isCreating || isChoosingParent) return
    setIsChoosingParent(true)
    try {
      const selected = await chooseFolder(t('newSession.chooseParentFolder'))
      if (selected) setParentDir(selected)
    } catch (error) {
      console.error('[NewProjectDialog] Failed to open folder dialog:', error)
      addToast({
        type: 'error',
        message: t('newSession.folderPickerUnavailable'),
      })
    } finally {
      setIsChoosingParent(false)
    }
  }

  const handleCreate = async () => {
    const name = projectName.trim()
    const parent = parentDir.trim()
    if (!name || !parent || isCreating) return

    setIsCreating(true)
    try {
      const project = await sessionsApi.createProjectFolder({ parentDir: parent, name })
      const ok = await onCreate(project.path)
      if (ok) {
        setProjectName('')
        setParentDir('')
        onClose()
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setIsCreating(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/18 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resetAndClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('newSession.createProject')}
        className="w-full max-w-[420px] overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[0_18px_54px_rgba(0,0,0,0.22)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-border-separator)] px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]">
            <Icon name="create_new_folder" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold text-[var(--color-text-primary)]">
              {t('newSession.createProject')}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={resetAndClose}
            disabled={isCreating}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-50"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
              {t('newSession.projectName')}
            </span>
            <input
              ref={nameInputRef}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              disabled={isCreating}
              placeholder={t('newSession.projectNamePlaceholder')}
              className="h-9 rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
              {t('newSession.parentFolder')}
            </span>
            <div className="flex items-center gap-2">
              <input
                value={parentDir}
                readOnly
                disabled={isCreating}
                placeholder={t('newSession.parentFolderPlaceholder')}
                onClick={() => void handleChooseParent()}
                className="h-9 min-w-0 flex-1 cursor-pointer rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] disabled:cursor-default disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void handleChooseParent()}
                disabled={isCreating || isChoosingParent}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--color-border-separator)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-50"
                title={t('newSession.chooseParentFolder')}
                aria-label={t('newSession.chooseParentFolder')}
              >
                {isChoosingParent
                  ? <Icon name="loading" size={15} className="animate-spin" />
                  : <Icon name="folder_open" size={15} />}
              </button>
            </div>
          </label>

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={isCreating}
              className="h-9 rounded-[8px] px-3 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || projectName.trim().length === 0 || parentDir.trim().length === 0}
              className="flex h-9 items-center gap-2 rounded-[8px] bg-[var(--color-brand)] px-3 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-default disabled:opacity-45"
            >
              {isCreating && <Icon name="loading" size={14} className="animate-spin" />}
              {t('newSession.createProjectAction')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
