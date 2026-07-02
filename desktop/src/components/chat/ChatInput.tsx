import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ArrowUp, Folder, Paperclip, Plus, Square } from 'lucide-react'

import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTeamStore } from '../../stores/teamStore'
import { sessionsApi } from '../../api/sessions'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import type { AttachmentRef } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import { StreamingIndicator } from './StreamingIndicator'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashTrigger,
  getSlashCommandName,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveSlashUiAction,
} from './composerUtils'

type GitInfo = { branch: string | null; repoName: string | null; workDir: string; changedFiles: number }

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  path?: string
  mimeType?: string
  previewUrl?: string
  data?: string
}

const INLINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

type ChatInputProps = {
  variant?: 'default' | 'hero'
  sessionId?: string
  projectPath?: string
  onSubmit?: (text: string, attachments: AttachmentRef[]) => void
  workDir?: string
  onWorkDirChange?: (dir: string) => void
  runtimeKey?: string
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

function getFileExtension(name: string): string {
  const match = name.toLowerCase().match(/\.([^.]+)$/)
  return match?.[1] ?? ''
}

function getPathFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

function isInlineImageFile(file: File): boolean {
  const mimeType = file.type.toLowerCase()
  return mimeType.startsWith('image/') || IMAGE_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name))
}

function getNonStandardFilePath(file: File): string | null {
  const maybePath = (file as File & { path?: unknown }).path
  return typeof maybePath === 'string' && maybePath.trim() ? maybePath : null
}

function fileUrlToPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    return pathname.replace(/^\/([a-zA-Z]:\/)/, '$1')
  } catch {
    return null
  }
}

function getDroppedPaths(dataTransfer: DataTransfer): string[] {
  const uriList = dataTransfer.getData('text/uri-list')
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(fileUrlToPath)
    .filter((path): path is string => Boolean(path))
}

