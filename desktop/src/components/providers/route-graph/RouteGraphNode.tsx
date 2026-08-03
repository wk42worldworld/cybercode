import {
  Bot,
  Braces,
  CircleDot,
  GitBranch,
  GitFork,
  LogIn,
  LogOut,
  Minus,
  Network,
  Plus,
  Scale,
} from 'lucide-react'
import { useEffect, type CSSProperties, type SyntheticEvent } from 'react'
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { useTranslation } from '../../../i18n'
import type {
  RouteAgentPort,
  RouteConditionKind,
  RouteConditionOperator,
  RouteDistributionMode,
  RouteGraphNodeConfig,
  RouteGraphNodeData,
  RouteGraphNodeKind,
  RouteResultMode,
  RoutingSource,
} from '../../../types/routing'
import {
  CONDITION_KINDS,
  CONDITION_OPERATORS,
  DISTRIBUTION_MODES,
  RESULT_MODES,
  uiConditionOperator,
} from './routeGraphOptions'
import {
  RouteGraphSelect,
  type RouteGraphSelectOption,
} from './RouteGraphSelect'
import { routeGraphProviderOption } from './routeGraphProviderOptions'
import { ImeSafeInput, ImeSafeTextarea } from './ImeSafeInput'
import {
  ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
  ROUTE_GRAPH_DISTRIBUTION_MAX_OUTPUTS,
  ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS,
} from '../../../utils/routeGraph'

export type RouteGraphNodeViewData = RouteGraphNodeData & {
  sources?: RoutingSource[]
  validationError?: boolean
  connectedOutputs?: number
  onConfigChange?: (patch: Partial<RouteGraphNodeConfig>) => void
}

export const ROUTE_GRAPH_AGENT_SPARE_OUTPUT_HANDLE = 'output:__spare__'
export const ROUTE_GRAPH_AGENT_MAX_OUTPUT_PORTS = 6
export const ROUTE_GRAPH_DISTRIBUTION_SPARE_OUTPUT_HANDLE = 'dist:__spare__'

type FlowRouteNode = Node<RouteGraphNodeViewData, 'routeGraphNode'>

function agentPortLabel(
  port: Pick<RouteAgentPort, 'id' | 'label'>,
  t: ReturnType<typeof useTranslation>,
): string {
  return ['simple', 'standard', 'complex'].includes(port.id)
    ? t(`settings.routing.graph.agent.branch.${port.id}` as never)
    : port.label
}

export const ROUTE_GRAPH_NODE_COLORS = {
  start: '#159455',
  model: '#1473e6',
  agent: '#c026d3',
  condition: '#d97706',
  distribution: '#7c3aed',
  parallel: '#0891b2',
  result: '#d14f76',
  relay: '#0f8a79',
  output: '#64748b',
} satisfies Record<RouteGraphNodeKind, string>

export function routeGraphNodeColor(kind: RouteGraphNodeKind): string {
  return ROUTE_GRAPH_NODE_COLORS[kind]
}

const ICONS = {
  start: LogIn,
  model: CircleDot,
  agent: Bot,
  condition: GitBranch,
  distribution: GitFork,
  parallel: Network,
  result: Scale,
  relay: Braces,
  output: LogOut,
} satisfies Record<RouteGraphNodeKind, typeof LogIn>

function agentPortTop(index: number, count: number): string {
  if (count <= 1) return '52%'
  return `${32 + (index / (count - 1)) * 58}%`
}

function inputHandles(data: RouteGraphNodeData): Array<{
  id: string
  top: string
  label?: string
}> {
  if (data.kind === 'start') return []
  if (data.kind !== 'agent') return [{ id: 'input', top: '50%' }]
  const ports = data.config.inputPorts ?? []
  return ports.map((port, index) => ({
    id: `input:${port.id}`,
    top: agentPortTop(index, ports.length),
    label: port.label,
  }))
}

