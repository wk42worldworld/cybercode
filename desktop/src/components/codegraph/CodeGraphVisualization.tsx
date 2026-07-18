import {
  Files,
  Focus,
  Maximize2,
  Search,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  CodeGraphConfidence,
  CodeGraphData,
  CodeGraphNode,
} from '../../api/tokenOptimization'
import { useTranslation } from '../../i18n'

type PositionedNode = CodeGraphNode & {
  x: number
  y: number
  radius: number
  clusterKey: string
}
type GraphCluster = {
  key: string
  label: string
  kind: GraphViewMode
  x: number
  y: number
  radius: number
  nodeIds: string[]
}
type GraphLayout = { nodes: PositionedNode[]; clusters: GraphCluster[] }
export type GraphViewMode = 'architecture' | 'files'
type ViewTransform = { x: number; y: number; scale: number }
type ScreenPoint = { x: number; y: number }

const WORLD_WIDTH = 1180
const WORLD_HEIGHT = 760
const MIN_SCALE = 0.48
const MAX_SCALE = 3.4

const KIND_COLORS: Record<string, string> = {
  class: '#6aa6ff',
  function: '#45e1bc',
  method: '#2fc5b3',
  interface: '#b69cff',
  type_alias: '#9d8cff',
  enum: '#ffba63',
  constant: '#ff7185',
  variable: '#ff9868',
  module: '#62d6ee',
  file: '#e8f0f5',
}

const EDGE_STYLES: Record<string, { color: string; dash: number[] }> = {
  calls: { color: '#45e1bc', dash: [] },
  references: { color: '#ffba63', dash: [4, 5] },
  contains: { color: '#6f8794', dash: [] },
}

