import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleOff,
  Copy,
  KeyRound,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { Locale } from '../../i18n/localeConfig'
import { gatewayApi } from '../../api/gateway'
import type {
  GatewayConfigInput,
  GatewayKeyStatus,
  GatewayKeyUpdateInput,
  GatewayStatus,
  GatewayTarget,
} from '../../types/gateway'
import { normalizeGatewayStatus } from '../../types/gateway'
import { copyTextToClipboard } from '../chat/clipboard'
import { Button } from '../shared/Button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Input } from '../shared/Input'
import { Modal } from '../shared/Modal'
import { SettingsSection, Switch } from '../settings/SettingsLayout'
import { openExternalUrl } from '../../lib/openExternalUrl'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  GatewayTargetPicker,
  type GatewayTargetKind,
  type GatewayTargetPickerMode,
} from './GatewayTargetPicker'
import { P2PModelSharingPanel } from './P2PModelSharingPanel'

type NodeDraft = Omit<GatewayConfigInput, 'publicBaseUrl'> & { publicBaseUrl: string }
type KeyDraft = GatewayKeyUpdateInput
type NodeView = 'gateway' | 'p2p'
const AGENT_NODE_DOCS_ROOT = 'https://wk42worldworld.github.io/cybercode'
const EXAMPLE_NODE_KEY = 'cc_REPLACE_WITH_YOUR_NODE_KEY'

export function agentNodeGuideUrl(locale: Locale): string {
  const localePath = locale === 'zh' ? '' : `/${locale}`
  return `${AGENT_NODE_DOCS_ROOT}${localePath}/guide/agent-node.html`
}

function nodeDraftFromStatus(status: GatewayStatus): NodeDraft {
  return {
    enabled: status.enabled,
    publicBaseUrl: status.publicBaseUrl ?? '',
  }
}

function keyDraftFromKey(key: GatewayKeyStatus): KeyDraft {
  return {
    name: key.name,
    monthlyRequestLimit: key.monthlyRequestLimit,
    allowedTargets: key.allowedTargets,
    defaultTarget: key.defaultTarget ?? null,
  }
}

function isNodeDraftEqual(left: NodeDraft, right: NodeDraft): boolean {
  return left.enabled === right.enabled &&
    left.publicBaseUrl === right.publicBaseUrl
}

function isKeyDraftEqual(left: KeyDraft, right: KeyDraft): boolean {
  return left.name === right.name &&
    left.monthlyRequestLimit === right.monthlyRequestLimit &&
    left.defaultTarget === right.defaultTarget &&
    left.allowedTargets.length === right.allowedTargets.length &&
    left.allowedTargets.every((target) => right.allowedTargets.includes(target))
}

function TargetIcon({ kind }: { kind: GatewayTarget['kind'] }) {
  return kind === 'route'
    ? <Route size={15} strokeWidth={1.9} />
    : <Server size={15} strokeWidth={1.9} />
}

function CopyField({
  value,
  displayValue = value,
  label,
  copyLabel,
  disabled = false,
}: {
  value: string
  displayValue?: string
  label: string
  copyLabel: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (disabled) return
    if (await copyTextToClipboard(value)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="min-w-0">
      <div className="mb-[6px] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="flex h-[40px] min-w-0 items-center gap-[8px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] py-[4px] pl-[12px] pr-[5px]">
        <code className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">{displayValue}</code>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void copy()}
          title={copied ? `${copyLabel} ✓` : copyLabel}
          aria-label={copied ? `${copyLabel} ✓` : copyLabel}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={1.9} />}
        </button>
      </div>
    </div>
  )
}

function summarizeTargets(targets: GatewayTarget[], emptyLabel: string): string {
  if (targets.length === 0) return emptyLabel
  const visible = targets.slice(0, 2).map((target) => target.label).join(' · ')
  return targets.length > 2 ? `${visible}  +${targets.length - 2}` : visible
}

function TargetAccessButton({
  kind,
  title,
  hint,
  selected,
  total,
  emptyLabel,
  disabled,
  onClick,
}: {
  kind: GatewayTarget['kind']
  title: string
  hint: string
  selected: GatewayTarget[]
  total: number
  emptyLabel: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${title}: ${selected.length} / ${total}`}
      className="group flex min-h-[92px] w-full min-w-0 items-center gap-[12px] overflow-hidden px-[16px] py-[14px] text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`flex size-[38px] shrink-0 items-center justify-center rounded-[8px] ${
        kind === 'route'
          ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
      }`}>
        {kind === 'route'
          ? <Route size={18} strokeWidth={1.9} />
          : <Server size={18} strokeWidth={1.9} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[8px]">
          <span className="truncate text-[12px] font-bold text-[var(--color-text-primary)]">{title}</span>
          <span className="shrink-0 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
            {selected.length} / {total}
          </span>
        </span>
        <span className="mt-[2px] block truncate text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">{hint}</span>
        <span className="mt-[5px] block truncate text-[11px] font-medium text-[var(--color-text-secondary)]">
          {summarizeTargets(selected, emptyLabel)}
        </span>
      </span>
      <ChevronRight
        size={16}
        strokeWidth={1.8}
        className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-[2px]"
      />
    </button>
  )
}

function TargetPolicySection({
  keyName,
  draft,
  defaultTarget,
  selectedRoutes,
  selectedModels,
  routeCount,
  modelCount,
  disabled,
  onUpdateDraft,
  onOpenPicker,
}: {
  keyName: string
  draft: KeyDraft
  defaultTarget: GatewayTarget | null
  selectedRoutes: GatewayTarget[]
  selectedModels: GatewayTarget[]
  routeCount: number
  modelCount: number
  disabled: boolean
  onUpdateDraft: (next: Partial<KeyDraft>) => void
  onOpenPicker: (mode: GatewayTargetPickerMode, kind: GatewayTargetKind) => void
}) {
  const t = useTranslation()
  const defaultKind = defaultTarget?.kind ?? 'route'

  return (
    <SettingsSection
      title={t('settings.gateway.targetPolicy')}
      description={t('settings.gateway.targetPolicyForKey', { name: keyName })}
    >
      <div className="gateway-target-policy-primary grid">
        <div className="gateway-target-policy-default min-w-0 p-[16px]">
          <div className="mb-[7px] text-[11px] font-semibold text-[var(--color-text-secondary)]">
            {t('settings.gateway.autoModel')}
          </div>
          <button
            type="button"
            data-testid="gateway-default-target"
            disabled={disabled}
            onClick={() => onOpenPicker('default', defaultKind)}
            className="group flex min-h-[58px] w-full items-center gap-[11px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[11px] py-[9px] text-left transition-[border-color,background-color] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-[8px] ${
              defaultTarget?.kind === 'route'
                ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]'
                : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
            }`}>
              {defaultTarget
                ? <TargetIcon kind={defaultTarget.kind} />
                : <CircleOff size={16} strokeWidth={1.8} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                {defaultTarget?.label ?? t('settings.gateway.noDefault')}
              </span>
              <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
                {defaultTarget
                  ? `${defaultTarget.kind === 'route'
                    ? t('settings.gateway.routeKind')
                    : t('settings.gateway.directModel')} · ${defaultTarget.description}`
                  : t('settings.gateway.noDefaultHint')}
              </span>
            </span>
            <ChevronDown
              size={16}
              strokeWidth={1.8}
              className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-y-[1px]"
            />
          </button>
        </div>
        <div className="gateway-target-policy-limit min-w-0 border-t border-[var(--color-border-separator)] p-[16px]">
          <Input
            label={t('settings.gateway.monthlyLimit')}
            type="number"
            min="0"
            step="1"
            disabled={disabled}
            value={String(draft.monthlyRequestLimit)}
            onChange={(event) => onUpdateDraft({
              monthlyRequestLimit: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
            })}
          />
          <p className="mt-[6px] text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
            {t('settings.gateway.monthlyLimitHint')}
          </p>
        </div>
      </div>

      <div className="gateway-target-policy-access grid">
        <TargetAccessButton
          kind="route"
          title={t('settings.gateway.routes')}
          hint={t('settings.gateway.routeAccessHint')}
          selected={selectedRoutes}
          total={routeCount}
          emptyLabel={t('settings.gateway.noneSelected')}
          disabled={disabled || routeCount === 0}
          onClick={() => onOpenPicker('scope', 'route')}
        />
        <div className="gateway-target-policy-access-secondary min-w-0 border-t border-[var(--color-border-separator)]">
          <TargetAccessButton
            kind="model"
            title={t('settings.gateway.directModels')}
            hint={t('settings.gateway.modelAccessHint')}
            selected={selectedModels}
            total={modelCount}
            emptyLabel={t('settings.gateway.noneSelected')}
            disabled={disabled || modelCount === 0}
            onClick={() => onOpenPicker('scope', 'model')}
          />
        </div>
      </div>
    </SettingsSection>
  )
}

