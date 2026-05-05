import { forwardRef, useRef, useState, useEffect, useCallback } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'
import { WindowControls, showWindowControls } from './WindowControls'
import { Icon } from '../shared/Icon'

const TAB_WIDTH = 180
const DRAG_START_THRESHOLD = 4
const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)

  const moveTab = useTabStore((s) => s.moveTab)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const dragIndexRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ index: number; startX: number; startY: number } | null>(null)
  const suppressClickRef = useRef(false)
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>())
  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)
  const t = useTranslation()

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState)
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState, tabs.length])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -TAB_WIDTH : TAB_WIDTH, behavior: 'smooth' })
  }

  const handleClose = (sessionId: string) => {
    // Special tabs can always be closed directly
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (!tab) return
    if (tab.type !== 'session') {
      closeTab(sessionId)
      return
    }

    const sessionState = useChatStore.getState().sessions[sessionId]
    const isRunning = sessionState && sessionState.chatState !== 'idle'

    if (isRunning) {
      setClosingTabId(sessionId)
      return
    }

    disconnectSession(sessionId)
    closeTab(sessionId)
  }

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY })
  }

  const handleCloseOthers = (sessionId: string) => {
    setContextMenu(null)
    const otherTabs = sessionTabs.filter((t) => t.sessionId !== sessionId)
    for (const tab of otherTabs) {
      disconnectSession(tab.sessionId)
      closeTab(tab.sessionId)
    }
  }

  const handleCloseLeft = (sessionId: string) => {
    setContextMenu(null)
    const idx = sessionTabs.findIndex((t) => t.sessionId === sessionId)
    const leftTabs = sessionTabs.slice(0, idx)
    for (const tab of leftTabs) {
      disconnectSession(tab.sessionId)
      closeTab(tab.sessionId)
    }
  }

  const handleCloseRight = (sessionId: string) => {
    setContextMenu(null)
    const idx = sessionTabs.findIndex((t) => t.sessionId === sessionId)
    const rightTabs = sessionTabs.slice(idx + 1)
    for (const tab of rightTabs) {
      disconnectSession(tab.sessionId)
      closeTab(tab.sessionId)
    }
  }

  const handleCloseAll = () => {
    setContextMenu(null)
    for (const tab of sessionTabs) {
      disconnectSession(tab.sessionId)
      closeTab(tab.sessionId)
    }
  }

  const getTargetIndexFromClientX = useCallback((clientX: number) => {
    for (let index = 0; index < sessionTabs.length; index++) {
      const tab = sessionTabs[index]
      if (!tab) continue
      const el = tabRefs.current.get(tab.sessionId)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) return index
    }

    return tabs.length > 0 ? tabs.length - 1 : null
  }, [tabs])

  const finalizeDrag = useCallback((targetIndex: number | null) => {
    if (dragIndexRef.current !== null && targetIndex !== null && dragIndexRef.current !== targetIndex) {
      moveTab(dragIndexRef.current, targetIndex)
    }
    dragIndexRef.current = null
    pendingDragRef.current = null
    setDraggingSessionId(null)
    setDragOffsetX(0)
    setDragOverIndex(null)
  }, [moveTab])

  const handlePointerMove = useCallback((event: MouseEvent) => {
    const pending = pendingDragRef.current
    if (!pending) return

    const deltaX = Math.abs(event.clientX - pending.startX)
    const deltaY = Math.abs(event.clientY - pending.startY)

    if (dragIndexRef.current === null) {
      if (Math.max(deltaX, deltaY) < DRAG_START_THRESHOLD) return
      dragIndexRef.current = pending.index
      suppressClickRef.current = true
      setDraggingSessionId(sessionTabs[pending.index]?.sessionId ?? null)
    }

    setDragOffsetX(event.clientX - pending.startX)

    const targetIndex = getTargetIndexFromClientX(event.clientX)
    if (targetIndex === null || targetIndex === dragIndexRef.current) {
      setDragOverIndex(null)
      return
    }

    setDragOverIndex(targetIndex)
  }, [getTargetIndexFromClientX])

  const handlePointerUp = useCallback(() => {
    finalizeDrag(dragOverIndex)
  }, [dragOverIndex, finalizeDrag])

  useEffect(() => {
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  useEffect(() => {
    if (!draggingSessionId) return
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = previousCursor
    }
  }, [draggingSessionId])

  const handleTabMouseDown = (event: React.MouseEvent, index: number) => {
    if (event.button !== 0) return
    pendingDragRef.current = { index, startX: event.clientX, startY: event.clientY }
  }

  const handleTabClick = (sessionId: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setActiveTab(sessionId)
  }

  const handleScrollRegionMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== scrollRef.current) return
    const startDragging = startDraggingRef.current
    if (!startDragging) return
    void startDragging().catch(() => {})
  }, [])

  const sessionTabs = tabs.filter((t) => t.type === 'session')

  if (sessionTabs.length <= 1) return null

  return (
    <div
      data-testid="tab-bar"
      className="flex items-stretch bg-white/90 dark:bg-[#050505] min-h-[40px] select-none border-b border-black/[0.12] dark:border-white/[0.12]"
    >

      {canScrollLeft && (
        <button onClick={() => scroll('left')} className="flex-shrink-0 w-7 h-[40px] flex items-center justify-center rounded-full text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <Icon name="chevron_left" size={16} />
        </button>
      )}

      <div
        ref={scrollRef}
        className="tab-bar-hit-area flex-1 flex items-stretch overflow-x-hidden gap-1 px-1 py-1"
        onDragOver={(e) => e.preventDefault()}
        onMouseDown={handleScrollRegionMouseDown}
      >
        {sessionTabs.map((tab, index) => (
          <TabItem
            key={tab.sessionId}
            ref={(node) => { tabRefs.current.set(tab.sessionId, node) }}
            tab={tab}
            isActive={tab.sessionId === activeTabId}
            isDragOver={dragOverIndex === index}
            isDragging={tab.sessionId === draggingSessionId}
            dragOffsetX={tab.sessionId === draggingSessionId ? dragOffsetX : 0}
            onClick={() => handleTabClick(tab.sessionId)}
            onClose={() => handleClose(tab.sessionId)}
            onContextMenu={(e) => handleContextMenu(e, tab.sessionId)}
            onMouseDown={(event) => handleTabMouseDown(event, index)}
          />
        ))}
      </div>

      {isTauri && (
        <div
          data-testid="tab-bar-drag-gutter"
          data-tauri-drag-region
          aria-hidden="true"
          className={`flex-shrink-0 min-h-[40px] ${showWindowControls ? 'w-3' : 'w-4'}`}
        />
      )}

      {canScrollRight && (
        <button onClick={() => scroll('right')} className="flex-shrink-0 w-7 h-[40px] flex items-center justify-center rounded-full text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <Icon name="chevron_right" size={16} />
        </button>
      )}

      <WindowControls />

      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--color-surface)] border-2 border-[var(--color-border)] rounded-[5px] py-1 min-w-[160px] backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => { handleClose(contextMenu.sessionId); setContextMenu(null) }}
            className="w-full px-3 py-2 text-[12px] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('tabs.close')}
          </button>
          <button
            onClick={() => handleCloseOthers(contextMenu.sessionId)}
            className="w-full px-3 py-2 text-[12px] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('tabs.closeOthers')}
          </button>
          <button
            onClick={() => handleCloseLeft(contextMenu.sessionId)}
            className="w-full px-3 py-2 text-[12px] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('tabs.closeLeft')}
          </button>
          <button
            onClick={() => handleCloseRight(contextMenu.sessionId)}
            className="w-full px-3 py-2 text-[12px] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('tabs.closeRight')}
          </button>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            onClick={handleCloseAll}
            className="w-full px-3 py-2 text-[12px] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('tabs.closeAll')}
          </button>
        </div>
      )}

      {closingTabId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm animate-fade-in">
          <div className="bg-[var(--color-surface-container-lowest)] rounded-[8px] border-2 border-[var(--color-border)] p-6 max-w-sm w-full mx-4 animate-modal-in" style={{ boxShadow: 'var(--shadow-window)' }}>
            <h3 className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)] mb-2">{t('tabs.closeConfirmTitle')}</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-5 leading-relaxed">{t('tabs.closeConfirmMessage')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setClosingTabId(null)} className="px-4 py-1.5 text-[12px] font-medium rounded-full border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all duration-200">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { closeTab(closingTabId); setClosingTabId(null) }}
                className="px-4 py-1.5 text-[12px] font-medium rounded-full border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all duration-200"
              >
                {t('tabs.closeConfirmKeep')}
              </button>
              <button
                onClick={() => {
                  useChatStore.getState().stopGeneration(closingTabId)
                  disconnectSession(closingTabId)
                  closeTab(closingTabId)
                  setClosingTabId(null)
                }}
                className="px-4 py-1.5 text-[12px] font-semibold rounded-full bg-[var(--color-spacex-accent)] text-white hover:opacity-90 transition-opacity duration-150 shadow-md shadow-[var(--color-spacex-accent)]/20"
              >
                {t('tabs.closeConfirmStop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const TabItem = forwardRef<HTMLDivElement, {
  tab: Tab
  isActive: boolean
  isDragOver: boolean
  isDragging: boolean
  dragOffsetX: number
  onClick: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMouseDown: (event: React.MouseEvent) => void
}>(({ tab, isActive, isDragOver, isDragging, dragOffsetX, onClick, onClose, onContextMenu, onMouseDown }, ref) => {
  return (
    <div
      ref={ref}
      data-dragging={isDragging ? 'true' : 'false'}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      className={`
        tab-bar-hit-area group flex-shrink-0 flex items-center gap-1.5 px-3 h-[32px] relative rounded-[10px]
        ${isDragging ? 'z-20 cursor-grabbing' : 'cursor-grab'}
        transition-all duration-200 ease-out
        ${isActive
          ? 'bg-black/5 dark:bg-white/5 text-black/90 dark:text-white/90'
          : 'bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
        }
        ${isDragging ? 'opacity-95 ring-1 ring-black/10 dark:ring-white/10' : ''}
        ${isDragOver ? 'before:absolute before:left-[-2px] before:top-[6px] before:bottom-[6px] before:w-[2px] before:bg-[var(--color-spacex-accent)] before:rounded-full' : ''}
      `}
      style={{
        width: TAB_WIDTH,
        maxWidth: TAB_WIDTH,
        transform: isDragging ? `translateX(${dragOffsetX}px) scale(1.02)` : undefined,
      }}
    >
      {tab.type === 'session' && tab.status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot flex-shrink-0" />
      )}
      {tab.type === 'session' && tab.status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
      )}
      {tab.type === 'scheduled' && (
        <Icon name="schedule" size={14} className="flex-shrink-0 text-black/60 dark:text-white/60" />
      )}
      {tab.type === 'terminal' && (
        <Icon name="terminal" size={14} className="flex-shrink-0 text-black/60 dark:text-white/60" />
      )}

      <span className={`flex-1 truncate text-[12px] tracking-tight ${isActive ? 'text-black/90 dark:text-white/90 font-semibold' : 'text-black/60 dark:text-white/60 font-medium'}`}>
        {tab.title || 'Untitled'}
      </span>

      <button
        type="button"
        aria-label={`Close ${tab.title || 'Untitled'}`}
        onMouseDown={(e) => { e.stopPropagation() }}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="flex-shrink-0 -mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-transparent p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background] text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90 hover:bg-black/10 dark:hover:bg-white/10 focus-visible:outline-none"
      >
        <Icon name="close" size={12} className="leading-none" />
      </button>
    </div>
  )
})
TabItem.displayName = 'TabItem'