export function CodeGraphVisualization({ data }: { data: CodeGraphData }) {
  const t = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 980, height: 620 })
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 })
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<GraphViewMode>('architecture')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const layout = useMemo(() => buildSemanticLayout(data, viewMode), [data, viewMode])
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const matchedNodes = useMemo(
    () => normalizedQuery
      ? layout.nodes.filter((node) => matchesQuery(node, normalizedQuery))
      : [],
    [layout.nodes, normalizedQuery],
  )
  const hoveredNode = hoveredId ? nodeById.get(hoveredId) ?? null : null
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null
  const selectedConnections = useMemo(
    () => selectedId ? getNodeConnections(data, selectedId, nodeById) : [],
    [data, nodeById, selectedId],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateSize = () => {
      const width = Math.max(320, container.clientWidth)
      const availableHeight = container.clientHeight
      const height = Math.max(
        440,
        Math.min(900, availableHeight > 440 ? availableHeight : Math.round(width * 0.64)),
      )
      setCanvasSize({ width, height })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(canvasSize.width * dpr)
    canvas.height = Math.round(canvasSize.height * dpr)
    canvas.style.width = `${canvasSize.width}px`
    canvas.style.height = `${canvasSize.height}px`
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let animationFrame = 0
    let lastFrame = 0

    const render = (time: number) => {
      if (reduceMotion || time - lastFrame >= 32) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawGraph({
          context,
          size: canvasSize,
          transform,
          data,
          layout,
          nodeById,
          hoveredId,
          selectedId,
          query: normalizedQuery,
          time,
        })
        lastFrame = time
      }
      if (!reduceMotion) animationFrame = window.requestAnimationFrame(render)
    }
    render(performance.now())
    return () => window.cancelAnimationFrame(animationFrame)
  }, [canvasSize, data, hoveredId, layout, nodeById, normalizedQuery, selectedId, transform])

  const findNodeAt = useCallback((x: number, y: number) => {
    const world = screenToWorld(x, y, canvasSize, transform)
    for (let index = layout.nodes.length - 1; index >= 0; index -= 1) {
      const node = layout.nodes[index]!
      const distance = Math.hypot(node.x - world.x, node.y - world.y)
      if (distance <= node.radius + 6 / getFitScale(canvasSize, transform.scale)) return node
    }
    return null
  }, [canvasSize, layout.nodes, transform])

  const focusNode = useCallback((node: PositionedNode) => {
    const scale = Math.max(1.35, transform.scale)
    const fitScale = getFitScale(canvasSize, scale)
    setTransform({
      scale,
      x: -(node.x - WORLD_WIDTH / 2) * fitScale - (canvasSize.width > 700 ? 100 : 0),
      y: -(node.y - WORLD_HEIGHT / 2) * fitScale,
    })
    setSelectedId(node.id)
  }, [canvasSize, transform.scale])

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    setPointer({ x, y })
    if (dragRef.current) {
      const drag = dragRef.current
      setTransform((current) => ({
        ...current,
        x: drag.originX + event.clientX - drag.x,
        y: drag.originY + event.clientY - drag.y,
      }))
      return
    }
    setHoveredId(findNodeAt(x, y)?.id ?? null)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y)
    if (moved > 4) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setSelectedId(findNodeAt(event.clientX - bounds.left, event.clientY - bounds.top)?.id ?? null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const world = screenToWorld(cursor.x, cursor.y, canvasSize, transform)
    const nextScale = clamp(transform.scale * (event.deltaY < 0 ? 1.12 : 0.88), MIN_SCALE, MAX_SCALE)
    const nextFit = getFitScale(canvasSize, nextScale)
    setTransform({
      scale: nextScale,
      x: cursor.x - canvasSize.width / 2 - (world.x - WORLD_WIDTH / 2) * nextFit,
      y: cursor.y - canvasSize.height / 2 - (world.y - WORLD_HEIGHT / 2) * nextFit,
    })
  }

  const adjustZoom = (factor: number) => {
    setTransform((current) => ({
      ...current,
      scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE),
    }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <label className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            size={16}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matchedNodes[0]) focusNode(matchedNodes[0])
            }}
            placeholder={t('tokenOptimization.graph.search')}
            aria-label={t('tokenOptimization.graph.search')}
            className="h-[38px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] pl-[34px] pr-[72px] text-[13px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
          />
          {normalizedQuery && (
            <span className="pointer-events-none absolute right-[11px] top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
              {matchedNodes.length} {t('tokenOptimization.graph.matches')}
            </span>
          )}
        </label>
        <div
          role="group"
          aria-label={t('tokenOptimization.graph.view.label')}
          className="flex h-[38px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[2px]"
        >
          <GraphModeButton
            active={viewMode === 'architecture'}
            label={t('tokenOptimization.graph.view.architecture')}
            onClick={() => {
              setViewMode('architecture')
              setSelectedId(null)
              setTransform({ x: 0, y: 0, scale: 1 })
            }}
          >
            <Waypoints size={14} />
          </GraphModeButton>
          <GraphModeButton
            active={viewMode === 'files'}
            label={t('tokenOptimization.graph.view.files')}
            onClick={() => {
              setViewMode('files')
              setSelectedId(null)
              setTransform({ x: 0, y: 0, scale: 1 })
            }}
          >
            <Files size={14} />
          </GraphModeButton>
        </div>
        <div className="flex h-[38px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[2px]">
          <GraphIconButton label={t('tokenOptimization.graph.zoomOut')} onClick={() => adjustZoom(0.82)}>
            <ZoomOut size={16} />
          </GraphIconButton>
          <GraphIconButton
            label={t('tokenOptimization.graph.reset')}
            onClick={() => {
              setTransform({ x: 0, y: 0, scale: 1 })
              setSelectedId(null)
            }}
          >
            <Maximize2 size={15} />
          </GraphIconButton>
          <GraphIconButton label={t('tokenOptimization.graph.zoomIn')} onClick={() => adjustZoom(1.22)}>
            <ZoomIn size={16} />
          </GraphIconButton>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-[440px] w-full flex-1 overflow-hidden rounded-[8px] border border-[#26333a] bg-[#090d10] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.015)]"
      >
        <canvas
          ref={canvasRef}
          aria-label={t('tokenOptimization.graph.canvasLabel')}
          className="block cursor-grab touch-none active:cursor-grabbing"
          onDoubleClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
          onPointerDown={handlePointerDown}
          onPointerLeave={() => {
            dragRef.current = null
            setHoveredId(null)
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        />

        <div className="pointer-events-none absolute left-[12px] top-[11px] flex items-center gap-[8px] font-mono text-[9px] uppercase text-[#78909a]">
          <span className="h-[5px] w-[5px] rounded-full bg-[#45e1bc] shadow-[0_0_10px_rgba(69,225,188,0.8)]" />
          {t('tokenOptimization.graph.liveMap')}
        </div>

        <GraphLegend t={t} />

        {hoveredNode && !selectedNode && (
          <NodeTooltip node={hoveredNode} x={pointer.x} y={pointer.y} size={canvasSize} t={t} />
        )}

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            connections={selectedConnections}
            onClose={() => setSelectedId(null)}
            onSelect={focusNode}
            t={t}
          />
        )}

        {layout.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#78909a]">
            {t('tokenOptimization.graph.empty')}
          </div>
        )}
      </div>

      <div className="flex min-h-[28px] items-center justify-between gap-[16px] text-[11px] text-[var(--color-text-tertiary)]">
        <span>{t('tokenOptimization.graph.summary', { nodes: data.nodes.length, edges: data.edges.length })}</span>
        <span>
          {viewMode === 'architecture'
            ? t('tokenOptimization.graph.architectureSummary', {
                communities: data.architecture.communities.length,
                hubs: data.architecture.hubNodeIds.length,
                bridges: data.architecture.bridgeNodeIds.length,
              })
            : t('tokenOptimization.graph.fileSummary', { files: layout.clusters.length })}
        </span>
      </div>
    </div>
  )
}

