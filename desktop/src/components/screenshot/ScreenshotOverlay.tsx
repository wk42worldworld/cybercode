import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

import { useTranslation } from '../../i18n'

export type ScreenshotSelection = {
  x: number
  y: number
  width: number
  height: number
}

type Point = { x: number; y: number }
type Bounds = { width: number; height: number }
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

type Interaction =
  | { kind: 'create'; start: Point; pointerId: number }
  | { kind: 'move'; start: Point; initial: ScreenshotSelection; pointerId: number }
  | {
      kind: 'resize'
      start: Point
      initial: ScreenshotSelection
      handle: ResizeHandle
      pointerId: number
    }

const MIN_SELECTION_SIZE = 8
const HANDLE_SIZE = 10
const TOOLBAR_WIDTH = 118
const TOOLBAR_HEIGHT = 46

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function selectionFromPoints(start: Point, end: Point, bounds: Bounds): ScreenshotSelection {
  const startX = clamp(start.x, 0, bounds.width)
  const startY = clamp(start.y, 0, bounds.height)
  const endX = clamp(end.x, 0, bounds.width)
  const endY = clamp(end.y, 0, bounds.height)
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  }
}

export function moveSelection(
  initial: ScreenshotSelection,
  delta: Point,
  bounds: Bounds,
): ScreenshotSelection {
  return {
    ...initial,
    x: clamp(initial.x + delta.x, 0, Math.max(0, bounds.width - initial.width)),
    y: clamp(initial.y + delta.y, 0, Math.max(0, bounds.height - initial.height)),
  }
}

export function resizeSelection(
  initial: ScreenshotSelection,
  delta: Point,
  handle: ResizeHandle,
  bounds: Bounds,
): ScreenshotSelection {
  let left = initial.x
  let top = initial.y
  let right = initial.x + initial.width
  let bottom = initial.y + initial.height

  if (handle.includes('w')) left = clamp(initial.x + delta.x, 0, right - MIN_SELECTION_SIZE)
  if (handle.includes('e')) right = clamp(right + delta.x, left + MIN_SELECTION_SIZE, bounds.width)
  if (handle.includes('n')) top = clamp(initial.y + delta.y, 0, bottom - MIN_SELECTION_SIZE)
  if (handle.includes('s')) bottom = clamp(bottom + delta.y, top + MIN_SELECTION_SIZE, bounds.height)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

function pointerPoint(event: React.PointerEvent, root: HTMLDivElement): Point {
  const bounds = root.getBoundingClientRect()
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height),
  }
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode the selected screen region'))
        return
      }
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the screenshot image'))
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

const handleLayout: Record<ResizeHandle, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
}