function outputHandles(data: RouteGraphNodeViewData): Array<{
  id: string
  position: Position
  top: string
  label?: string
  spare?: boolean
}> {
  const kind = data.kind
  if (kind === 'output') return []
  if (kind === 'model') {
    return [
      { id: 'success', position: Position.Right, top: '40%' },
      { id: 'result', position: Position.Right, top: '62%' },
      { id: 'failure', position: Position.Right, top: '84%' },
    ]
  }
  if (kind === 'condition') {
    return [
      { id: 'true', position: Position.Right, top: '34%' },
      { id: 'false', position: Position.Right, top: '72%' },
    ]
  }
  if (kind === 'distribution') {
    const visibleCount = Math.max(
      ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS,
      data.config.distributionOutputCount
        ?? data.connectedOutputs
        ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
    )
    const handles: Array<{
      id: string
      position: Position
      top: string
      label?: string
      spare?: boolean
    }> = []
    for (let index = 1; index <= visibleCount; index += 1) {
      handles.push({
        id: `dist:${index}`,
        position: Position.Right,
        top: agentPortTop(index - 1, visibleCount),
        label: String(index),
      })
    }
    return handles
  }
  if (kind === 'agent') {
    const ports = data.config.outputPorts ?? []
    const hasSpare = ports.length < ROUTE_GRAPH_AGENT_MAX_OUTPUT_PORTS
    const visibleCount = ports.length + (hasSpare ? 1 : 0)
    const handles: Array<{
      id: string
      position: Position
      top: string
      label?: string
      spare?: boolean
    }> = ports.map((port, index) => ({
      id: `output:${port.id}`,
      position: Position.Right,
      top: agentPortTop(index, visibleCount),
      label: port.label,
    }))
    if (hasSpare) {
      handles.push({
        id: ROUTE_GRAPH_AGENT_SPARE_OUTPUT_HANDLE,
        position: Position.Right,
        top: agentPortTop(ports.length, visibleCount),
        label: '',
        spare: true,
      })
    }
    return handles
  }
  return [{
    id: 'flow',
    position: Position.Right,
    top: '50%',
  }]
}

function nodeSummary(data: RouteGraphNodeData, t: ReturnType<typeof useTranslation>): string {
  const config = data.config
  if (data.kind === 'model') {
    return config.modelId || t('settings.routing.graph.node.model.unconfigured')
  }
  if (data.kind === 'condition') {
    return t(`settings.routing.graph.condition.${config.condition ?? 'task'}` as never)
  }
  if (data.kind === 'agent') {
    const fallback = config.outputPorts?.find((port) => (
      port.id === config.fallbackOutputPortId
    ))
    return fallback ? agentPortLabel(fallback, t) : t('settings.routing.graph.node.agent.summary')
  }
  if (data.kind === 'distribution') {
    return t(`settings.routing.graph.distribution.${config.distributionMode ?? 'round-robin'}` as never)
  }
  if (data.kind === 'parallel') return t('settings.routing.graph.node.parallel.readOnly')
  if (data.kind === 'result') {
    return t(`settings.routing.graph.result.${config.resultMode ?? 'first-success'}` as never)
  }
  if (data.kind === 'relay') {
    return t(config.sessionSticky === false
      ? 'settings.routing.graph.node.relay.summary'
      : 'settings.routing.graph.node.relay.sticky')
  }
  return t(`settings.routing.graph.node.${data.kind}.summary` as never)
}

function InlineNodeSelect({
  label,
  value,
  disabled = false,
  title,
  onChange,
  options,
}: {
  label: string
  value: string
  disabled?: boolean
  title?: string
  onChange: (value: string) => void
  options: readonly RouteGraphSelectOption[]
}) {
  return (
    <RouteGraphSelect
      label={label}
      value={value}
      options={options}
      variant="node"
      disabled={disabled}
      title={title}
      onChange={onChange}
    />
  )
}

function InlineNodeInput({
  label,
  value,
  type = 'text',
  min,
  max,
  disabled = false,
  onChange,
}: {
  label: string
  value: string | number
  type?: 'text' | 'number'
  min?: number
  max?: number
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="route-graph-node-input">
      <span>{label}</span>
      <ImeSafeInput
        aria-label={label}
        type={type}
        min={min}
        max={max}
        value={String(value)}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  )
}

function InlineNodeTextarea({
  label,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="route-graph-node-textarea">
      <span>{label}</span>
      <ImeSafeTextarea
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        onChange={onChange}
      />
    </label>
  )
}

function InlineNodeSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="route-graph-node-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="route-graph-node-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}

