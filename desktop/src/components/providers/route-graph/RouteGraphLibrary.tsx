import {
  Bot,
  Braces,
  CircleDot,
  Check,
  Gauge,
  GitBranch,
  GitFork,
  GripVertical,
  LogIn,
  LogOut,
  Network,
  Route,
  Scale,
  ShieldCheck,
  Sparkles,
  Timer,
  WalletCards,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../../i18n'
import type { RouteGraphNodeKind } from '../../../types/routing'
import {
  ROUTE_GRAPH_TEMPLATES,
  type RouteGraphTemplateId,
} from '../../../utils/routeGraph'
import { routeGraphNodeColor } from './RouteGraphNode'

const NODE_ITEMS: Array<{
  kind: RouteGraphNodeKind
  icon: typeof LogIn
}> = [
  { kind: 'start', icon: LogIn },
  { kind: 'model', icon: CircleDot },
  { kind: 'agent', icon: Bot },
  { kind: 'condition', icon: GitBranch },
  { kind: 'distribution', icon: GitFork },
  { kind: 'parallel', icon: Network },
  { kind: 'result', icon: Scale },
  { kind: 'relay', icon: Braces },
  { kind: 'output', icon: LogOut },
]

const TEMPLATE_ICONS = {
  shield: ShieldCheck,
  quota: Gauge,
  cost: WalletCards,
  speed: Zap,
  judge: Sparkles,
  relay: Timer,
  agent: Bot,
}

type ClientPoint = {
  clientX: number
  clientY: number
}

type PalettePointerDrag = ClientPoint & {
  active: boolean
  kind: RouteGraphNodeKind
  overCanvas: boolean
  pointerId: number
  startX: number
  startY: number
}

const POINTER_DRAG_THRESHOLD = 6

export type RouteGraphLibraryRoute = {
  id: string
  name: string
  isDefault: boolean
  isCurrent: boolean
  isActive: boolean
  candidateCount: number
}

export function RouteGraphLibrary({
  open,
  hasStart,
  hasOutput,
  onClose,
  onAddNode,
  onApplyTemplate,
  canDropNodeAt,
  onDropNode,
  onDragTargetChange,
  routes = [],
  routesDisabled = false,
  onSelectRoute,
  onDeleteRoute,
}: {
  open: boolean
  hasStart: boolean
  hasOutput: boolean
  onClose: () => void
  onAddNode: (kind: RouteGraphNodeKind) => void
  onApplyTemplate: (templateId: RouteGraphTemplateId) => void
  canDropNodeAt: (kind: RouteGraphNodeKind, point: ClientPoint) => boolean
  onDropNode: (kind: RouteGraphNodeKind, point: ClientPoint) => void
  onDragTargetChange: (overCanvas: boolean) => void
  routes?: RouteGraphLibraryRoute[]
  routesDisabled?: boolean
  onSelectRoute?: (routeId: string) => void
  onDeleteRoute?: (route: RouteGraphLibraryRoute) => void
}) {
  const t = useTranslation()
  const pointerDragRef = useRef<PalettePointerDrag | null>(null)
  const suppressClickKindRef = useRef<RouteGraphNodeKind | null>(null)
  const mouseDragCleanupRef = useRef<(() => void) | null>(null)
  const [dragPreview, setDragPreview] = useState<PalettePointerDrag | null>(null)
  const [libraryView, setLibraryView] = useState<'templates' | 'routes'>('templates')

  useEffect(() => () => mouseDragCleanupRef.current?.(), [])

  const clearPointerDrag = () => {
    pointerDragRef.current = null
    setDragPreview(null)
    onDragTargetChange(false)
  }

  const beginPointerDrag = (
    kind: RouteGraphNodeKind,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || event.pointerType === 'mouse') return
    pointerDragRef.current = {
      active: false,
      kind,
      overCanvas: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginMouseDrag = (
    kind: RouteGraphNodeKind,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return
    mouseDragCleanupRef.current?.()
    pointerDragRef.current = {
      active: false,
      kind,
      overCanvas: false,
      pointerId: -1,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const current = pointerDragRef.current
      if (!current || current.kind !== kind || current.pointerId !== -1) return
      const active = current.active || Math.hypot(
        moveEvent.clientX - current.startX,
        moveEvent.clientY - current.startY,
      ) >= POINTER_DRAG_THRESHOLD
      if (!active) return

      moveEvent.preventDefault()
      const point = { clientX: moveEvent.clientX, clientY: moveEvent.clientY }
      const overCanvas = canDropNodeAt(kind, point)
      const next = { ...current, ...point, active: true, overCanvas }
      pointerDragRef.current = next
      setDragPreview(next)
      if (!current.active || current.overCanvas !== overCanvas) {
        onDragTargetChange(overCanvas)
      }
    }

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      if (mouseDragCleanupRef.current === cleanup) mouseDragCleanupRef.current = null
    }

    const handleMouseUp = (upEvent: MouseEvent) => {
      const current = pointerDragRef.current
      if (current?.kind === kind && current.pointerId === -1 && current.active) {
        upEvent.preventDefault()
        const point = { clientX: upEvent.clientX, clientY: upEvent.clientY }
        suppressClickKindRef.current = kind
        if (canDropNodeAt(kind, point)) onDropNode(kind, point)
        window.setTimeout(() => {
          if (suppressClickKindRef.current === kind) suppressClickKindRef.current = null
        }, 0)
      }
      cleanup()
      clearPointerDrag()
    }

    mouseDragCleanupRef.current = cleanup
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
  }

  const movePointerDrag = (
    kind: RouteGraphNodeKind,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = pointerDragRef.current
    if (!current || current.kind !== kind || current.pointerId !== event.pointerId) return
    const active = current.active || Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    ) >= POINTER_DRAG_THRESHOLD
    if (!active) return

    event.preventDefault()
    const point = { clientX: event.clientX, clientY: event.clientY }
    const overCanvas = canDropNodeAt(kind, point)
    const next = { ...current, ...point, active: true, overCanvas }
    pointerDragRef.current = next
    setDragPreview(next)
    if (!current.active || current.overCanvas !== overCanvas) {
      onDragTargetChange(overCanvas)
    }
  }

  const finishPointerDrag = (
    kind: RouteGraphNodeKind,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = pointerDragRef.current
    if (!current || current.kind !== kind || current.pointerId !== event.pointerId) return
    if (current.active) {
      event.preventDefault()
      const point = { clientX: event.clientX, clientY: event.clientY }
      suppressClickKindRef.current = kind
      if (canDropNodeAt(kind, point)) onDropNode(kind, point)
      window.setTimeout(() => {
        if (suppressClickKindRef.current === kind) suppressClickKindRef.current = null
      }, 0)
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    clearPointerDrag()
  }

  const cancelPointerDrag = (
    kind: RouteGraphNodeKind,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = pointerDragRef.current
    if (!current || current.kind !== kind || current.pointerId !== event.pointerId) return
    clearPointerDrag()
  }

  const losePointerCapture = (
    kind: RouteGraphNodeKind,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = pointerDragRef.current
    if (!current || current.kind !== kind || current.pointerId !== event.pointerId) return
    clearPointerDrag()
  }

  const previewItem = dragPreview
    ? NODE_ITEMS.find((entry) => entry.kind === dragPreview.kind)
    : undefined
  const defaultRoutes = routes.filter((route) => route.isDefault)
  const customRoutes = routes.filter((route) => !route.isDefault)

  return (
    <>
      <aside
        data-testid="route-graph-library"
        data-open={open ? 'true' : 'false'}
        className="route-graph-library"
        aria-label={t('settings.routing.graph.library')}
      >
      <div className="route-graph-panel-heading">
        <span>{t('settings.routing.graph.library')}</span>
        <button
          type="button"
          className="route-graph-mobile-close"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="route-graph-library-scroll">
        <section>
          <h3>{t('settings.routing.graph.nodes')}</h3>
          <div className="route-graph-node-palette">
            {NODE_ITEMS.map(({ kind, icon: Icon }) => {
              const disabled = (kind === 'start' && hasStart) || (kind === 'output' && hasOutput)
              return (
                <button
                  key={kind}
                  type="button"
                  data-route-node-kind={kind}
                  data-dragging={dragPreview?.kind === kind ? 'true' : 'false'}
                  style={{ '--route-node-accent': routeGraphNodeColor(kind) } as CSSProperties}
                  disabled={disabled}
                  title={t(`settings.routing.graph.node.${kind}.description` as never)}
                  onMouseDown={(event) => beginMouseDrag(kind, event)}
                  onPointerDown={(event) => beginPointerDrag(kind, event)}
                  onPointerMove={(event) => movePointerDrag(kind, event)}
                  onPointerUp={(event) => finishPointerDrag(kind, event)}
                  onPointerCancel={(event) => cancelPointerDrag(kind, event)}
                  onLostPointerCapture={(event) => losePointerCapture(kind, event)}
                  onClick={(event) => {
                    if (suppressClickKindRef.current === kind) {
                      event.preventDefault()
                      event.stopPropagation()
                      suppressClickKindRef.current = null
                      return
                    }
                    onAddNode(kind)
                  }}
                >
                  <GripVertical className="route-graph-node-drag-handle" size={11} />
                  <Icon size={15} />
                  <span>{t(`settings.routing.graph.node.${kind}.name` as never)}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="route-graph-resource-section">
          <div
            className="route-graph-library-tabs"
            role="tablist"
            aria-label={t('settings.routing.graph.libraryViews')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={libraryView === 'templates'}
              onClick={() => setLibraryView('templates')}
            >
              {t('settings.routing.graph.templates')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={libraryView === 'routes'}
              onClick={() => setLibraryView('routes')}
            >
              {t('settings.routing.graph.availableRoutes')}
            </button>
          </div>

          {libraryView === 'templates' ? (
            <div className="route-graph-template-list" role="tabpanel">
              {ROUTE_GRAPH_TEMPLATES.map((template) => {
                const Icon = TEMPLATE_ICONS[template.icon]
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onApplyTemplate(template.id)}
                    title={t(`settings.routing.graph.template.${template.id}.description` as never)}
                  >
                    <Icon size={15} />
                    <span>{t(`settings.routing.graph.template.${template.id}.name` as never)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="route-graph-route-groups" role="tabpanel">
              {routes.length > 0 ? (
                [
                  {
                    key: 'default',
                    label: t('settings.routing.graph.defaultRoutes'),
                    items: defaultRoutes,
                  },
                  {
                    key: 'custom',
                    label: t('settings.routing.graph.customRoutes'),
                    items: customRoutes,
                  },
                ].filter((group) => group.items.length > 0).map((group) => (
                  <div className="route-graph-route-group" key={group.key}>
                    <h4>{group.label}</h4>
                    <div className="route-graph-route-list">
                      {group.items.map((route) => (
                        <div
                          className={`route-graph-route-row${onDeleteRoute ? ' has-delete' : ''}`}
                          key={route.id}
                        >
                          <button
                            type="button"
                            className="route-graph-route-option"
                            aria-current={route.isCurrent ? 'page' : undefined}
                            disabled={routesDisabled || route.isCurrent}
                            title={route.name}
                            onClick={() => onSelectRoute?.(route.id)}
                          >
                            <span className="route-graph-route-icon" aria-hidden="true">
                              <Route size={13} />
                            </span>
                            <span className="route-graph-route-copy">
                              <strong>{route.name}</strong>
                              <small>
                                {t('settings.routing.readyCount', { count: route.candidateCount })}
                              </small>
                            </span>
                            <span
                              className={`route-graph-route-state${route.isActive ? ' is-active' : ''}`}
                            >
                              {route.isCurrent ? (
                                <Check size={11} />
                              ) : route.isActive
                                ? t('settings.routing.routeActive')
                                : t('settings.routing.graph.published')}
                            </span>
                          </button>
                          {onDeleteRoute && (
                            <button
                              type="button"
                              className="route-graph-route-delete"
                              disabled={routesDisabled}
                              aria-label={`${t('settings.routing.deleteRoute')}: ${route.name}`}
                              title={`${t('settings.routing.deleteRoute')}: ${route.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                onDeleteRoute(route)
                              }}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="route-graph-route-empty">
                  {t('settings.routing.graph.noAvailableRoutes')}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      </aside>

      {dragPreview && previewItem && typeof document !== 'undefined' && createPortal(
        <div
          className="route-graph-node-drag-preview"
          data-can-drop={dragPreview.overCanvas ? 'true' : 'false'}
          data-testid="route-graph-node-drag-preview"
          aria-hidden="true"
          style={{
            '--route-node-accent': routeGraphNodeColor(dragPreview.kind),
            left: dragPreview.clientX + 14,
            top: dragPreview.clientY + 14,
          } as CSSProperties}
        >
          <previewItem.icon size={15} />
          <span>{t(`settings.routing.graph.node.${dragPreview.kind}.name` as never)}</span>
        </div>,
        document.body,
      )}
    </>
  )
}
