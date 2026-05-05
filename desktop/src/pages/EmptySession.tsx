import { useEffect, useMemo, useRef, useState } from 'react'

import { skillsApi } from '../api/skills'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useProviderStore } from '../stores/providerStore'
import { useSessionRuntimeStore, DRAFT_RUNTIME_SELECTION_KEY } from '../stores/sessionRuntimeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useTabStore } from '../stores/tabStore'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../constants/modelCatalog'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { PermissionModeSelector } from '../components/controls/PermissionModeSelector'
import { ModelSelector } from '../components/controls/ModelSelector'
import { AttachmentGallery } from '../components/chat/AttachmentGallery'
import { FileSearchMenu, type FileSearchMenuHandle } from '../components/chat/FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from '../components/chat/LocalSlashCommandPanel'
import {
  FALLBACK_SLASH_COMMANDS,
  findSlashToken,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashCommand,
  resolveSlashUiAction,
} from '../components/chat/composerUtils'
import type { AttachmentRef } from '../types/chat'
import type { SlashCommandOption } from '../components/chat/composerUtils'
import { Icon } from '../components/shared/Icon'

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

export function EmptySession() {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workDir, setWorkDir] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashCommands, setSlashCommands] = useState<SlashCommandOption[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const createSession = useSessionStore((state) => state.createSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const connectToSession = useChatStore((state) => state.connectToSession)
  const setActiveView = useUIStore((state) => state.setActiveView)
  const addToast = useUIStore((state) => state.addToast)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

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

  useEffect(() => {
    let cancelled = false

    skillsApi.list(workDir || undefined)
      .then(({ skills }) => {
        if (cancelled) return
        setSlashCommands(
          skills
            .filter((skill) => skill.userInvocable)
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setSlashCommands([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [workDir])

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

  const handleSubmit = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isSubmitting) return

    const slashUiAction = text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
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

    setIsSubmitting(true)
    try {
      const settings = useSettingsStore.getState()
      let providerState = useProviderStore.getState()
      if (
        settings.activeProviderName &&
        providerState.providers.length === 0 &&
        !providerState.isLoading
      ) {
        await providerState.fetchProviders()
        providerState = useProviderStore.getState()
      }
      const inferredProviderId = providerState.activeId ?? (
        settings.activeProviderName
          ? providerState.providers.find((provider) => provider.name === settings.activeProviderName)?.id ?? null
          : null
      )
      const draftSelection =
        useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]
        ?? {
          providerId: inferredProviderId,
          modelId: settings.currentModel?.id ?? OFFICIAL_DEFAULT_MODEL_ID,
        }
      const sessionId = await createSession(workDir || undefined)
      useSessionRuntimeStore.getState().setSelection(sessionId, draftSelection)
      useSessionRuntimeStore.getState().clearSelection(DRAFT_RUNTIME_SELECTION_KEY)
      setActiveView('code')
      const { activeTabId: curTabId } = useTabStore.getState()
      if (curTabId) {
        useTabStore.getState().replaceTabSession(curTabId, sessionId)
      } else {
        useTabStore.getState().openTab(sessionId, 'New Session')
      }
      connectToSession(sessionId)
      const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }))
      sendMessage(sessionId, text, attachmentPayload)
      setInput('')
      setAttachments([])
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (value: string, cursorPos: number) => {
    setInput(value)
    const token = findSlashToken(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
    } else {
      setSlashFilter(token.filter)
      setSlashMenuOpen(true)
    }

    // Detect @ trigger for file search
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
    } else {
      setAtFilter(textBeforeCursor.slice(pos + 1))
      setAtCursorPos(cursorPos)
      setSlashMenuOpen(false)
      setFileSearchOpen(true)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (event.nativeEvent.isComposing) return

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
      return
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
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (
          event.key === 'Enter' &&
          exactSlashCommand &&
          slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()
        ) {
          event.preventDefault()
          void handleSubmit()
          return
        }
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
            mimeType: file.type || undefined,
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
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const selectSlashCommand = (command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashCommand(input, cursorPos, command)
    if (!replacement) return
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const insertSlashCommand = () => {
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

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden transition-colors duration-300">
      <div className="h-8 shrink-0" data-tauri-drag-region />

      {/* One centered column — hero + composer + meta. Cursor / ChatGPT style. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 md:px-12 overflow-y-auto">
        <div className="w-full max-w-[640px] flex flex-col">
          {/* Hero */}
          <div className="flex flex-col items-center text-center mb-8">
            <img src="/app-icon.png" alt="CyberCode" className="mb-5 h-[88px] w-[88px] rounded-[8px]" />
            <h1
              className="mb-2 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-black/90 dark:text-white/90"
            >
              {t('empty.title')}
            </h1>
            <p
              className="max-w-[420px] text-[14px] leading-[1.6] text-black/70 dark:text-white/70"
            >
              {t('empty.subtitle')}
            </p>
          </div>

          {/* Composer pill */}
          <div
            className="relative"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {fileSearchOpen && (
              <FileSearchMenu
                ref={fileSearchRef}
                cwd={workDir || ''}
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

            {localSlashPanel && (
              <div ref={slashMenuRef}>
                <LocalSlashCommandPanel
                  command={localSlashPanel}
                  cwd={workDir || undefined}
                  commands={allSlashCommands}
                  onClose={() => setLocalSlashPanel(null)}
                />
              </div>
            )}

            {slashMenuOpen && filteredCommands.length > 0 && (
              <div
                ref={slashMenuRef}
                className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white dark:bg-[#0A0A0A]"
                style={{ boxShadow: 'var(--shadow-dropdown)' }}
              >
                <div className="max-h-[260px] overflow-y-auto py-1">
                  {filteredCommands.map((command, index) => (
                    <button
                      key={command.name}
                      ref={(el) => { slashItemRefs.current[index] = el }}
                      onClick={() => selectSlashCommand(command.name)}
                      onMouseEnter={() => setSlashSelectedIndex(index)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === slashSelectedIndex ? 'bg-black/5 dark:bg-white/5' : 'hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <span className="shrink-0 text-[13px] font-semibold text-black/90 dark:text-white/90 font-mono">/{command.name}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-black/60 dark:text-white/60">{command.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="mb-2">
                <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
              </div>
            )}

            {/* Glass pill — same as ChatInput default variant */}
            <div className="flex flex-col bg-white dark:bg-[#111] rounded-lg p-4 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_60px_-10px_rgba(0,0,0,0.55)] border-2 border-black/15 dark:border-white/20 focus-within:border-black/30 dark:focus-within:border-white/35 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => handleInputChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={t('empty.placeholder')}
                rows={2}
                className="w-full resize-none bg-transparent outline-none text-[13px] font-medium text-black/90 dark:text-white/90 placeholder:text-black/55 dark:placeholder:text-white/70 placeholder:text-[13px] leading-relaxed tracking-tight"
              />

              <div className="flex items-center justify-between gap-2 mt-3">
                {/* Left: + button, permission, separator, directory */}
                <div className="flex items-center gap-1 min-w-0">
                  <div ref={plusMenuRef} className="relative shrink-0">
                    <button
                      onClick={() => setPlusMenuOpen((prev) => !prev)}
                      aria-label="Open composer tools"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-black/65 dark:text-white/65 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] hover:text-black/80 dark:hover:text-white/80 transition-colors"
                    >
                      <Icon name="add" size={18} />
                    </button>
                    {plusMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white/90 dark:bg-[#0A0A0A]/90 backdrop-blur py-1" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                        <button onClick={() => { fileInputRef.current?.click(); setPlusMenuOpen(false) }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                          <Icon name="attach_file" size={18} className="text-black/60 dark:text-white/60" />
                          <span className="text-[13px] text-black/90 dark:text-white/90">{t('empty.addFiles')}</span>
                        </button>
                        <button onClick={insertSlashCommand} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                          <span className="w-[24px] text-center text-[18px] font-bold text-black/60 dark:text-white/60 font-mono">/</span>
                          <span className="text-[13px] text-black/90 dark:text-white/90">{t('empty.slashCommands')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <PermissionModeSelector workDir={workDir} />
                  <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 mx-0.5 shrink-0" />
                  <DirectoryPicker value={workDir} onChange={setWorkDir} />
                </div>

                {/* Right: model selector + send */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <ModelSelector runtimeKey={DRAFT_RUNTIME_SELECTION_KEY} disabled={isSubmitting} />
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={(!input.trim() && attachments.length === 0) || isSubmitting}
                    aria-label={t('common.run')}
                    className="h-8 w-8 flex items-center justify-center rounded-full border transition-all disabled:opacity-40 bg-black/[0.06] dark:bg-white/[0.08] text-black/70 dark:text-white/70 border-transparent hover:bg-black/80 hover:text-white dark:hover:bg-white/80 dark:hover:text-black"
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-black/70 dark:text-white/70">
            <span><kbd className="font-mono opacity-90">⏎</kbd> Send</span>
            <span className="opacity-30">·</span>
            <span><kbd className="font-mono opacity-90">⇧⏎</kbd> Newline</span>
            <span className="opacity-30">·</span>
            <span><kbd className="font-mono opacity-90">/</kbd> Commands</span>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