export function RouteGraphNodeView({ id, data, selected }: NodeProps<FlowRouteNode>) {
  const t = useTranslation()
  const updateNodeInternals = useUpdateNodeInternals()
  const Icon = ICONS[data.kind]
  const active = Boolean(data.runtimeActive)
  const failed = data.runtimeStatus === 'failed'
  const providerSources = data.sources?.filter(
    (entry): entry is RoutingSource & { providerId: string } => Boolean(entry.providerId),
  ) ?? []
  const selectedSource = providerSources.find((entry) => (
    entry.providerId === data.config.providerId
  ))
  const selectedJudgeSource = providerSources.find((entry) => (
    entry.providerId === data.config.judgeProviderId
  ))
  const selectedAgentSource = providerSources.find((entry) => (
    entry.providerId === data.config.providerId
  ))
  const controlsDisabled = !data.onConfigChange
  const inputPortSignature = data.kind === 'agent'
    ? data.config.inputPorts?.map((port) => port.id).join('|') ?? ''
    : ''
  const outputPortSignature = data.kind === 'agent'
    ? data.config.outputPorts?.map((port) => port.id).join('|') ?? ''
    : ''
  const distributionPinCount = data.kind === 'distribution'
    ? Math.max(
        ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS,
        data.config.distributionOutputCount
          ?? data.connectedOutputs
          ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS,
      )
    : 0

  useEffect(() => {
    if (data.kind !== 'agent' && data.kind !== 'distribution') return
    updateNodeInternals(id)
  }, [data.kind, id, inputPortSignature, outputPortSignature, distributionPinCount, updateNodeInternals])

  const stopNodeInteraction = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  const updateConfig = (patch: Partial<RouteGraphNodeConfig>) => {
    data.onConfigChange?.(patch)
  }

  const inlineControls = (() => {
    if (data.kind === 'model') {
      return (
        <>
          <InlineNodeSelect
            label={t('settings.routing.graph.provider')}
            value={data.config.providerId ?? ''}
            disabled={controlsDisabled}
            title={selectedSource?.name ?? t('settings.routing.graph.chooseProvider')}
            options={[
              { value: '', label: t('settings.routing.graph.chooseProvider') },
              ...providerSources.map((entry) => routeGraphProviderOption(entry, t)),
            ]}
            onChange={(providerId) => {
              const nextSource = providerSources.find((entry) => entry.providerId === providerId)
              updateConfig({
                providerId: providerId || undefined,
                modelId: nextSource?.models[0]?.id,
              })
            }}
          />
          <InlineNodeSelect
            label={t('settings.routing.graph.model')}
            value={data.config.modelId ?? ''}
            disabled={controlsDisabled || !selectedSource}
            title={data.config.modelId ?? t('settings.routing.graph.chooseModel')}
            options={[
              { value: '', label: t('settings.routing.graph.chooseModel') },
              ...(selectedSource?.models.map((model) => ({
                value: model.id,
                label: model.id,
              })) ?? []),
            ]}
            onChange={(modelId) => updateConfig({ modelId: modelId || undefined })}
          />
        </>
      )
    }

    if (data.kind === 'condition') {
      const operator = uiConditionOperator(data.config.operator ?? 'is')
      return (
        <>
          <InlineNodeSelect
            label={t('settings.routing.graph.conditionLabel')}
            value={data.config.condition ?? 'task'}
            disabled={controlsDisabled}
            options={CONDITION_KINDS.map((entry) => ({
              value: entry,
              label: t(`settings.routing.graph.condition.${entry}` as never),
            }))}
            onChange={(condition) => updateConfig({
              condition: condition as RouteConditionKind,
              operator,
            })}
          />
          <InlineNodeSelect
            label={t('settings.routing.graph.operator')}
            value={operator}
            disabled={controlsDisabled}
            options={CONDITION_OPERATORS.map((entry) => ({
              value: entry,
              label: t(`settings.routing.graph.operator.${entry}` as never),
            }))}
            onChange={(nextOperator) => updateConfig({
              operator: nextOperator as RouteConditionOperator,
            })}
          />
          {!['known', 'unknown'].includes(operator) && (
            <InlineNodeInput
              label={t('settings.routing.graph.value')}
              value={String(data.config.value ?? '')}
              disabled={controlsDisabled}
              onChange={(value) => updateConfig({ value })}
            />
          )}
        </>
      )
    }

    if (data.kind === 'agent') {
      return (
        <>
          <InlineNodeSelect
            label={t('settings.routing.graph.agent.decisionProvider')}
            value={data.config.providerId ?? ''}
            disabled={controlsDisabled}
            options={[
              { value: '', label: t('settings.routing.graph.agent.autoProvider') },
              ...providerSources.map((entry) => routeGraphProviderOption(entry, t)),
            ]}
            onChange={(providerId) => {
              const nextSource = providerSources.find((entry) => entry.providerId === providerId)
              updateConfig({
                providerId: providerId || undefined,
                modelId: nextSource?.models[0]?.id,
              })
            }}
          />
          <InlineNodeSelect
            label={t('settings.routing.graph.agent.decisionModel')}
            value={data.config.modelId ?? ''}
            disabled={controlsDisabled || !selectedAgentSource}
            options={[
              { value: '', label: t('settings.routing.graph.chooseModel') },
              ...(selectedAgentSource?.models.map((model) => ({ value: model.id, label: model.id })) ?? []),
            ]}
            onChange={(modelId) => updateConfig({ modelId: modelId || undefined })}
          />
          <InlineNodeSelect
            label={t('settings.routing.graph.agent.fallback')}
            value={data.config.fallbackOutputPortId ?? data.config.outputPorts?.[0]?.id ?? ''}
            disabled={controlsDisabled}
            options={(data.config.outputPorts ?? []).map((port) => ({
              value: port.id,
              label: agentPortLabel(port, t),
            }))}
            onChange={(fallbackOutputPortId) => updateConfig({ fallbackOutputPortId })}
          />
          <InlineNodeTextarea
            label={t('settings.routing.graph.agent.instructions')}
            value={data.config.instructions ?? ''}
            placeholder={t('settings.routing.graph.agent.instructionsPlaceholder')}
            disabled={controlsDisabled}
            onChange={(instructions) => updateConfig({ instructions })}
          />
        </>
      )
    }

    if (data.kind === 'distribution') {
      return (
        <>
          <InlineNodeSelect
            label={t('settings.routing.graph.distributionLabel')}
            value={data.config.distributionMode ?? 'round-robin'}
            disabled={controlsDisabled}
            options={DISTRIBUTION_MODES.map((entry) => ({
              value: entry,
              label: t(`settings.routing.graph.distribution.${entry}` as never),
            }))}
            onChange={(distributionMode) => updateConfig({
              distributionMode: distributionMode as RouteDistributionMode,
            })}
          />
          <div className="route-graph-distribution-output-stepper">
            <span>{t('settings.routing.graph.distributionOutputs')}</span>
            <div>
              <button
                type="button"
                disabled={controlsDisabled || distributionPinCount <= ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS}
                aria-label={t('settings.routing.graph.removeDistributionOutput')}
                title={t('settings.routing.graph.removeDistributionOutput')}
                onClick={() => updateConfig({
                  distributionOutputCount: distributionPinCount - 1,
                })}
              >
                <Minus size={12} />
              </button>
              <output aria-label={t('settings.routing.graph.distributionOutputs')}>
                {distributionPinCount}
              </output>
              <button
                type="button"
                disabled={controlsDisabled || distributionPinCount >= ROUTE_GRAPH_DISTRIBUTION_MAX_OUTPUTS}
                aria-label={t('settings.routing.graph.addDistributionOutput')}
                title={t('settings.routing.graph.addDistributionOutput')}
                onClick={() => updateConfig({
                  distributionOutputCount: distributionPinCount + 1,
                })}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        </>
      )
    }

    if (data.kind === 'parallel') {
      return (
        <InlineNodeInput
          label={t('settings.routing.graph.maxConcurrency')}
          type="number"
          min={2}
          max={4}
          value={data.config.maxConcurrency ?? 4}
          disabled={controlsDisabled}
          onChange={(value) => updateConfig({
            maxConcurrency: Math.max(2, Math.min(4, Number(value) || 4)),
          })}
        />
      )
    }

    if (data.kind === 'result') {
      const resultMode = data.config.resultMode ?? 'first-success'
      return (
        <>
          <InlineNodeSelect
            label={t('settings.routing.graph.resultLabel')}
            value={resultMode}
            disabled={controlsDisabled}
            options={RESULT_MODES.map((entry) => ({
              value: entry,
              label: t(`settings.routing.graph.result.${entry}` as never),
            }))}
            onChange={(nextResultMode) => updateConfig({
              resultMode: nextResultMode as RouteResultMode,
            })}
          />
          {resultMode === 'judge' && (
            <>
              <InlineNodeSelect
                label={t('settings.routing.graph.judgeProvider')}
                value={data.config.judgeProviderId ?? ''}
                disabled={controlsDisabled}
                options={[
                  { value: '', label: t('settings.routing.graph.chooseProvider') },
                  ...providerSources.map((entry) => routeGraphProviderOption(entry, t)),
                ]}
                onChange={(judgeProviderId) => {
                  const nextSource = providerSources.find((entry) => (
                    entry.providerId === judgeProviderId
                  ))
                  updateConfig({
                    judgeProviderId: judgeProviderId || undefined,
                    judgeModelId: nextSource?.models[0]?.id,
                  })
                }}
              />
              <InlineNodeSelect
                label={t('settings.routing.graph.judgeModel')}
                value={data.config.judgeModelId ?? ''}
                disabled={controlsDisabled || !selectedJudgeSource}
                options={[
                  { value: '', label: t('settings.routing.graph.chooseModel') },
                  ...(selectedJudgeSource?.models.map((model) => ({
                    value: model.id,
                    label: model.id,
                  })) ?? []),
                ]}
                onChange={(judgeModelId) => updateConfig({
                  judgeModelId: judgeModelId || undefined,
                })}
              />
            </>
          )}
        </>
      )
    }

    if (data.kind === 'relay') {
      return (
        <InlineNodeSwitch
          label={t('settings.routing.graph.sessionSticky')}
          checked={data.config.sessionSticky !== false}
          disabled={controlsDisabled}
          onChange={(sessionSticky) => updateConfig({ sessionSticky })}
        />
      )
    }

    return null
  })()

  const agentPortCount = data.kind === 'agent'
    ? Math.max(
        data.config.inputPorts?.length ?? 0,
        Math.min(
          (data.config.outputPorts?.length ?? 0) + 1,
          ROUTE_GRAPH_AGENT_MAX_OUTPUT_PORTS,
        ),
      )
    : 0

  return (
    <div
      data-route-node-kind={data.kind}
      className={`route-graph-node ${selected ? 'is-selected' : ''} ${active ? 'is-runtime-active' : ''} ${failed ? 'is-runtime-failed' : ''} ${data.validationError ? 'is-validation-error' : ''}`}
      style={{
        '--route-node-accent': routeGraphNodeColor(data.kind),
        ...(data.kind === 'agent'
          ? { minHeight: `${Math.max(150, 74 + agentPortCount * 18)}px` }
          : {}),
        ...(data.kind === 'distribution'
          ? { minHeight: `${Math.max(114, 74 + distributionPinCount * 18)}px` }
          : {}),
      } as CSSProperties}
      aria-label={t(`settings.routing.graph.node.${data.kind}.name` as never)}
    >
      {inputHandles(data).map((handle) => (
        <div key={`target:${handle.id}`}>
          <Handle
            id={handle.id}
            type="target"
            position={Position.Left}
            style={{ top: handle.top }}
            className="route-graph-handle"
          />
          {data.kind === 'agent' && (
            <span
              className="route-graph-port-label is-input"
              style={{ top: handle.top }}
              title={handle.label}
            >
              {agentPortLabel({
                id: handle.id.slice('input:'.length),
                label: handle.label ?? '',
              }, t)}
            </span>
          )}
        </div>
      ))}

      <div className="route-graph-node-header">
        <span className="route-graph-node-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        <span>{data.label || t(`settings.routing.graph.node.${data.kind}.name` as never)}</span>
      </div>
      {inlineControls ? (
        <div
          className={`route-graph-node-controls route-graph-node-${data.kind}-controls nodrag nowheel`}
          onClick={stopNodeInteraction}
          onPointerDown={stopNodeInteraction}
        >
          {inlineControls}
        </div>
      ) : (
        <div className="route-graph-node-summary" title={nodeSummary(data, t)}>
          {nodeSummary(data, t)}
        </div>
      )}

      {outputHandles(data).map((handle) => (
        <div key={handle.id}>
          <Handle
            id={handle.id}
            type="source"
            position={handle.position}
            style={{ top: handle.top }}
            className={`route-graph-handle route-graph-handle-${handle.id}${handle.spare ? ' is-spare' : ''}`}
          />
          {(data.kind === 'model' || data.kind === 'condition' || data.kind === 'agent' || data.kind === 'distribution') && (
            <span
              className={`route-graph-port-label is-output${handle.spare ? ' is-spare' : ''} route-graph-port-label-${handle.id.replaceAll(':', '-')}`}
              style={{ top: handle.top }}
              title={handle.label}
            >
              {handle.spare
                ? '+'
                : data.kind === 'agent'
                  ? agentPortLabel(
                      (data.config.outputPorts ?? []).find((port) => `output:${port.id}` === handle.id)
                        ?? { id: handle.id.slice('output:'.length), label: handle.label ?? '' },
                      t,
                    )
                  : data.kind === 'distribution'
                    ? handle.label
                    : t(`settings.routing.graph.edge.${handle.id}` as never)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
