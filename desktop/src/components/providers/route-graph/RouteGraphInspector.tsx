import { ChevronDown, Minus, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import type {
  RouteAgentPort,
  RouteConditionKind,
  RouteConditionOperator,
  RouteDistributionMode,
  RouteGraphNode,
  RouteGraphNodeConfig,
  RouteResultMode,
  RoutingSource,
} from '../../../types/routing'
import { Switch } from '../../settings/SettingsLayout'
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

function agentPortLabel(
  port: Pick<RouteAgentPort, 'id' | 'label'>,
  t: ReturnType<typeof useTranslation>,
): string {
  return ['simple', 'standard', 'complex'].includes(port.id)
    ? t(`settings.routing.graph.agent.branch.${port.id}` as never)
    : port.label
}

function nextAgentPortId(side: 'input' | 'output', ports: RouteAgentPort[]): string {
  const used = new Set(ports.map((port) => port.id))
  let suffix = ports.length + 1
  while (used.has(`${side}-${suffix}`)) suffix += 1
  return `${side}-${suffix}`
}

export function RouteGraphInspector({
  node,
  sources,
  onChange,
  onDelete,
  onClose,
}: {
  node: RouteGraphNode
  sources: RoutingSource[]
  onChange: (next: RouteGraphNode) => void
  onDelete: () => void
  onClose: () => void
}) {
  const t = useTranslation()
  const config = node.data.config
  const source = sources.find((entry) => entry.providerId === config.providerId)
  const updateConfig = (patch: Partial<RouteGraphNodeConfig>) => {
    onChange({
      ...node,
      data: {
        ...node.data,
        config: { ...node.data.config, ...patch },
      },
    })
  }

  return (
    <aside
      data-testid="route-graph-inspector"
      className="route-graph-inspector"
      aria-label={t('settings.routing.graph.inspector')}
    >
      <div className="route-graph-panel-heading">
        <span>{t(`settings.routing.graph.node.${node.data.kind}.name` as never)}</span>
        <button type="button" aria-label={t('common.close')} onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="route-graph-inspector-scroll">
        <InspectorField label={t('settings.routing.graph.label')}>
          <ImeSafeInput
            value={node.data.label ?? ''}
            placeholder={t(`settings.routing.graph.node.${node.data.kind}.name` as never)}
            onChange={(label) => onChange({
              ...node,
              data: { ...node.data, label },
            })}
          />
        </InspectorField>

        {node.data.kind === 'model' && (
          <>
            <InspectorSelect
              label={t('settings.routing.graph.provider')}
              value={config.providerId ?? ''}
              options={[
                { value: '', label: t('settings.routing.graph.chooseProvider') },
                ...sources.flatMap((entry) => (
                  entry.providerId ? [routeGraphProviderOption(entry, t)] : []
                )),
              ]}
              onChange={(providerId) => {
                const nextSource = sources.find((entry) => entry.providerId === providerId)
                updateConfig({
                  providerId: providerId || undefined,
                  modelId: nextSource?.models[0]?.id,
                })
              }}
            />
            <InspectorSelect
              label={t('settings.routing.graph.model')}
              value={config.modelId ?? ''}
              disabled={!source}
              options={[
                { value: '', label: t('settings.routing.graph.chooseModel') },
                ...(source?.models.map((model) => ({
                  value: model.id,
                  label: model.id,
                })) ?? []),
              ]}
              onChange={(modelId) => updateConfig({ modelId: modelId || undefined })}
            />
          </>
        )}

        {node.data.kind === 'condition' && (
          <>
            <InspectorSelect
              label={t('settings.routing.graph.conditionLabel')}
              value={config.condition ?? 'task'}
              options={CONDITION_KINDS.map((entry) => ({
                value: entry,
                label: t(`settings.routing.graph.condition.${entry}` as never),
              }))}
              onChange={(condition) => updateConfig({
                condition: condition as RouteConditionKind,
                operator: uiConditionOperator(config.operator ?? 'is'),
              })}
            />
            <InspectorSelect
              label={t('settings.routing.graph.operator')}
              value={uiConditionOperator(config.operator ?? 'is')}
              options={CONDITION_OPERATORS.map((entry) => ({
                value: entry,
                label: t(`settings.routing.graph.operator.${entry}` as never),
              }))}
              onChange={(operator) => updateConfig({ operator: operator as RouteConditionOperator })}
            />
            {!['known', 'unknown'].includes(config.operator ?? '') && (
              <InspectorField label={t('settings.routing.graph.value')}>
                <ImeSafeInput
                  value={String(config.value ?? '')}
                  onChange={(value) => updateConfig({ value })}
                />
              </InspectorField>
            )}
            {config.condition === 'quota' && <UnknownQuotaNotice />}
          </>
        )}

        {node.data.kind === 'agent' && (
          <>
            <InspectorSelect
              label={t('settings.routing.graph.agent.decisionProvider')}
              value={config.providerId ?? ''}
              options={[
                { value: '', label: t('settings.routing.graph.agent.autoProvider') },
                ...sources.flatMap((entry) => (
                  entry.providerId ? [routeGraphProviderOption(entry, t)] : []
                )),
              ]}
              onChange={(providerId) => {
                const nextSource = sources.find((entry) => entry.providerId === providerId)
                updateConfig({
                  providerId: providerId || undefined,
                  modelId: nextSource?.models[0]?.id,
                })
              }}
            />
            <InspectorSelect
              label={t('settings.routing.graph.agent.decisionModel')}
              value={config.modelId ?? ''}
              disabled={!source}
              options={[
                { value: '', label: t('settings.routing.graph.chooseModel') },
                ...(source?.models.map((model) => ({ value: model.id, label: model.id })) ?? []),
              ]}
              onChange={(modelId) => updateConfig({ modelId: modelId || undefined })}
            />
            <InspectorSelect
              label={t('settings.routing.graph.agent.fallback')}
              value={config.fallbackOutputPortId ?? config.outputPorts?.[0]?.id ?? ''}
              options={(config.outputPorts ?? []).map((port) => ({
                value: port.id,
                label: agentPortLabel(port, t),
              }))}
              onChange={(fallbackOutputPortId) => updateConfig({ fallbackOutputPortId })}
            />
            <AgentPortEditor
              side="input"
              ports={config.inputPorts ?? []}
              minPorts={1}
              onChange={(inputPorts) => updateConfig({ inputPorts })}
            />
            <AgentPortEditor
              side="output"
              ports={config.outputPorts ?? []}
              minPorts={2}
              onChange={(outputPorts) => updateConfig({
                outputPorts,
                fallbackOutputPortId: outputPorts.some((port) => (
                  port.id === config.fallbackOutputPortId
                ))
                  ? config.fallbackOutputPortId
                  : outputPorts[0]?.id,
              })}
            />
            <InspectorField label={t('settings.routing.graph.agent.instructions')}>
              <ImeSafeTextarea
                rows={5}
                maxLength={4_000}
                value={config.instructions ?? ''}
                placeholder={t('settings.routing.graph.agent.instructionsPlaceholder')}
                onChange={(instructions) => updateConfig({ instructions })}
              />
            </InspectorField>
            <details className="route-graph-advanced">
              <summary>
                <span>{t('settings.routing.graph.advanced')}</span>
                <ChevronDown size={14} />
              </summary>
              <InspectorField label={t('settings.routing.graph.agent.confidence')}>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.confidenceThreshold ?? 0.6}
                  onChange={(event) => updateConfig({
                    confidenceThreshold: Math.max(0, Math.min(1, Number(event.target.value) || 0)),
                  })}
                />
              </InspectorField>
              <InspectorField label={t('settings.routing.graph.agent.timeout')}>
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  step="1000"
                  value={config.timeoutMs ?? 8_000}
                  onChange={(event) => updateConfig({
                    timeoutMs: Math.max(1_000, Math.min(30_000, Number(event.target.value) || 8_000)),
                  })}
                />
              </InspectorField>
              <InspectorField label={t('settings.routing.graph.agent.maxInputChars')}>
                <input
                  type="number"
                  min="200"
                  max="16000"
                  step="200"
                  value={config.maxInputChars ?? 4_000}
                  onChange={(event) => updateConfig({
                    maxInputChars: Math.max(200, Math.min(16_000, Number(event.target.value) || 4_000)),
                  })}
                />
              </InspectorField>
            </details>
          </>
        )}

        {node.data.kind === 'distribution' && (
          <>
            <InspectorSelect
              label={t('settings.routing.graph.distributionLabel')}
              value={config.distributionMode ?? 'round-robin'}
              options={DISTRIBUTION_MODES.map((entry) => ({
                value: entry,
                label: t(`settings.routing.graph.distribution.${entry}` as never),
              }))}
              onChange={(distributionMode) => updateConfig({
                distributionMode: distributionMode as RouteDistributionMode,
              })}
            />
            <div className="route-graph-field">
              <span className="route-graph-field-label">
                {t('settings.routing.graph.distributionOutputs')}
              </span>
              <div className="route-graph-inspector-stepper">
                <button
                  type="button"
                  disabled={(
                    config.distributionOutputCount
                      ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS
                  ) <= ROUTE_GRAPH_DISTRIBUTION_MIN_OUTPUTS}
                  aria-label={t('settings.routing.graph.removeDistributionOutput')}
                  title={t('settings.routing.graph.removeDistributionOutput')}
                  onClick={() => updateConfig({
                    distributionOutputCount: (
                      config.distributionOutputCount
                        ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS
                    ) - 1,
                  })}
                >
                  <Minus size={14} />
                </button>
                <output aria-label={t('settings.routing.graph.distributionOutputs')}>
                  {config.distributionOutputCount ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS}
                </output>
                <button
                  type="button"
                  disabled={(
                    config.distributionOutputCount
                      ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS
                  ) >= ROUTE_GRAPH_DISTRIBUTION_MAX_OUTPUTS}
                  aria-label={t('settings.routing.graph.addDistributionOutput')}
                  title={t('settings.routing.graph.addDistributionOutput')}
                  onClick={() => updateConfig({
                    distributionOutputCount: (
                      config.distributionOutputCount
                        ?? ROUTE_GRAPH_DISTRIBUTION_DEFAULT_OUTPUTS
                    ) + 1,
                  })}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            {config.distributionMode === 'quota' && <UnknownQuotaNotice />}
          </>
        )}

        {node.data.kind === 'parallel' && (
          <>
            <InspectorField label={t('settings.routing.graph.maxConcurrency')}>
              <input
                type="number"
                min="2"
                max="4"
                value={config.maxConcurrency ?? 4}
                onChange={(event) => updateConfig({
                  maxConcurrency: Math.max(2, Math.min(4, Number(event.target.value) || 4)),
                })}
              />
            </InspectorField>
            <div className="route-graph-safety-note" role="note">
              <strong>{t('settings.routing.graph.parallelSafetyTitle')}</strong>
              <span>{t('settings.routing.graph.parallelSafety')}</span>
            </div>
          </>
        )}

        {node.data.kind === 'result' && (
          <>
            <InspectorSelect
              label={t('settings.routing.graph.resultLabel')}
              value={config.resultMode ?? 'first-success'}
              options={RESULT_MODES.map((entry) => ({
                value: entry,
                label: t(`settings.routing.graph.result.${entry}` as never),
              }))}
              onChange={(resultMode) => updateConfig({ resultMode: resultMode as RouteResultMode })}
            />
            {config.resultMode === 'judge' && (
              <>
                <InspectorSelect
                  label={t('settings.routing.graph.judgeProvider')}
                  value={config.judgeProviderId ?? ''}
                  options={[
                    { value: '', label: t('settings.routing.graph.chooseProvider') },
                    ...sources.flatMap((entry) => (
                      entry.providerId ? [routeGraphProviderOption(entry, t)] : []
                    )),
                  ]}
                  onChange={(judgeProviderId) => {
                    const nextSource = sources.find((entry) => entry.providerId === judgeProviderId)
                    updateConfig({
                      judgeProviderId: judgeProviderId || undefined,
                      judgeModelId: nextSource?.models[0]?.id,
                    })
                  }}
                />
                <InspectorSelect
                  label={t('settings.routing.graph.judgeModel')}
                  value={config.judgeModelId ?? ''}
                  options={[
                    { value: '', label: t('settings.routing.graph.chooseModel') },
                    ...(sources
                      .find((entry) => entry.providerId === config.judgeProviderId)
                      ?.models.map((model) => ({
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
        )}

        {node.data.kind === 'relay' && (
          <div className="route-graph-switch-row">
            <div>
              <strong>{t('settings.routing.graph.sessionSticky')}</strong>
              <span>{t('settings.routing.graph.sessionStickyHint')}</span>
            </div>
            <Switch
              checked={config.sessionSticky !== false}
              ariaLabel={t('settings.routing.graph.sessionSticky')}
              accent
              onChange={(sessionSticky) => updateConfig({ sessionSticky })}
            />
          </div>
        )}

        {node.data.kind === 'model' && (
          <details className="route-graph-advanced">
            <summary>
              <span>{t('settings.routing.graph.advanced')}</span>
              <ChevronDown size={14} />
            </summary>
            <InspectorField label={t('settings.routing.graph.weight')}>
              <input
                type="number"
                min="1"
                max="100"
                value={config.weight ?? 1}
                onChange={(event) => updateConfig({ weight: Number(event.target.value) || 1 })}
              />
            </InspectorField>
            <InspectorField label={t('settings.routing.graph.modelAttempts')}>
              <input
                type="number"
                min="1"
                max="8"
                value={config.maxAttempts ?? 1}
                onChange={(event) => updateConfig({
                  maxAttempts: Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                })}
              />
            </InspectorField>
            <InspectorField label={t('settings.routing.graph.timeout')}>
              <input
                type="number"
                min="1000"
                step="1000"
                value={config.timeoutMs ?? 60_000}
                onChange={(event) => updateConfig({ timeoutMs: Number(event.target.value) || 60_000 })}
              />
            </InspectorField>
            <InspectorField
              label={t('settings.routing.graph.budget')}
              hint={t('settings.routing.graph.budgetHint')}
            >
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={config.budgetUsd ?? ''}
                placeholder={t('settings.routing.graph.unlimited')}
                onChange={(event) => updateConfig({
                  budgetUsd: event.target.value ? Number(event.target.value) : undefined,
                })}
              />
            </InspectorField>
          </details>
        )}
      </div>

      {!['start', 'output'].includes(node.data.kind) && (
        <button type="button" className="route-graph-delete-node" onClick={onDelete}>
          <Trash2 size={14} />
          {t('settings.routing.graph.deleteNode')}
        </button>
      )}
    </aside>
  )
}

function AgentPortEditor({
  side,
  ports,
  minPorts,
  onChange,
}: {
  side: 'input' | 'output'
  ports: RouteAgentPort[]
  minPorts: number
  onChange: (ports: RouteAgentPort[]) => void
}) {
  const t = useTranslation()
  const title = t(side === 'input'
    ? 'settings.routing.graph.agent.inputPorts'
    : 'settings.routing.graph.agent.outputPorts')
  const addLabel = t(side === 'input'
    ? 'settings.routing.graph.agent.addInput'
    : 'settings.routing.graph.agent.addOutput')

  return (
    <section className="route-graph-agent-ports" aria-label={title}>
      <div className="route-graph-agent-ports-heading">
        <span className="route-graph-field-label">{title}</span>
        <span>{ports.length}/6</span>
      </div>
      <div className="route-graph-agent-port-list">
        {ports.map((port, index) => (
          <div className="route-graph-agent-port" key={port.id}>
            <ImeSafeInput
              aria-label={`${title} ${index + 1} ${t('settings.routing.graph.agent.portName')}`}
              maxLength={32}
              value={port.label}
              placeholder={t('settings.routing.graph.agent.portName')}
              onChange={(label) => onChange(ports.map((entry) => (
                entry.id === port.id ? { ...entry, label } : entry
              )))}
            />
            <ImeSafeInput
              aria-label={`${title} ${index + 1} ${t('settings.routing.graph.agent.portDescription')}`}
              maxLength={120}
              value={port.description}
              placeholder={t('settings.routing.graph.agent.portDescription')}
              onChange={(description) => onChange(ports.map((entry) => (
                entry.id === port.id ? { ...entry, description } : entry
              )))}
            />
            <button
              type="button"
              className="route-graph-agent-port-remove"
              aria-label={t('settings.routing.graph.agent.removePort', { name: port.label })}
              title={ports.length <= minPorts
                ? t('settings.routing.graph.agent.minimumPorts')
                : t('settings.routing.graph.agent.removePort', { name: port.label })}
              disabled={ports.length <= minPorts}
              onClick={() => onChange(ports.filter((entry) => entry.id !== port.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="route-graph-agent-port-add"
        disabled={ports.length >= 6}
        onClick={() => {
          const id = nextAgentPortId(side, ports)
          const suffix = Number(id.slice(side.length + 1))
          onChange([
            ...ports,
            {
              id,
              // Label follows the id suffix so deleting a middle port and
              // re-adding never collides with an existing default name.
              label: t(side === 'input'
                ? 'settings.routing.graph.agent.inputDefault'
                : 'settings.routing.graph.agent.outputDefault', {
                  index: Number.isFinite(suffix) ? suffix : ports.length + 1,
                }),
              description: '',
            },
          ])
        }}
      >
        <Plus size={13} />
        {addLabel}
      </button>
    </section>
  )
}

function InspectorField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="route-graph-field">
      <span className="route-graph-field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function InspectorSelect({
  label,
  value,
  disabled = false,
  onChange,
  options,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  options: readonly RouteGraphSelectOption[]
}) {
  return (
    <RouteGraphSelect
      label={label}
      value={value}
      options={options}
      variant="inspector"
      disabled={disabled}
      onChange={onChange}
    />
  )
}

function UnknownQuotaNotice() {
  const t = useTranslation()
  return (
    <div className="route-graph-unknown-quota" role="status">
      <span>{t('settings.routing.graph.quota')}</span>
      <strong>{t('settings.routing.graph.unknown')}</strong>
      <p>{t('settings.routing.graph.quotaUnknownHint')}</p>
    </div>
  )
}
