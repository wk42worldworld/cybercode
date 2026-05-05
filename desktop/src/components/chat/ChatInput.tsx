import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useTeamStore } from '../../stores/teamStore'
import { sessionsApi } from '../../api/sessions'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import type { AttachmentRef } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveSlashUiAction,
} from './composerUtils'
import { Icon } from '../shared/Icon'

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
}

export function ChatInput({ variant = 'default' }: ChatInputProps) {
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
  const { sendMessage, stopGeneration } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const slashCommands = sessionState?.slashCommands ?? []
  const composerPrefill = sessionState?.composerPrefill ?? null
  const activeSession = useSessionStore((state) => activeTabId ? state.sessions.find((session) => session.id === activeTabId) ?? null : null)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const hasMessages = useChatStore((s) => activeTabId ? (s.sessions[activeTabId]?.messages?.length ?? 0) > 0 : false)

  const isMemberSession = !!memberInfo
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.workDirExists === false
  const canSubmit = !isWorkspaceMissing && (input.trim().length > 0 || (!isMemberSession && attachments.length > 0))
  const isHeroComposer = variant === 'hero' && !isMemberSession
  const resolvedWorkDir = activeSession?.workDir || gitInfo?.workDir || undefined

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
    sessionsApi.getGitInfo(activeTabId).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, isMemberSession])

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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
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

  // Detect @ trigger (file search)
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

    // Extract filter text after @
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

    sendMessage(activeTabId!, text, attachmentPayload)
    setInput('')
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

    // Route file search navigation keys to FileSearchMenu
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
      // Other keys (typing) should go to the textarea - let it propagate
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
    <div className={isHeroComposer ? '' : 'px-4 md:px-8 pt-3 pb-8'}>
      <div className={isHeroComposer ? 'w-full' : 'mx-auto w-full max-w-3xl flex flex-col'}>
        {/* Input area */}
        <div
          className="relative"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
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
                cwd={resolvedWorkDir}
                commands={allSlashCommands}
                onClose={() => setLocalSlashPanel(null)}
              />
            </div>
          )}

          {!isMemberSession && slashMenuOpen && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white/90 dark:bg-[#0A0A0A]/90 backdrop-blur"
              style={{ boxShadow: 'var(--shadow-dropdown)' }}
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
                    <span className="shrink-0 text-[13px] font-semibold text-black/90 dark:text-white/90 font-mono">
                      /{command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-black/60 dark:text-white/60">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-black/[0.10] dark:border-white/[0.10] px-4 py-2 text-[10px] text-black/60 dark:text-white/60">
                <kbd className="rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Up/Down</kbd>
                <span>{t('chat.navigate')}</span>
                <kbd className="ml-2 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Enter</kbd>
                <span>{t('chat.select')}</span>
                <kbd className="ml-2 rounded border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] font-bold">Esc</kbd>
                <span>{t('chat.dismiss')}</span>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mb-2">
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            </div>
          )}

          {/* === Glass pill (default variant) === */}
          {!isHeroComposer && (
            <div className="flex flex-col bg-white dark:bg-[#111] rounded-lg p-4 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_60px_-10px_rgba(0,0,0,0.55)] border-2 border-black/15 dark:border-white/25 focus-within:border-black/30 dark:focus-within:border-white/40 transition-all relative">
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
                rows={2}
                className="w-full resize-none bg-transparent outline-none text-[13px] font-medium text-black/90 dark:text-white/90 placeholder:text-black/55 dark:placeholder:text-white/70 placeholder:text-[13px] leading-relaxed tracking-tight disabled:opacity-50"
              />

              {!isMemberSession && (
                <div className="flex items-center justify-between gap-2 mt-3">
                  <div className="flex items-center gap-1 min-w-0">
                    <div ref={plusMenuRef} className="relative shrink-0">
                      <button
                        onClick={() => setPlusMenuOpen((value) => !value)}
                        aria-label="Open composer tools"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-black/65 dark:text-white/65 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] hover:text-black/80 dark:hover:text-white/80 transition-colors"
                      >
                        <Icon name="add" size={18} />
                      </button>

                      {plusMenuOpen && (
                        <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white/90 dark:bg-[#0A0A0A]/90 backdrop-blur py-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                          <button
                            onClick={() => { fileInputRef.current?.click(); setPlusMenuOpen(false) }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <Icon name="attach_file" size={18} className="text-black/60 dark:text-white/60" />
                            <span className="text-[13px] text-black/90 dark:text-white/90">{addFilesLabel}</span>
                          </button>
                          <button
                            onClick={insertSlashCommand}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <span className="w-[24px] text-center text-[18px] font-bold text-black/60 dark:text-white/60 font-mono">/</span>
                            <span className="text-[13px] text-black/90 dark:text-white/90">{slashCommandsLabel}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <PermissionModeSelector />
                    <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 mx-0.5 shrink-0" />
                    <DirectoryPicker
                      value={resolvedWorkDir || ''}
                      onChange={async (newWorkDir) => {
                        if (!activeTabId) return
                        if (newWorkDir === resolvedWorkDir) return
                        const oldId = activeTabId
                        const { createSession, deleteSession } = useSessionStore.getState()
                        const { openTab, setActiveTab, replaceTabSession } = useTabStore.getState()
                        const { disconnectSession, connectToSession } = useChatStore.getState()
                        const newId = await createSession(newWorkDir)
                        if (hasMessages) {
                          const folderName = newWorkDir.split('/').pop() || newWorkDir
                          openTab(newId, folderName)
                          setActiveTab(newId)
                          connectToSession(newId)
                        } else {
                          useSessionRuntimeStore.getState().moveSelection(oldId, newId)
                          disconnectSession(oldId)
                          replaceTabSession(oldId, newId)
                          connectToSession(newId)
                          deleteSession(oldId).catch(() => {})
                        }
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeTabId && (
                      <ModelSelector runtimeKey={activeTabId} disabled={isActive} />
                    )}
                    <button
                      type="button"
                      onClick={isActive ? () => stopGeneration(activeTabId!) : handleSubmit}
                      disabled={isActive ? false : !canSubmit}
                      title={isActive ? t('chat.stopTitle') : undefined}
                      aria-label={isActive ? undefined : t('common.run')}
                      className={`h-8 w-8 flex items-center justify-center rounded-full border transition-all disabled:opacity-40 ${
                        isActive
                          ? 'bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25'
                          : 'bg-black/[0.06] dark:bg-white/[0.08] text-black/70 dark:text-white/70 border-transparent hover:bg-black/80 hover:text-white dark:hover:bg-white/80 dark:hover:text-black'
                      }`}
                    >
                      {isActive ? (
                        <Icon name="stop" size={15} className="leading-none" />
                      ) : <SendIcon />}
                    </button>
                  </div>
                </div>
              )}

              {isMemberSession && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  aria-label={t('common.run')}
                  className="absolute right-4 bottom-4 p-2 rounded-md shadow-md bg-black text-white dark:bg-white dark:text-black disabled:opacity-20 transition-all"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          )}

          {/* === Hero variant (unchanged) === */}
          {isHeroComposer && (
            <>
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
                className="w-full bg-black/[0.04] dark:bg-white/[0.04] border-2 border-black/[0.10] dark:border-white/[0.12] hover:border-black/20 dark:hover:border-white/25 focus:border-black/30 dark:focus:border-white/40 rounded-lg px-5 py-4 pr-14 text-[13px] leading-[1.6] text-black/90 dark:text-white outline-none placeholder:text-black/55 dark:placeholder:text-white/65 disabled:opacity-50 transition-all resize-none"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-label={t('common.run')}
                className="absolute right-3 bottom-3 p-2 rounded-md shadow-md bg-black text-white dark:bg-white dark:text-black disabled:opacity-20 transition-all"
              >
                <SendIcon />
              </button>
            </>
          )}
        </div>

        {/* Tools row — hero variant only (default has tools inside the glass pill) */}
        {isHeroComposer && !isMemberSession && (
          <div className="mt-3 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <div ref={plusMenuRef} className="relative">
                <button
                  onClick={() => setPlusMenuOpen((value) => !value)}
                  aria-label="Open composer tools"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-black/70 dark:text-white/70 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-black/90 dark:hover:text-white/90 transition-colors"
                >
                  <Icon name="add" size={18} />
                </button>

                {plusMenuOpen && (
                  <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white dark:bg-[#0A0A0A] py-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                    <button
                      onClick={() => {
                        fileInputRef.current?.click()
                        setPlusMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Icon name="attach_file" size={18} className="text-black/60 dark:text-white/60" />
                      <span className="text-[13px] text-black/90 dark:text-white/90">{addFilesLabel}</span>
                    </button>
                    <button
                      onClick={insertSlashCommand}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <span className="w-[24px] text-center text-[18px] font-bold text-black/60 dark:text-white/60 font-mono">/</span>
                      <span className="text-[13px] text-black/90 dark:text-white/90">{slashCommandsLabel}</span>
                    </button>
                  </div>
                )}
              </div>

              <PermissionModeSelector />
            </div>

            {activeTabId && (
              <ModelSelector runtimeKey={activeTabId} disabled={isActive} />
            )}
          </div>
        )}

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

        {/* Directory picker for hero variant only — default pill has it inline above */}
        {isHeroComposer && !isMemberSession && (
          <div className="px-1">
            <DirectoryPicker
              value={resolvedWorkDir || ''}
              onChange={async (newWorkDir) => {
                if (!activeTabId) return
                if (newWorkDir === resolvedWorkDir) return

                const oldId = activeTabId
                const { createSession, deleteSession } = useSessionStore.getState()
                const { openTab, setActiveTab, replaceTabSession } = useTabStore.getState()
                const { disconnectSession, connectToSession } = useChatStore.getState()
                const newId = await createSession(newWorkDir)

                if (hasMessages) {
                  const folderName = newWorkDir.split('/').pop() || newWorkDir
                  openTab(newId, folderName)
                  setActiveTab(newId)
                  connectToSession(newId)
                } else {
                  useSessionRuntimeStore.getState().moveSelection(oldId, newId)
                  disconnectSession(oldId)
                  replaceTabSession(oldId, newId)
                  connectToSession(newId)
                  deleteSession(oldId).catch(() => {})
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