export function ChatInput({ variant = 'default', sessionId: sessionIdProp, projectPath, onSubmit: onSubmitProp, workDir: workDirProp, onWorkDirChange, runtimeKey }: ChatInputProps) {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [modelSelectorOpenSignal, setModelSelectorOpenSignal] = useState(0)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const wasActiveRef = useRef(false)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { sendMessage, stopGeneration, queuePendingSteer } = useChatStore()
  const globalActiveTabId = useTabStore((s) => s.activeTabId)
  const activeTabId = sessionIdProp ?? globalActiveTabId
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const slashCommands = sessionState?.slashCommands ?? []
  const composerPrefill = sessionState?.composerPrefill ?? null
  const activeSession = useSessionStore((state) =>
    activeTabId
      ? state.sessions.find((session) =>
          session.id === activeTabId && (!projectPath || session.projectPath === projectPath),
        ) ?? null
      : null,
  )
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const isMemberSession = !!memberInfo
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.workDirExists === false
  const canSubmit = !isWorkspaceMissing && (input.trim().length > 0 || (!isMemberSession && attachments.length > 0))
  const isHeroComposer = variant === 'hero' && !isMemberSession
  const resolvedWorkDir = workDirProp ?? (activeSession?.workDir || gitInfo?.workDir || undefined)

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      textareaRef.current?.focus()
    }
    wasActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    if (!composerPrefill) return

    setInput(composerPrefill.text)
    setAttachments(
      (composerPrefill.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' || attachment.data || attachment.path)
        .map((attachment, index) => ({
          id: `rewind-prefill-${composerPrefill.nonce}-${index}`,
          name: attachment.name,
          type: attachment.type,
          path: attachment.path,
          mimeType: attachment.mimeType,
          previewUrl: attachment.type === 'image' ? attachment.data : undefined,
          data: attachment.data,
        })),
    )
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      el?.focus()
      const cursor = composerPrefill.text.length
      el?.setSelectionRange(cursor, cursor)
    })
  }, [composerPrefill])

  useEffect(() => {
    if (!activeTabId) {
      setGitInfo(null)
      return
    }
    if (isMemberSession) {
      setGitInfo(null)
      return
    }
    sessionsApi.getGitInfo(activeTabId, { projectPath }).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, projectPath, isMemberSession])

  useEffect(() => {
    if (!isMemberSession) return
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
  }, [isMemberSession, activeTabId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const minHeight = 50
    const maxHeight = 200
    el.style.height = `${Math.max(Math.min(el.scrollHeight, maxHeight), minHeight)}px`
  }, [input])

  useEffect(() => {
    if (!plusMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [plusMenuOpen])

  useEffect(() => {
    if (!slashMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!localSlashPanel) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setLocalSlashPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [localSlashPanel])

  useEffect(() => {
    if (!fileSearchOpen) return
    const handleClick = (event: MouseEvent) => {
      const menu = document.getElementById('file-search-menu')
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setFileSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [fileSearchOpen])

  const allSlashCommands = useMemo(
    () => mergeSlashCommands(slashCommands, FALLBACK_SLASH_COMMANDS),
    [slashCommands],
  )

  const filteredCommands = useMemo(() => {
    const source = allSlashCommands
    if (!slashFilter) return source
    const lower = slashFilter.toLowerCase()
    return source.filter((command) => (
      command.name.toLowerCase().includes(lower) ||
      command.description.toLowerCase().includes(lower)
    ))
  }, [allSlashCommands, slashFilter])

  const exactSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (!normalized) return null
    return filteredCommands.find((command) => command.name.toLowerCase() === normalized) ?? null
  }, [filteredCommands, slashFilter])

  const selectedSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (exactSlashCommand && normalized === exactSlashCommand.name.toLowerCase()) {
      return exactSlashCommand
    }
    return filteredCommands[slashSelectedIndex] ?? filteredCommands[0] ?? null
  }, [exactSlashCommand, filteredCommands, slashFilter, slashSelectedIndex])

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findSlashTrigger(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
      return
    }

    setFileSearchOpen(false)
    setSlashFilter(token.filter)
    setSlashMenuOpen(true)
  }, [])

  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.slice(0, cursorPos)
    let pos = -1

    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      const ch = textBeforeCursor[i]!
      if (ch === '@') {
        if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
          pos = i
          break
        }
        break
      }
      if (/\s/.test(ch)) {
        break
      }
    }

    if (pos < 0) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
      return
    }

    const filter = textBeforeCursor.slice(pos + 1)
    setAtFilter(filter)
    setAtCursorPos(cursorPos)
    setSlashMenuOpen(false)
    setFileSearchOpen(true)
  }, [])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    if (isMemberSession) {
      setInput(value)
      return
    }
    const cursorPos = event.target.selectionStart ?? value.length
    setInput(value)
    detectSlashTrigger(value, cursorPos)
    detectAtTrigger(value, cursorPos)
  }

  const selectSlashCommand = useCallback((command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, command)
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }, [input])

  const handleSubmit = () => {
    const text = (() => {
      if (!isMemberSession && slashMenuOpen && selectedSlashCommand) {
        const cursorPos = textareaRef.current?.selectionStart ?? input.length
        return replaceSlashToken(input, cursorPos, selectedSlashCommand.name).value.trim()
      }
      return input.trim()
    })()
    if ((!text && (!attachments.length || isMemberSession)) || isWorkspaceMissing) return

    const slashCommandName = !isMemberSession ? getSlashCommandName(text) : null
    const slashUiAction = slashCommandName ? resolveSlashUiAction(slashCommandName) : null
    if (slashUiAction?.type === 'panel') {
      setLocalSlashPanel(slashUiAction.command as LocalSlashCommandName)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'settings') {
      useUIStore.getState().openSettings(slashUiAction.tab)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'model') {
      setModelSelectorOpenSignal((value) => value + 1)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'unsupported') {
      const unsupportedMessage =
        slashUiAction.command === 'vim'
          ? t('slash.unsupported.vim')
          : t('slash.unsupported.desktopCommand', { command: `/${slashUiAction.command}` })
      useUIStore.getState().addToast({
        type: 'info',
        message: unsupportedMessage,
      })
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      path: attachment.path,
      data: attachment.data,
      mimeType: attachment.mimeType,
    }))

    if (!isMemberSession && isActive) {
      queuePendingSteer(activeTabId!, text, attachmentPayload)
    } else if (onSubmitProp) {
      onSubmitProp(text, attachmentPayload)
    } else {
      sendMessage(activeTabId!, text, attachmentPayload)
    }
    setInput('')
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
  }

  const handleSubmitMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!isMemberSession && slashMenuOpen) {
      event.stopPropagation()
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

    // Escape stops generation when active
    if (event.key === 'Escape' && isActive && activeTabId) {
      event.preventDefault()
      stopGeneration(activeTabId)
      return
    }

    if (fileSearchOpen) {
      const key = event.key
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Tab' || key === 'Escape') {
        event.preventDefault()
        if (key === 'Escape') {
          setFileSearchOpen(false)
          setAtFilter('')
          setAtCursorPos(-1)
          return
        }
        fileSearchRef.current?.handleKeyDown(event.nativeEvent)
        return
      }
      return
    }

    if (localSlashPanel) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLocalSlashPanel(null)
        return
      }
    }

    if (slashMenuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter') {
        if (exactSlashCommand && slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()) {
          event.preventDefault()
          handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (isMemberSession) return
    const items = event.clipboardData?.items
    if (!items) return

    let hasImage = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !item.type.startsWith('image/')) continue

      hasImage = true
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue

      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: `pasted-image-${Date.now()}.png`,
            type: 'image',
            mimeType: file.type || 'image/png',
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isMemberSession) return
    const files = event.target.files
    if (!files) return

    handleFiles(files)

    event.target.value = ''
  }

  const addPathAttachments = useCallback((paths: string[]) => {
    if (paths.length === 0) return

    setAttachments((prev) => [
      ...prev,
      ...paths.map((filePath) => ({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: getPathFileName(filePath),
        type: 'file' as const,
        path: filePath,
      })),
    ])
  }, [])

  const handleAddFiles = async () => {
    if (isMemberSession) return

    if (!isTauriRuntime()) {
      fileInputRef.current?.click()
      return
    }

    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        directory: false,
        title: addFilesLabel,
      })
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
      addPathAttachments(paths)
    } catch (error) {
      console.error('[ChatInput] Failed to choose attachment files:', error)
      fileInputRef.current?.click()
    }
  }

  const handleFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const filePath = getNonStandardFilePath(file)
      if (filePath) {
        addPathAttachments([filePath])
        return
      }

      if (!isInlineImageFile(file)) {
        useUIStore.getState().addToast({
          type: 'warning',
          message: t('chat.pathlessFileAttachment', { name: file.name }),
        })
        return
      }

      if (file.size > INLINE_IMAGE_MAX_BYTES) {
        useUIStore.getState().addToast({
          type: 'warning',
          message: t('chat.inlineImageTooLarge', { name: file.name }),
        })
        return
      }

      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: 'image',
            mimeType: file.type || undefined,
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    })
  }

  const insertTextAtCursor = useCallback((text: string) => {
    const sanitizedText = text.replace(/[\r\n]+/g, ' ')
    const el = textareaRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    const before = input.slice(0, start)
    const after = input.slice(end)
    const prefix = before && !/\s$/.test(before) ? ' ' : ''
    const suffix = after && !/^\s/.test(after) ? ' ' : ''
    const nextInput = `${before}${prefix}${sanitizedText}${suffix}${after}`
    const nextCursor = before.length + prefix.length + sanitizedText.length

    setInput(nextInput)
    requestAnimationFrame(() => {
      const target = textareaRef.current
      target?.focus()
      target?.setSelectionRange(nextCursor, nextCursor)
    })
  }, [input])

  const handleProjectFolderSelect = useCallback(async () => {
    if (isMemberSession) return
    setPlusMenuOpen(false)

    try {
      let selectedPath: string | null = null
      if (isTauriRuntime()) {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({
          directory: true,
          multiple: false,
          title: t('dirPicker.chooseProjectFolder'),
        })
        selectedPath = Array.isArray(selected) ? selected[0] ?? null : selected
      } else {
        selectedPath = window.prompt(t('dirPicker.chooseProjectFolder'))?.trim() || null
      }

      if (selectedPath) insertTextAtCursor(selectedPath)
    } catch (error) {
      console.error('[ChatInput] Failed to choose project folder:', error)
    }
  }, [insertTextAtCursor, isMemberSession, t])

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (isMemberSession) return
    const droppedPaths = getDroppedPaths(event.dataTransfer)
    if (droppedPaths.length > 0) {
      addPathAttachments(droppedPaths)
      return
    }

    const files = event.dataTransfer.files
    if (files.length > 0) {
      handleFiles(files)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const insertSlashCommand = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = insertSlashTrigger(input, cursorPos)
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const insertAtTrigger = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const newValue = `${input.slice(0, cursorPos)}@${input.slice(cursorPos)}`
    const newCursorPos = cursorPos + 1
    setInput(newValue)
    setPlusMenuOpen(false)
    setAtFilter('')
    setAtCursorPos(newCursorPos)
    setFileSearchOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
    })
  }

  const composerPlaceholder =
    isHeroComposer
      ? t('empty.placeholder')
      : isWorkspaceMissing
        ? t('chat.placeholderMissing')
        : isMemberSession
          ? t('teams.memberPlaceholder')
          : t('chat.placeholder')

  const addFilesLabel = isHeroComposer ? t('empty.addFiles') : t('chat.addFiles')
  const addProjectFolderLabel = t('dirPicker.chooseProjectFolder')
  const slashCommandsLabel = isHeroComposer ? t('empty.slashCommands') : t('chat.slashCommands')
  const showWorkDirControl = isHeroComposer && onWorkDirChange
  const composerToolButtonClassName = 'group relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-transparent text-[var(--color-text-tertiary)] transition-colors duration-100 hover:border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'

  return (
    <div className={isHeroComposer ? '' : 'wechat-input-container pointer-events-none flex justify-center p-[24px]'}>
      <div
        className={isHeroComposer ? 'relative w-full' : 'pointer-events-auto relative w-full max-w-[896px]'}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Slash / file search menus positioned above the input */}
        {!isMemberSession && fileSearchOpen && (
          <FileSearchMenu
            ref={fileSearchRef}
            cwd={resolvedWorkDir || ''}
            filter={atFilter}
            onSelect={(_path, name) => {
              if (atCursorPos >= 0) {
                const newValue = `${input.slice(0, atCursorPos)}${name}${input.slice(atCursorPos)}`
                const newCursorPos = atCursorPos + name.length
                setInput(newValue)
                setFileSearchOpen(false)
                setAtFilter('')
                setAtCursorPos(-1)
                void textareaRef.current?.focus()
                requestAnimationFrame(() => {
                  textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
                })
              }
            }}
          />
        )}

        {!isMemberSession && localSlashPanel && (
          <div ref={slashMenuRef}>
            <LocalSlashCommandPanel
              command={localSlashPanel}
              sessionId={activeTabId ?? undefined}
              projectPath={projectPath}
              cwd={resolvedWorkDir}
              commands={allSlashCommands}
              onClose={() => setLocalSlashPanel(null)}
            />
          </div>
        )}

        {!isMemberSession && slashMenuOpen && filteredCommands.length > 0 && (
          <div
            ref={slashMenuRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-[10px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]"
          >
            <div className="max-h-[320px] overflow-y-auto">
              {filteredCommands.map((command, index) => (
                <button
                  key={command.name}
                  ref={(el) => { slashItemRefs.current[index] = el }}
                  onClick={() => selectSlashCommand(command.name)}
                  onMouseEnter={() => setSlashSelectedIndex(index)}
                  className={`group flex min-h-[48px] w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[8px] text-left transition-colors ${
                    index === slashSelectedIndex
                      ? 'bg-[var(--color-surface-selected)]'
                      : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="flex h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-[8px] font-mono text-[12px] font-semibold text-[var(--color-text-primary)]">
                    /{command.name}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">/{command.name}</span>
                    <span className="mt-[2px] block truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">
                      {command.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-[6px] flex items-center gap-1.5 rounded-[16px] bg-[var(--color-surface-container-low)] px-[10px] py-[8px] text-[10px] font-medium text-[var(--color-text-tertiary)]">
              <kbd className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">Up/Down</kbd>
              <span>{t('chat.navigate')}</span>
              <kbd className="ml-2 rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">Enter</kbd>
              <span>{t('chat.select')}</span>
              <kbd className="ml-2 rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[9px] font-semibold">Esc</kbd>
              <span>{t('chat.dismiss')}</span>
            </div>
          </div>
        )}

        {showWorkDirControl && (
          <div className="mb-[8px] flex items-center justify-end gap-[12px] px-[4px]">
            <DirectoryPicker value={workDirProp || ''} onChange={onWorkDirChange} variant="pill" />
          </div>
        )}

        {/* ── WeChat Style Input ── */}
        <div className="flex w-full flex-col rounded-[28px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] pt-[12px] transition-colors duration-150 focus-within:border-[var(--color-border-focus)]">
          <div className="flex px-[8px]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              disabled={isWorkspaceMissing}
              rows={1}
              className="min-h-[50px] max-h-[200px] w-full flex-1 resize-none bg-transparent px-[8px] py-[8px] text-[15px] font-medium leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
            />
          </div>

          {/* Attachments inline */}
          {attachments.length > 0 && (
            <div className="px-[16px] pb-[8px]">
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            </div>
          )}

          <div className="flex items-center gap-[8px] px-[8px] pb-[8px] pt-[4px]">
            <div className="flex items-center gap-[12px]">
              <div className="relative flex items-center" ref={plusMenuRef}>
                {!isMemberSession && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPlusMenuOpen((v) => !v)}
                      aria-label="Open composer tools"
                      className={composerToolButtonClassName}
                    >
                      <Plus size={18} strokeWidth={2.5} />
                      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap">
                        {slashCommandsLabel}
                      </span>
                    </button>

                    {plusMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-[10px] w-[260px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]">
                        <button
                          onClick={insertSlashCommand}
                          className="group flex min-h-[54px] w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[8px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] font-mono text-[15px] font-semibold text-[var(--color-text-secondary)]">/</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{slashCommandsLabel}</span>
                            <span className="mt-[2px] block truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">{t('chat.select')}</span>
                          </span>
                        </button>
                        <button
                          onClick={insertAtTrigger}
                          className="group flex min-h-[54px] w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[8px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] font-mono text-[14px] font-semibold text-[var(--color-text-secondary)]">@</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{t('chat.addFileRef')}</span>
                            <span className="mt-[2px] block truncate text-[11px] font-medium text-[var(--color-text-tertiary)]">{t('fileSearch.attach')}</span>
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="relative flex items-center">
                {!isMemberSession && (
                  <button
                    type="button"
                    onClick={handleAddFiles}
                    aria-label={addFilesLabel}
                    className={composerToolButtonClassName}
                  >
                    <Paperclip size={16} strokeWidth={2.25} />
                    <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap">
                      {addFilesLabel}
                    </span>
                  </button>
                )}
              </div>

              <div className="relative flex items-center">
                {!isMemberSession && (
                  <button
                    type="button"
                    onClick={handleProjectFolderSelect}
                    aria-label={addProjectFolderLabel}
                    className={composerToolButtonClassName}
                  >
                    <Folder size={17} strokeWidth={2.2} />
                    <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap">
                      {addProjectFolderLabel}
                    </span>
                  </button>
                )}
              </div>

              {!isMemberSession && (
                <PermissionModeSelector variant="icon" />
              )}
            </div>

            <div className="ml-auto flex min-w-0 items-center justify-end gap-[8px] overflow-visible">
              <StreamingIndicator sessionId={activeTabId ?? undefined} />

              {runtimeKey && !isMemberSession && (
                <div className="min-w-0 shrink">
                  <ModelSelector
                    runtimeKey={runtimeKey}
                    disabled={isActive}
                    placement="top"
                    align="right"
                    compact
                    variant="pill"
                    openSignal={modelSelectorOpenSignal || undefined}
                  />
                </div>
              )}

              {!isMemberSession && (
                <>
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => stopGeneration(activeTabId!)}
                      title={t('chat.stopTitle')}
                      aria-label={t('chat.stopTitle')}
                      className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-inverse-surface)] hover:text-[var(--color-inverse-on-surface)]"
                    >
                      <Square size={16} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      onMouseDown={handleSubmitMouseDown}
                      disabled={!canSubmit}
                      aria-label={t('common.run')}
                      className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full transition-colors ${
                        canSubmit
                          ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--color-inverse-surface)] hover:text-[var(--color-inverse-on-surface)]'
                          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] cursor-not-allowed'
                      }`}
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </button>
                  )}
                </>
              )}
              {isMemberSession && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  onMouseDown={handleSubmitMouseDown}
                  disabled={!canSubmit}
                  aria-label={t('common.run')}
                  className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full transition-colors ${
                    canSubmit
                      ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--color-inverse-surface)] hover:text-[var(--color-inverse-on-surface)]'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] cursor-not-allowed'
                  }`}
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}
