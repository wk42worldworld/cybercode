import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Library,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  Play,
  Redo2,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Unlink2,
  WandSparkles,
} from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './routeGraph.css'

import { useTranslation } from '../../../i18n'
import type {
  RouteGraph,
  RouteGraphEdge,
  RouteGraphNode,
  RouteGraphNodeConfig,
  RouteGraphNodeKind,
  RouteGraphValidation,
  RoutePreviewResult,
  RouteProfile,
  RoutingSource,
} from '../../../types/routing'
import {
  autoLayoutRouteGraph,
  buildRouteGraphTemplate,
  cloneRouteGraph,
  createRouteGraphEdge,
  createRouteGraphNode,
  dedupeRouteGraphEdges,
  hasRouteGraphConnection,
  legacyRouteToGraph,
  normalizeDistributionOutputHandles,
  pruneUnconnectedAgentOutputPorts,
  replaceRouteGraphNode,
  type RouteGraphTemplateId,
  validateRouteGraph,
} from '../../../utils/routeGraph'
import { RouteGraphInspector } from './RouteGraphInspector'
import {
  RouteGraphLibrary,
  type RouteGraphLibraryRoute,
} from './RouteGraphLibrary'
import { ConfirmDialog } from '../../shared/ConfirmDialog'
import {
  ROUTE_GRAPH_AGENT_MAX_OUTPUT_PORTS,
  ROUTE_GRAPH_AGENT_SPARE_OUTPUT_HANDLE,
  RouteGraphNodeView,
  type RouteGraphNodeViewData,
} from './RouteGraphNode'

const NODE_TYPES = { routeGraphNode: RouteGraphNodeView }
type RouteFlowNode = Node<RouteGraphNodeViewData, 'routeGraphNode'>
type GraphContextMenuPosition = {
  left: number
  top: number
}
type GraphContextMenuState = GraphContextMenuPosition & (
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'pane' }
)

const GRAPH_CONTEXT_MENU_WIDTH = 184
const GRAPH_CONTEXT_MENU_HEIGHT = 152
const GRAPH_CONTEXT_MENU_GUTTER = 8

function graphContextMenuPosition(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  canvas: HTMLElement | null,
): GraphContextMenuPosition {
  const bounds = canvas?.getBoundingClientRect()
  if (!bounds) return { left: event.clientX, top: event.clientY }
  const maxLeft = Math.max(
    GRAPH_CONTEXT_MENU_GUTTER,
    bounds.width - GRAPH_CONTEXT_MENU_WIDTH - GRAPH_CONTEXT_MENU_GUTTER,
  )
  const maxTop = Math.max(
    GRAPH_CONTEXT_MENU_GUTTER,
    bounds.height - GRAPH_CONTEXT_MENU_HEIGHT - GRAPH_CONTEXT_MENU_GUTTER,
  )
  return {
    left: Math.min(
      Math.max(event.clientX - bounds.left, GRAPH_CONTEXT_MENU_GUTTER),
      maxLeft,
    ),
    top: Math.min(
      Math.max(event.clientY - bounds.top, GRAPH_CONTEXT_MENU_GUTTER),
      maxTop,
    ),
  }
}

function graphSignature(graph: RouteGraph, name = ''): string {
  return JSON.stringify({ name, version: graph.version, nodes: graph.nodes, edges: graph.edges })
}

function connectionPortIds(connection: Connection | Edge): {
  sourcePortId?: string
  targetPortId?: string
} {
  return {
    sourcePortId: connection.sourceHandle?.startsWith('output:')
      ? connection.sourceHandle.slice('output:'.length)
      : undefined,
    targetPortId: connection.targetHandle?.startsWith('input:')
      ? connection.targetHandle.slice('input:'.length)
      : undefined,
  }
}

function edgePortIds(edge: RouteGraphEdge): {
  sourcePortId?: string
  targetPortId?: string
} {
  return {
    sourcePortId: edge.data.sourcePortId ?? (
      edge.sourceHandle?.startsWith('output:')
        ? edge.sourceHandle.slice('output:'.length)
        : undefined
    ),
    targetPortId: edge.data.targetPortId ?? (
      edge.targetHandle?.startsWith('input:')
        ? edge.targetHandle.slice('input:'.length)
        : undefined
    ),
  }
}

function withoutConflictingPortConnections(
  edges: RouteGraphEdge[],
  connection: Connection | Edge,
): RouteGraphEdge[] {
  const { sourcePortId, targetPortId } = connectionPortIds(connection)
  return edges.filter((edge) => {
    const edgePorts = edgePortIds(edge)
    if (
      connection.sourceHandle?.startsWith('dist:')
      && edge.source === connection.source
      && edge.sourceHandle === connection.sourceHandle
    ) return false
    if (
      sourcePortId
      && edge.source === connection.source
      && edgePorts.sourcePortId === sourcePortId
    ) return false
    if (
      targetPortId
      && edge.target === connection.target
      && edgePorts.targetPortId === targetPortId
    ) return false
    return true
  })
}

function transientNodes(
  nodes: RouteGraphNode[],
  selectedNodeId: string | null,
  preview: RoutePreviewResult | undefined,
  sources: RoutingSource[] = [],
  onConfigChange?: (
    nodeId: string,
    patch: Partial<RouteGraphNodeConfig>,
  ) => void,
  invalidNodeIds?: ReadonlySet<string>,
  outgoingCountByNode?: ReadonlyMap<string, number>,
): RouteFlowNode[] {
  const activeNodes = new Set(preview?.path ?? [])
  const statusByNode = new Map(preview?.nodes?.map((entry) => [entry.nodeId, entry.status]) ?? [])
  return nodes.map((entry) => ({
    ...entry,
    selected: entry.id === selectedNodeId,
    data: {
      ...entry.data,
      runtimeActive: activeNodes.has(entry.id),
      runtimeStatus: statusByNode.get(entry.id),
      validationError: invalidNodeIds?.has(entry.id) ?? false,
      connectedOutputs: outgoingCountByNode?.get(entry.id) ?? 0,
      sources,
      onConfigChange: onConfigChange
        ? (patch) => onConfigChange(entry.id, patch)
        : undefined,
    },
  }))
}

function materializeAgentSparePort(
  graph: RouteGraph,
  nodeId: string,
  portLabel: (index: number) => string,
): { graph: RouteGraph; sourceHandle: string } | null {
  const agent = graph.nodes.find((entry) => (
    entry.id === nodeId && entry.data.kind === 'agent'
  ))
  const ports = agent?.data.config.outputPorts ?? []
  if (!agent || ports.length >= ROUTE_GRAPH_AGENT_MAX_OUTPUT_PORTS) return null
  const used = new Set(ports.map((port) => port.id))
  let index = ports.length + 1
  let portId = `output-${index}`
  while (used.has(portId)) {
    index += 1
    portId = `output-${index}`
  }
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.map((entry) => entry.id === nodeId
        ? {
            ...entry,
            data: {
              ...entry.data,
              config: {
                ...entry.data.config,
                outputPorts: [
                  ...ports,
                  { id: portId, label: portLabel(index), description: '' },
                ],
              },
            },
          }
        : entry),
    },
    sourceHandle: `output:${portId}`,
  }
}

