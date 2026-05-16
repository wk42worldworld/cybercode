import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

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
import { Icon } from '../shared/Icon'
import type { AttachmentRef } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import { ThinkingIndicator } from './ThinkingIndicator'
import { StreamingIndicator } from './StreamingIndicator'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveSlashUiAction,
} from './composerUtils'

type GitInfo = { branch: string | null; repoName: string | null; workDir: string; changedFiles: number }

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

type ChatInputProps = {
  variant?: 'default' | 'hero'
  sessionId?: string
  projectPath?: string
  onSubmit?: (text: string, attachments: AttachmentRef[]) => void
  workDir?: string
  onWorkDirChange?: (dir: string) => void
  runtimeKey?: string
  thinkingContent?: string
}

const THINKING_DISPLAY_GRACE_MS = 3200

export function ChatInput({ variant = 'default', sessionId: sessionIdProp, projectPath, onSubmit: onSubmitProp, workDir: workDirProp, onWorkDirChange, runtimeKey, thinkingContent }: ChatInputProps) {
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
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [cachedThinkingContent, setCachedThinkingContent] = useState('')
  const thinkingClearTimerRef = useRef<number | null>(null)
  const { sendMessage, stopGeneration } = useChatStore()
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
  const hasIncomingThinkingContent = !!thinkingContent?.trim()
  const liveThinkingContent = isActive && hasIncomingThinkingContent ? thinkingContent : ''
  const visibleThinkingContent = liveThinkingContent || cachedThinkingContent

  const clearThinkingCacheTimer = useCallback(() => {
    if (thinkingClearTimerRef.current === null) return
    window.clearTimeout(thinkingClearTimerRef.current)
    thinkingClearTimerRef.current = null
  }, [])

  const scheduleThinkingCacheClear = useCallback(() => {
    if (thinkingClearTimerRef.current !== null) return
    thinkingClearTimerRef.current = window.setTimeout(() => {
      setCachedThinkingContent('')
      thinkingClearTimerRef.current = null
    }, THINKING_DISPLAY_GRACE_MS)
  }, [])

  useEffect(() => {
    clearThinkingCacheTimer()
    setCachedThinkingContent('')
  }, [activeTabId, clearThinkingCacheTimer])

  useEffect(() => {
    if (!thinkingContent?.trim()) return
    setCachedThinkingContent(thinkingContent)

    if (isActive) {
      clearThinkingCacheTimer()
      return
    }

    scheduleThinkingCacheClear()
  }, [
    thinkingContent,
    isActive,
    clearThinkingCacheTimer,
    scheduleThinkingCacheClear,
  ])

  useEffect(() => {
    if (hasIncomingThinkingContent || !cachedThinkingContent) return
    scheduleThinkingCacheClear()
  }, [hasIncomingThinkingContent, cachedThinkingContent, scheduleThinkingCacheClear])

  useEffect(() => clearThinkingCacheTimer, [clearThinkingCacheTimer])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    if (!composerPrefill) return

    setInput(composerPrefill.text)
    setAttachments(
      (composerPrefill.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' || attachment.data)
        .map((attachment, index) => ({
          id: `rewind-prefill-${composerPrefill.nonce}-${index}`,
          name: attachment.name,
          type: attachment.type,
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
    const minHeight = 100
    const maxHeight = 160
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
    const text = input.trim()
    if ((!text && (!attachments.length || isMemberSession)) || isWorkspaceMissing) return

    const slashUiAction = !isMemberSession && text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
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

    const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      data: attachment.data,
      mimeType: attachment.mimeType,
    }))

    if (onSubmitProp) {
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

    Array.from(files).forEach((file) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith('image/')
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: isImage ? 'image' : 'file',
            mimeType: file.type || undefined,
            previewUrl: isImage ? (reader.result as string) : undefined,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (isMemberSession) return
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const insertSlashCommand = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, '', { trailingSpace: false })
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
  const slashCommandsLabel = isHeroComposer ? t('empty.slashCommands') : t('chat.slashCommands')

  return (
    <div className={isHeroComposer ? '' : 'shrink-0 wechat-input-container'}>
      <div className="w-full relative" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
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
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-[20px] border border-white/50 dark:border-white/10 bg-white/80 dark:bg-black/80 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
          >
            <div className="max-h-[300px] overflow-y-auto py-1">
              {filteredCommands.map((command, index) => (
                <button
                  key={command.name}
                  ref={(el) => { slashItemRefs.current[index] = el }}
                  onClick={() => selectSlashCommand(command.name)}
                  onMouseEnter={() => setSlashSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    index === slashSelectedIndex
                      ? 'bg-black/5 dark:bg-white/5'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="shrink-0 text-[13px] font-semibold text-black/70 dark:text-white/70 font-mono">
                    /{command.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-black/50 dark:text-white/50">
                    {command.description}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 border-t border-black/5 dark:border-white/10 px-4 py-2 text-[10px] text-black/40 dark:text-white/40">
              <kbd className="rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Up/Down</kbd>
              <span>{t('chat.navigate')}</span>
              <kbd className="ml-2 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Enter</kbd>
              <span>{t('chat.select')}</span>
              <kbd className="ml-2 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Esc</kbd>
              <span>{t('chat.dismiss')}</span>
            </div>
          </div>
        )}

        {/* ── WeChat Style Input ── */}
        <div className="flex flex-col bg-[var(--color-background)]">
          {/* Top Toolbar — grid layout keeps center truly centered regardless of left/right content */}
          <div className="grid grid-cols-[2.5rem_2.5rem_1fr_2.5rem] px-3 h-12">
            {/* Left: + button (slash commands & @) */}
            <div className="relative flex items-center" ref={plusMenuRef}>
              {!isMemberSession && !isHeroComposer && (
                <>
                  <button
                    onClick={() => setPlusMenuOpen((v) => !v)}
                    aria-label="Open composer tools"
                    className="group relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-hover)] transition-all text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    <Icon name="add" size={18} />
                    <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap">
                      {slashCommandsLabel}
                    </span>
                  </button>

                  {plusMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-[220px] rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-background)] py-1 shadow-[var(--shadow-dropdown)]">
                      <button
                        onClick={insertSlashCommand}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="text-[14px] font-bold text-[var(--color-text-secondary)] font-mono">/</span>
                        <span className="text-[13px] text-[var(--color-text-primary)]">{slashCommandsLabel}</span>
                      </button>
                      <button
                        onClick={insertAtTrigger}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="text-[14px] font-bold text-[var(--color-text-secondary)] font-mono">@</span>
                        <span className="text-[13px] text-[var(--color-text-primary)]">{t('chat.addFileRef')}</span>
                      </button>
                      <div className="px-3 py-2 border-t border-[var(--color-border-separator)]">
                        <PermissionModeSelector />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Attach file button */}
            <div className="relative flex items-center">
              {!isMemberSession && !isHeroComposer && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={addFilesLabel}
                  className="group relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-hover)] transition-all text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  <Icon name="attach_file" size={16} />
                  <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 rounded-md bg-[var(--color-inverse-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-inverse-on-surface)] opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 whitespace-nowrap">
                    {addFilesLabel}
                  </span>
                </button>
              )}
            </div>

            {/* Center: Thinking / Streaming indicator */}
            <div className="flex min-w-0 items-center justify-center gap-2 overflow-hidden py-2">
              <StreamingIndicator sessionId={activeTabId ?? undefined} />
              {visibleThinkingContent && (
                <>
                  {isActive && (
                    <span className="h-3 w-px shrink-0 bg-[var(--color-border-separator)]" />
                  )}
                  <ThinkingIndicator content={visibleThinkingContent} showDot={false} />
                </>
              )}
            </div>

            {/* Right: empty placeholder to balance the grid */}
            <div />
          </div>

          {/* Textarea area */}
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
            rows={3}
            className="w-full flex-1 resize-none bg-transparent outline-none text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] px-4 py-3 leading-relaxed disabled:opacity-50 min-h-[100px]"
          />

          {/* Attachments inline */}
          {attachments.length > 0 && (
            <div className="px-4 pb-2">
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            </div>
          )}

          {/* ── Bottom Toolbar ── */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              {isHeroComposer && onWorkDirChange && (
                <DirectoryPicker value={workDirProp || ''} onChange={onWorkDirChange} />
              )}
              {runtimeKey && !isMemberSession && (
                <ModelSelector runtimeKey={runtimeKey} placement="top" align="left" compact />
              )}
            </div>

            {/* Right: Send / Stop */}
            <div className="flex items-center">
              {!isMemberSession && (
                <>
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => stopGeneration(activeTabId!)}
                      title={t('chat.stopTitle')}
                      aria-label={t('chat.stopTitle')}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] hover:bg-[var(--color-btn-primary-bg-hover)] transition-all"
                    >
                      <Icon name="stop_circle" size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      aria-label={t('common.run')}
                      className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
                        canSubmit
                          ? 'bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] hover:bg-[var(--color-btn-primary-bg-hover)]'
                          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] cursor-not-allowed'
                      }`}
                    >
                      <Icon name="arrow_upward" size={14} />
                    </button>
                  )}
                </>
              )}
              {isMemberSession && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  aria-label={t('common.run')}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
                    canSubmit
                      ? 'bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] hover:bg-[var(--color-btn-primary-bg-hover)]'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] cursor-not-allowed'
                  }`}
                >
                  <Icon name="arrow_upward" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hero variant: hints below input */}
        {isHeroComposer && !isMemberSession && (
          <div className="mt-2 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] text-black/40 dark:text-white/40">
              <span className="font-mono font-semibold">/</span>
              <span>{t('chat.hintCommand')}</span>
              <span className="text-black/20 dark:text-white/20 mx-1">&middot;</span>
              <span className="font-mono font-semibold">@</span>
              <span>{t('chat.hintFile')}</span>
              <span className="text-black/20 dark:text-white/20 mx-1">&middot;</span>
              <span className="font-mono font-semibold">&#8984;K</span>
              <span>{t('chat.hintSettings')}</span>
            </div>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}