export function ScreenshotOverlay() {
  const t = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const interactionRef = useRef<Interaction | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [selection, setSelection] = useState<ScreenshotSelection | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [imageSize, setImageSize] = useState<Bounds | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const [viewport, setViewport] = useState<Bounds>({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  useEffect(() => {
    let active = true
    void invoke<string>('read_screen_capture_source')
      .then((dataUrl) => {
        if (active) setSource(dataUrl)
      })
      .catch((error) => {
        console.error('[ScreenshotOverlay] Failed to load capture source:', error)
        void invoke('cancel_screen_capture')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  const cancel = useCallback(() => {
    if (isCompleting) return
    setIsCompleting(true)
    void invoke('cancel_screen_capture').catch((error) => {
      console.error('[ScreenshotOverlay] Failed to cancel capture:', error)
      setIsCompleting(false)
    })
  }, [isCompleting])

  const complete = useCallback(async () => {
    const image = imageRef.current
    if (!selection || !image || isCompleting || selection.width < MIN_SELECTION_SIZE) return

    setIsCompleting(true)
    try {
      const scaleX = image.naturalWidth / viewport.width
      const scaleY = image.naturalHeight / viewport.height
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(selection.width * scaleX))
      canvas.height = Math.max(1, Math.round(selection.height * scaleY))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D is unavailable')
      context.drawImage(
        image,
        Math.round(selection.x * scaleX),
        Math.round(selection.y * scaleY),
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      const pngDataUrl = await canvasToPngDataUrl(canvas)
      await invoke('complete_screen_capture', { pngDataUrl })
    } catch (error) {
      console.error('[ScreenshotOverlay] Failed to complete capture:', error)
      setIsCompleting(false)
    }
  }, [isCompleting, selection, viewport.height, viewport.width])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      } else if (event.key === 'Enter' && selection) {
        event.preventDefault()
        void complete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancel, complete, selection])

  const startCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isCompleting || !imageSize || !rootRef.current) return
    const start = pointerPoint(event, rootRef.current)
    interactionRef.current = { kind: 'create', start, pointerId: event.pointerId }
    rootRef.current.setPointerCapture(event.pointerId)
    setCursor(start)
    setSelection({ x: start.x, y: start.y, width: 0, height: 0 })
  }

  const startMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !selection || !rootRef.current) return
    event.stopPropagation()
    const start = pointerPoint(event, rootRef.current)
    interactionRef.current = { kind: 'move', start, initial: selection, pointerId: event.pointerId }
    rootRef.current.setPointerCapture(event.pointerId)
  }

  const startResize = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (event.button !== 0 || !selection || !rootRef.current) return
    event.stopPropagation()
    const start = pointerPoint(event, rootRef.current)
    interactionRef.current = {
      kind: 'resize',
      start,
      initial: selection,
      handle,
      pointerId: event.pointerId,
    }
    rootRef.current.setPointerCapture(event.pointerId)
  }

  const updateInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (!root) return
    const point = pointerPoint(event, root)
    setCursor(point)
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    const bounds = { width: root.clientWidth, height: root.clientHeight }

    if (interaction.kind === 'create') {
      setSelection(selectionFromPoints(interaction.start, point, bounds))
      return
    }
    const delta = { x: point.x - interaction.start.x, y: point.y - interaction.start.y }
    setSelection(
      interaction.kind === 'move'
        ? moveSelection(interaction.initial, delta, bounds)
        : resizeSelection(interaction.initial, delta, interaction.handle, bounds),
    )
  }

  const finishInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    interactionRef.current = null
    setCursor(null)
    rootRef.current?.releasePointerCapture(event.pointerId)
    setSelection((current) => {
      if (!current || current.width < MIN_SELECTION_SIZE || current.height < MIN_SELECTION_SIZE) {
        return null
      }
      return current
    })
  }

  const selectedPixelSize = useMemo(() => {
    if (!selection || !imageSize) return null
    return {
      width: Math.max(1, Math.round(selection.width * imageSize.width / viewport.width)),
      height: Math.max(1, Math.round(selection.height * imageSize.height / viewport.height)),
    }
  }, [imageSize, selection, viewport.height, viewport.width])

  const toolbarPosition = useMemo(() => {
    if (!selection) return null
    const below = selection.y + selection.height + 10
    const top = below + TOOLBAR_HEIGHT <= viewport.height
      ? below
      : Math.max(8, selection.y - TOOLBAR_HEIGHT - 10)
    return {
      left: clamp(selection.x + selection.width - TOOLBAR_WIDTH, 8, viewport.width - TOOLBAR_WIDTH - 8),
      top,
    }
  }, [selection, viewport.height, viewport.width])

  const magnifierPosition = useMemo(() => {
    if (!cursor) return null
    const width = 116
    const height = 82
    return {
      left: cursor.x + width + 24 <= viewport.width ? cursor.x + 18 : cursor.x - width - 18,
      top: cursor.y + height + 24 <= viewport.height ? cursor.y + 18 : cursor.y - height - 18,
      width,
      height,
    }
  }, [cursor, viewport.height, viewport.width])

  const showMagnifier = source && cursor && magnifierPosition && interactionRef.current?.kind === 'create'

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 select-none overflow-hidden bg-black cursor-crosshair"
      onPointerDown={startCreate}
      onPointerMove={updateInteraction}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onContextMenu={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      {source ? (
        <img
          ref={imageRef}
          src={source}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-fill"
          onLoad={(event) => {
            setImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[#111418]">
          <LoaderCircle size={24} className="animate-spin text-white/80" />
        </div>
      )}

      {!selection && source && <div className="pointer-events-none absolute inset-0 bg-black/45" />}

      {selection && (
        <div
          role="presentation"
          className="absolute cursor-move border border-[#2aa9ff] shadow-[0_0_0_9999px_rgba(2,7,12,0.48),inset_0_0_0_1px_rgba(255,255,255,0.28)]"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
          onPointerDown={startMove}
          onDoubleClick={(event) => {
            event.stopPropagation()
            void complete()
          }}
        >
          {selectedPixelSize && selection.width >= MIN_SELECTION_SIZE && (
            <div className="pointer-events-none absolute bottom-full left-0 mb-1.5 rounded-[4px] bg-[#15191f]/92 px-2 py-0.5 font-mono text-[11px] leading-5 text-white shadow-lg">
              {selectedPixelSize.width} x {selectedPixelSize.height}
            </div>
          )}

          {(Object.keys(handleLayout) as ResizeHandle[]).map((handle) => (
            <button
              key={handle}
              type="button"
              tabIndex={-1}
              aria-label={`${t('screenshot.resize')} ${handle}`}
              className="absolute z-20 block rounded-[1px] border border-white bg-[#2aa9ff] p-0 shadow-sm"
              style={{
                left: handleLayout[handle].left,
                top: handleLayout[handle].top,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                cursor: handleLayout[handle].cursor,
                transform: 'translate(-50%, -50%)',
              }}
              onPointerDown={(event) => startResize(event, handle)}
            />
          ))}
        </div>
      )}

      {showMagnifier && (
        <div
          className="pointer-events-none absolute z-30 overflow-hidden border border-white/70 bg-black shadow-2xl"
          style={{
            left: magnifierPosition.left,
            top: magnifierPosition.top,
            width: magnifierPosition.width,
            height: magnifierPosition.height,
            backgroundImage: `url(${source})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${viewport.width * 3}px ${viewport.height * 3}px`,
            backgroundPosition: `${magnifierPosition.width / 2 - cursor.x * 3}px ${magnifierPosition.height / 2 - cursor.y * 3}px`,
          }}
        >
          <span className="absolute left-1/2 top-0 h-full w-px bg-[#ff4d4f]/90" />
          <span className="absolute left-0 top-1/2 h-px w-full bg-[#ff4d4f]/90" />
        </div>
      )}

      {selection && toolbarPosition && selection.width >= MIN_SELECTION_SIZE && (
        <div
          className="absolute z-40 flex h-[46px] w-[118px] cursor-default items-center justify-center gap-1 rounded-[6px] border border-white/10 bg-[#171b20]/96 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.34)]"
          style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={t('screenshot.reselect')}
            title={t('screenshot.reselect')}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[4px] text-white/72 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => setSelection(null)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            aria-label={t('screenshot.cancel')}
            title={t('screenshot.cancel')}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[4px] text-white/72 transition-colors hover:bg-white/10 hover:text-white"
            onClick={cancel}
          >
            <X size={18} />
          </button>
          <button
            type="button"
            aria-label={t('screenshot.confirm')}
            title={t('screenshot.confirm')}
            disabled={isCompleting}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[4px] bg-[#168cff] text-white transition-colors hover:bg-[#087ce7] disabled:cursor-wait disabled:opacity-60"
            onClick={() => void complete()}
          >
            {isCompleting ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={18} />}
          </button>
        </div>
      )}
    </div>
  )
}
