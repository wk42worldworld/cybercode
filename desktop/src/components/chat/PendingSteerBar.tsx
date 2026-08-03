import {
  AlertCircle,
  Clock3,
  CornerDownRight,
  GripVertical,
  Loader2,
  PencilLine,
  X,
} from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import type { PendingSteer } from '../../stores/chatStore'

type PendingSteerBarProps = {
  sessionId: string
}

const EMPTY_PENDING_STEERS: PendingSteer[] = []

function isReorderableSteer(steer: PendingSteer): boolean {
  return steer.status === 'draft' || steer.status === 'failed'
}

function previewSteer(steer: PendingSteer): string {
  const text = steer.content.trim()
  if (text) return text
  const firstAttachment = steer.attachments?.[0]
  return firstAttachment?.name ?? firstAttachment?.path ?? ''
}

export function PendingSteerBar({ sessionId }: PendingSteerBarProps) {
  const t = useTranslation()
  const pendingSteers = useChatStore((s) => s.sessions[sessionId]?.pendingSteers ?? EMPTY_PENDING_STEERS)
  const sendPendingSteers = useChatStore((s) => s.sendPendingSteers)
  const reorderPendingSteer = useChatStore((s) => s.reorderPendingSteer)
  const editPendingSteer = useChatStore((s) => s.editPendingSteer)
  const cancelPendingSteer = useChatStore((s) => s.cancelPendingSteer)
  const [draggedSteerId, setDraggedSteerId] = useState<string | null>(null)
  const [dropTargetSteerId, setDropTargetSteerId] = useState<string | null>(null)
  // HTML5 drag & drop cannot be used here: the app enables Tauri's native
  // drag-drop channel (file attachments), and on macOS WKWebView that makes
  // the native layer swallow dragover/drop, so in-page DnD never completes.
  // Pointer events work in every webview, so reorder is pointer-driven.
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const dragStateRef = useRef<{ steerId: string; pointerId: number } | null>(null)

  const visibleSteers = pendingSteers.filter((steer) => steer.status !== 'cancelled' && steer.status !== 'processed')
  const reorderableSteers = visibleSteers.filter(isReorderableSteer)
  const draggedSteerIndex = visibleSteers.findIndex((steer) => steer.id === draggedSteerId)
  const showReorderHandles = reorderableSteers.length > 1

  const clearDragState = () => {
    dragStateRef.current = null
    setDraggedSteerId(null)
    setDropTargetSteerId(null)
  }

  const findDropTargetAt = (clientY: number): string | null => {
    for (const steer of visibleSteers) {
      const row = rowRefs.current.get(steer.id)
      if (!row) continue
      const rect = row.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) return steer.id
    }
    return null
  }

  const handleReorderPointerDown = (event: PointerEvent<HTMLButtonElement>, steerId: string) => {
    if (event.button !== 0 || dragStateRef.current) return
    event.preventDefault()
    const handle = event.currentTarget
    if (typeof handle.setPointerCapture === 'function') {
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // jsdom and older webviews may reject capture; drag still works without it.
      }
    }
    dragStateRef.current = { steerId, pointerId: event.pointerId }
    setDraggedSteerId(steerId)
    setDropTargetSteerId(null)
  }

  const handleReorderPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const targetId = findDropTargetAt(event.clientY)
    setDropTargetSteerId(targetId && targetId !== drag.steerId ? targetId : null)
  }

  const handleReorderPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const targetId = findDropTargetAt(event.clientY)
    if (targetId && targetId !== drag.steerId) {
      reorderPendingSteer(sessionId, drag.steerId, targetId)
    }
    clearDragState()
  }

  const handleReorderKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    steerId: string,
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()

    const currentIndex = reorderableSteers.findIndex((steer) => steer.id === steerId)
    const targetIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
    const target = reorderableSteers[targetIndex]
    if (target) reorderPendingSteer(sessionId, steerId, target.id)
  }

  if (visibleSteers.length === 0) return null

  return (
    <div className="mb-[8px] w-full px-[24px]">
      <div data-chat-content-column className="mx-auto flex w-full max-w-[878px] min-w-0 flex-col gap-[6px] rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-[6px] shadow-[0_10px_32px_rgba(15,23,42,0.10)]">
        {visibleSteers.map((steer, index) => {
          const canAct = steer.status === 'draft' || steer.status === 'failed'
          const isRunning = steer.status === 'queued' || steer.status === 'processing'
          const canReorder = showReorderHandles && canAct
          const isDropTarget = dropTargetSteerId === steer.id && draggedSteerId !== steer.id
          const dropAfter = draggedSteerIndex >= 0 && draggedSteerIndex < index
          const preview = previewSteer(steer)

          return (
            <div
              key={steer.id}
              data-testid={`pending-steer-row-${steer.id}`}
              ref={(element) => {
                if (element) {
                  rowRefs.current.set(steer.id, element)
                } else {
                  rowRefs.current.delete(steer.id)
                }
              }}
              className={`relative flex h-[36px] min-w-0 items-center gap-[8px] rounded-[10px] bg-[var(--color-surface-container-low)] px-[8px] text-[var(--color-text-secondary)] transition-opacity ${
                draggedSteerId === steer.id ? 'opacity-55' : ''
              }`}
            >
              {isDropTarget && (
                <span
                  data-testid="pending-steer-drop-indicator"
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-[8px] right-[8px] z-10 h-[2px] rounded-full bg-[var(--color-brand)] ${
                    dropAfter ? 'bottom-[-4px]' : 'top-[-4px]'
                  }`}
                />
              )}
              {showReorderHandles && (
                <button
                  type="button"
                  disabled={!canReorder}
                  onPointerDown={(event) => {
                    if (canReorder) handleReorderPointerDown(event, steer.id)
                  }}
                  onPointerMove={handleReorderPointerMove}
                  onPointerUp={handleReorderPointerUp}
                  onPointerCancel={clearDragState}
                  onKeyDown={(event) => handleReorderKeyDown(event, steer.id)}
                  aria-label={`${t('chat.pendingSteerReorder')}: ${preview}`}
                  title={t('chat.pendingSteerReorder')}
                  className="inline-flex h-[24px] w-[20px] shrink-0 cursor-grab touch-none items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                >
                  <GripVertical size={14} strokeWidth={2.2} />
                </button>
              )}
              <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)]">
                {steer.status === 'failed' ? (
                  <AlertCircle size={14} strokeWidth={2.35} className="text-[var(--color-error)]" />
                ) : isRunning ? (
                  <Loader2 size={14} strokeWidth={2.35} className="animate-spin" />
                ) : (
                  <Clock3 size={14} strokeWidth={2.35} />
                )}
              </span>
              <div
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]"
                title={preview}
              >
                {preview}
              </div>
              <div className="flex shrink-0 items-center gap-[4px]">
                {canAct && (
                  <>
                    <button
                      type="button"
                      onClick={() => sendPendingSteers(sessionId, 'now', [steer.id])}
                      aria-label={t('chat.pendingSteerJoin')}
                      title={t('chat.pendingSteerJoin')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <CornerDownRight size={14} strokeWidth={2.4} />
                    </button>
                    <button
                      type="button"
                      onClick={() => editPendingSteer(sessionId, steer.id)}
                      aria-label={t('chat.pendingSteerEdit')}
                      title={t('chat.pendingSteerEdit')}
                      className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <PencilLine size={14} strokeWidth={2.35} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => cancelPendingSteer(sessionId, steer.id)}
                  aria-label={t('chat.pendingSteerCancel')}
                  title={t('chat.pendingSteerCancel')}
                  className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <X size={14} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