type GatewayProtocol = 'openai' | 'anthropic'

type GatewayConnectionOption = {
  id: string
  kind: 'auto' | GatewayTarget['kind']
  label: string
  description: string
  target?: GatewayTarget
}

function GatewayConnectionOptionButton({
  option,
  onSelect,
}: {
  option: GatewayConnectionOption
  onSelect: (option: GatewayConnectionOption) => void
}) {
  const t = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onSelect(option)}
      aria-label={t('settings.gateway.openConnectionCard', { target: option.id })}
      className="group flex min-h-[62px] w-full min-w-0 items-center gap-[11px] px-[16px] py-[10px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-[8px] ${
        option.kind === 'route'
          ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
      }`}>
        {option.kind === 'route'
          ? <Route size={16} strokeWidth={1.9} />
          : option.kind === 'auto'
            ? <Network size={16} strokeWidth={1.9} />
            : <Server size={16} strokeWidth={1.9} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
            {option.label}
          </span>
          <code className="max-w-[45%] shrink-0 truncate text-[10px] font-semibold text-[var(--color-text-secondary)]">
            {option.id}
          </code>
        </span>
        <span className="mt-[2px] block truncate text-[10px] text-[var(--color-text-tertiary)]">
          {option.description}
        </span>
      </span>
      <ChevronRight
        size={16}
        strokeWidth={1.8}
        className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-[2px]"
      />
    </button>
  )
}

function GatewayConnectionBuilder({
  status,
  accessKey,
  revealedKey,
  isSaving,
  rotationDisabled,
  onRotateKey,
}: {
  status: GatewayStatus
  accessKey: GatewayKeyStatus
  revealedKey: string | null
  isSaving: boolean
  rotationDisabled: boolean
  onRotateKey: () => void
}) {
  const t = useTranslation()
  const [protocol, setProtocol] = useState<GatewayProtocol>('openai')
  const [targetKind, setTargetKind] = useState<GatewayTargetKind>('route')
  const [query, setQuery] = useState('')
  const [selectedOption, setSelectedOption] = useState<GatewayConnectionOption | null>(null)

  const options = useMemo<GatewayConnectionOption[]>(() => {
    const allowedTargets = status.targets.filter((target) => (
      target.available && accessKey.allowedTargets.includes(target.id)
    ))
    const defaultTarget = allowedTargets.find((target) => target.id === accessKey.defaultTarget)
    const entries: GatewayConnectionOption[] = []

    if (defaultTarget) {
      entries.push({
        id: 'auto',
        kind: 'auto',
        label: t('settings.gateway.connectionAuto', { target: defaultTarget.label }),
        description: t('settings.gateway.connectionAutoHint'),
        target: defaultTarget,
      })
    }

    for (const target of allowedTargets) {
      entries.push({
        id: target.publicId,
        kind: target.kind,
        label: target.label,
        description: target.description,
        target,
      })
    }
    return entries
  }, [accessKey, status.targets, t])

  const autoOption = options.find((option) => option.kind === 'auto')
  const routeCount = options.filter((option) => option.kind === 'route').length
  const modelCount = options.filter((option) => option.kind === 'model').length
  useEffect(() => {
    if (targetKind === 'route' && routeCount === 0 && modelCount > 0) {
      setTargetKind('model')
    } else if (targetKind === 'model' && modelCount === 0 && routeCount > 0) {
      setTargetKind('route')
    }
  }, [modelCount, routeCount, targetKind])
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const kindOptions = options.filter((option) => option.kind === targetKind)
    if (!normalized) return kindOptions
    return kindOptions.filter((option) => (
      `${option.label} ${option.description} ${option.id} ${option.kind}`
        .toLocaleLowerCase()
        .includes(normalized)
    ))
  }, [options, query, targetKind])

  return (
    <>
      <SettingsSection
        title={t('settings.gateway.connectionBuilder')}
        description={t('settings.gateway.connectionBuilderHint')}
      >
        <div className="gateway-connection-builder-controls grid gap-[14px] p-[16px]">
          <div className="min-w-0">
            <div className="mb-[7px] text-[11px] font-semibold text-[var(--color-text-secondary)]">
              {t('settings.gateway.connectionProtocol')}
            </div>
            <div
              role="tablist"
              aria-label={t('settings.gateway.connectionProtocol')}
              className="grid h-[40px] grid-cols-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[3px]"
            >
              {([
                ['openai', t('settings.gateway.guideOpenAI')],
                ['anthropic', t('settings.gateway.guideAnthropic')],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={protocol === value}
                  onClick={() => setProtocol(value)}
                  className={`rounded-[6px] px-[8px] text-[11px] font-semibold transition-colors ${
                    protocol === value
                      ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-[7px] text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
              {t('settings.gateway.connectionProtocolHint')}
            </p>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="gateway-connection-search"
              className="mb-[7px] block text-[11px] font-semibold text-[var(--color-text-secondary)]"
            >
              {t('settings.gateway.connectionSearchLabel')}
            </label>
            <div className="relative">
              <Search
                size={15}
                strokeWidth={1.9}
                className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                id="gateway-connection-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.gateway.connectionSearchPlaceholder')}
                className="h-[40px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] pl-[34px] pr-[12px] text-[12px] font-medium text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
              />
            </div>
          </div>
        </div>

        {autoOption && (
          <div className="border-t border-[var(--color-border-separator)]">
            <div className="px-[16px] pt-[10px] text-[10px] font-semibold text-[var(--color-text-tertiary)]">
              {t('settings.gateway.connectionDefaultOption')}
            </div>
            <GatewayConnectionOptionButton option={autoOption} onSelect={setSelectedOption} />
          </div>
        )}

        <div className="border-t border-[var(--color-border-separator)]">
          <div
            role="tablist"
            aria-label={t('settings.gateway.connectionTargetKind')}
            className="grid h-[42px] grid-cols-2 gap-[4px] border-b border-[var(--color-border-separator)] px-[12px] py-[5px]"
          >
            {([
              ['route', t('settings.gateway.routes'), routeCount],
              ['model', t('settings.gateway.directModels'), modelCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={targetKind === value}
                onClick={() => {
                  setTargetKind(value)
                  setQuery('')
                }}
                className={`flex items-center justify-center gap-[6px] rounded-[6px] text-[11px] font-semibold transition-colors ${
                  targetKind === value
                    ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <span>{label}</span>
                <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{count}</span>
              </button>
            ))}
          </div>
          <div className="max-h-[238px] overflow-y-auto">
            {filteredOptions.map((option) => (
              <GatewayConnectionOptionButton
                key={`${option.kind}:${option.id}`}
                option={option}
                onSelect={setSelectedOption}
              />
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-[16px] py-[20px] text-center text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.gateway.connectionNoResults')}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <GatewayConnectionDialog
        open={selectedOption !== null}
        status={status}
        accessKey={accessKey}
        protocol={protocol}
        option={selectedOption}
        revealedKey={revealedKey}
        isSaving={isSaving}
        rotationDisabled={rotationDisabled}
        onRotateKey={onRotateKey}
        onClose={() => setSelectedOption(null)}
      />
    </>
  )
}

function GatewayConnectionDialog({
  open,
  status,
  accessKey,
  protocol,
  option,
  revealedKey,
  isSaving,
  rotationDisabled,
  onRotateKey,
  onClose,
}: {
  open: boolean
  status: GatewayStatus
  accessKey: GatewayKeyStatus
  protocol: GatewayProtocol
  option: GatewayConnectionOption | null
  revealedKey: string | null
  isSaving: boolean
  rotationDisabled: boolean
  onRotateKey: () => void
  onClose: () => void
}) {
  const t = useTranslation()
  const [copiedAll, setCopiedAll] = useState(false)
  if (!option) return null

  const protocolLabel = protocol === 'openai'
    ? t('settings.gateway.openAIProtocol')
    : t('settings.gateway.anthropicProtocol')
  const baseUrl = protocol === 'openai' ? status.baseUrl : status.anthropicBaseUrl
  const endpoint = protocol === 'openai'
    ? `${status.baseUrl}/chat/completions`
    : `${status.anthropicBaseUrl}/v1/messages`
  const maskedKey = `${accessKey.prefix}••••••••••••••••`
  const targetType = option.kind === 'route'
    ? t('settings.gateway.routeKind')
    : option.kind === 'auto'
      ? t('settings.gateway.autoModel')
      : t('settings.gateway.directModel')
  const completeConfig = [
    `${t('settings.gateway.connectionProtocol')}: ${protocolLabel}`,
    `${t('settings.gateway.baseUrl')}: ${baseUrl}`,
    `${t('settings.gateway.connectionEndpoint')}: ${endpoint}`,
    `${t('settings.gateway.apiKey')}: ${revealedKey ?? ''}`,
    `${t('settings.gateway.connectionModel')}: ${option.id}`,
  ].join('\n')

  const copyAll = async () => {
    if (!revealedKey || !await copyTextToClipboard(completeConfig)) return
    setCopiedAll(true)
    window.setTimeout(() => setCopiedAll(false), 1500)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.gateway.connectionCardTitle')}
      width={560}
    >
      <div className="flex flex-col gap-[14px]">
        <div className="flex items-center gap-[11px] border-b border-[var(--color-border-separator)] pb-[14px]">
          <span className={`flex size-[38px] shrink-0 items-center justify-center rounded-[8px] ${
            option.kind === 'route'
              ? 'bg-[#1473e6]/10 text-[#1473e6] dark:bg-[#68adff]/12 dark:text-[#68adff]'
              : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
          }`}>
            {option.kind === 'route'
              ? <Route size={18} strokeWidth={1.9} />
              : option.kind === 'auto'
                ? <Network size={18} strokeWidth={1.9} />
                : <Server size={18} strokeWidth={1.9} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-[var(--color-text-primary)]">
              {option.label}
            </div>
            <div className="mt-[2px] text-[11px] text-[var(--color-text-tertiary)]">
              {targetType} · {option.description}
            </div>
          </div>
        </div>

        <div className="grid gap-[12px] sm:grid-cols-2">
          <CopyField value={protocolLabel} label={t('settings.gateway.connectionProtocol')} copyLabel={t('settings.gateway.copy')} />
          <CopyField value={baseUrl} label={t('settings.gateway.baseUrl')} copyLabel={t('settings.gateway.copy')} />
          <div className="sm:col-span-2">
            <CopyField value={endpoint} label={t('settings.gateway.connectionEndpoint')} copyLabel={t('settings.gateway.copy')} />
          </div>
          <CopyField value={option.id} label={t('settings.gateway.connectionModel')} copyLabel={t('settings.gateway.copy')} />
          <div className="sm:col-span-2">
            <CopyField
              value={revealedKey ?? ''}
              displayValue={revealedKey ?? maskedKey}
              label={t('settings.gateway.apiKey')}
              copyLabel={revealedKey ? t('settings.gateway.copy') : t('settings.gateway.connectionKeyUnavailable')}
              disabled={!revealedKey}
            />
          </div>
        </div>

        {!revealedKey && (
          <div className="flex flex-col gap-[10px] rounded-[8px] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/5 px-[12px] py-[11px] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-[8px]">
              <CircleAlert size={15} className="mt-[1px] shrink-0 text-[var(--color-warning)]" />
              <p className="text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
                {t('settings.gateway.connectionKeyUnavailableHint')}
              </p>
            </div>
            <Button
              size="sm"
              icon={<RefreshCw size={14} />}
              loading={isSaving}
              disabled={rotationDisabled}
              className="shrink-0"
              onClick={onRotateKey}
            >
              {t('settings.gateway.connectionRotateKey')}
            </Button>
          </div>
        )}

        <div className="flex justify-end border-t border-[var(--color-border-separator)] pt-[14px]">
          <Button
            size="sm"
            icon={copiedAll ? <Check size={14} /> : <Copy size={14} />}
            disabled={!revealedKey}
            onClick={() => void copyAll()}
          >
            {copiedAll
              ? t('settings.gateway.connectionCopiedAll')
              : t('settings.gateway.connectionCopyAll')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function GatewayKeyTable({
  keys,
  selectedKeyId,
  revealedKeys,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onRotate,
  onRevoke,
}: {
  keys: GatewayKeyStatus[]
  selectedKeyId: string | null
  revealedKeys: Record<string, string>
  disabled: boolean
  onSelect: (keyId: string) => void
  onCreate: () => void
  onRename: (keyId: string, name: string) => Promise<void>
  onRotate: (key: GatewayKeyStatus) => void
  onRevoke: (key: GatewayKeyStatus) => void
}) {
  const t = useTranslation()
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  const beginRename = (key: GatewayKeyStatus) => {
    setEditingKeyId(key.id)
    setNameDraft(key.name)
  }

  const saveName = async (key: GatewayKeyStatus) => {
    const name = nameDraft.trim()
    if (!name) return
    if (name !== key.name) await onRename(key.id, name)
    setEditingKeyId(null)
  }

  const copyKey = async (keyId: string) => {
    const apiKey = revealedKeys[keyId]
    if (!apiKey || !await copyTextToClipboard(apiKey)) return
    setCopiedKeyId(keyId)
    window.setTimeout(() => setCopiedKeyId((current) => current === keyId ? null : current), 1500)
  }

  return (
    <SettingsSection
      title={t('settings.gateway.keyManagement')}
      description={t('settings.gateway.keyManagementHint')}
      action={(
        <Button
          size="sm"
          icon={<Plus size={14} />}
          disabled={disabled}
          onClick={onCreate}
        >
          {t('settings.gateway.addKey')}
        </Button>
      )}
    >
      {keys.length > 0 ? (
        <div role="radiogroup" aria-label={t('settings.gateway.keyManagement')}>
          <div className="gateway-key-table-header min-h-[34px] items-center gap-[12px] bg-[var(--color-surface-container-low)] px-[16px] text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
            <span>{t('settings.gateway.keyNameColumn')}</span>
            <span>{t('settings.gateway.keyScopeColumn')}</span>
            <span>{t('settings.gateway.keyUsageColumn')}</span>
            <span className="text-right">{t('settings.gateway.keyActionsColumn')}</span>
          </div>
          {keys.map((key) => {
            const selected = key.id === selectedKeyId
            const revealedKey = revealedKeys[key.id]
            const usageLimit = key.monthlyRequestLimit > 0
              ? String(key.monthlyRequestLimit)
              : t('settings.gateway.unlimited')
            return (
              <div
                key={key.id}
                data-testid={`gateway-key-row-${key.id}`}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => onSelect(key.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(key.id)
                  }
                }}
                className={`gateway-key-table-row grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[10px] px-[16px] py-[10px] ${
                  selected ? 'bg-[var(--color-surface-selected)]' : ''
                }`}
              >
                <div className="min-w-0">
                  {editingKeyId === key.id ? (
                    <div className="flex items-center gap-[6px]">
                      <input
                        autoFocus
                        value={nameDraft}
                        maxLength={80}
                        aria-label={t('settings.gateway.keyName')}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveName(key)
                          if (event.key === 'Escape') setEditingKeyId(null)
                        }}
                        className="h-[32px] min-w-0 flex-1 rounded-[6px] border border-[var(--color-border-focus)] bg-[var(--color-surface-container-lowest)] px-[9px] text-[12px] font-semibold text-[var(--color-text-primary)] outline-none shadow-[var(--shadow-focus-ring)]"
                      />
                      <button
                        type="button"
                        aria-label={t('common.save')}
                        disabled={disabled || !nameDraft.trim()}
                        onClick={() => void saveName(key)}
                        className="flex size-[28px] items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-35"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('common.cancel')}
                        onClick={() => setEditingKeyId(null)}
                        className="flex size-[28px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-[7px]">
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSelect(key.id)}
                        className="min-w-0 truncate text-left text-[12px] font-bold text-[var(--color-text-primary)] hover:underline"
                      >
                        {key.name}
                      </button>
                      <button
                        type="button"
                        title={t('settings.gateway.renameKey')}
                        aria-label={t('settings.gateway.renameKey')}
                        disabled={disabled}
                        onClick={() => beginRename(key)}
                        className="flex size-[24px] shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-35"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  )}
                  <div className="mt-[3px] flex min-w-0 items-center gap-[6px]">
                    <code className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                      {revealedKey ?? `${key.prefix}••••••••`}
                    </code>
                    {revealedKey && (
                      <span className="shrink-0 text-[9px] font-semibold text-[var(--color-warning)]">
                        {t('settings.gateway.keyVisibleNow')}
                      </span>
                    )}
                  </div>
                  <div className="gateway-key-table-mobile-summary mt-[3px] text-[10px] text-[var(--color-text-tertiary)]">
                    {t('settings.gateway.keyMobileSummary', {
                      targets: key.allowedTargets.length,
                      requests: key.usage.requests,
                      limit: usageLimit,
                    })}
                  </div>
                </div>
                <div className="gateway-key-table-metric text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {t('settings.gateway.keyTargetCount', { count: key.allowedTargets.length })}
                </div>
                <div className="gateway-key-table-metric text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {key.usage.requests} / {usageLimit}
                </div>
                <div className="flex items-center justify-end gap-[2px]">
                  <button
                    type="button"
                    title={revealedKey ? t('settings.gateway.copyKey') : t('settings.gateway.copyKeyUnavailable')}
                    aria-label={revealedKey ? t('settings.gateway.copyKey') : t('settings.gateway.copyKeyUnavailable')}
                    disabled={!revealedKey}
                    onClick={() => void copyKey(key.id)}
                    className="flex size-[30px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    {copiedKeyId === key.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    type="button"
                    title={t('settings.gateway.rotateKey')}
                    aria-label={`${t('settings.gateway.rotateKey')} ${key.name}`}
                    disabled={disabled}
                    onClick={() => onRotate(key)}
                    className="flex size-[30px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-35"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    title={t('settings.gateway.revokeKey')}
                    aria-label={`${t('settings.gateway.revokeKey')} ${key.name}`}
                    disabled={disabled}
                    onClick={() => onRevoke(key)}
                    className="flex size-[30px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/8 hover:text-[var(--color-error)] disabled:opacity-35"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-[10px] px-[16px] py-[18px] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              {t('settings.gateway.noKey')}
            </div>
            <div className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
              {t('settings.gateway.noKeyHint')}
            </div>
          </div>
          <Button
            size="sm"
            icon={<KeyRound size={14} />}
            disabled={disabled}
            onClick={onCreate}
          >
            {t('settings.gateway.createKey')}
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}

export function GatewayNodePanel() {
  const t = useTranslation()
  const [nodeView, setNodeView] = useState<NodeView>('gateway')
  const peekedStatus = gatewayApi.peekStatus()
  const cachedStatus = normalizeGatewayStatus(peekedStatus)
  const [status, setStatus] = useState<GatewayStatus | null>(cachedStatus ?? null)
  const [nodeDraft, setNodeDraft] = useState<NodeDraft | null>(
    cachedStatus ? nodeDraftFromStatus(cachedStatus) : null,
  )
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(
    cachedStatus?.keys[0]?.id ?? null,
  )
  const [keyDraft, setKeyDraft] = useState<KeyDraft | null>(
    cachedStatus?.keys[0] ? keyDraftFromKey(cachedStatus.keys[0]) : null,
  )
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(!cachedStatus)
  const [isSaving, setIsSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showCreateKey, setShowCreateKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [rotateCandidate, setRotateCandidate] = useState<GatewayKeyStatus | null>(null)
  const [revokeCandidate, setRevokeCandidate] = useState<GatewayKeyStatus | null>(null)
  const [targetPicker, setTargetPicker] = useState<{
    mode: GatewayTargetPickerMode
    kind: GatewayTargetKind
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    if (!normalizeGatewayStatus(gatewayApi.peekStatus())) setIsLoading(true)
    setError(null)
    try {
      const next = normalizeGatewayStatus(await gatewayApi.status({ force }))
      if (!next) throw new Error(t('settings.gateway.loadFailed'))
      setStatus(next)
      setNodeDraft(nodeDraftFromStatus(next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load(true)
  }, [load])

  const selectedKey = useMemo(
    () => status?.keys.find((key) => key.id === selectedKeyId) ?? null,
    [selectedKeyId, status?.keys],
  )

  useEffect(() => {
    if (!status) return
    if (selectedKeyId && status.keys.some((key) => key.id === selectedKeyId)) return
    setSelectedKeyId(status.keys[0]?.id ?? null)
  }, [selectedKeyId, status])

  useEffect(() => {
    setKeyDraft(selectedKey ? keyDraftFromKey(selectedKey) : null)
    setTargetPicker(null)
  }, [selectedKey])

  const selectedTargets = useMemo(
    () => new Set(keyDraft?.allowedTargets ?? []),
    [keyDraft?.allowedTargets],
  )
  const availableTargets = useMemo(
    () => status?.targets.filter((target) => target.available) ?? [],
    [status?.targets],
  )
  const modelTargets = useMemo(
    () => availableTargets.filter((target) => target.kind === 'model'),
    [availableTargets],
  )
  const routeTargets = useMemo(
    () => availableTargets.filter((target) => target.kind === 'route'),
    [availableTargets],
  )
  const selectedRouteTargets = useMemo(
    () => routeTargets.filter((target) => selectedTargets.has(target.id)),
    [routeTargets, selectedTargets],
  )
  const selectedModelTargets = useMemo(
    () => modelTargets.filter((target) => selectedTargets.has(target.id)),
    [modelTargets, selectedTargets],
  )
  const resolvedDefaultTarget = useMemo(
    () => status?.targets.find((target) => target.id === keyDraft?.defaultTarget) ?? null,
    [keyDraft?.defaultTarget, status?.targets],
  )
  const savedNodeDraft = status ? nodeDraftFromStatus(status) : null
  const savedKeyDraft = selectedKey ? keyDraftFromKey(selectedKey) : null
  const nodeDirty = Boolean(
    nodeDraft && savedNodeDraft && !isNodeDraftEqual(nodeDraft, savedNodeDraft),
  )
  const keyDirty = Boolean(
    keyDraft && savedKeyDraft && !isKeyDraftEqual(keyDraft, savedKeyDraft),
  )
  const dirty = nodeDirty || keyDirty

  const selectKey = (keyId: string) => {
    if (keyId === selectedKeyId) return
    if (keyDirty) {
      setError(t('settings.gateway.saveBeforeKeyAction'))
      return
    }
    setError(null)
    setSelectedKeyId(keyId)
  }

  const updateNodeDraft = (next: Partial<NodeDraft>) => {
    setNodeDraft((current) => current ? { ...current, ...next } : current)
  }

  const updateKeyDraft = (next: Partial<KeyDraft>) => {
    setKeyDraft((current) => current ? { ...current, ...next } : current)
  }

  const toggleTarget = (target: GatewayTarget) => {
    setKeyDraft((current) => {
      if (!current) return current
      const selected = new Set(current.allowedTargets)
      if (selected.has(target.id)) selected.delete(target.id)
      else selected.add(target.id)
      const defaultTarget = current.defaultTarget === target.id && !selected.has(target.id)
        ? null
        : current.defaultTarget
      return { ...current, allowedTargets: [...selected], defaultTarget }
    })
  }

  const toggleGroup = (targets: GatewayTarget[]) => {
    setKeyDraft((current) => {
      if (!current) return current
      const selected = new Set(current.allowedTargets)
      const shouldSelect = targets.some((target) => !selected.has(target.id))
      for (const target of targets) {
        if (shouldSelect) selected.add(target.id)
        else selected.delete(target.id)
      }
      const defaultTarget = current.defaultTarget && selected.has(current.defaultTarget)
        ? current.defaultTarget
        : null
      return { ...current, allowedTargets: [...selected], defaultTarget }
    })
  }

  const save = async () => {
    if (!status || !nodeDraft) return
    setIsSaving(true)
    setError(null)
    try {
      let nextStatus = status
      if (nodeDirty) {
        const result = await gatewayApi.updateConfig({
          enabled: nodeDraft.enabled,
          publicBaseUrl: nodeDraft.publicBaseUrl.trim() || null,
        })
        nextStatus = result.status
      }
      if (keyDirty && selectedKey && keyDraft) {
        const result = await gatewayApi.updateKey(selectedKey.id, keyDraft)
        nextStatus = result.status
      }
      setStatus(nextStatus)
      setNodeDraft(nodeDraftFromStatus(nextStatus))
      const nextSelectedKey = nextStatus.keys.find((key) => key.id === selectedKeyId)
      setKeyDraft(nextSelectedKey ? keyDraftFromKey(nextSelectedKey) : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const createKey = async () => {
    const name = newKeyName.trim()
    if (!name) return
    setIsSaving(true)
    setError(null)
    try {
      const result = await gatewayApi.createKey({ name })
      setStatus(result.status)
      setNodeDraft(nodeDraftFromStatus(result.status))
      setSelectedKeyId(result.keyId)
      setRevealedKeys((current) => ({ ...current, [result.keyId]: result.apiKey }))
      setShowCreateKey(false)
      setNewKeyName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const renameKey = async (keyId: string, name: string) => {
    setIsSaving(true)
    setError(null)
    try {
      const result = await gatewayApi.updateKey(keyId, { name })
      setStatus(result.status)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const rotateKey = async (keyId: string) => {
    setIsSaving(true)
    setError(null)
    try {
      const result = await gatewayApi.rotateKey(keyId)
      setStatus(result.status)
      setSelectedKeyId(keyId)
      setRevealedKeys((current) => ({ ...current, [keyId]: result.apiKey }))
      setRotateCandidate(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const revokeKey = async (keyId: string) => {
    setIsSaving(true)
    setError(null)
    try {
      const result = await gatewayApi.revokeKey(keyId)
      setStatus(result.status)
      setNodeDraft(nodeDraftFromStatus(result.status))
      setRevealedKeys((current) => {
        const next = { ...current }
        delete next[keyId]
        return next
      })
      setRevokeCandidate(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsSaving(false)
    }
  }

  const resetDrafts = () => {
    if (!status) return
    setNodeDraft(nodeDraftFromStatus(status))
    setKeyDraft(selectedKey ? keyDraftFromKey(selectedKey) : null)
  }

  const nodeNavigation = (
    <div className="flex flex-col gap-[6px]">
      <nav
        aria-label={t('settings.p2p.nodeViews')}
        className="grid grid-cols-2 gap-[6px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[4px]"
        role="tablist"
      >
        {(['gateway', 'p2p'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={nodeView === view}
            onClick={() => setNodeView(view)}
            className={`flex min-h-[34px] items-center justify-center rounded-[6px] px-[12px] text-[12px] font-semibold transition-colors ${
              nodeView === view
                ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t(`settings.p2p.nodeView.${view}` as never)}
          </button>
        ))}
      </nav>
      <p
        aria-live="polite"
        className="px-[4px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]"
      >
        {t(`settings.p2p.nodeViewDescription.${nodeView}` as never)}
      </p>
    </div>
  )

  if (nodeView === 'p2p') {
    return (
      <div className="flex max-w-[920px] flex-col gap-[16px]">
        {nodeNavigation}
        <P2PModelSharingPanel />
      </div>
    )
  }

  const header = (
    <section className="border-b border-[var(--color-border-separator)] pb-[18px]">
      <div className="gateway-node-header flex flex-col gap-[14px]">
        <div className="flex min-w-0 items-start gap-[11px]">
          <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
            <Network size={19} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">{t('settings.gateway.title')}</h2>
            <p className="mt-[3px] max-w-[600px] text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{t('settings.gateway.description')}</p>
          </div>
        </div>
        <div className="gateway-node-header-actions flex shrink-0 items-center gap-[8px] self-end">
          <Button
            variant="ghost"
            size="sm"
            icon={<BookOpenText size={14} />}
            onClick={() => setShowGuide(true)}
          >
            {t('settings.gateway.guide')}
          </Button>
          {status && nodeDraft && (
            <>
              <span className={`text-[11px] font-semibold ${nodeDraft.enabled && status.keys.length > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}`}>
                {nodeDraft.enabled && status.keys.length > 0
                  ? t('settings.gateway.online')
                  : t('settings.gateway.offline')}
              </span>
              <Switch
                checked={nodeDraft.enabled}
                disabled={status.keys.length === 0 || isSaving}
                accent
                ariaLabel={t('settings.gateway.title')}
                onChange={(enabled) => updateNodeDraft({ enabled })}
              />
            </>
          )}
        </div>
      </div>
    </section>
  )
  const guideDialog = (
    <GatewayGuideDialog
      open={showGuide}
      status={status ?? undefined}
      accessKey={selectedKey ?? undefined}
      onClose={() => setShowGuide(false)}
    />
  )

  if (!status || !nodeDraft) {
    return (
      <>
        <div className="flex max-w-[920px] flex-col gap-[16px]">
          {nodeNavigation}
          {header}
          {isLoading ? (
            <GatewayLoadingSkeleton />
          ) : (
            <div className="flex flex-col items-center gap-[12px] py-[36px] text-center">
              <CircleAlert size={20} className="text-[var(--color-error)]" />
              <span className="text-[12px] text-[var(--color-text-secondary)]">{error || t('settings.gateway.loadFailed')}</span>
              <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={() => void load(true)}>{t('common.retry')}</Button>
            </div>
          )}
        </div>
        {guideDialog}
      </>
    )
  }

  return (
    <>
      <div className="flex max-w-[920px] flex-col gap-[16px]">
        {nodeNavigation}
        {header}

      <SettingsSection title={t('settings.gateway.connection')}>
        <div className="gateway-node-connection-grid grid gap-[12px] p-[16px]">
          <CopyField value={status.baseUrl} label={t('settings.gateway.baseUrl')} copyLabel={t('settings.gateway.copy')} />
          <CopyField value={status.anthropicBaseUrl} label={t('settings.gateway.anthropicBaseUrl')} copyLabel={t('settings.gateway.copy')} />
          <div className="gateway-node-connection-wide min-w-0">
            <CopyField value={status.modelsUrl} label={t('settings.gateway.modelsEndpoint')} copyLabel={t('settings.gateway.copy')} />
          </div>
          <div className="gateway-node-connection-wide min-w-0">
            <Input
              label={t('settings.gateway.publicBaseUrl')}
              placeholder="https://agent.example.com"
              value={nodeDraft.publicBaseUrl}
              disabled={isSaving}
              onChange={(event) => updateNodeDraft({ publicBaseUrl: event.target.value })}
            />
            <p className="mt-[6px] text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
              {t('settings.gateway.publicBaseUrlHint')}
            </p>
          </div>
        </div>
      </SettingsSection>

      <GatewayKeyTable
        keys={status.keys}
        selectedKeyId={selectedKeyId}
        revealedKeys={revealedKeys}
        disabled={isSaving || keyDirty}
        onSelect={selectKey}
        onCreate={() => {
          setNewKeyName(t('settings.gateway.defaultKeyName', { index: status.keys.length + 1 }))
          setShowCreateKey(true)
        }}
        onRename={renameKey}
        onRotate={setRotateCandidate}
        onRevoke={setRevokeCandidate}
      />

      {selectedKey && keyDraft && (
        <>
          <TargetPolicySection
            keyName={selectedKey.name}
            draft={keyDraft}
            defaultTarget={resolvedDefaultTarget}
            selectedRoutes={selectedRouteTargets}
            selectedModels={selectedModelTargets}
            routeCount={routeTargets.length}
            modelCount={modelTargets.length}
            disabled={isSaving}
            onUpdateDraft={updateKeyDraft}
            onOpenPicker={(mode, kind) => setTargetPicker({ mode, kind })}
          />
          <GatewayConnectionBuilder
            status={status}
            accessKey={selectedKey}
            revealedKey={revealedKeys[selectedKey.id] ?? null}
            isSaving={isSaving}
            rotationDisabled={keyDirty}
            onRotateKey={() => setRotateCandidate(selectedKey)}
          />
        </>
      )}

      {error && <div role="alert" className="rounded-[8px] border border-[var(--color-error)]/25 bg-[var(--color-error)]/5 px-[12px] py-[10px] text-[12px] text-[var(--color-error)]">{error}</div>}

      <div className="flex items-center justify-end gap-[8px] pt-[2px]">
        {dirty && <span className="mr-auto text-[11px] font-medium text-[var(--color-text-tertiary)]">{t('settings.gateway.unsaved')}</span>}
        <Button variant="secondary" size="sm" disabled={!dirty || isSaving} onClick={resetDrafts}>{t('common.cancel')}</Button>
        <Button size="sm" icon={<ShieldCheck size={14} />} loading={isSaving} disabled={!dirty} onClick={() => void save()}>{t('common.save')}</Button>
      </div>
      </div>
      {guideDialog}
      {selectedKey && keyDraft && targetPicker && (
        <GatewayTargetPicker
          open
          mode={targetPicker.mode}
          initialKind={targetPicker.kind}
          targets={availableTargets}
          selectedTargets={selectedTargets}
          defaultTarget={keyDraft.defaultTarget}
          disabled={isSaving}
          onClose={() => setTargetPicker(null)}
          onToggleTarget={toggleTarget}
          onToggleGroup={toggleGroup}
          onSelectDefault={(defaultTarget) => updateKeyDraft({ defaultTarget })}
        />
      )}
      <Modal
        open={showCreateKey}
        onClose={() => {
          if (!isSaving) setShowCreateKey(false)
        }}
        title={t('settings.gateway.createKeyTitle')}
        width={420}
      >
        <div className="flex flex-col gap-[16px]">
          <Input
            autoFocus
            label={t('settings.gateway.keyName')}
            value={newKeyName}
            maxLength={80}
            disabled={isSaving}
            onChange={(event) => setNewKeyName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newKeyName.trim()) void createKey()
            }}
          />
          <p className="text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">
            {t('settings.gateway.createKeyHint')}
          </p>
          <div className="flex justify-end gap-[8px] border-t border-[var(--color-border-separator)] pt-[14px]">
            <Button
              variant="secondary"
              size="sm"
              disabled={isSaving}
              onClick={() => setShowCreateKey(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              icon={<KeyRound size={14} />}
              loading={isSaving}
              disabled={!newKeyName.trim()}
              onClick={() => void createKey()}
            >
              {t('settings.gateway.createKey')}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={rotateCandidate !== null}
        onClose={() => setRotateCandidate(null)}
        onConfirm={() => rotateCandidate ? rotateKey(rotateCandidate.id) : undefined}
        title={t('settings.gateway.rotateKeyTitle')}
        body={t('settings.gateway.rotateKeyConfirm', {
          name: rotateCandidate?.name ?? '',
        })}
        confirmLabel={t('settings.gateway.rotateKey')}
        cancelLabel={t('common.cancel')}
        loading={isSaving}
      />
      <ConfirmDialog
        open={revokeCandidate !== null}
        onClose={() => setRevokeCandidate(null)}
        onConfirm={() => revokeCandidate ? revokeKey(revokeCandidate.id) : undefined}
        title={t('settings.gateway.revokeKeyTitle')}
        body={t('settings.gateway.revokeKeyConfirm', {
          name: revokeCandidate?.name ?? '',
        })}
        confirmLabel={t('settings.gateway.revokeKey')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isSaving}
      />
    </>
  )
}

function GatewayLoadingSkeleton() {
  return (
    <div aria-label="loading" className="flex flex-col gap-[12px]">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-[88px] animate-pulse rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]"
        />
      ))}
    </div>
  )
}