export function mergeRouteGraphFlowNodes(
  current: RouteFlowNode[],
  next: RouteFlowNode[],
): RouteFlowNode[] {
  const currentById = new Map(current.map((node) => [node.id, node]))
  return next.map((node) => ({
    ...currentById.get(node.id),
    ...node,
  }))
}

function transientEdges(
  edges: RouteGraphEdge[],
  selectedEdgeId: string | null,
  preview: RoutePreviewResult | undefined,
  t: ReturnType<typeof useTranslation>,
): Edge[] {
  const pathNodes = new Set(preview?.path ?? [])
  const explicitEdgePath = new Set(preview?.edgePath ?? [])
  return edges.map((entry) => {
    const active = explicitEdgePath.has(entry.id) || (
      pathNodes.has(entry.source) && pathNodes.has(entry.target)
    )
    const color = entry.data.kind === 'failure'
      ? 'var(--color-error)'
      : entry.data.kind === 'true'
        ? 'var(--color-success)'
        : entry.data.kind === 'false'
          ? 'var(--color-warning)'
          : active
            ? '#4da3ff'
            : 'var(--route-canvas-edge)'
    return {
      ...entry,
      selected: entry.id === selectedEdgeId,
      animated: active,
      label: entry.data.kind === 'flow'
        ? undefined
        : t(`settings.routing.graph.edge.${entry.data.kind}` as never),
      style: {
        stroke: color,
        strokeWidth: active ? 2.8 : entry.id === selectedEdgeId ? 2.4 : 1.8,
      },
      labelStyle: {
        fill: 'var(--route-canvas-edge-label)',
        fontSize: 9,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: 'var(--route-canvas-edge-label-bg)',
        fillOpacity: 0.96,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
      interactionWidth: 24,
    }
  })
}

export function RouteGraphEditor({
  profile,
  sources,
  preview,
  isSaving,
  isPreviewing,
  isPublishing,
  globallyEnabled = false,
  routeEnabled = false,
  error,
  onBack,
  onSaveDraft,
  onPreview,
  onPublish,
  onRollback,
  onUsageChange,
  availableRoutes = [],
  onSelectRoute,
  onDeleteRoute,
}: {
  profile: RouteProfile
  sources: RoutingSource[]
  preview?: RoutePreviewResult
  isSaving: boolean
  isPreviewing: boolean
  isPublishing: boolean
  globallyEnabled?: boolean
  routeEnabled?: boolean
  error: string | null
  onBack: () => void
  onSaveDraft: (graph: RouteGraph, name: string) => Promise<void>
  onPreview: (graph: RouteGraph) => Promise<RoutePreviewResult | null>
  onPublish: (graph: RouteGraph, name: string) => Promise<boolean>
  onRollback: () => Promise<boolean>
  onUsageChange?: (enabled: boolean) => Promise<void> | void
  availableRoutes?: RouteGraphLibraryRoute[]
  onSelectRoute?: (routeId: string) => void
  onDeleteRoute?: (routeId: string) => Promise<boolean>
}) {
  const t = useTranslation()
  const initialGraph = useMemo(
    () => normalizeDistributionOutputHandles(legacyRouteToGraph(profile, sources)),
    [profile.id],
  )
  const [graph, setGraphState] = useState<RouteGraph>(initialGraph)
  const [flowNodes, setFlowNodes] = useState<RouteFlowNode[]>(() => (
    transientNodes(initialGraph.nodes, null, undefined)
  ))
  const [name, setName] = useState(profile.draftName ?? profile.name)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [graphContextMenu, setGraphContextMenu] = useState<GraphContextMenuState | null>(null)
  const [paletteDragOverCanvas, setPaletteDragOverCanvas] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [bottomOpen, setBottomOpen] = useState(false)
  const [localValidationAttempted, setLocalValidationAttempted] = useState(false)
  const [previewSignature, setPreviewSignature] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [isLeaving, setIsLeaving] = useState(false)
  const [isDeletingRoute, setIsDeletingRoute] = useState(false)
  const [isUpdatingUsage, setIsUpdatingUsage] = useState(false)
  const [optimisticRouteInUse, setOptimisticRouteInUse] = useState<boolean | null>(null)
  const [routeToDelete, setRouteToDelete] = useState<RouteGraphLibraryRoute | null>(null)
  const [isApplyingVersionChange, setIsApplyingVersionChange] = useState(false)
  const graphRef = useRef(graph)
  const nameRef = useRef(name)
  const pastRef = useRef<RouteGraph[]>([])
  const futureRef = useRef<RouteGraph[]>([])
  const dragStartRef = useRef<RouteGraph | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)
  const flowRef = useRef<ReactFlowInstance<
    RouteFlowNode,
    Edge
  > | null>(null)
  const preserveViewportOnSelectionRef = useRef(false)
  const lastSavedSignatureRef = useRef(graphSignature(
    initialGraph,
    profile.draftName ?? profile.name,
  ))
  const saveSequenceRef = useRef(0)
  const saveRetryCountRef = useRef(0)
  const usageUpdateSequenceRef = useRef(0)
  const skipUnmountSaveRef = useRef(false)
  const suspendDraftSavesRef = useRef(false)
  const pendingDraftSavesRef = useRef<Promise<void>>(Promise.resolve())
  const pendingDraftSignaturesRef = useRef(new Map<
    string,
    { sequence: number; operation: Promise<void> }
  >())
  nameRef.current = name

  useEffect(() => {
    const next = normalizeDistributionOutputHandles(legacyRouteToGraph(profile, sources))
    graphRef.current = next
    setGraphState(next)
    setFlowNodes(transientNodes(next.nodes, null, undefined))
    const nextName = profile.draftName ?? profile.name
    setName(nextName)
    nameRef.current = nextName
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setGraphContextMenu(null)
    setPaletteDragOverCanvas(false)
    setActionsOpen(false)
    pastRef.current = []
    futureRef.current = []
    setHistoryVersion((value) => value + 1)
    lastSavedSignatureRef.current = graphSignature(next, nextName)
    usageUpdateSequenceRef.current += 1
    saveRetryCountRef.current = 0
    setIsUpdatingUsage(false)
    setOptimisticRouteInUse(null)
    skipUnmountSaveRef.current = false
    suspendDraftSavesRef.current = false
  }, [profile.id])

  const setGraphDirect = useCallback((next: RouteGraph) => {
    graphRef.current = next
    setGraphState(next)
  }, [])

  const commitGraph = useCallback((next: RouteGraph) => {
    const normalized = normalizeDistributionOutputHandles({
      ...next,
      version: next.nodes.some((entry) => entry.data.kind === 'agent') ? 3 as const : next.version,
      edges: dedupeRouteGraphEdges(next.edges),
    })
    if (graphSignature(normalized) === graphSignature(graphRef.current)) return
    pastRef.current = [...pastRef.current.slice(-49), cloneRouteGraph(graphRef.current)]
    futureRef.current = []
    setHistoryVersion((value) => value + 1)
    setGraphDirect(normalized)
    setPreviewSignature(null)
  }, [setGraphDirect])

  const updateNodeConfig = useCallback((
    nodeId: string,
    patch: Partial<RouteGraphNodeConfig>,
  ) => {
    const current = graphRef.current
    const currentNode = current.nodes.find((entry) => entry.id === nodeId)
    if (!currentNode) return
    const next = replaceRouteGraphNode(current, {
      ...currentNode,
      data: {
        ...currentNode.data,
        config: { ...currentNode.data.config, ...patch },
      },
    })
    commitGraph(next)
    if (selectedEdgeId && !next.edges.some((entry) => entry.id === selectedEdgeId)) {
      setSelectedEdgeId(null)
    }
  }, [commitGraph, selectedEdgeId])

  const recordDrag = useCallback(() => {
    const start = dragStartRef.current
    dragStartRef.current = null
    if (!start || graphSignature(start) === graphSignature(graphRef.current)) return
    pastRef.current = [...pastRef.current.slice(-49), start]
    futureRef.current = []
    setHistoryVersion((value) => value + 1)
    setPreviewSignature(null)
  }, [])

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1)
    if (!previous) return
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [cloneRouteGraph(graphRef.current), ...futureRef.current.slice(0, 49)]
    setGraphDirect(cloneRouteGraph(previous))
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setPreviewSignature(null)
    setHistoryVersion((value) => value + 1)
  }, [setGraphDirect])

  const redo = useCallback(() => {
    const next = futureRef.current[0]
    if (!next) return
    futureRef.current = futureRef.current.slice(1)
    pastRef.current = [...pastRef.current.slice(-49), cloneRouteGraph(graphRef.current)]
    setGraphDirect(cloneRouteGraph(next))
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setPreviewSignature(null)
    setHistoryVersion((value) => value + 1)
  }, [setGraphDirect])

  const persistDraft = useCallback(async (nextGraph: RouteGraph, nextName: string) => {
    if (suspendDraftSavesRef.current) return
    const signature = graphSignature(nextGraph, nextName)
    if (signature === lastSavedSignatureRef.current) return
    const pendingSignature = pendingDraftSignaturesRef.current.get(signature)
    if (pendingSignature?.sequence === saveSequenceRef.current) {
      await pendingSignature.operation
      return
    }
    const sequence = ++saveSequenceRef.current
    const graphSnapshot = cloneRouteGraph(nextGraph)
    const operation = pendingDraftSavesRef.current.then(async () => {
      await onSaveDraft(graphSnapshot, nextName)
      if (sequence === saveSequenceRef.current) {
        lastSavedSignatureRef.current = signature
      }
    })
    pendingDraftSignaturesRef.current.set(signature, { sequence, operation })
    void operation.then(
      () => {
        if (pendingDraftSignaturesRef.current.get(signature)?.sequence === sequence) {
          pendingDraftSignaturesRef.current.delete(signature)
        }
        if (sequence === saveSequenceRef.current) saveRetryCountRef.current = 0
      },
      () => {
        if (pendingDraftSignaturesRef.current.get(signature)?.sequence === sequence) {
          pendingDraftSignaturesRef.current.delete(signature)
        }
        // The debounce effect only refires on graph edits; without a retry a
        // transient failure (offline, server 500) would silently drop the
        // draft until the user types again.
        if (sequence === saveSequenceRef.current && saveRetryCountRef.current < 3) {
          saveRetryCountRef.current += 1
          window.setTimeout(() => {
            if (suspendDraftSavesRef.current) return
            const latestGraph = graphRef.current
            const latestName = nameRef.current
            if (graphSignature(latestGraph, latestName) === lastSavedSignatureRef.current) return
            void persistDraftRef.current(latestGraph, latestName)
          }, 4000)
        }
      },
    )
    pendingDraftSavesRef.current = operation.catch(() => {})
    await operation
  }, [onSaveDraft])

  const persistDraftRef = useRef(persistDraft)
  persistDraftRef.current = persistDraft

  useEffect(() => {
    if (suspendDraftSavesRef.current) return
    const signature = graphSignature(graph, name)
    if (signature === lastSavedSignatureRef.current) return
    const timer = window.setTimeout(() => {
      void persistDraft(graph, name)
    }, 550)
    return () => window.clearTimeout(timer)
  }, [graph, name, persistDraft])

  useEffect(() => () => {
    if (skipUnmountSaveRef.current || suspendDraftSavesRef.current) return
    const latestGraph = graphRef.current
    const latestName = nameRef.current
    if (graphSignature(latestGraph, latestName) === lastSavedSignatureRef.current) return
    void persistDraftRef.current(latestGraph, latestName)
  }, [])

  const localValidation = useMemo(
    () => validateRouteGraph(graph, sources),
    [graph, sources],
  )
  const errorNodeIds = useMemo(() => {
    // Start/Output stay neutral: an empty draft would otherwise light both
    // endpoints red before the user has drawn anything.
    const kindById = new Map(graph.nodes.map((entry) => [entry.id, entry.data.kind]))
    return new Set(localValidation.issues.flatMap((entry) => {
      if (entry.severity !== 'error' || !entry.nodeId) return []
      const kind = kindById.get(entry.nodeId)
      return kind === 'start' || kind === 'output' ? [] : [entry.nodeId]
    }))
  }, [localValidation, graph.nodes])
  const outgoingCountByNode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of graph.edges) {
      counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)
    }
    return counts
  }, [graph.edges])
  const currentSignature = graphSignature(graph, name)
  const currentPreview = previewSignature === currentSignature ? preview : undefined
  const validation = currentPreview?.validation ?? localValidation
  const selectedNode = graph.nodes.find((entry) => entry.id === selectedNodeId) ?? null
  const hasStart = graph.nodes.some((entry) => entry.data.kind === 'start')
  const hasOutput = graph.nodes.some((entry) => entry.data.kind === 'output')
  const hasPublishedGraph = Boolean(profile.graph)
  const committedRouteInUse = hasPublishedGraph && globallyEnabled && routeEnabled
  const routeInUse = optimisticRouteInUse ?? committedRouteInUse
  const isDraft = !profile.graph || currentSignature !== graphSignature(profile.graph, profile.name)
  const displayNodes = useMemo(
    () => transientNodes(
      graph.nodes,
      selectedNodeId,
      currentPreview,
      sources,
      updateNodeConfig,
      errorNodeIds,
      outgoingCountByNode,
    ),
    [graph.nodes, selectedNodeId, currentPreview, sources, updateNodeConfig, errorNodeIds, outgoingCountByNode],
  )
  const displayEdges = useMemo(
    () => transientEdges(graph.edges, selectedEdgeId, currentPreview, t),
    [graph.edges, selectedEdgeId, currentPreview, t],
  )

  useEffect(() => {
    setFlowNodes((current) => mergeRouteGraphFlowNodes(current, displayNodes))
  }, [displayNodes])

  useEffect(() => {
    if (preserveViewportOnSelectionRef.current) {
      preserveViewportOnSelectionRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      const instance = flowRef.current
      if (!instance) return
      const focusedNode = selectedNodeId
        ? graphRef.current.nodes.find((entry) => entry.id === selectedNodeId)
        : undefined
      void instance.fitView(focusedNode
        ? { nodes: [focusedNode], padding: 1.1, maxZoom: 0.9, duration: 140 }
        : { padding: 0.2, duration: 140 })
    }, 170)
    return () => window.clearTimeout(timer)
  }, [selectedNodeId])

  const deleteNode = useCallback((nodeId: string) => {
    const current = graphRef.current
    const nodeToDelete = current.nodes.find((entry) => entry.id === nodeId)
    if (!nodeToDelete || ['start', 'output'].includes(nodeToDelete.data.kind)) {
      setGraphContextMenu(null)
      return
    }
    commitGraph(pruneUnconnectedAgentOutputPorts({
      ...current,
      nodes: current.nodes.filter((entry) => entry.id !== nodeId),
      edges: current.edges.filter((entry) => (
        entry.source !== nodeId && entry.target !== nodeId
      )),
    }))
    setSelectedNodeId((currentId) => currentId === nodeId ? null : currentId)
    setSelectedEdgeId(null)
    setGraphContextMenu(null)
  }, [commitGraph])

  const removeSelection = useCallback(() => {
    if (!selectedNodeId && !selectedEdgeId) return
    if (selectedNodeId) {
      deleteNode(selectedNodeId)
      return
    } else if (selectedEdgeId) {
      commitGraph(pruneUnconnectedAgentOutputPorts({
        ...graphRef.current,
        edges: graphRef.current.edges.filter((entry) => entry.id !== selectedEdgeId),
      }))
      setSelectedEdgeId(null)
    }
    setGraphContextMenu(null)
  }, [commitGraph, deleteNode, selectedEdgeId, selectedNodeId])

  const disconnectEdge = useCallback((edgeId: string) => {
    if (!graphRef.current.edges.some((entry) => entry.id === edgeId)) {
      setGraphContextMenu(null)
      return
    }
    commitGraph(pruneUnconnectedAgentOutputPorts({
      ...graphRef.current,
      edges: graphRef.current.edges.filter((entry) => entry.id !== edgeId),
    }))
    setSelectedEdgeId((current) => current === edgeId ? null : current)
    setGraphContextMenu(null)
  }, [commitGraph])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && graphContextMenu) {
      event.preventDefault()
      setGraphContextMenu(null)
      return
    }
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelection()
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
  }

  const handleNodesChange = (changes: NodeChange<RouteFlowNode>[]) => {
    const removed = new Set(changes.filter((entry) => entry.type === 'remove').map((entry) => entry.id))
    const protectedIds = new Set(graphRef.current.nodes
      .filter((entry) => ['start', 'output'].includes(entry.data.kind))
      .map((entry) => entry.id))
    const acceptedChanges = changes.filter((entry) => (
      entry.type !== 'remove' || !protectedIds.has(entry.id)
    ))
    setFlowNodes((current) => applyNodeChanges<RouteFlowNode>(acceptedChanges, current))

    if (removed.size > 0) {
      const removable = new Set([...removed].filter((id) => {
        const entry = graphRef.current.nodes.find((nodeEntry) => nodeEntry.id === id)
        return entry && !['start', 'output'].includes(entry.data.kind)
      }))
      if (removable.size > 0) {
        commitGraph(pruneUnconnectedAgentOutputPorts({
          ...graphRef.current,
          nodes: graphRef.current.nodes.filter((entry) => !removable.has(entry.id)),
          edges: graphRef.current.edges.filter((entry) => (
            !removable.has(entry.source) && !removable.has(entry.target)
          )),
        }))
      }
      if (graphContextMenu?.kind === 'node' && removed.has(graphContextMenu.nodeId)) {
        setGraphContextMenu(null)
      }
    }

    const positions = new Map(changes.flatMap((entry) => (
      entry.type === 'position' && entry.position ? [[entry.id, entry.position] as const] : []
    )))
    if (positions.size > 0) {
      setGraphDirect({
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((entry) => (
          positions.has(entry.id)
            ? { ...entry, position: { ...positions.get(entry.id)! } }
            : entry
        )),
      })
    }
  }

  const handleEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.filter((entry) => entry.type === 'remove').map((entry) => entry.id))
    if (removed.size === 0) return
    commitGraph(pruneUnconnectedAgentOutputPorts({
      ...graphRef.current,
      edges: graphRef.current.edges.filter((entry) => !removed.has(entry.id)),
    }))
    if (
      graphContextMenu?.kind === 'edge'
      && removed.has(graphContextMenu.edgeId)
    ) setGraphContextMenu(null)
  }

  const addNode = useCallback((
    kind: RouteGraphNodeKind,
    position?: { x: number; y: number },
  ) => {
    const current = graphRef.current
    const kindAlreadyExists = current.nodes.some((entry) => entry.data.kind === kind)
    if ((kind === 'start' || kind === 'output') && kindAlreadyExists) return
    const nextNode = createRouteGraphNode(
      kind,
      position ?? { x: 280 + current.nodes.length * 18, y: 180 + current.nodes.length * 12 },
      current.nodes.map((entry) => entry.id),
      kind === 'agent'
        ? {
            input: t('settings.routing.graph.agent.inputDefault', { index: 1 }),
            outputs: [
              t('settings.routing.graph.agent.outputDefault', { index: 1 }),
              t('settings.routing.graph.agent.outputDefault', { index: 2 }),
            ],
          }
        : undefined,
    )
    commitGraph({ ...current, nodes: [...current.nodes, nextNode] })
    setSelectedNodeId(nextNode.id)
    setSelectedEdgeId(null)
    setLibraryOpen(false)
  }, [commitGraph, t])

  const duplicateNode = useCallback((nodeId: string) => {
    const current = graphRef.current
    const sourceNode = current.nodes.find((entry) => entry.id === nodeId)
    if (!sourceNode || ['start', 'output'].includes(sourceNode.data.kind)) {
      setGraphContextMenu(null)
      return
    }
    const nodeShell = createRouteGraphNode(
      sourceNode.data.kind,
      { x: sourceNode.position.x + 36, y: sourceNode.position.y + 36 },
      current.nodes.map((entry) => entry.id),
    )
    const nextNode: RouteGraphNode = {
      ...nodeShell,
      data: {
        ...sourceNode.data,
        config: {
          ...sourceNode.data.config,
          ...(sourceNode.data.config.inputPorts
            ? { inputPorts: sourceNode.data.config.inputPorts.map((port) => ({ ...port })) }
            : {}),
          ...(sourceNode.data.config.outputPorts
            ? { outputPorts: sourceNode.data.config.outputPorts.map((port) => ({ ...port })) }
            : {}),
          ...(sourceNode.data.config.branches
            ? { branches: sourceNode.data.config.branches.map((branch) => ({ ...branch })) }
            : {}),
        },
      },
    }
    preserveViewportOnSelectionRef.current = true
    commitGraph({ ...current, nodes: [...current.nodes, nextNode] })
    setSelectedNodeId(nextNode.id)
    setSelectedEdgeId(null)
    setGraphContextMenu(null)
  }, [commitGraph])

  const canDropNodeAt = useCallback((
    kind: RouteGraphNodeKind,
    point: { clientX: number; clientY: number },
  ) => {
    const current = graphRef.current
    if ((kind === 'start' || kind === 'output') && current.nodes.some(
      (entry) => entry.data.kind === kind,
    )) return false
    const bounds = canvasRef.current?.getBoundingClientRect()
    return Boolean(
      bounds
      && flowRef.current
      && point.clientX >= bounds.left
      && point.clientX <= bounds.right
      && point.clientY >= bounds.top
      && point.clientY <= bounds.bottom,
    )
  }, [])

  const dropPaletteNode = useCallback((
    kind: RouteGraphNodeKind,
    point: { clientX: number; clientY: number },
  ) => {
    if (!canDropNodeAt(kind, point)) return
    const position = flowRef.current?.screenToFlowPosition({
      x: point.clientX,
      y: point.clientY,
    })
    if (position) {
      preserveViewportOnSelectionRef.current = true
      addNode(kind, position)
    }
  }, [addNode, canDropNodeAt])

  const canConnect = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false
    return !hasRouteGraphConnection(
      graphRef.current.edges,
      connection.source,
      connection.target,
      connection.sourceHandle,
      connection.targetHandle,
    )
  }, [])

  const connect = (connection: Connection) => {
    if (!canConnect(connection) || !connection.source || !connection.target) return
    let working = graphRef.current
    let sourceHandle = connection.sourceHandle
    if (sourceHandle === ROUTE_GRAPH_AGENT_SPARE_OUTPUT_HANDLE) {
      const materialized = materializeAgentSparePort(
        working,
        connection.source,
        (index) => t('settings.routing.graph.agent.outputDefault', { index }),
      )
      if (!materialized) return
      working = materialized.graph
      sourceHandle = materialized.sourceHandle
    }
    const retainedEdges = withoutConflictingPortConnections(working.edges, {
      ...connection,
      sourceHandle,
    })
    const nextEdge = createRouteGraphEdge(
      connection.source,
      connection.target,
      sourceHandle,
      connection.targetHandle,
      retainedEdges.map((entry) => entry.id),
    )
    commitGraph(pruneUnconnectedAgentOutputPorts({
      ...working,
      edges: [...retainedEdges, nextEdge],
    }))
  }

  const reconnect = (oldEdge: Edge, connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    let working = graphRef.current
    let sourceHandle = connection.sourceHandle
    if (sourceHandle === ROUTE_GRAPH_AGENT_SPARE_OUTPUT_HANDLE) {
      const materialized = materializeAgentSparePort(
        working,
        connection.source,
        (index) => t('settings.routing.graph.agent.outputDefault', { index }),
      )
      if (!materialized) return
      working = materialized.graph
      sourceHandle = materialized.sourceHandle
    }
    const withoutOldEdge = working.edges.filter((entry) => entry.id !== oldEdge.id)
    if (hasRouteGraphConnection(
      withoutOldEdge,
      connection.source,
      connection.target,
      sourceHandle,
      connection.targetHandle,
    )) return
    const retainedEdges = withoutConflictingPortConnections(withoutOldEdge, {
      ...connection,
      sourceHandle,
    })
    const nextEdge = createRouteGraphEdge(
      connection.source,
      connection.target,
      sourceHandle,
      connection.targetHandle,
      retainedEdges.map((entry) => entry.id),
    )
    commitGraph(pruneUnconnectedAgentOutputPorts({
      ...working,
      edges: [...retainedEdges, nextEdge],
    }))
  }

  const applyTemplate = (templateId: RouteGraphTemplateId) => {
    commitGraph(buildRouteGraphTemplate(templateId, sources, {
      agentInstructions: t('settings.routing.graph.template.agent-difficulty.instructions'),
      agentInputLabel: t('settings.routing.graph.agent.inputDefault', { index: 1 }),
      agentOutputLabels: [
        t('settings.routing.graph.agent.branch.simple'),
        t('settings.routing.graph.agent.branch.standard'),
        t('settings.routing.graph.agent.branch.complex'),
      ],
      agentOutputDescriptions: [
        t('settings.routing.graph.agent.branch.simple.description'),
        t('settings.routing.graph.agent.branch.standard.description'),
        t('settings.routing.graph.agent.branch.complex.description'),
      ],
    }))
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setLibraryOpen(false)
    window.setTimeout(() => void flowRef.current?.fitView({ padding: 0.18, duration: 180 }), 0)
  }

  const autoLayout = () => {
    commitGraph(autoLayoutRouteGraph(graphRef.current))
    window.setTimeout(() => void flowRef.current?.fitView({ padding: 0.18, duration: 180 }), 0)
  }

  const fitGraphToView = () => {
    setGraphContextMenu(null)
    void flowRef.current?.fitView({ padding: 0.18, duration: 180 })
  }

  const runPreview = async () => {
    setLocalValidationAttempted(true)
    setBottomOpen(true)
    if (!localValidation.valid) return
    const signature = graphSignature(graphRef.current, name)
    const result = await onPreview(cloneRouteGraph(graphRef.current))
    if (result) setPreviewSignature(signature)
  }

  const publish = async () => {
    if (isApplyingVersionChange) return
    setLocalValidationAttempted(true)
    setBottomOpen(true)
    if (!localValidation.valid) return
    const graphSnapshot = cloneRouteGraph(graphRef.current)
    const nameSnapshot = nameRef.current
    const publishedSignature = graphSignature(graphSnapshot, nameSnapshot)
    setIsApplyingVersionChange(true)
    suspendDraftSavesRef.current = true
    let success = false
    try {
      await pendingDraftSavesRef.current
      success = await onPublish(graphSnapshot, nameSnapshot)
      if (success) {
        lastSavedSignatureRef.current = publishedSignature
        setPreviewSignature(null)
      }
    } finally {
      suspendDraftSavesRef.current = false
      setIsApplyingVersionChange(false)
      if (graphSignature(graphRef.current, nameRef.current) !== lastSavedSignatureRef.current) {
        void persistDraftRef.current(graphRef.current, nameRef.current)
      }
    }
  }

  const rollback = async () => {
    if (isApplyingVersionChange || isPublishing) return
    setIsApplyingVersionChange(true)
    suspendDraftSavesRef.current = true
    let success = false
    try {
      await pendingDraftSavesRef.current
      success = await onRollback()
      if (success) {
        skipUnmountSaveRef.current = true
        onBack()
      }
    } finally {
      if (!success) {
        suspendDraftSavesRef.current = false
        void persistDraftRef.current(graphRef.current, nameRef.current)
      }
      setIsApplyingVersionChange(false)
    }
  }

  const backToRoutes = async () => {
    if (isLeaving) return
    setIsLeaving(true)
    try {
      await persistDraft(graphRef.current, nameRef.current)
      onBack()
    } finally {
      setIsLeaving(false)
    }
  }

  const selectAvailableRoute = async (routeId: string) => {
    if (!onSelectRoute || routeId === profile.id || isLeaving) return
    setIsLeaving(true)
    try {
      await persistDraft(graphRef.current, nameRef.current)
      onSelectRoute(routeId)
    } finally {
      setIsLeaving(false)
    }
  }

  const deleteAvailableRoute = async () => {
    if (!routeToDelete || !onDeleteRoute || isLeaving || isDeletingRoute) return
    const deletingCurrentRoute = routeToDelete.id === profile.id
    let deleted = false
    setIsLeaving(true)
    setIsDeletingRoute(true)
    if (deletingCurrentRoute) {
      suspendDraftSavesRef.current = true
      skipUnmountSaveRef.current = true
      await pendingDraftSavesRef.current
    }
    try {
      deleted = await onDeleteRoute(routeToDelete.id)
      if (deleted) setRouteToDelete(null)
    } finally {
      if (!deleted && deletingCurrentRoute) {
        suspendDraftSavesRef.current = false
        skipUnmountSaveRef.current = false
        void persistDraftRef.current(graphRef.current, nameRef.current)
      }
      setIsDeletingRoute(false)
      setIsLeaving(false)
    }
  }

  const toggleRouteUsage = async () => {
    if (!onUsageChange || !hasPublishedGraph || isUpdatingUsage) return
    const nextRouteInUse = !routeInUse
    const sequence = ++usageUpdateSequenceRef.current
    setOptimisticRouteInUse(nextRouteInUse)
    setIsUpdatingUsage(true)
    try {
      await onUsageChange(nextRouteInUse)
    } finally {
      if (sequence === usageUpdateSequenceRef.current) {
        setOptimisticRouteInUse(null)
        setIsUpdatingUsage(false)
      }
    }
  }

  const issuesToShow = (localValidationAttempted || validation.issues.length > 0)
    ? validation.issues
    : []
  const contextNode = graphContextMenu?.kind === 'node'
    ? graph.nodes.find((entry) => entry.id === graphContextMenu.nodeId) ?? null
    : null
  const contextNodeIsProtected = contextNode
    ? ['start', 'output'].includes(contextNode.data.kind)
    : false

  return (
    <div
      className="route-graph-workspace"
      data-testid="route-graph-editor"
      data-history-version={historyVersion}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDownCapture={(event) => {
        if (!graphContextMenu) return
        const target = event.target
        if (!(target instanceof Element) || !target.closest('.route-graph-context-menu')) {
          setGraphContextMenu(null)
        }
      }}
    >
      <header className="route-graph-toolbar">
        <button
          type="button"
          className="route-graph-icon-button route-graph-back"
          aria-label={t('settings.routing.graph.back')}
          title={t('settings.routing.graph.back')}
          disabled={isLeaving || isApplyingVersionChange || isPublishing}
          onClick={() => void backToRoutes()}
        >
          <ArrowLeft size={17} />
        </button>

        <input
          className="route-graph-name"
          aria-label={t('settings.routing.builder.nameLabel')}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <span className={`route-graph-status ${isDraft ? 'is-draft' : 'is-published'}`}>
          <span className="route-graph-status-label">
            <span className={isSaving ? 'is-visible' : ''}>
              {t('settings.routing.graph.saving')}
            </span>
            <span className={!isSaving && isDraft ? 'is-visible' : ''}>
              {t('settings.routing.graph.draft')}
            </span>
            <span className={!isSaving && !isDraft ? 'is-visible' : ''}>
              {t('settings.routing.graph.published')}
            </span>
          </span>
        </span>

        {onUsageChange && (
          <button
            type="button"
            role="switch"
            aria-checked={routeInUse}
            aria-label={t('settings.routing.useRoute')}
            aria-busy={isUpdatingUsage || undefined}
            title={hasPublishedGraph
              ? t(routeInUse ? 'settings.routing.routeActive' : 'settings.routing.useRoute')
              : t('settings.routing.publishRequired')}
            className={`route-graph-use-switch ${routeInUse ? 'is-active' : ''}${
              isUpdatingUsage ? ' is-updating' : ''
            }`}
            disabled={!hasPublishedGraph || isUpdatingUsage || isPublishing || isApplyingVersionChange || isLeaving}
            onClick={() => void toggleRouteUsage()}
          >
            <span className="route-graph-use-switch-label" aria-hidden="true">
              <span className={routeInUse ? 'is-visible' : ''}>
                {t('settings.routing.routeActive')}
              </span>
              <span className={!routeInUse ? 'is-visible' : ''}>
                {t('settings.routing.useRoute')}
              </span>
            </span>
            <span className="route-graph-use-switch-track" aria-hidden="true">
              <span />
            </span>
          </button>
        )}

        <div className="route-graph-toolbar-spacer" />

        <div className="route-graph-toolbar-group">
          <ToolbarButton
            label={t('settings.routing.graph.undo')}
            disabled={pastRef.current.length === 0}
            onClick={undo}
          ><Undo2 size={16} /></ToolbarButton>
          <ToolbarButton
            label={t('settings.routing.graph.redo')}
            disabled={futureRef.current.length === 0}
            onClick={redo}
          ><Redo2 size={16} /></ToolbarButton>
          <ToolbarButton label={t('settings.routing.graph.autoLayout')} onClick={autoLayout}>
            <WandSparkles size={16} />
          </ToolbarButton>
        </div>

        <div className="route-graph-mobile-actions">
          <button
            type="button"
            data-testid="route-graph-mobile-actions"
            className="route-graph-icon-button"
            aria-label={t('settings.routing.graph.moreActions')}
            title={t('settings.routing.graph.moreActions')}
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((value) => !value)}
          >
            <MoreHorizontal size={16} />
          </button>
          {actionsOpen && (
            <div className="route-graph-mobile-actions-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={pastRef.current.length === 0}
                onClick={() => {
                  undo()
                  setActionsOpen(false)
                }}
              >
                <Undo2 size={15} />
                <span>{t('settings.routing.graph.undo')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={futureRef.current.length === 0}
                onClick={() => {
                  redo()
                  setActionsOpen(false)
                }}
              >
                <Redo2 size={15} />
                <span>{t('settings.routing.graph.redo')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  autoLayout()
                  setActionsOpen(false)
                }}
              >
                <WandSparkles size={15} />
                <span>{t('settings.routing.graph.autoLayout')}</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          data-testid="route-graph-mobile-library"
          className="route-graph-icon-button route-graph-mobile-tool"
          aria-label={t('settings.routing.graph.library')}
          title={t('settings.routing.graph.library')}
          onClick={() => setLibraryOpen((value) => !value)}
        >
          <Library size={16} />
        </button>

        <button
          type="button"
          className="route-graph-preview-button"
          disabled={isPreviewing || isPublishing || isApplyingVersionChange}
          onClick={() => void runPreview()}
        >
          <Play size={15} />
          <span>{isPreviewing ? t('settings.routing.graph.running') : t('settings.routing.graph.preview')}</span>
        </button>
        <button
          type="button"
          className="route-graph-publish-button"
          disabled={isPublishing || isPreviewing || isApplyingVersionChange || !name.trim()}
          onClick={() => void publish()}
        >
          <Save size={15} />
          <span>{isPublishing ? t('settings.routing.graph.publishing') : t('settings.routing.graph.publish')}</span>
        </button>

        {hasPublishedGraph && profile.previousGraph && (
          <ToolbarButton
            label={t('settings.routing.graph.rollback')}
            disabled={isPublishing || isSaving || isApplyingVersionChange || isLeaving}
            onClick={() => void rollback()}
          ><RotateCcw size={16} /></ToolbarButton>
        )}
        {!profile.previousGraph && (
          <span className="route-graph-more-placeholder" aria-hidden="true">
            <MoreHorizontal size={16} />
          </span>
        )}
      </header>

      <div className="route-graph-main">
        <RouteGraphLibrary
          open={libraryOpen}
          hasStart={hasStart}
          hasOutput={hasOutput}
          onClose={() => setLibraryOpen(false)}
          onAddNode={addNode}
          onApplyTemplate={applyTemplate}
          canDropNodeAt={canDropNodeAt}
          onDropNode={dropPaletteNode}
          onDragTargetChange={setPaletteDragOverCanvas}
          routes={availableRoutes}
          routesDisabled={isLeaving || isDeletingRoute || isApplyingVersionChange || isPublishing}
          onSelectRoute={(routeId) => void selectAvailableRoute(routeId)}
          onDeleteRoute={onDeleteRoute ? setRouteToDelete : undefined}
        />

        <main
          ref={canvasRef}
          className={`route-graph-canvas${paletteDragOverCanvas ? ' is-palette-drag-over' : ''}`}
          data-testid="route-graph-canvas"
        >
          <ReactFlow
            nodes={flowNodes}
            edges={displayEdges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => {
              flowRef.current = instance
            }}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={connect}
            onReconnect={reconnect}
            edgesReconnectable
            isValidConnection={canConnect}
            onNodeClick={(_event, node) => {
              setGraphContextMenu(null)
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
            }}
            onEdgeClick={(_event, edge) => {
              setGraphContextMenu(null)
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              event.stopPropagation()
              preserveViewportOnSelectionRef.current = true
              setSelectedNodeId(node.id)
              setSelectedEdgeId(null)
              setGraphContextMenu({
                kind: 'node',
                nodeId: node.id,
                ...graphContextMenuPosition(event, canvasRef.current),
              })
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault()
              event.stopPropagation()
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
              setGraphContextMenu({
                kind: 'edge',
                edgeId: edge.id,
                ...graphContextMenuPosition(event, canvasRef.current),
              })
            }}
            onPaneClick={() => {
              setGraphContextMenu(null)
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
              setGraphContextMenu({
                kind: 'pane',
                ...graphContextMenuPosition(event, canvasRef.current),
              })
            }}
            onMoveStart={() => setGraphContextMenu(null)}
            onNodeDragStart={() => {
              setGraphContextMenu(null)
              dragStartRef.current = cloneRouteGraph(graphRef.current)
            }}
            onNodeDragStop={recordDrag}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.35}
            maxZoom={1.65}
            deleteKeyCode={null}
            selectNodesOnDrag={false}
            snapToGrid
            snapGrid={[12, 12]}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              id="route-grid-minor"
              variant={BackgroundVariant.Lines}
              gap={18}
              lineWidth={0.65}
              color="#18212c"
            />
            <Background
              id="route-grid-major"
              variant={BackgroundVariant.Lines}
              gap={90}
              lineWidth={1}
              color="#293647"
            />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>

          {graphContextMenu && (
            <div
              className="route-graph-context-menu"
              data-testid={`route-graph-${graphContextMenu.kind}-context-menu`}
              role="menu"
              aria-label={t('settings.routing.graph.contextMenu')}
              style={{ left: graphContextMenu.left, top: graphContextMenu.top }}
              onContextMenu={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
            >
              {graphContextMenu.kind === 'node' && contextNode && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={() => {
                      setSelectedNodeId(contextNode.id)
                      setSelectedEdgeId(null)
                      setGraphContextMenu(null)
                    }}
                  >
                    <SlidersHorizontal size={15} />
                    <span>{t('settings.routing.graph.inspector')}</span>
                  </button>
                  {!contextNodeIsProtected && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => duplicateNode(contextNode.id)}
                      >
                        <Copy size={15} />
                        <span>{t('settings.routing.graph.duplicateNode')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => deleteNode(contextNode.id)}
                      >
                        <Trash2 size={15} />
                        <span>{t('settings.routing.graph.deleteNode')}</span>
                      </button>
                    </>
                  )}
                </>
              )}
              {graphContextMenu.kind === 'edge' && (
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  autoFocus
                  onClick={() => disconnectEdge(graphContextMenu.edgeId)}
                >
                  <Unlink2 size={15} />
                  <span>{t('settings.routing.graph.disconnectConnection')}</span>
                </button>
              )}
              {graphContextMenu.kind === 'pane' && (
                <>
                  <button type="button" role="menuitem" autoFocus onClick={fitGraphToView}>
                    <Maximize2 size={15} />
                    <span>{t('settings.routing.graph.fitView')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      autoLayout()
                      setGraphContextMenu(null)
                    }}
                  >
                    <WandSparkles size={15} />
                    <span>{t('settings.routing.graph.autoLayout')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pastRef.current.length === 0}
                    onClick={() => {
                      undo()
                      setGraphContextMenu(null)
                    }}
                  >
                    <Undo2 size={15} />
                    <span>{t('settings.routing.graph.undo')}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={futureRef.current.length === 0}
                    onClick={() => {
                      redo()
                      setGraphContextMenu(null)
                    }}
                  >
                    <Redo2 size={15} />
                    <span>{t('settings.routing.graph.redo')}</span>
                  </button>
                </>
              )}
            </div>
          )}

          {!selectedNode && (
            <button
              type="button"
              className="route-graph-mobile-inspector"
              aria-label={t('settings.routing.graph.inspector')}
              disabled
            >
              <PanelRight size={15} />
            </button>
          )}
        </main>

        {selectedNode && (
          <RouteGraphInspector
            node={selectedNode}
            sources={sources}
            onClose={() => setSelectedNodeId(null)}
            onChange={(next) => commitGraph(replaceRouteGraphNode(graphRef.current, next))}
            onDelete={removeSelection}
          />
        )}
      </div>

      <RouteGraphBottomPanel
        open={bottomOpen}
        nodes={graph.nodes}
        validation={validation}
        preview={currentPreview}
        issues={issuesToShow}
        error={error}
        onToggle={() => setBottomOpen((value) => !value)}
        onSelectNode={(nodeId) => {
          setSelectedNodeId(nodeId)
          setSelectedEdgeId(null)
        }}
      />

      <ConfirmDialog
        open={routeToDelete !== null}
        onClose={() => {
          if (!isDeletingRoute) setRouteToDelete(null)
        }}
        onConfirm={deleteAvailableRoute}
        title={t('settings.routing.deleteTitle')}
        body={t('settings.routing.deleteBody', { name: routeToDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isDeletingRoute}
        size="compact"
      />
    </div>
  )
}

function ToolbarButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="route-graph-icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function RouteGraphBottomPanel({
  open,
  nodes,
  validation,
  preview,
  issues,
  error,
  onToggle,
  onSelectNode,
}: {
  open: boolean
  nodes: RouteGraphNode[]
  validation: RouteGraphValidation
  preview?: RoutePreviewResult
  issues: RouteGraphValidation['issues']
  error: string | null
  onToggle: () => void
  onSelectNode: (nodeId: string) => void
}) {
  const t = useTranslation()
  const errorCount = issues.filter((entry) => entry.severity === 'error').length
  const warningCount = issues.filter((entry) => entry.severity === 'warning').length
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const previewAgent = preview?.path
    .map((nodeId) => nodeById.get(nodeId))
    .find((node) => node?.data.kind === 'agent')
  const previewAgentFallback = previewAgent?.data.config.outputPorts?.find((port) => (
    port.id === previewAgent.data.config.fallbackOutputPortId
  ))
  const nodeDisplayName = (nodeId: string): string => {
    const node = nodeById.get(nodeId)
    if (!node) return nodeId
    return node.data.label || node.data.config.modelId ||
      t(`settings.routing.graph.node.${node.data.kind}.name` as never)
  }

  return (
    <footer className="route-graph-bottom" data-open={open ? 'true' : 'false'}>
      <button type="button" className="route-graph-bottom-toggle" onClick={onToggle}>
        <span className={validation.valid ? 'is-valid' : 'is-invalid'}>
          {validation.valid
            ? t('settings.routing.graph.validation.ready')
            : t('settings.routing.graph.validation.blocked')}
        </span>
        <span>{t('settings.routing.graph.validation.counts', {
          errors: errorCount,
          warnings: warningCount,
        })}</span>
        <span className="route-graph-safety-limits">
          {t('settings.routing.graph.safetyLimits', { depth: 24, attempts: 8, parallel: 4 })}
        </span>
        {preview?.path.length ? (
          <span>{t('settings.routing.graph.previewPathCount', { count: preview.path.length })}</span>
        ) : null}
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>

      {open && (
        <div className="route-graph-bottom-content">
          {error && <p className="route-graph-api-error">{error}</p>}
          {issues.length === 0 && !preview && !error && (
            <p>{t('settings.routing.graph.validation.noIssues')}</p>
          )}
          {issues.map((entry, index) => {
            const translated = entry.messageKey ? t(entry.messageKey as never) : ''
            const message = translated && translated !== entry.messageKey
              ? translated
              : entry.message || entry.code
            return (
              <button
                key={`${entry.code}:${entry.nodeId ?? entry.edgeId ?? index}`}
                type="button"
                className={`route-graph-issue is-${entry.severity}`}
                disabled={!entry.nodeId}
                onClick={() => entry.nodeId && onSelectNode(entry.nodeId)}
              >
                <span>{entry.severity === 'error' ? '!' : 'i'}</span>
                {message}
              </button>
            )
          })}
          {preview && preview.path.length > 0 && (
            <div className="route-graph-preview-path">
              <strong>{t('settings.routing.graph.previewPath')}</strong>
              <div>
                {preview.path.map((nodeId, index) => (
                  <button
                    key={`${nodeId}:${index}`}
                    type="button"
                    title={nodeId}
                    onClick={() => onSelectNode(nodeId)}
                  >
                    {nodeDisplayName(nodeId)}
                  </button>
                ))}
              </div>
              <span>
                {preview.totalLatencyMs !== undefined
                  ? `${preview.totalLatencyMs} ms`
                  : ''}
                {preview.inputTokens !== undefined || preview.outputTokens !== undefined
                  ? ` · ${t('settings.routing.graph.tokens', {
                      input: preview.inputTokens ?? 0,
                      output: preview.outputTokens ?? 0,
                    })}`
                  : ''}
              </span>
              {previewAgentFallback && (
                <small className="route-graph-preview-agent-note">
                  {t('settings.routing.graph.agent.staticPreview', {
                    branch: ['simple', 'standard', 'complex'].includes(previewAgentFallback.id)
                      ? t(`settings.routing.graph.agent.branch.${previewAgentFallback.id}` as never)
                      : previewAgentFallback.label,
                  })}
                </small>
              )}
            </div>
          )}
        </div>
      )}
    </footer>
  )
}