function GraphModeButton({ children, active, label, onClick }: {
  children: React.ReactNode
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex h-[32px] items-center gap-[6px] rounded-[6px] px-[9px] text-[11px] font-semibold transition-colors ${active
        ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] shadow-sm'
        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

function GraphIconButton({ children, label, onClick }: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      {children}
    </button>
  )
}

function GraphLegend({ t }: { t: ReturnType<typeof useTranslation> }) {
  return (
    <div className="pointer-events-none absolute bottom-[11px] left-[12px] flex flex-wrap items-center gap-x-[13px] gap-y-[5px] bg-[#090d10]/80 px-[7px] py-[5px] font-mono text-[9px] text-[#78909a] backdrop-blur-[4px]">
      <LegendEdge color="#45e1bc" label={t('tokenOptimization.graph.edge.calls')} />
      <LegendEdge color="#ffba63" dashed label={t('tokenOptimization.graph.edge.references')} />
      <LegendEdge color="#6f8794" label={t('tokenOptimization.graph.edge.contains')} />
      <LegendEdge color="#b69cff" dashed label={t('tokenOptimization.graph.edge.inferred')} />
    </div>
  )
}

function LegendEdge({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-[5px]">
      <span
        className={`block h-0 w-[16px] border-t ${dashed ? 'border-dashed' : ''}`}
        style={{ borderColor: color }}
      />
      {label}
    </span>
  )
}

function NodeTooltip({ node, x, y, size, t }: {
  node: PositionedNode
  x: number
  y: number
  size: { width: number; height: number }
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[280px] border border-[#32434b] bg-[#10171b]/95 px-[10px] py-[8px] font-mono text-[10px] text-[#dce7eb] shadow-[0_12px_30px_rgba(0,0,0,0.4)] backdrop-blur-[6px]"
      style={{
        left: Math.max(8, Math.min(x + 14, size.width - 294)),
        top: Math.max(8, Math.min(y - 12, size.height - 62)),
      }}
    >
      <div className="truncate font-semibold text-white">{node.qualifiedName || node.name}</div>
      <div className="mt-[3px] truncate text-[#78909a]">{node.filePath}:{node.startLine}</div>
      <div className="mt-[3px] truncate text-[#8aa2ab]">
        {node.communityLabel} · {getRoleLabel(node.role, t)}
      </div>
    </div>
  )
}

function NodeInspector({ node, connections, onClose, onSelect, t }: {
  node: PositionedNode
  connections: Array<{
    node: PositionedNode
    kind: string
    direction: 'in' | 'out'
    confidence: CodeGraphConfidence
    provenance: string | null
    line: number | null
  }>
  onClose: () => void
  onSelect: (node: PositionedNode) => void
  t: ReturnType<typeof useTranslation>
}) {
  const grouped = Object.entries(
    connections.reduce<Record<string, number>>((counts, connection) => {
      counts[connection.kind] = (counts[connection.kind] || 0) + 1
      return counts
    }, {}),
  )
  return (
    <aside className="absolute bottom-0 right-0 top-0 z-20 flex w-[min(292px,78%)] flex-col border-l border-[#2b3a41] bg-[#0d1317]/95 text-[#dce7eb] shadow-[-18px_0_44px_rgba(0,0,0,0.28)] backdrop-blur-[10px]">
      <header className="flex items-start justify-between gap-[12px] border-b border-[#26333a] px-[16px] py-[15px]">
        <div className="min-w-0">
          <div className="flex items-center gap-[7px] font-mono text-[9px] uppercase text-[#78909a]">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: KIND_COLORS[node.kind] || '#78909a' }} />
            {node.kind} · {getRoleLabel(node.role, t)}
          </div>
          <h2 className="mt-[7px] truncate text-[14px] font-semibold text-white">
            {node.qualifiedName || node.name}
          </h2>
        </div>
        <button
          type="button"
          aria-label={t('tokenOptimization.graph.inspector.close')}
          title={t('tokenOptimization.graph.inspector.close')}
          onClick={onClose}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-[#78909a] hover:bg-[#1a252b] hover:text-white"
        >
          <X size={15} />
        </button>
      </header>

      <div className="border-b border-[#26333a] px-[16px] py-[13px] font-mono text-[10px] leading-[1.65]">
        <div className="break-all text-[#9aadb5]">{node.filePath}</div>
        <div className="mt-[5px] flex items-center justify-between text-[#78909a]">
          <span>{t('tokenOptimization.graph.inspector.lines')}</span>
          <span className="text-[#dce7eb]">{node.startLine}-{node.endLine}</span>
        </div>
        <div className="flex items-center justify-between gap-[12px] text-[#78909a]">
          <span>{t('tokenOptimization.graph.inspector.community')}</span>
          <span className="truncate text-right text-[#dce7eb]">{node.communityLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[#78909a]">
          <span>{t('tokenOptimization.graph.inspector.degree')}</span>
          <span className="text-[#dce7eb]">{node.degree}</span>
        </div>
      </div>

      {grouped.length > 0 && (
        <div className="flex flex-wrap gap-x-[14px] gap-y-[5px] border-b border-[#26333a] px-[16px] py-[11px] font-mono text-[9px] uppercase text-[#78909a]">
          {grouped.map(([kind, count]) => (
            <span key={kind}><strong className="mr-[4px] text-[#dce7eb]">{count}</strong>{kind}</span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-[8px] py-[10px]">
        <div className="px-[8px] pb-[7px] font-mono text-[9px] uppercase text-[#78909a]">
          {t('tokenOptimization.graph.inspector.related')}
        </div>
        {connections.length === 0 ? (
          <div className="px-[8px] py-[12px] text-[11px] text-[#60757f]">
            {t('tokenOptimization.graph.inspector.noRelations')}
          </div>
        ) : connections.slice(0, 24).map((connection, index) => (
          <button
            key={`${connection.node.id}-${connection.kind}-${index}`}
            type="button"
            onClick={() => onSelect(connection.node)}
            className="group flex w-full items-center gap-[9px] border-b border-[#1c272c] px-[8px] py-[9px] text-left hover:bg-[#151f24]"
          >
            <span
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: KIND_COLORS[connection.node.kind] || '#78909a' }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-[#cddade] group-hover:text-white">
                {connection.node.name}
              </span>
              <span className="mt-[2px] block truncate font-mono text-[8px] uppercase text-[#60757f]">
                {connection.direction === 'out' ? '→' : '←'} {connection.kind} · {getConfidenceLabel(connection.confidence, t)}
                {connection.line ? ` · L${connection.line}` : ''}
              </span>
            </span>
            <Focus size={12} className="shrink-0 text-[#50636c] opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </aside>
  )
}

function drawGraph({ context, size, transform, data, layout, nodeById, hoveredId, selectedId, query, time }: {
  context: CanvasRenderingContext2D
  size: { width: number; height: number }
  transform: ViewTransform
  data: CodeGraphData
  layout: GraphLayout
  nodeById: Map<string, PositionedNode>
  hoveredId: string | null
  selectedId: string | null
  query: string
  time: number
}) {
  context.clearRect(0, 0, size.width, size.height)
  context.fillStyle = '#090d10'
  context.fillRect(0, 0, size.width, size.height)
  drawGrid(context, size, transform)

  const activeId = selectedId || hoveredId
  const neighborhood = activeId ? getNeighborhoodIds(data, activeId) : null
  const matchedIds = query
    ? new Set(layout.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id))
    : null

  for (const cluster of layout.clusters) {
    const center = worldToScreen(cluster.x, cluster.y, size, transform)
    const radius = cluster.radius * getFitScale(size, transform.scale)
    const clusterActive = !neighborhood || cluster.nodeIds.some((id) => neighborhood.has(id))
    context.save()
    context.globalAlpha = clusterActive ? 1 : 0.24
    context.beginPath()
    context.arc(center.x, center.y, radius, 0, Math.PI * 2)
    context.fillStyle = cluster.kind === 'architecture'
      ? 'rgba(15, 33, 35, 0.58)'
      : 'rgba(18, 28, 33, 0.52)'
    context.fill()
    context.setLineDash(cluster.kind === 'architecture' ? [3, 6] : [2, 7])
    context.lineWidth = cluster.kind === 'architecture' ? 1 : 0.8
    context.strokeStyle = cluster.kind === 'architecture'
      ? 'rgba(69, 225, 188, 0.33)'
      : 'rgba(107, 140, 151, 0.34)'
    context.stroke()
    context.setLineDash([])
    context.font = `${cluster.kind === 'architecture' ? 10 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`
    context.textBaseline = 'middle'
    context.fillStyle = clusterActive
      ? cluster.kind === 'architecture' ? '#79b8ad' : '#6f8791'
      : '#42535a'
    context.fillText(truncateLabel(cluster.label, 30), center.x - radius + 9, center.y - radius + 13)
    context.restore()
  }

  for (const edge of data.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue
    const from = worldToScreen(source.x, source.y, size, transform)
    const to = worldToScreen(target.x, target.y, size, transform)
    const style = EDGE_STYLES[edge.kind] || EDGE_STYLES.contains!
    const emphasized = Boolean(activeId && (edge.source === activeId || edge.target === activeId))
    const related = !neighborhood || (neighborhood.has(edge.source) && neighborhood.has(edge.target))
    const queryRelated = !matchedIds || matchedIds.has(edge.source) || matchedIds.has(edge.target)
    const curve = curveControl(from, to, edge.source, edge.target)
    const confidenceAlpha = edge.confidence === 'extracted' ? 1 : edge.confidence === 'inferred' ? 0.56 : 0.72

    context.save()
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.quadraticCurveTo(curve.x, curve.y, to.x, to.y)
    context.strokeStyle = style.color
    context.globalAlpha = (emphasized
      ? 0.86
      : related && queryRelated
        ? edge.crossCommunity ? 0.28 : 0.19
        : 0.035) * confidenceAlpha
    context.lineWidth = emphasized ? 1.65 : edge.crossCommunity ? 1.05 : edge.kind === 'contains' ? 0.65 : 0.9
    context.setLineDash(edge.confidence === 'inferred' ? [2, 5] : style.dash)
    context.stroke()
    context.setLineDash([])

    const showFlow = edge.kind === 'calls'
      && (emphasized || (!activeId && hashString(edge.source + edge.target) % 4 === 0))
    if ((emphasized && edge.kind !== 'contains') || showFlow) {
      if (emphasized) drawArrowHead(context, quadraticPoint(from, curve, to, 0.88), to, style.color)
      const progress = ((time / 1700) + (hashString(edge.source + edge.target) % 100) / 100) % 1
      const particle = quadraticPoint(from, curve, to, progress)
      context.globalAlpha = emphasized ? 0.95 : 0.5
      context.beginPath()
      context.arc(particle.x, particle.y, emphasized ? 1.9 : 1.2, 0, Math.PI * 2)
      context.fillStyle = '#f4fffd'
      context.shadowColor = style.color
      context.shadowBlur = 9
      context.fill()
    }
    context.restore()
  }

  for (const node of layout.nodes) {
    const point = worldToScreen(node.x, node.y, size, transform)
    const radius = Math.max(3.2, node.radius * getFitScale(size, transform.scale))
    const isActive = node.id === hoveredId || node.id === selectedId
    const isRelated = !neighborhood || neighborhood.has(node.id)
    const isMatch = !matchedIds || matchedIds.has(node.id)
    const color = KIND_COLORS[node.kind] || '#78909a'
    context.save()
    context.globalAlpha = isRelated && isMatch ? 0.94 : isRelated && matchedIds ? 0.18 : 0.1

    if (isActive) {
      const pulse = 4 + Math.sin(time / 230) * 1.4
      context.beginPath()
      context.arc(point.x, point.y, radius + pulse, 0, Math.PI * 2)
      context.strokeStyle = color
      context.globalAlpha = 0.36
      context.lineWidth = 1
      context.stroke()
      context.shadowColor = color
      context.shadowBlur = 15
      context.globalAlpha = 1
    }

    if (!isActive && node.role !== 'member') {
      context.beginPath()
      context.arc(point.x, point.y, radius + (node.role === 'bridge' ? 4.5 : 3.2), 0, Math.PI * 2)
      context.strokeStyle = node.role === 'bridge' ? '#ffba63' : color
      context.globalAlpha = node.role === 'bridge' ? 0.58 : 0.34
      context.lineWidth = node.role === 'bridge' ? 1.15 : 0.85
      context.setLineDash(node.role === 'bridge' ? [2, 3] : [])
      context.stroke()
      context.setLineDash([])
      context.globalAlpha = isRelated && isMatch ? 0.94 : 0.1
    }

    drawNodeShape(context, node.kind, point, isActive ? radius + 1.3 : radius)
    context.fillStyle = color
    if (node.kind === 'file') {
      context.shadowColor = '#c4f5eb'
      context.shadowBlur = isActive ? 16 : 7
    }
    context.fill()
    if (node.kind === 'file') {
      context.strokeStyle = '#91a5ae'
      context.lineWidth = 1
      context.stroke()
    }
    context.restore()
  }

  drawLabels(context, size, transform, layout.nodes, hoveredId, selectedId, matchedIds, neighborhood)
}

function drawGrid(context: CanvasRenderingContext2D, size: { width: number; height: number }, transform: ViewTransform) {
  const spacing = Math.max(22, 38 * transform.scale)
  const offsetX = ((transform.x % spacing) + spacing) % spacing
  const offsetY = ((transform.y % spacing) + spacing) % spacing
  context.save()
  context.lineWidth = 0.5
  context.strokeStyle = 'rgba(102, 129, 139, 0.075)'
  context.beginPath()
  for (let x = offsetX; x < size.width; x += spacing) {
    context.moveTo(x, 0)
    context.lineTo(x, size.height)
  }
  for (let y = offsetY; y < size.height; y += spacing) {
    context.moveTo(0, y)
    context.lineTo(size.width, y)
  }
  context.stroke()
  context.fillStyle = 'rgba(119, 153, 165, 0.15)'
  for (let x = offsetX; x < size.width; x += spacing) {
    for (let y = offsetY; y < size.height; y += spacing) context.fillRect(x - 0.5, y - 0.5, 1, 1)
  }
  context.restore()
}

function drawLabels(
  context: CanvasRenderingContext2D,
  size: { width: number; height: number },
  transform: ViewTransform,
  nodes: PositionedNode[],
  hoveredId: string | null,
  selectedId: string | null,
  matchedIds: Set<string> | null,
  neighborhood: Set<string> | null,
) {
  const priorityIds = new Set(
    [...nodes]
      .filter((node) => node.kind !== 'file')
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6)
      .map((node) => node.id),
  )
  context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  context.textBaseline = 'middle'
  const candidates = nodes
    .filter((node) => node.id === hoveredId
      || node.id === selectedId
      || priorityIds.has(node.id)
      || Boolean(matchedIds?.has(node.id)))
    .sort((a, b) => {
      const activeA = a.id === hoveredId || a.id === selectedId ? 1 : 0
      const activeB = b.id === hoveredId || b.id === selectedId ? 1 : 0
      return activeB - activeA || b.degree - a.degree
    })
  const placed: Array<{ left: number; top: number; right: number; bottom: number }> = []
  for (const node of candidates) {
    const point = worldToScreen(node.x, node.y, size, transform)
    const radius = Math.max(3.2, node.radius * getFitScale(size, transform.scale))
    const text = truncateLabel(node.name, 25)
    const width = context.measureText(text).width
    const positions = [
      { x: point.x + radius + 5, y: point.y },
      { x: point.x - radius - width - 5, y: point.y },
      { x: point.x - width / 2, y: point.y - radius - 9 },
      { x: point.x - width / 2, y: point.y + radius + 9 },
    ]
    const position = positions.find(({ x, y }) => {
      const box = { left: x - 3, top: y - 7, right: x + width + 3, bottom: y + 7 }
      return box.left >= 5 && box.top >= 5 && box.right <= size.width - 5 && box.bottom <= size.height - 5
        && placed.every((other) => !rectanglesOverlap(box, other))
    })
    if (!position) continue
    placed.push({ left: position.x - 3, top: position.y - 7, right: position.x + width + 3, bottom: position.y + 7 })
    const visible = (!neighborhood || neighborhood.has(node.id)) && (!matchedIds || matchedIds.has(node.id))
    context.globalAlpha = visible ? node.kind === 'file' ? 0.9 : 0.78 : 0.12
    context.fillStyle = '#9aadb5'
    context.fillText(text, position.x, position.y)
  }
  context.globalAlpha = 1
}

export function buildSemanticLayout(
  data: CodeGraphData,
  viewMode: GraphViewMode = 'architecture',
): GraphLayout {
  if (data.nodes.length === 0) return { nodes: [], clusters: [] }
  const groups = new Map<string, CodeGraphNode[]>()
  for (const node of data.nodes) {
    const key = viewMode === 'architecture'
      ? node.communityId || node.filePath || '(project)'
      : node.filePath || '(project)'
    const group = groups.get(key) || []
    group.push(node)
    groups.set(key, group)
  }
  const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  const columns = Math.max(
    1,
    entries.length <= 4
      ? Math.ceil(Math.sqrt(entries.length))
      : Math.ceil(Math.sqrt(entries.length * 1.3)),
  )
  const rows = Math.ceil(entries.length / columns)
  const cellWidth = (WORLD_WIDTH - 120) / columns
  const cellHeight = (WORLD_HEIGHT - 100) / rows
  const clusterRadius = clamp(Math.min(cellWidth, cellHeight) * 0.4, 72, 148)
  const nodes: PositionedNode[] = []
  const clusters: GraphCluster[] = []

  entries.forEach(([key, group], index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const itemsInRow = Math.min(columns, entries.length - row * columns)
    const rowOffset = (columns - itemsInRow) * cellWidth / 2
    const centerX = 60 + rowOffset + column * cellWidth + cellWidth / 2
    const centerY = 50 + row * cellHeight + cellHeight / 2
    const ordered = [...group].sort((left, right) => {
      const rolePriority = viewMode === 'architecture'
        ? graphRolePriority(right.role) - graphRolePriority(left.role)
        : Number(right.kind === 'file') - Number(left.kind === 'file')
      return rolePriority || right.degree - left.degree || left.name.localeCompare(right.name)
    })
    const hub = viewMode === 'architecture'
      ? ordered.find((node) => node.role === 'hub') || ordered[0]!
      : ordered.find((node) => node.kind === 'file') || ordered[0]!
    const satellites = ordered.filter((node) => node.id !== hub.id)
    const positioned: PositionedNode[] = [{
      ...hub,
      x: centerX,
      y: centerY,
      radius: hub.kind === 'file' ? 15 : hub.role === 'hub' ? 12 : 10,
      clusterKey: key,
    }]
    satellites.forEach((node, satelliteIndex) => {
      const ringIndex = Math.floor(satelliteIndex / 10)
      const indexOnRing = satelliteIndex % 10
      const ringCount = Math.min(10, satellites.length - ringIndex * 10)
      const offset = ((hashString(key) % 360) * Math.PI) / 180
      const angle = offset + indexOnRing / Math.max(1, ringCount) * Math.PI * 2 + ringIndex * 0.35
      const distance = Math.min(clusterRadius - 13, 48 + ringIndex * 34 + (satelliteIndex % 3) * 4)
      positioned.push({
        ...node,
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance * 0.82,
        radius: 5.2 + Math.min(4.8, Math.sqrt(Math.max(0, node.degree)) * 0.72),
        clusterKey: key,
      })
    })
    nodes.push(...positioned)
    clusters.push({
      key,
      label: viewMode === 'architecture'
        ? group[0]?.communityLabel || key
        : key.split(/[\\/]/).pop() || key,
      kind: viewMode,
      x: centerX,
      y: centerY,
      radius: clusterRadius,
      nodeIds: positioned.map((node) => node.id),
    })
  })
  return { nodes, clusters }
}

function graphRolePriority(role: CodeGraphNode['role']) {
  return role === 'hub' ? 3 : role === 'bridge' ? 2 : 1
}

function getNeighborhoodIds(data: CodeGraphData, id: string) {
  const ids = new Set([id])
  for (const edge of data.edges) {
    if (edge.source === id) ids.add(edge.target)
    if (edge.target === id) ids.add(edge.source)
  }
  return ids
}

function getNodeConnections(
  data: CodeGraphData,
  id: string,
  nodeById: Map<string, PositionedNode>,
) {
  const connections: Array<{
    node: PositionedNode
    kind: string
    direction: 'in' | 'out'
    confidence: CodeGraphConfidence
    provenance: string | null
    line: number | null
  }> = []
  for (const edge of data.edges) {
    if (edge.source === id) {
      const node = nodeById.get(edge.target)
      if (node) connections.push({
        node,
        kind: edge.kind,
        direction: 'out',
        confidence: edge.confidence,
        provenance: edge.provenance,
        line: edge.line,
      })
    }
    if (edge.target === id) {
      const node = nodeById.get(edge.source)
      if (node) connections.push({
        node,
        kind: edge.kind,
        direction: 'in',
        confidence: edge.confidence,
        provenance: edge.provenance,
        line: edge.line,
      })
    }
  }
  return connections.sort((left, right) => right.node.degree - left.node.degree)
}

function drawNodeShape(context: CanvasRenderingContext2D, kind: string, point: ScreenPoint, radius: number) {
  context.beginPath()
  if (kind === 'file') {
    context.moveTo(point.x, point.y - radius)
    context.lineTo(point.x + radius, point.y)
    context.lineTo(point.x, point.y + radius)
    context.lineTo(point.x - radius, point.y)
    context.closePath()
    return
  }
  if (kind === 'constant' || kind === 'enum') {
    context.rect(point.x - radius * 0.72, point.y - radius * 0.72, radius * 1.44, radius * 1.44)
    return
  }
  if (kind === 'class' || kind === 'interface') {
    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 3 * index - Math.PI / 2
      const x = point.x + Math.cos(angle) * radius
      const y = point.y + Math.sin(angle) * radius
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
    return
  }
  context.arc(point.x, point.y, radius, 0, Math.PI * 2)
}

function curveControl(from: ScreenPoint, to: ScreenPoint, sourceId: string, targetId: string) {
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.max(1, Math.hypot(dx, dy))
  const direction = hashString(sourceId + targetId) % 2 === 0 ? 1 : -1
  const bend = Math.min(30, length * 0.12) * direction
  return { x: midpoint.x - dy / length * bend, y: midpoint.y + dx / length * bend }
}

function quadraticPoint(from: ScreenPoint, control: ScreenPoint, to: ScreenPoint, progress: number) {
  const inverse = 1 - progress
  return {
    x: inverse * inverse * from.x + 2 * inverse * progress * control.x + progress * progress * to.x,
    y: inverse * inverse * from.y + 2 * inverse * progress * control.y + progress * progress * to.y,
  }
}

function drawArrowHead(context: CanvasRenderingContext2D, from: ScreenPoint, to: ScreenPoint, color: string) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  context.save()
  context.translate(from.x, from.y)
  context.rotate(angle)
  context.beginPath()
  context.moveTo(4, 0)
  context.lineTo(-3, -2.5)
  context.lineTo(-3, 2.5)
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.restore()
}

function worldToScreen(x: number, y: number, size: { width: number; height: number }, transform: ViewTransform) {
  const scale = getFitScale(size, transform.scale)
  return {
    x: size.width / 2 + (x - WORLD_WIDTH / 2) * scale + transform.x,
    y: size.height / 2 + (y - WORLD_HEIGHT / 2) * scale + transform.y,
  }
}

function screenToWorld(x: number, y: number, size: { width: number; height: number }, transform: ViewTransform) {
  const scale = getFitScale(size, transform.scale)
  return {
    x: (x - size.width / 2 - transform.x) / scale + WORLD_WIDTH / 2,
    y: (y - size.height / 2 - transform.y) / scale + WORLD_HEIGHT / 2,
  }
}

function getFitScale(size: { width: number; height: number }, zoom: number) {
  return Math.min((size.width - 30) / WORLD_WIDTH, (size.height - 30) / WORLD_HEIGHT) * zoom
}

function matchesQuery(node: CodeGraphNode, query: string) {
  return [node.name, node.qualifiedName, node.filePath, node.kind, node.language]
    .some((value) => value.toLowerCase().includes(query))
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function truncateLabel(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value
}

function getRoleLabel(role: CodeGraphNode['role'], t: ReturnType<typeof useTranslation>) {
  switch (role) {
    case 'hub':
      return t('tokenOptimization.graph.role.hub')
    case 'bridge':
      return t('tokenOptimization.graph.role.bridge')
    default:
      return t('tokenOptimization.graph.role.member')
  }
}

function getConfidenceLabel(
  confidence: CodeGraphConfidence,
  t: ReturnType<typeof useTranslation>,
) {
  switch (confidence) {
    case 'extracted':
      return t('tokenOptimization.graph.confidence.extracted')
    case 'inferred':
      return t('tokenOptimization.graph.confidence.inferred')
    default:
      return t('tokenOptimization.graph.confidence.unknown')
  }
}

function rectanglesOverlap(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
}