function GatewayGuideDialog({
  open,
  status,
  accessKey,
  onClose,
}: {
  open: boolean
  status?: GatewayStatus
  accessKey?: GatewayKeyStatus
  onClose: () => void
}) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const [mode, setMode] = useState<'openai' | 'anthropic'>('openai')
  const [showAdvancedTargets, setShowAdvancedTargets] = useState(false)
  const [showTestRequest, setShowTestRequest] = useState(false)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const openaiBaseUrl = status?.baseUrl ?? 'http://127.0.0.1:3456/v1'
  const resolvedAnthropicBaseUrl = status?.anthropicBaseUrl
    ?? status?.baseUrl?.replace(/\/v1$/, '')
    ?? 'http://127.0.0.1:3456'
  const allowedTargets = status?.targets.filter((target) => (
    target.available && accessKey?.allowedTargets.includes(target.id)
  )) ?? []
  const defaultTarget = allowedTargets.find((target) => target.id === accessKey?.defaultTarget)
  const exampleModel = 'auto'
  const exampleBaseUrl = mode === 'openai' ? openaiBaseUrl : resolvedAnthropicBaseUrl
  const exampleProtocol = mode === 'openai'
    ? t('settings.gateway.openAIProtocol')
    : t('settings.gateway.anthropicProtocol')
  const openaiRequest = [
    `curl ${openaiBaseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer ${EXAMPLE_NODE_KEY}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '${JSON.stringify({
      model: exampleModel,
      messages: [{ role: 'user', content: 'hello' }],
    })}'`,
  ].join('\n')
  const anthropicRequest = [
    `curl ${resolvedAnthropicBaseUrl}/v1/messages \\`,
    `  -H "x-api-key: ${EXAMPLE_NODE_KEY}" \\`,
    '  -H "anthropic-version: 2023-06-01" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${JSON.stringify({
      model: exampleModel,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
    })}'`,
  ].join('\n')
  const requestExample = mode === 'openai' ? openaiRequest : anthropicRequest

  const copyValue = async (value: string) => {
    if (!await copyTextToClipboard(value)) return
    setCopiedValue(value)
    window.setTimeout(() => setCopiedValue((current) => current === value ? null : current), 1500)
  }

  return (
    <Modal open={open} onClose={onClose} title={t('settings.gateway.guideTitle')} width={640}>
      <div className="flex flex-col gap-[16px]">
        <p className="text-[12px] leading-[19px] text-[var(--color-text-secondary)]">
          {t('settings.gateway.guideIntro')}
        </p>
        <div
          role="tablist"
          aria-label={t('settings.gateway.guideProtocol')}
          className="grid grid-cols-2 rounded-[8px] bg-[var(--color-surface-container)] p-[3px]"
        >
          {([
            ['openai', t('settings.gateway.guideOpenAI')],
            ['anthropic', t('settings.gateway.guideAnthropic')],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`h-[34px] rounded-[6px] px-[12px] text-[12px] font-semibold transition-colors ${
                mode === value
                  ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          data-testid="gateway-guide-fill-example"
          className="overflow-hidden rounded-[8px] border border-[var(--color-border)]"
        >
          <div className="border-b border-[var(--color-border-separator)] px-[12px] py-[8px] text-[11px] font-semibold text-[var(--color-text-primary)]">
            {t('settings.gateway.guideExampleTitle')}
          </div>
          <dl className="divide-y divide-[var(--color-border-separator)]">
            {[
              [t('settings.gateway.connectionProtocol'), exampleProtocol],
              [t('settings.gateway.baseUrl'), exampleBaseUrl],
              [t('settings.gateway.apiKey'), EXAMPLE_NODE_KEY],
              [t('settings.gateway.guideExampleModel'), exampleModel],
            ].map(([label, value]) => (
              <div key={label} className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-[10px] px-[12px] py-[7px]">
                <dt className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{label}</dt>
                <dd className="break-all font-mono text-[10px] leading-[15px] text-[var(--color-text-secondary)]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)]">
          <button
            type="button"
            aria-expanded={showAdvancedTargets}
            onClick={() => setShowAdvancedTargets((current) => !current)}
            className="flex w-full items-center justify-between gap-[12px] px-[12px] py-[9px] text-left hover:bg-[var(--color-surface-hover)]"
          >
            <span>
              <span className="block text-[11px] font-semibold text-[var(--color-text-primary)]">
                {t('settings.gateway.guideModelChoices')}
              </span>
              <span className="mt-[2px] block text-[10px] leading-[15px] text-[var(--color-text-tertiary)]">
                {t('settings.gateway.guideModelChoicesHint')}
              </span>
            </span>
            {showAdvancedTargets ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showAdvancedTargets && (
            <div className="max-h-[190px] divide-y divide-[var(--color-border-separator)] overflow-y-auto border-t border-[var(--color-border-separator)]">
              {defaultTarget && (
                <GuideTargetRow
                  id="auto"
                  label={t('settings.gateway.guideAutoTarget', { target: defaultTarget.label })}
                  detail={defaultTarget.publicId}
                  copied={copiedValue === 'auto'}
                  onCopy={copyValue}
                />
              )}
              {allowedTargets.map((target) => (
                <GuideTargetRow
                  key={target.id}
                  id={target.publicId}
                  label={t(
                    target.kind === 'route'
                      ? 'settings.gateway.guideRouteTarget'
                      : 'settings.gateway.guideModelTarget',
                    { target: target.label },
                  )}
                  detail={target.description}
                  copied={copiedValue === target.publicId}
                  onCopy={copyValue}
                />
              ))}
              {!defaultTarget && allowedTargets.length === 0 && (
                <div className="px-[12px] py-[16px] text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.gateway.guideNoTargets')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <div className={`flex h-[36px] items-center ${showTestRequest ? 'border-b border-[var(--color-border-separator)]' : ''}`}>
            <button
              type="button"
              aria-expanded={showTestRequest}
              onClick={() => setShowTestRequest((current) => !current)}
              className="flex h-full min-w-0 flex-1 items-center justify-between gap-[10px] px-[12px] text-left"
            >
              <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                {t('settings.gateway.guideRequestExample')}
              </span>
              {showTestRequest ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showTestRequest && (
              <button
                type="button"
                onClick={() => void copyValue(requestExample)}
                aria-label={copiedValue === requestExample ? `${t('settings.gateway.copy')} ✓` : t('settings.gateway.copy')}
                title={copiedValue === requestExample ? `${t('settings.gateway.copy')} ✓` : t('settings.gateway.copy')}
                className="mr-[6px] flex size-[28px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {copiedValue === requestExample ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>
          {showTestRequest && (
            <pre className="max-h-[250px] overflow-auto p-[12px] text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
              <code>{requestExample}</code>
            </pre>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            icon={<BookOpenText size={14} />}
            onClick={() => {
              void openExternalUrl(agentNodeGuideUrl(locale))
            }}
          >
            {t('settings.gateway.openFullGuide')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function GuideTargetRow({
  id,
  label,
  detail,
  copied,
  onCopy,
}: {
  id: string
  label: string
  detail: string
  copied: boolean
  onCopy: (value: string) => Promise<void>
}) {
  const t = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-[10px] px-[12px] py-[9px]">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-[var(--color-text-primary)]">{label}</div>
        <code className="mt-[2px] block break-all text-[10px] leading-[15px] text-[var(--color-text-secondary)]">{id}</code>
        <div className="mt-[1px] truncate text-[10px] text-[var(--color-text-tertiary)]">{detail}</div>
      </div>
      <button
        type="button"
        onClick={() => void onCopy(id)}
        aria-label={`${t('settings.gateway.copy')} ${id}`}
        title={copied ? `${t('settings.gateway.copy')} ✓` : t('settings.gateway.copy')}
        className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}
